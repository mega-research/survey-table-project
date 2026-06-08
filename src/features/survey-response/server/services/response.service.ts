import 'server-only';

import { headers } from 'next/headers';

import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';

import { db } from '@/db';
import {
  contactTargets,
  NewSurveyResponse,
  questions,
  surveyResponses,
} from '@/db/schema';
import type { PageVisit } from '@/db/schema/schema-types';
import { checkTrackA, checkTrackB } from '@/lib/duplicate-detection/check';
import { computeSignals } from '@/lib/duplicate-detection/signals';
import { sumActiveSeconds } from '@/lib/operations/active-seconds';
import { parseBrowser, parsePlatform } from '@/lib/operations/parse-ua';
import { substituteTokens } from '@/lib/survey/substitute-tokens';

import type {
  CompleteResponseInput,
  CreateBlankResponseInput,
  CreateResponseWithFirstAnswerInput,
  FirstAnswerResult,
  StartResponseInput,
  SurveyResponse,
  UpdateQuestionResponseInput,
} from '../../domain/response';
import { replaceResponseAnswers } from './response-answers.service';

// ========================
// 컨택 매칭 helper
// ========================

/**
 * 동일 컨택의 활성 응답(미완료, soft-delete 제외) 1건 조회.
 * idx_active_response_per_contact partial unique index 가 동일 contact_target_id 의
 * 미완료 응답을 1개로 제한하므로, 재진입 시 기존 행을 재사용한다.
 */
