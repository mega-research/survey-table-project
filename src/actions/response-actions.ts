'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import { and, eq, isNotNull, sql } from 'drizzle-orm';

import { db } from '@/db';
import {
  contactTargets,
  NewSurveyResponse,
  questions,
  surveyResponses,
} from '@/db/schema';
import type { PageVisit } from '@/db/schema/schema-types';
import { requireAuth } from '@/lib/auth';
import { checkTrackA, checkTrackB } from '@/lib/duplicate-detection/check';
import { computeSignals } from '@/lib/duplicate-detection/signals';
import type { BlockReason, ClientSignals } from '@/lib/duplicate-detection/types';
import { parseBrowser, parsePlatform } from '@/lib/operations/parse-ua';
import {
  buildNegativeCodeExists,
  getResultCodeStatuses,
} from '@/lib/operations/result-code-statuses.server';
import { replaceResponseAnswers } from '@/actions/response-answers-replace';
import { substituteTokens } from '@/lib/survey/substitute-tokens';

// ========================
// 컨택 매칭 helper
// ========================

/**
 * inviteToken 으로 컨택 lookup. 반환 케이스 3가지:
 * - valid: 정상 ct, contactTargetId 매칭됨 (+ respondedAt 동봉 — token_already_used 판정용)
 * - excluded: 부정 결과코드 OR unsubscribed_at IS NOT NULL [응답 차단]
 * - invalid: 토큰 자체가 무효 [익명 폴백]
 *
 * 액션은 mutation 흐름이라 dedupe 가 의미 없어 cache 적용 안 함.
 *
 * SECURITY DEFINER PG 함수 사용 — connection role 이 anon/authenticated 라도
 * RLS 우회해서 contact_target_id 만 안전하게 조회 가능. 다른 attrs/PII 는 노출 안 됨.
 *
 * SECURITY: 차단 사유는 호출자에게 구분 노출하지 않음 [UI 는 동일 카피 — PII].
 */
export type InviteTokenLookupResult =
  | { kind: 'valid'; contactTargetId: string; respondedAt: Date | null }
  | { kind: 'excluded' }
  | { kind: 'invalid' };

export async function findContactByInviteToken(
  surveyId: string,
  inviteToken: string,
): Promise<InviteTokenLookupResult> {
  const lookup = (await db.execute(
    sql`SELECT public.lookup_contact_by_invite_token(${surveyId}::uuid, ${inviteToken}::uuid) AS id`,
  )) as unknown as Array<{ id: string | null }>;
  const contactTargetId = lookup[0]?.id ?? null;
  if (!contactTargetId) return { kind: 'invalid' };

  const { negative: negativeCodes } = await getResultCodeStatuses(surveyId);
  const excludedRows = (await db.execute(sql`
    SELECT 1
    FROM contact_targets ct
    WHERE ct.id = ${contactTargetId}::uuid
      AND (
        ct.unsubscribed_at IS NOT NULL
        ${negativeCodes.length > 0
          ? sql`OR ${buildNegativeCodeExists(negativeCodes, sql`ct.id`)}`
          : sql``}
      )
    LIMIT 1
  `)) as unknown as unknown[];
  if (excludedRows.length > 0) {
    return { kind: 'excluded' };
  }

  const row = await db.query.contactTargets.findFirst({
    where: eq(contactTargets.id, contactTargetId),
    columns: { respondedAt: true },
  });

  return { kind: 'valid', contactTargetId, respondedAt: row?.respondedAt ?? null };
}

// ========================
// 응답 변경 액션 (Mutations)
// ========================

// 아래 3개 함수는 설문 응답자용이므로 인증 체크하지 않음
// - startResponse
// - updateQuestionResponse
// - completeResponse

// 응답 시작
export async function startResponse(
  surveyId: string,
  sessionId?: string,
  versionId?: string,
) {
  const newResponse: NewSurveyResponse = {
    surveyId,
    questionResponses: {},
    isCompleted: false,
    sessionId: sessionId || `session-${Date.now()}`,
    versionId: versionId || null,
  };

  const [response] = await db.insert(surveyResponses).values(newResponse).returning();
  return response;
}

