import 'server-only';

import { randomUUID } from 'node:crypto';

import { headers } from 'next/headers';

import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';

import { db } from '@/db';
import {
  contactTargets,
  NewSurveyResponse,
  questions,
  surveyResponses,
  surveys,
  surveyVersions,
} from '@/db/schema';
import type { PageVisit } from '@/db/schema/schema-types';
import { checkTrackA, checkTrackB } from '@/lib/duplicate-detection/check';
import { computeSignals } from '@/lib/duplicate-detection/signals';
import { sumActiveSeconds } from '@/lib/operations/active-seconds';
import { parseBrowser, parsePlatform } from '@/lib/operations/parse-ua';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { isValidTestToken } from '@/lib/survey-control';

import type {
  ClientSignals,
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
// 응답 가용성 게이트 (#3) — 변조 가드 상수 (#5)
// ========================

/**
 * 단일 질문 응답값의 직렬화 바이트 상한.
 * 정상 응답(랭킹/테이블 매트릭스 포함)은 수 KB 수준이므로 256KB 면 충분히 여유롭다.
 * 미인증 응답자가 거대 JSONB 를 주입해 저장소/직렬화 비용을 폭증시키는 것을 차단한다.
 */
const MAX_ANSWER_VALUE_BYTES = 256 * 1024;

/** 가용성 게이트 입력 — 이미 조회된 설문 행의 부분집합. */
type SurveyGateRow = {
  status: string;
  endDate: Date | null;
  maxResponses: number | null;
  isPublic: boolean;
  requireInviteToken: boolean;
  // #24 버전 무결성: 클라 제공 versionId 의 "현재 활성" 판정에 사용.
  currentVersionId: string | null;
  // 설문 중단·테스트 모드 (isValidTestToken 판정 + paused 게이트에 사용).
  isPaused: boolean;
  testModeEnabled: boolean;
  testToken: string | null;
};

/** 가용성 게이트 입력 — 응답 시점 활성 버전(없으면 null). */
type VersionGateRow = { status: string } | null;

/** 응답 가용성 게이트 위반 시 던지는 에러. pub 엔드포인트라 호출자에 사유를 세분 노출하지 않는다. */
export class SurveyNotAcceptingResponsesError extends Error {
  constructor(reason: string) {
    super(`응답을 받을 수 없는 설문입니다. (${reason})`);
    this.name = 'SurveyNotAcceptingResponsesError';
  }
}

/**
 * 설문이 현재 응답을 받을 수 있는 상태인지 검증한다. 위반 시 throw.
 *
 * 검사 항목:
 * - 설문 status === 'published' (또는 활성 version 이 published) 가 아니면 거부.
 * - endDate 가 null 또는 미래여야 함. 경과 시 거부.
 * - maxResponses: completedCount 가 주어지면(=완료 시점 하드체크) 완료 카운트 < maxResponses 검사.
 *   create 시점은 completedCount 를 넘기지 않아 soft(검사 생략) — 잔여 race window 는 수용.
 *   complete 시점 count 쿼리와 실제 UPDATE 사이의 동시성 갭(여러 응답이 동시에 마지막 정원을
 *   채우는 경우)도 DB 레벨 락 없이 허용하는 잔여 window 다(문서화된 trade-off).
 * - isPublic === false 면 유효 invite(contactTargetId)가 필요. requireInviteToken 이면 토큰 강제
 *   (기존 checkTrackA 가 inviteToken 유효성을 별도 검증하므로 여기서는 contactTargetId 매칭 유무만 본다).
 *   단, isTest(테스트 세션)면 예외 — 테스트 링크는 invite 없이 진입하는 것이 정상 설계다.
 * - survey.isPaused 면 거부. 단, isTest(테스트 세션)면 예외 — 운영자가 중단 중에도 테스트
 *   링크로 미리보기/QA 할 수 있어야 한다(스펙 5절).
 */
function assertSurveyAcceptingResponses(
  survey: SurveyGateRow,
  version: VersionGateRow,
  opts: { contactTargetId: string | null; completedCount?: number | null; isTest: boolean },
): void {
  // status: 설문 자체가 published 이거나, 활성 version 이 published 여야 함.
  const surveyPublished = survey.status === 'published';
  const versionPublished = version?.status === 'published';
  if (!surveyPublished && !versionPublished) {
    throw new SurveyNotAcceptingResponsesError('status_not_published');
  }

  // 중단 모드: 테스트 세션(isTest)만 예외 (스펙 5절)
  if (survey.isPaused && !opts.isTest) {
    throw new SurveyNotAcceptingResponsesError('survey_paused');
  }

  // endDate 경과
  if (survey.endDate != null && survey.endDate.getTime() <= Date.now()) {
    throw new SurveyNotAcceptingResponsesError('end_date_passed');
  }

  // maxResponses 하드체크 (complete 시점에만 completedCount 전달)
  if (
    survey.maxResponses != null &&
    opts.completedCount != null &&
    opts.completedCount >= survey.maxResponses
  ) {
    throw new SurveyNotAcceptingResponsesError('max_responses_reached');
  }

  // 비공개 설문 / invite 강제 — 테스트 세션(isTest)은 invite 없이 진입하는 것이 정상이므로 예외.
  if (
    (survey.isPublic === false || survey.requireInviteToken) &&
    opts.contactTargetId == null &&
    !opts.isTest
  ) {
    throw new SurveyNotAcceptingResponsesError('invite_required');
  }
}

/** 가용성 게이트용 설문 행 조회. 없으면 throw. */
async function loadSurveyGateRow(surveyId: string): Promise<SurveyGateRow> {
  const row = await db.query.surveys.findFirst({
    where: and(eq(surveys.id, surveyId), isNull(surveys.deletedAt)),
    columns: {
      status: true,
      endDate: true,
      maxResponses: true,
      isPublic: true,
      requireInviteToken: true,
      currentVersionId: true,
      isPaused: true,
      testModeEnabled: true,
      testToken: true,
    },
  });
  if (!row) {
    throw new SurveyNotAcceptingResponsesError('survey_not_found');
  }
  return row;
}

/** 활성 버전 행 조회. versionId 없으면 null. */
async function loadVersionGateRow(versionId: string | null | undefined): Promise<VersionGateRow> {
  if (!versionId) return null;
  const row = await db.query.surveyVersions.findFirst({
    where: and(eq(surveyVersions.id, versionId), isNull(surveyVersions.deletedAt)),
    columns: { status: true },
  });
  return row ?? null;
}

/**
 * #24 버전 무결성 가드 — 클라 제공 versionId 의 소속/유효성 검증.
 *
 * 응답 행 생성 시점(startResponse/create*)에 클라이언트가 보내는 versionId 는 신뢰할 수 없다.
 * - versionId 가 null/undefined 면 레거시/버전 미연결 경로 — 검증 skip, null 반환(기존 동작 보존).
 * - versionId 가 있으면 그 행이 (a) 동일 surveyId 에 속하고 (b) 유효(published 또는 surveys.
 *   currentVersionId 와 일치하는 현재 활성 버전)해야 한다. 위반 시 throw 로 거부한다.
 *   타 설문의 versionId / 미존재 / 비published 비활성 버전 주입으로 응답이 엉뚱한 스냅샷에
 *   바인딩되는 것을 차단한다.
 *
 * 반환값은 downstream assertSurveyAcceptingResponses 의 VersionGateRow 입력으로 그대로 쓴다.
 */
async function loadValidatedVersionGateRow(
  surveyId: string,
  versionId: string | null | undefined,
  currentVersionId: string | null,
): Promise<VersionGateRow> {
  if (!versionId) return null;
  const row = await db.query.surveyVersions.findFirst({
    where: and(eq(surveyVersions.id, versionId), isNull(surveyVersions.deletedAt)),
    columns: { surveyId: true, status: true },
  });
  // 미존재 또는 타 설문 소속이면 거부.
  if (!row || row.surveyId !== surveyId) {
    throw new SurveyNotAcceptingResponsesError('version_mismatch');
  }
  // 유효성: published 이거나 설문의 현재 활성 버전(currentVersionId)이어야 한다.
  const isPublished = row.status === 'published';
  const isCurrent = currentVersionId != null && currentVersionId === versionId;
  if (!isPublished && !isCurrent) {
    throw new SurveyNotAcceptingResponsesError('version_not_active');
  }
  return { status: row.status };
}

/**
 * questionId 가 응답이 가리키는 질문 집합에 존재하는지 검증한다. 미존재면 throw.
 *
 * - versionId 가 있으면 그 버전 스냅샷(snapshot->'questions')의 멤버십을 검사한다
 *   (응답은 응답 시점 스냅샷을 기준으로 하므로 권위 소스). non-array 스냅샷은 빈 배열로 폴백.
 * - versionId 가 없으면(레거시/버전 미연결) surveyId 의 라이브 questions 테이블로 폴백.
 *
 * 임의 키 JSONB 주입(설문에 없는 questionId 로 questionResponses 오염)을 차단한다.
 */
async function assertQuestionBelongsToResponse(
  versionId: string | null,
  surveyId: string,
  questionId: string,
): Promise<void> {
  if (versionId) {
    const [hit] = await db
      .select({ id: surveyVersions.id })
      .from(surveyVersions)
      .where(
        and(
          eq(surveyVersions.id, versionId),
          sql`EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(${surveyVersions.snapshot}->'questions') = 'array'
                   THEN ${surveyVersions.snapshot}->'questions'
                   ELSE '[]'::jsonb
              END
            ) AS qe(elem)
            WHERE qe.elem->>'id' = ${questionId}
          )`,
        ),
      )
      .limit(1);
    if (!hit) {
      throw new Error('해당 설문에 존재하지 않는 질문입니다.');
    }
    return;
  }

  const [hit] = await db
    .select({ id: questions.id })
    .from(questions)
    .where(and(eq(questions.surveyId, surveyId), eq(questions.id, questionId)))
    .limit(1);
  if (!hit) {
    throw new Error('해당 설문에 존재하지 않는 질문입니다.');
  }
}

/**
 * assertQuestionBelongsToResponse 의 "집합 반환" 버전.
 *
 * 응답이 가리키는 질문 전체의 id 집합을 단일 쿼리로 수집한다(N+1 금지).
 * - versionId 가 있으면 그 버전 스냅샷(snapshot->'questions')의 모든 elem->>'id' 를 권위 소스로 사용.
 *   non-array 스냅샷은 빈 배열로 폴백.
 * - versionId 가 없으면(레거시/버전 미연결) surveyId 의 라이브 questions 테이블로 폴백.
 *
 * completeResponse 의 JSONB 오염 가드(멤버십 필터)에서 사용한다. updateQuestionResponse 는
 * 단건 검증이라 assertQuestionBelongsToResponse 를 쓰지만, completeResponse 는 여러 키를
 * 한 번에 검증하므로 집합을 1회 로드해 키별로 in-memory 멤버십 검사를 수행한다.
 */
async function loadValidQuestionIds(
  versionId: string | null,
  surveyId: string,
): Promise<Set<string>> {
  if (versionId) {
    // 버전 스냅샷(snapshot->'questions')의 모든 elem->>'id' 를 단일 쿼리로 수집한다.
    // non-array 스냅샷은 CASE 로 빈 배열 폴백(ERROR 방지). assertQuestionBelongsToResponse
    // 의 EXISTS subquery 와 동일한 jsonb_array_elements 패턴을 집합 추출로 확장한 것.
    const rows = await db.execute<{ id: string | null }>(sql`
      SELECT qe.elem->>'id' AS id
      FROM survey_versions sv,
           jsonb_array_elements(
             CASE WHEN jsonb_typeof(sv.snapshot->'questions') = 'array'
                  THEN sv.snapshot->'questions'
                  ELSE '[]'::jsonb
             END
           ) AS qe(elem)
      WHERE sv.id = ${versionId}
    `);
    const ids = new Set<string>();
    for (const r of rows) {
      if (r.id != null) ids.add(r.id);
    }
    return ids;
  }

  const rows = await db
    .select({ id: questions.id })
    .from(questions)
    .where(eq(questions.surveyId, surveyId));
  return new Set(rows.map((r) => r.id));
}

/** surveyId 의 완료 응답 수 (soft-delete 제외). complete 시점 정원 하드체크용. */
async function countCompletedResponses(surveyId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(surveyResponses)
    .where(
      and(
        eq(surveyResponses.surveyId, surveyId),
        eq(surveyResponses.status, 'completed'),
        isNull(surveyResponses.deletedAt),
      ),
    );
  return row?.total ?? 0;
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

// 응답 시작.
//
// ⚠️ 보안: pub procedure 로 다시 노출하지 말 것. clientSignals/honeypot 을 받지 않는
// 무인증 빈 행 생성 경로라 봇 방어(isLikelyBot)를 우회하는 표면이 된다(2026-06 적대 리뷰).
// response.start procedure 는 제거됐고, 정상 클라는 createWithFirstAnswer/createBlank 만 쓴다.
// 이 함수는 가용성 게이트(assertSurveyAcceptingResponses) 단위 테스트용으로만 유지한다.
export async function startResponse(input: StartResponseInput): Promise<SurveyResponse> {
  const { surveyId, sessionId, versionId } = input;

  // 가용성 게이트: 마감/draft/closed/비공개 설문에 응답 행이 생성되지 않도록 진입부에서 차단.
  // startResponse 는 inviteToken 을 받지 않으므로 비공개/토큰강제 설문이면 contactTargetId=null 로 거부된다.
  const survey = await loadSurveyGateRow(surveyId);
  // #24 버전 무결성: 클라 제공 versionId 가 동일 surveyId 의 유효 버전인지 검증(불일치 거부).
  const version = await loadValidatedVersionGateRow(surveyId, versionId, survey.currentVersionId);
  // startResponse 는 테스트 전용 유지 함수(#402 주석 참조)라 isTest 판정 없이 고정한다.
  assertSurveyAcceptingResponses(survey, version, { contactTargetId: null, isTest: false });

  const newResponse: NewSurveyResponse = {
    surveyId,
    questionResponses: {},
    isCompleted: false,
    // 예측 가능한 session-<밀리초> 폴백 금지 — pub(무인증) start 로 도달 가능해
    // resume→updateQuestionResponse 응답 변조 윈도를 연다. crypto.randomUUID 로 생성.
    sessionId: sessionId || randomUUID(),
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

  // #5 변조 가드 1: value 직렬화 바이트 상한. DB UPDATE 이전에 차단해 거대 JSONB 주입을 막는다.
  const serializedBytes = Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
  if (serializedBytes > MAX_ANSWER_VALUE_BYTES) {
    throw new SurveyNotAcceptingResponsesError('answer_value_too_large');
  }

  // #5 변조 가드 2: 응답 행 조회 — versionId/surveyId 로 questionId 소속을 검증한다.
  const responseRow = await db.query.surveyResponses.findFirst({
    where: eq(surveyResponses.id, responseId),
    columns: { id: true, surveyId: true, versionId: true },
  });
  if (!responseRow) {
    throw new Error('응답을 찾을 수 없습니다.');
  }

  // #5 변조 가드 3: questionId 가 해당 응답의 versionId 스냅샷(또는 surveyId 의 questions)에
  // 존재해야 한다. 미존재면 거부 — 임의 키 JSONB 주입 차단.
  await assertQuestionBelongsToResponse(responseRow.versionId, responseRow.surveyId, questionId);

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
    // #5 변조 가드 4: 완료/삭제/타상태(종결) 응답의 사후 변조 차단. soft-delete 됐거나
    // status 가 in_progress 가 아니면 영향 0행 → throw. pub 엔드포인트는 responseId 만으로
    // 호출 가능하므로, 지연/리플레이된 update 가 종결 응답을 되돌리지 못하게 막는다.
    .where(
      and(
        eq(surveyResponses.id, responseId),
        isNull(surveyResponses.deletedAt),
        eq(surveyResponses.status, 'in_progress'),
      ),
    )
    .returning();

  if (!updated) {
    // 행이 없거나(삭제/존재 안 함) 종결 상태면 변조 시도로 보고 거부한다.
    throw new Error('응답을 수정할 수 없습니다.');
  }

  return updated;
}

// ========================
// 운영 현황 콘솔 — 응답 라이프사이클 통합 지점 (T4)
// ========================

/**
 * 봇 방어 가드 (bypass defense). true 면 차단 대상.
 * - honeypot 채워짐: 실제 클라이언트는 hidden 필드라 항상 빈 값, 봇이 자동 채움.
 * - 익명(invite 없음) + clientSignals 부재: 실제 클라이언트는 응답 페이지 렌더 게이트상
 *   signals 수집 완료(non-null) 전엔 답변이 불가하므로 create 시점 항상 non-null.
 *   null 은 Track B 중복검사를 우회하려는 직접 RPC 호출 봇뿐이다.
 */
function isLikelyBot(args: {
  honeypot: string | undefined;
  inviteToken: string | undefined;
  clientSignals: ClientSignals | null;
}): boolean {
  if (args.honeypot && args.honeypot.trim().length > 0) return true;
  if (!args.inviteToken && !args.clientSignals) return true;
  return false;
}

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
  const { surveyId, sessionId, versionId, questionId, value, currentStepId, visibleStepIndex, visibleStepTotal, inviteToken, clientSignals, honeypot, testToken } = input;

  // 봇 방어: db/헤더 접근 전에 차단. 사유는 device_already_responded 로 통일(탐지 비노출). 위치·동작 불변.
  if (isLikelyBot({ honeypot, inviteToken, clientSignals })) {
    return { kind: 'blocked', reason: 'device_already_responded' };
  }

  // UA + IP (Next 15+ 비동기 headers API)
  const headerStore = await headers();
  const userAgent = headerStore.get('user-agent') ?? null;
  const platform = parsePlatform(userAgent);
  const browser = parseBrowser(userAgent);

  // 신호 계산: ipHash, fpHash, deviceId (clientSignals null 이면 모두 null)
  const signals = clientSignals ? computeSignals(headerStore, clientSignals) : null;

  // 가용성 게이트 + 테스트 세션 판정: contactTargetId 확정보다 survey 를 먼저 로드해야
  // isTest(testModeEnabled + testToken 일치) 판정이 가능하고, isTest 면 아래 중복 감지를 skip 한다.
  const survey = await loadSurveyGateRow(surveyId);
  const isTest = isValidTestToken(survey, testToken);

  // 중복 감지 재검증 (bypass defense — checkDuplicateOnEntry 우회 시 server action에서 2차 차단)
  // checkTrackA 가 통과 시 contactTargetId 를 반환하므로 그대로 사용 (중복 DB 호출 회피)
  // clientSignals null 시 Track B 검사 skip (수용된 trade-off — fallback 신호로 거짓 차단 회피)
  // isTest 세션은 통계·쿼터·중복대조 모수에서 제외되므로 Track A/B 자체를 skip (스펙 4절).
  // inviteToken 이 함께 와도 isTest 면 Track A 를 건너뛰므로 contactTargetId 는 null 로 남는다
  // (테스트 링크는 invite 없이 진입하는 것이 정상 설계 — invite 병용은 지원하지 않는다).
  let contactTargetId: string | null = null;
  if (!isTest) {
    if (inviteToken) {
      const trackA = await checkTrackA(surveyId, inviteToken);
      if (trackA.blocked) return { kind: 'blocked', reason: trackA.reason };
      contactTargetId = trackA.contactTargetId ?? null;
    } else if (signals) {
      const trackB = await checkTrackB({ surveyId, signals });
      if (trackB.blocked) return { kind: 'blocked', reason: trackB.reason };
    }
  }

  // #24 버전 무결성: 클라 제공 versionId 가 동일 surveyId 의 유효 버전인지 검증(불일치 거부).
  // create 시점 정원은 soft(completedCount 미전달) — 잔여 race window 는 complete 하드체크가 보강.
  const version = await loadValidatedVersionGateRow(surveyId, versionId, survey.currentVersionId);
  assertSurveyAcceptingResponses(survey, version, { contactTargetId, isTest });

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
    isTest,
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
  const { surveyId, sessionId, versionId, currentStepId, inviteToken, clientSignals, honeypot, testToken } = input;

  // 봇 방어: db/헤더 접근 전에 차단. 사유는 device_already_responded 로 통일(탐지 비노출). 위치·동작 불변.
  if (isLikelyBot({ honeypot, inviteToken, clientSignals })) {
    return { kind: 'blocked', reason: 'device_already_responded' };
  }

  const headerStore = await headers();
  const userAgent = headerStore.get('user-agent') ?? null;
  const platform = parsePlatform(userAgent);
  const browser = parseBrowser(userAgent);

  // 신호 계산: ipHash, fpHash, deviceId (clientSignals null 이면 모두 null)
  const signals = clientSignals ? computeSignals(headerStore, clientSignals) : null;

  // 가용성 게이트 + 테스트 세션 판정: createResponseWithFirstAnswer 와 동일하게 survey 를
  // 먼저 로드해 isTest 를 판정하고, isTest 면 아래 중복 감지를 skip 한다.
  const survey = await loadSurveyGateRow(surveyId);
  const isTest = isValidTestToken(survey, testToken);

  // 중복 감지 재검증 (bypass defense). checkTrackA 반환의 contactTargetId 를 재사용해 중복 DB 호출 회피
  // clientSignals null 시 Track B 검사 skip. isTest 세션은 Track A/B 자체를 skip (스펙 4절).
  let contactTargetId: string | null = null;
  if (!isTest) {
    if (inviteToken) {
      const trackA = await checkTrackA(surveyId, inviteToken);
      if (trackA.blocked) return { kind: 'blocked', reason: trackA.reason };
      contactTargetId = trackA.contactTargetId ?? null;
    } else if (signals) {
      const trackB = await checkTrackB({ surveyId, signals });
      if (trackB.blocked) return { kind: 'blocked', reason: trackB.reason };
    }
  }

  // #24 버전 무결성: 클라 제공 versionId 가 동일 surveyId 의 유효 버전인지 검증(불일치 거부).
  // create 시점 정원 soft.
  const version = await loadValidatedVersionGateRow(surveyId, versionId, survey.currentVersionId);
  assertSurveyAcceptingResponses(survey, version, { contactTargetId, isTest });

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
    isTest,
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

  // 가용성 게이트(완료 시점 하드체크): 마감/폐쇄/draft/비공개 설문 완료를 차단하고,
  // maxResponses 정원을 완료 카운트로 하드 검사한다. 응답 행에서 surveyId/versionId/
  // contactTargetId 를 읽어 게이트 입력으로 사용한다. count 쿼리와 실제 완료 UPDATE 사이의
  // 동시성 갭(동시 완료가 마지막 정원을 함께 채우는 경우)은 DB 락 없이 허용하는 잔여 window 다.
  const gateRow = await db.query.surveyResponses.findFirst({
    where: eq(surveyResponses.id, responseId),
    columns: { surveyId: true, versionId: true, contactTargetId: true },
  });
  if (gateRow) {
    const survey = await loadSurveyGateRow(gateRow.surveyId);
    const version = await loadVersionGateRow(gateRow.versionId);
    const completedCount = await countCompletedResponses(gateRow.surveyId);
    assertSurveyAcceptingResponses(survey, version, {
      contactTargetId: gateRow.contactTargetId,
      completedCount,
      // TODO(Task 6): gateRow(survey_responses.isTest) 기준으로 교체 — 이 태스크는 create
      // 경로만 다루므로 completeResponse 는 아직 isTest 판정 없이 고정한다.
      isTest: false,
    });
  }

  // #5 변조 가드(JSONB 오염, updateQuestionResponse 와 대칭): completeResponse 는
  // data.questionResponses 를 verbatim 저장하므로, 미인증 응답자가 (a) 설문에 없는 임의
  // questionId 수천 개, 또는 (b) 단일 키에 수 MB 값을 주입해 JSONB SSOT 를 오염/팽창시킬 수
  // 있다(response_answers 정규화는 미존재 키를 거르지만 원본 JSONB 컬럼은 무방비).
  // gateRow(이미 surveyId/versionId 조회됨)로 유효 questionId 집합을 1회 로드한 뒤,
  // 유효 집합에 없는 키와 256KB 초과 값을 silent drop 한다(가용성 우선 — throw 아님).
  // 이 필터를 prefill 강제 복원보다 먼저 적용해, 통과한 키에 한해서만 복원이 일어나게 한다.
  let validatedResponses: Record<string, unknown> | undefined = data?.questionResponses;
  if (data?.questionResponses && gateRow) {
    const validIds = await loadValidQuestionIds(gateRow.versionId, gateRow.surveyId);
    const filtered: Record<string, unknown> = {};
    for (const [qid, value] of Object.entries(data.questionResponses)) {
      // 멤버십 필터: 설문(버전 스냅샷/라이브 questions)에 없는 키는 drop.
      if (!validIds.has(qid)) continue;
      // 바이트 필터: 단일 키 직렬화 256KB 초과면 그 키만 drop.
      const serializedBytes = Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
      if (serializedBytes > MAX_ANSWER_VALUE_BYTES) continue;
      filtered[qid] = value;
    }
    validatedResponses = filtered;
  }

  // prefill 재검증: defaultValueTemplate 이 있는 질문의 응답값은
  // contact_targets.attrs 로 치환한 expected 와 일치해야 함.
  // 클라이언트가 disabled 입력을 우회 조작해도 서버에서 expected 값으로 강제 복원.
  // 위 멤버십/바이트 필터를 통과한 validatedResponses 에 한해 적용한다.
  if (validatedResponses && gateRow) {
    // contactTargetId/surveyId 는 gateRow 에서 이미 조회됨 — 중복 select 제거(쿼리 최소화).
    const contactTargetId = gateRow.contactTargetId;

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
            eq(questions.surveyId, gateRow.surveyId),
            isNotNull(questions.defaultValueTemplate),
          ),
        );

      // 멤버십/바이트 필터를 통과한 validatedResponses 를 기반으로 prefill 복원을 적용한다.
      // (필터 결과를 다시 원본 questionResponses 로 덮어쓰면 오염 가드가 무력화되므로 금지.)
      for (const q of prefillQuestions) {
        if (!q.template?.trim()) continue;
        const expected = substituteTokens(q.template, attrs);
        // 제출된(=필터 통과한) 키만 검증 대상. 조건부로 숨겨져 응답에 포함되지 않은 prefill
        // 질문은 건드리지 않아 미노출 질문에 허위 답변이 주입되지 않도록 한다.
        if (!(q.id in validatedResponses)) continue;
        const submitted = validatedResponses[q.id];
        // 타입 가드 없이 expected 와 다르면 무조건 강제 복원.
        // 클라이언트가 문자열이 아닌 값(숫자/불리언/배열/객체/null)으로 우회 조작해도
        // expected 문자열과 일치하지 않으므로 서버에서 복원된다.
        if (submitted !== expected) {
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
      // soft-delete(deletedAt) 또는 종결 상태(completed/screened_out/quotaful_out/bad/drop)
      // 행은 완료 처리에서 제외한다. pub 엔드포인트는 responseId 만 있으면 호출 가능하므로,
      // 지연/리플레이된 complete 호출이 삭제된 행을 되살리거나 종결 status 를 덮어쓰지 못하게 막는다.
      .where(
        and(
          eq(surveyResponses.id, responseId),
          isNull(surveyResponses.deletedAt),
          eq(surveyResponses.status, 'in_progress'),
        ),
      )
      .returning();

    if (!updated) {
      // 가드에 막혀 0행 — 이미 완료된 같은 응답이면 멱등 재시도로 보고 기존 행을 그대로 반환.
      // (정상 제출 후 네트워크 응답 유실로 인한 사용자 수동 재시도 케이스 보존)
      const [existing] = await tx
        .select()
        .from(surveyResponses)
        .where(eq(surveyResponses.id, responseId))
        .limit(1);
      if (existing?.isCompleted && existing.deletedAt == null) {
        return existing;
      }
      // 행이 없거나(삭제/존재 안 함) 종결 상태(screened_out 등)면 완료 처리를 거부한다.
      throw new Error(
        `completeResponse: 완료 처리 불가 행 (responseId=${responseId}, status=${existing?.status ?? 'not_found'}, deleted=${existing?.deletedAt != null})`,
      );
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