async function findActiveResponseByContact(
  surveyId: string,
  contactTargetId: string,
): Promise<{ id: string; contactTargetId: string | null } | null> {
  const [row] = await db
    .select({ id: surveyResponses.id, contactTargetId: surveyResponses.contactTargetId })
    .from(surveyResponses)
    .where(
      and(
        eq(surveyResponses.surveyId, surveyId),
        eq(surveyResponses.contactTargetId, contactTargetId),
        eq(surveyResponses.isCompleted, false),
        isNull(surveyResponses.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * survey_responses 행 INSERT 의 공통 흐름.
 *
 * 처리 분기:
 * 1. 동일 컨택 활성 응답 존재 → 재사용 (재진입 케이스)
 * 2. (surveyId, sessionId) ON CONFLICT DO NOTHING — 동시 INSERT race 차단
 * 3. partial unique (idx_active_response_per_contact) race → catch + 활성 응답 재조회
 * 4. sessionId 충돌 → 기존 행 lookup
 *
 * `onReuse` 콜백이 있으면 1·3·4 의 재사용/충돌 경로에서 호출되어 첫 답변 머지 등을 수행.
 */
async function insertResponseWithContactReuse(params: {
  surveyId: string;
  sessionId: string;
  contactTargetId: string | null;
  newResponse: NewSurveyResponse;
  onReuse?: (id: string) => Promise<void>;
}): Promise<{ id: string; contactTargetId: string | null }> {
  const { surveyId, sessionId, contactTargetId, newResponse, onReuse } = params;

  if (contactTargetId) {
    const active = await findActiveResponseByContact(surveyId, contactTargetId);
    if (active) {
      if (onReuse) await onReuse(active.id);
      return active;
    }
  }

  let inserted: Array<{ id: string; contactTargetId: string | null }>;
  try {
    inserted = await db
      .insert(surveyResponses)
      .values(newResponse)
      .onConflictDoNothing({
        target: [surveyResponses.surveyId, surveyResponses.sessionId],
      })
      .returning({ id: surveyResponses.id, contactTargetId: surveyResponses.contactTargetId });
  } catch (e) {
    if (contactTargetId) {
      const active = await findActiveResponseByContact(surveyId, contactTargetId);
      if (active) {
        if (onReuse) await onReuse(active.id);
        return active;
      }
    }
    throw e;
  }

  const firstInserted = inserted[0];
  if (firstInserted !== undefined) return firstInserted;

  const [existing] = await db
    .select({ id: surveyResponses.id, contactTargetId: surveyResponses.contactTargetId })
    .from(surveyResponses)
    .where(
      and(eq(surveyResponses.surveyId, surveyId), eq(surveyResponses.sessionId, sessionId)),
    )
    .limit(1);

  if (!existing) {
    throw new Error(
      `insertResponseWithContactReuse: 충돌 후 기존 행 조회 실패 (surveyId=${surveyId}, sessionId=${sessionId})`,
    );
  }

  if (onReuse) await onReuse(existing.id);
  return existing;
}

// ========================
// 응답 변경 service (Mutations)
// ========================

// 아래 함수들은 설문 응답자용이므로 인증 체크하지 않음(pub 미들웨어):
// - startResponse
// - updateQuestionResponse
// - createResponseWithFirstAnswer
// - createBlankResponse
// - completeResponse

// 응답 시작
export async function startResponse(input: StartResponseInput): Promise<SurveyResponse> {
  const { surveyId, sessionId, versionId } = input;

  const newResponse: NewSurveyResponse = {
    surveyId,
    questionResponses: {},
    isCompleted: false,
    sessionId: sessionId || `session-${Date.now()}`,
    versionId: versionId || null,
  };

  const [response] = await db.insert(surveyResponses).values(newResponse).returning();
  if (!response) {
    throw new Error('startResponse: 응답 행 INSERT 실패');
  }
  return response;
}

// 질문 응답 업데이트 (원자적 업데이트로 Race Condition 방지)
export async function updateQuestionResponse(
  input: UpdateQuestionResponseInput,
): Promise<SurveyResponse> {
  const { responseId, questionId, value } = input;

  // jsonb_set 으로 답변 저장 + progress_pct 동기 갱신.
  // progress_pct 는 versionId 의 snapshot 에서 questionId 의 1-based position 을 찾아
  // (position / totalQuestions) × 100 으로 계산. GREATEST 로 단조 증가 보장 (앞 질문 수정
  // 시 % 후퇴 방지). snapshot 깨졌거나 questionId 가 snapshot 에 없으면 inner subquery
  // 가 NULL → COALESCE(0) → GREATEST 가 기존값 유지.
  // 방어: non-array snapshot 은 CASE 로 빈 배열 fallback (ERROR 방지). 최종 0 은 NULLIF
  // 로 NULL 로 변환해 "0%" 오표시 회피 (UI 가 NULL → '—' 표시).
  const [updated] = await db
    .update(surveyResponses)
    .set({
      questionResponses: sql`jsonb_set(
        COALESCE(${surveyResponses.questionResponses}, '{}'::jsonb),
        ARRAY[${questionId}],
        ${JSON.stringify(value)}::jsonb,
        true
      )`,
      progressPct: sql`NULLIF(LEAST(100, GREATEST(
        COALESCE(${surveyResponses.progressPct}, 0),
        COALESCE((
          SELECT ROUND((t.idx::numeric
                        / NULLIF(jsonb_array_length(
                            CASE WHEN jsonb_typeof(sv.snapshot->'questions') = 'array'
                                 THEN sv.snapshot->'questions'
                                 ELSE '[]'::jsonb
                            END
                          ), 0)) * 100)::int
          FROM survey_versions sv,
               jsonb_array_elements(
                 CASE WHEN jsonb_typeof(sv.snapshot->'questions') = 'array'
                      THEN sv.snapshot->'questions'
                      ELSE '[]'::jsonb
                 END
               ) WITH ORDINALITY AS t(elem, idx)
          WHERE sv.id = ${surveyResponses.versionId}
            AND elem->>'id' = ${questionId}
          LIMIT 1
        ), 0)
      ))::smallint, 0)`,
    })
    .where(eq(surveyResponses.id, responseId))
    .returning();

  if (!updated) {
    throw new Error('응답을 찾을 수 없습니다.');
  }

  return updated;
}

// ========================
// 운영 현황 콘솔 — 응답 라이프사이클 통합 지점 (T4)
// ========================

/**
 * 첫 답변과 함께 survey_responses 행을 INSERT.
 *
 * - UA를 서버 헤더에서 읽어 platform/browser를 파싱
 * - 첫 답변(`questionResponses`)과 첫 페이지 방문 기록을 함께 기록
 * - 동일 (surveyId, sessionId) 조합 동시 INSERT race 는 DB UNIQUE 제약 +
 *   `ON CONFLICT DO NOTHING` 으로 차단. 충돌 시 기존 행에 답변만 적용.
 * - clientSignals 로 중복 감지 재검증 (bypass defense). 차단 시 blocked 반환.
 *
 * @returns created (생성/기존 행 id) 또는 blocked (중복 감지)
 */
export async function createResponseWithFirstAnswer(
  input: CreateResponseWithFirstAnswerInput,
): Promise<FirstAnswerResult> {
  const { surveyId, sessionId, versionId, questionId, value, currentStepId, visibleStepIndex, visibleStepTotal, inviteToken, clientSignals } = input;

  // UA + IP (Next 15+ 비동기 headers API)
  const headerStore = await headers();
  const userAgent = headerStore.get('user-agent') ?? null;
  const platform = parsePlatform(userAgent);
  const browser = parseBrowser(userAgent);

  // 신호 계산: ipHash, fpHash, deviceId (clientSignals null 이면 모두 null)
  const signals = clientSignals ? computeSignals(headerStore, clientSignals) : null;

  // 중복 감지 재검증 (bypass defense — checkDuplicateOnEntry 우회 시 server action에서 2차 차단)
  // checkTrackA 가 통과 시 contactTargetId 를 반환하므로 그대로 사용 (중복 DB 호출 회피)
  // clientSignals null 시 Track B 검사 skip (수용된 trade-off — fallback 신호로 거짓 차단 회피)
  let contactTargetId: string | null = null;
  if (inviteToken) {
    const trackA = await checkTrackA(surveyId, inviteToken);
    if (trackA.blocked) return { kind: 'blocked', reason: trackA.reason };
    contactTargetId = trackA.contactTargetId ?? null;
  } else if (signals) {
    const trackB = await checkTrackB({ surveyId, signals });
    if (trackB.blocked) return { kind: 'blocked', reason: trackB.reason };
  }

  const firstVisit: PageVisit = {
    stepId: currentStepId,
    enteredAt: new Date().toISOString(),
  };

  const newResponse: NewSurveyResponse = {
    surveyId,
    sessionId,
    versionId: versionId ?? null,
    questionResponses: { [questionId]: value },
    isCompleted: false,
    status: 'in_progress',
    userAgent,
    ipHash: signals?.ipHash ?? null,
    fpHash: signals?.fpHash ?? null,
    deviceId: signals?.deviceId ?? null,
    platform,
    browser,
    currentStepId,
    visibleStepIndex: visibleStepIndex ?? null,
    visibleStepTotal: visibleStepTotal ?? null,
    pageVisits: [firstVisit],
    contactTargetId,
  };

  const result = await insertResponseWithContactReuse({
    surveyId,
    sessionId,
    contactTargetId,
    newResponse,
  });
  // 신규 INSERT 든 reuse 든 모두 updateQuestionResponse 로 첫 답변 머지 + progress_pct
  // 갱신을 단일화. jsonb_set 은 동일 값 덮어쓰기라 멱등이라 신규 INSERT path 의 중복 set
  // 도 안전. onReuse 콜백을 사용하지 않는 이유: progress_pct 가 신규 INSERT 에서도 필요.
  await updateQuestionResponse({ responseId: result.id, questionId, value });
  return { kind: 'created', id: result.id, contactTargetId: result.contactTargetId };
}

/**
 * 답변 없이 응답 행을 INSERT.
 *
 * notice-only / optional-only / visible-question-0 인 설문은 첫 답변이 발생하지 않아
 * createResponseWithFirstAnswer 가 트리거되지 않는다. 사용자가 그 상태로 제출을 누르면
 * survey_responses 가 만들어지지 않은 채 화면만 완료로 바뀌어 silent data loss 가 됨.
 * 호출자(handleSubmit)는 currentResponseId === null 일 때만 이 함수를 fallback 으로 호출한다.
 *
 * createResponseWithFirstAnswer 와 동일하게:
 * - (surveyId, sessionId) UNIQUE 제약으로 멱등 (ON CONFLICT DO NOTHING)
 * - inviteToken 으로 contactTargetId 매칭
 * - UA/platform/browser/firstVisit 캡처
 * - clientSignals 로 중복 감지 재검증 (bypass defense)
 *
 * 충돌(=이미 답변이 있는 row 존재) 시 기존 row 의 id 를 그대로 반환.
 */
export async function createBlankResponse(
  input: CreateBlankResponseInput,
): Promise<FirstAnswerResult> {
  const { surveyId, sessionId, versionId, currentStepId, inviteToken, clientSignals } = input;

  const headerStore = await headers();
  const userAgent = headerStore.get('user-agent') ?? null;
  const platform = parsePlatform(userAgent);
  const browser = parseBrowser(userAgent);

  // 신호 계산: ipHash, fpHash, deviceId (clientSignals null 이면 모두 null)
  const signals = clientSignals ? computeSignals(headerStore, clientSignals) : null;

  // 중복 감지 재검증 (bypass defense). checkTrackA 반환의 contactTargetId 를 재사용해 중복 DB 호출 회피
  // clientSignals null 시 Track B 검사 skip
  let contactTargetId: string | null = null;
  if (inviteToken) {
    const trackA = await checkTrackA(surveyId, inviteToken);
    if (trackA.blocked) return { kind: 'blocked', reason: trackA.reason };
    contactTargetId = trackA.contactTargetId ?? null;
  } else if (signals) {
    const trackB = await checkTrackB({ surveyId, signals });
    if (trackB.blocked) return { kind: 'blocked', reason: trackB.reason };
  }

  const firstVisit: PageVisit = {
    stepId: currentStepId,
    enteredAt: new Date().toISOString(),
  };

  const newResponse: NewSurveyResponse = {
    surveyId,
    sessionId,
    versionId: versionId ?? null,
    questionResponses: {},
    isCompleted: false,
    status: 'in_progress',
    userAgent,
    ipHash: signals?.ipHash ?? null,
    fpHash: signals?.fpHash ?? null,
    deviceId: signals?.deviceId ?? null,
    platform,
    browser,
    currentStepId,
    pageVisits: [firstVisit],
    contactTargetId,
  };

  const result = await insertResponseWithContactReuse({
    surveyId,
    sessionId,
    contactTargetId,
    newResponse,
  });
  return { kind: 'created', id: result.id, contactTargetId: result.contactTargetId };
}

// 응답 완료 (JSONB + response_answers 이중 쓰기)
// 읽기: response_answers 우선 (getResponsesWithAnswers), JSONB fallback
// JSONB 쓰기는 마이그레이션 완료 + 모든 읽기 경로 전환 후 제거 예정
export async function completeResponse(
  input: CompleteResponseInput,
): Promise<SurveyResponse> {
  const { responseId, data } = input;

  // prefill 재검증: defaultValueTemplate 이 있는 질문의 응답값은
  // contact_targets.attrs 로 치환한 expected 와 일치해야 함.
  // 클라이언트가 disabled 입력을 우회 조작해도 서버에서 expected 값으로 강제 복원.
  let validatedResponses: Record<string, unknown> | undefined = data?.questionResponses;
  if (data?.questionResponses) {
    const responseRow = await db
      .select({ contactTargetId: surveyResponses.contactTargetId, surveyId: surveyResponses.surveyId })
      .from(surveyResponses)
      .where(eq(surveyResponses.id, responseId))
      .limit(1);

    const firstResponseRow = responseRow[0];
    const contactTargetId = firstResponseRow?.contactTargetId;

    if (contactTargetId && firstResponseRow) {
      const [target] = await db
        .select({ attrs: contactTargets.attrs })
        .from(contactTargets)
        .where(eq(contactTargets.id, contactTargetId))
        .limit(1);
      const attrs = (target?.attrs ?? {}) as Record<string, string>;

      const prefillQuestions = await db
        .select({ id: questions.id, template: questions.defaultValueTemplate })
        .from(questions)
        .where(
          and(
            eq(questions.surveyId, firstResponseRow.surveyId),
            isNotNull(questions.defaultValueTemplate),
          ),
        );

      validatedResponses = { ...data.questionResponses };
      for (const q of prefillQuestions) {
        if (!q.template?.trim()) continue;
        const expected = substituteTokens(q.template, attrs);
        const submitted = validatedResponses[q.id];
        if (typeof submitted === 'string' && submitted !== expected) {
          // 조작 의심 — 서버에서 expected 값으로 강제 복원 (silent)
          validatedResponses[q.id] = expected;
        }
      }
    }
  }

  const result = await db.transaction(async (tx) => {
    // 1. 기존 JSONB 방식 저장 + 운영 현황 추적 컬럼 갱신
    const [updated] = await tx
      .update(surveyResponses)
      .set({
        isCompleted: true,
        completedAt: new Date(),
        // 운영 현황 콘솔용 추적 컬럼
        status: 'completed',
        progressPct: 100,
        lastActivityAt: new Date(),
        // 서버 클럭 기준 경과 초 (started_at부터 now()까지)
        totalSeconds: sql`EXTRACT(EPOCH FROM (now() - ${surveyResponses.startedAt}))::int`,
        // 마지막 pageVisits 항목의 leftAt이 NULL이면 now()로 백필
        // (sweep_stale_sessions 함수의 CASE 패턴과 동일)
        pageVisits: sql`CASE
          WHEN jsonb_array_length(COALESCE(${surveyResponses.pageVisits}, '[]'::jsonb)) > 0
           AND (COALESCE(${surveyResponses.pageVisits}, '[]'::jsonb) -> -1 ->> 'leftAt') IS NULL
          THEN jsonb_set(
                 COALESCE(${surveyResponses.pageVisits}, '[]'::jsonb),
                 ARRAY[(jsonb_array_length(COALESCE(${surveyResponses.pageVisits}, '[]'::jsonb)) - 1)::text, 'leftAt'],
                 to_jsonb(now())
               )
          ELSE COALESCE(${surveyResponses.pageVisits}, '[]'::jsonb)
        END`,
        ...(validatedResponses ? { questionResponses: validatedResponses } : {}),
        ...((data?.exposedQuestionIds || data?.exposedRowIds)
          ? {
            metadata: {
              ...(data?.exposedQuestionIds
                ? { exposedQuestionIds: data.exposedQuestionIds }
                : {}),
              ...(data?.exposedRowIds ? { exposedRowIds: data.exposedRowIds } : {}),
            },
          }
          : {}),
      })
      .where(eq(surveyResponses.id, responseId))
      .returning();

    if (!updated) {
      throw new Error(`completeResponse: 응답 행 없음 (responseId=${responseId})`);
    }

    // totalSeconds 정정: pageVisits 활성시간 합으로 덮어쓴다.
    // (UPDATE 1의 벽시계 EXTRACT는 활성 segment가 없을 때의 폴백으로 남는다.)
    // 백필된 updated.pageVisits 기준 — 마지막 leftAt이 now()로 채워진 상태.
    const activeSeconds = sumActiveSeconds(updated.pageVisits as PageVisit[] | null);
    if (activeSeconds !== null) {
      await tx
        .update(surveyResponses)
        .set({ totalSeconds: activeSeconds })
        .where(eq(surveyResponses.id, responseId));
    }

    // 2. response_answers 정규화 저장 (replaceResponseAnswers — saveAdminEdit 과 공유)
    if (validatedResponses && Object.keys(validatedResponses).length > 0) {
      await replaceResponseAnswers(
        tx,
        responseId,
        updated.surveyId,
        validatedResponses,
      );
    }

    return updated;
  });

  // 컨택 매칭 후처리: 트랜잭션 외부에서 best-effort UPDATE.
  // 실패하더라도 응답 완료 자체는 성공으로 처리한다 (응답 완료 우선).
  if (result?.contactTargetId) {
    try {
      const completedAt = new Date();
      await db
        .update(contactTargets)
        .set({
          respondedAt: completedAt,
          responseId: result.id,
          updatedAt: completedAt,
        })
        .where(eq(contactTargets.id, result.contactTargetId));
    } catch (err) {
      console.error(
        `[completeResponse] contact_targets UPDATE 실패 — 응답 완료는 성공 (responseId=${result.id}, contactTargetId=${result.contactTargetId})`,
        err,
      );
    }
  }

  // revalidatePath('/analytics') 는 백엔드에서 제거 — 공개 응답이 admin /analytics
  // 캐시를 cross 무효화하던 부분으로, 소비처 통합 단계에서 query invalidation 등으로 보강.
  return result;
}