// 질문 응답 업데이트 (원자적 업데이트로 Race Condition 방지)
export async function updateQuestionResponse(
  responseId: string,
  questionId: string,
  value: unknown,
) {
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
 * createResponseWithFirstAnswer / createBlankResponse 의 반환 타입.
 * - created: 응답 행 생성 성공
 * - blocked: 중복 감지로 차단
 */
export type FirstAnswerResult =
  | { kind: 'created'; id: string; contactTargetId: string | null }
  | { kind: 'blocked'; reason: BlockReason };

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
export async function createResponseWithFirstAnswer(input: {
  surveyId: string;
  sessionId: string;
  versionId: string | null;
  questionId: string;
  value: unknown;
  currentStepId: string;
  inviteToken?: string;
  // null 이면 신호 기반 검사 skip — 클라이언트 신호 수집 실패(LocalStorage 차단 등) 시
  // placeholder 신호로 hash 충돌 발생을 방지하기 위해 null 그대로 받는다
  clientSignals: ClientSignals | null;
}): Promise<FirstAnswerResult> {
  const { surveyId, sessionId, versionId, questionId, value, currentStepId, inviteToken, clientSignals } = input;

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
    leftAt: undefined,
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
    pageVisits: [firstVisit],
    contactTargetId,
  };

  // ON CONFLICT DO NOTHING: 동시 INSERT 시 한 쪽만 행을 만들고 다른 쪽은 빈 결과 반환.
  // returning 이 비어있으면 충돌 발생 — 기존 행을 조회해 답변만 적용한다.
  const inserted = await db
    .insert(surveyResponses)
    .values(newResponse)
    .onConflictDoNothing({
      target: [surveyResponses.surveyId, surveyResponses.sessionId],
    })
    .returning({ id: surveyResponses.id, contactTargetId: surveyResponses.contactTargetId });

  if (inserted.length > 0) {
    // INSERT 의 questionResponses 는 JSONB literal 로 들어가 progress_pct 계산이 안 됐다.
    // updateQuestionResponse 를 한 번 더 호출해 progress_pct 를 set 한다. jsonb_set 은
    // 동일 값 덮어쓰기라 멱등.
    await updateQuestionResponse(inserted[0].id, questionId, value);
    return { kind: 'created', id: inserted[0].id, contactTargetId: inserted[0].contactTargetId };
  }

  // 충돌 → 기존 행에 답변 머지. UNIQUE 제약이 있으므로 존재가 보장된다.
  const [existing] = await db
    .select({ id: surveyResponses.id, contactTargetId: surveyResponses.contactTargetId })
    .from(surveyResponses)
    .where(
      and(eq(surveyResponses.surveyId, surveyId), eq(surveyResponses.sessionId, sessionId)),
    )
    .limit(1);

  if (!existing) {
    throw new Error(
      `createResponseWithFirstAnswer: 충돌 후 기존 행 조회 실패 (surveyId=${surveyId}, sessionId=${sessionId})`,
    );
  }

  await updateQuestionResponse(existing.id, questionId, value);
  return { kind: 'created', id: existing.id, contactTargetId: existing.contactTargetId };
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
export async function createBlankResponse(input: {
  surveyId: string;
  sessionId: string;
  versionId: string | null;
  currentStepId: string;
  inviteToken?: string;
  // null 이면 신호 기반 검사 skip (createResponseWithFirstAnswer 와 동일 정책)
  clientSignals: ClientSignals | null;
}): Promise<FirstAnswerResult> {
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
    leftAt: undefined,
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

  const inserted = await db
    .insert(surveyResponses)
    .values(newResponse)
    .onConflictDoNothing({
      target: [surveyResponses.surveyId, surveyResponses.sessionId],
    })
    .returning({ id: surveyResponses.id, contactTargetId: surveyResponses.contactTargetId });

  if (inserted.length > 0) {
    return { kind: 'created', id: inserted[0].id, contactTargetId: inserted[0].contactTargetId };
  }

  const [existing] = await db
    .select({ id: surveyResponses.id, contactTargetId: surveyResponses.contactTargetId })
    .from(surveyResponses)
    .where(
      and(eq(surveyResponses.surveyId, surveyId), eq(surveyResponses.sessionId, sessionId)),
    )
    .limit(1);

  if (!existing) {
    throw new Error(
      `createBlankResponse: 충돌 후 기존 행 조회 실패 (surveyId=${surveyId}, sessionId=${sessionId})`,
    );
  }

  return { kind: 'created', id: existing.id, contactTargetId: existing.contactTargetId };
}

/**
 * 페이지 이동(스텝 전환) 기록.
 *
 * - 동일 stepId면 no-op (React 더블 이펙트, 네비게이션 레이스 방어)
 * - 그 외 단일 UPDATE로 원자적 처리:
 *   - 이전 마지막 pageVisits 항목의 leftAt을 now()로 (NULL일 때만 — 뒤로갔다 앞으로 시 기존 leftAt 보존)
 *   - 새 항목을 pageVisits 끝에 append
 *   - currentStepId, lastActivityAt 갱신
 *
 * @throws 행이 없으면 에러 — 호출자(T5)는 catch & log하되 사용자 흐름은 막지 않는다
 */
export async function recordStepVisit(input: {
  responseId: string;
  nextStepId: string;
}): Promise<void> {
  const { responseId, nextStepId } = input;

  // 단일 UPDATE: WHERE 절에서 currentStepId !== nextStepId 조건으로 멱등성 보장
  // jsonb_set은 마지막 항목의 leftAt이 NULL일 때만 갱신, 그 후 || 로 새 항목 append.
  const result = await db
    .update(surveyResponses)
    .set({
      currentStepId: nextStepId,
      lastActivityAt: new Date(),
      pageVisits: sql`(
        CASE
          WHEN jsonb_array_length(COALESCE(${surveyResponses.pageVisits}, '[]'::jsonb)) > 0
           AND (COALESCE(${surveyResponses.pageVisits}, '[]'::jsonb) -> -1 ->> 'leftAt') IS NULL
          THEN jsonb_set(
                 COALESCE(${surveyResponses.pageVisits}, '[]'::jsonb),
                 ARRAY[(jsonb_array_length(COALESCE(${surveyResponses.pageVisits}, '[]'::jsonb)) - 1)::text, 'leftAt'],
                 to_jsonb(now())
               )
          ELSE COALESCE(${surveyResponses.pageVisits}, '[]'::jsonb)
        END
      ) || jsonb_build_array(
        jsonb_build_object(
          'stepId', ${nextStepId}::text,
          'enteredAt', to_jsonb(now())
        )
      )`,
    })
    .where(
      and(
        eq(surveyResponses.id, responseId),
        // 동일 스텝이면 UPDATE 자체를 건너뛴다 (no-op idempotency)
        sql`COALESCE(${surveyResponses.currentStepId}, '') <> ${nextStepId}`,
      ),
    )
    .returning({ id: surveyResponses.id });

  if (result.length === 0) {
    // 행이 없거나 이미 같은 스텝인 경우. 같은 스텝은 no-op이므로 통과해야 함.
    // → 행 존재 여부를 확인해 행이 없을 때만 throw.
    const exists = await db
      .select({ id: surveyResponses.id })
      .from(surveyResponses)
      .where(eq(surveyResponses.id, responseId))
      .limit(1);

    if (exists.length === 0) {
      throw new Error('응답을 찾을 수 없습니다.');
    }
    // 같은 스텝이면 그냥 통과 (no-op)
  }
}

/**
 * 같은 (surveyId, sessionId) 조합으로 기존 응답이 있으면 회복, 없으면 null 반환.
 *
 * - drop 상태면 in_progress 로 UPDATE + lastActivityAt 갱신
 * - in_progress 면 그대로 (lastActivityAt만 갱신해 stale 방지)
 * - completed/screened_out/quotaful_out/bad 면 그대로 반환 — 호출자가 "이미 끝남" UX 처리
 *
 * 반환 null 이면 첫 진입 — 호출자는 평소대로 createResponseWithFirstAnswer 흐름.
 */
export async function resumeOrCreateResponse(input: {
  surveyId: string;
  sessionId: string;
  inviteToken?: string;
}): Promise<{
  id: string;
  status: 'in_progress' | 'completed' | 'screened_out' | 'quotaful_out' | 'bad' | 'drop';
  resumed: boolean;
} | null> {
  const { surveyId, sessionId, inviteToken } = input;

  // 컨택 매칭 우선순위: 유효한 inviteToken 이 있으면 같은 컨택의 in_progress 응답 우선 resume.
  // - 유효 토큰 + in_progress 행 존재 → 그 행 resume (sessionId 무시)
  // - 유효 토큰 + in_progress 행 없음 → null (호출자가 새 응답 생성)
  // - 무효 토큰 → silent fallback, 일반 sessionId 흐름 진행
  if (inviteToken) {
    const lookup = await findContactByInviteToken(surveyId, inviteToken);
    // excluded 도 valid 외 = null 로 fallback (anonymous sessionId 흐름으로 자연 처리).
    // excluded race 차단은 saveResponse 시점의 checkTrackA 가 별도로 책임.
    const target = lookup.kind === 'valid'
      ? { id: lookup.contactTargetId }
      : null;
    if (target) {
      const [existingByContact] = await db
        .select({
          id: surveyResponses.id,
          status: surveyResponses.status,
        })
        .from(surveyResponses)
        .where(
          and(
            eq(surveyResponses.contactTargetId, target.id),
            eq(surveyResponses.isCompleted, false),
          ),
        )
        .limit(1);

      if (existingByContact) {
        const now = new Date();
        if (existingByContact.status === 'drop') {
          await db
            .update(surveyResponses)
            .set({ status: 'in_progress', lastActivityAt: now })
            .where(eq(surveyResponses.id, existingByContact.id));
          return { id: existingByContact.id, status: 'in_progress', resumed: true };
        }
        if (existingByContact.status === 'in_progress') {
          await db
            .update(surveyResponses)
            .set({ lastActivityAt: now })
            .where(eq(surveyResponses.id, existingByContact.id));
          return { id: existingByContact.id, status: 'in_progress', resumed: false };
        }
        // isCompleted=false 인데 in_progress/drop 도 아닌 알 수 없는 status → fallback
      }
      // 유효 토큰이지만 매칭되는 in_progress 응답 없음 → 새 응답 흐름
      return null;
    }
    // 토큰 무효 → 일반 sessionId 흐름 fallback
  }

  const [existing] = await db
    .select({
      id: surveyResponses.id,
      status: surveyResponses.status,
    })
    .from(surveyResponses)
    .where(
      and(eq(surveyResponses.surveyId, surveyId), eq(surveyResponses.sessionId, sessionId)),
    )
    .limit(1);

  if (!existing) return null;

  const now = new Date();

  if (existing.status === 'drop') {
    // 회복 — drop → in_progress, lastActivityAt 새로 박는다
    await db
      .update(surveyResponses)
      .set({ status: 'in_progress', lastActivityAt: now })
      .where(eq(surveyResponses.id, existing.id));
    return { id: existing.id, status: 'in_progress', resumed: true };
  }

  if (existing.status === 'in_progress') {
    // stale 방지용 lastActivityAt 터치
    await db
      .update(surveyResponses)
      .set({ lastActivityAt: now })
      .where(eq(surveyResponses.id, existing.id));
    return { id: existing.id, status: 'in_progress', resumed: false };
  }

  // 종결 상태 — 알려진 값만 통과시키고 알 수 없으면 null 로 fallback
  const concludedStatuses = ['completed', 'screened_out', 'quotaful_out', 'bad'] as const;
  type ConcludedStatus = (typeof concludedStatuses)[number];
  if ((concludedStatuses as readonly string[]).includes(existing.status)) {
    return {
      id: existing.id,
      status: existing.status as ConcludedStatus,
      resumed: false,
    };
  }
  // 알 수 없는 status — 호출자가 새 응답 흐름으로 가도록 null 반환
  console.warn(
    `[resumeOrCreateResponse] 알 수 없는 status 발견: ${existing.status} (id=${existing.id})`,
  );
  return null;
}

// 응답 완료 (JSONB + response_answers 이중 쓰기)
// 읽기: response_answers 우선 (getResponsesWithAnswers), JSONB fallback
// JSONB 쓰기는 마이그레이션 완료 + 모든 읽기 경로 전환 후 제거 예정
export async function completeResponse(
  responseId: string,
  data?: {
    questionResponses?: Record<string, unknown>;
    exposedQuestionIds?: string[];
    exposedRowIds?: string[];
  },
) {
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

    const contactTargetId = responseRow[0]?.contactTargetId;

    if (contactTargetId) {
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
            eq(questions.surveyId, responseRow[0].surveyId),
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

  revalidatePath('/analytics');
  return result;
}


