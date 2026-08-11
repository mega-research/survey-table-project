import { headers } from 'next/headers';

import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import 'server-only';

import { notTestResponse } from '@/data/response-filters';
import { db } from '@/db';
import { logger } from '@/lib/logger';
import {
  NewSurveyResponse,
  contactTargets,
  questions,
  surveyResponses,
  surveyVersions,
  surveys,
} from '@/db/schema';
import type { PageVisit } from '@/db/schema/schema-types';
import { decryptQuestionResponses, encryptAnswerValue, encryptResponsesForStorage } from '@/lib/crypto/response-pii';
import { checkTrackA, checkTrackB } from '@/lib/duplicate-detection/check';
import { computeSignals } from '@/lib/duplicate-detection/signals';
import { sumActiveSeconds } from '@/lib/operations/active-seconds';
import { parseBrowser, parsePlatform } from '@/lib/operations/parse-ua';
import { getSurveyControlFlags, isValidTestToken } from '@/lib/survey-control';
import type { TestResponseResetFields } from '@/lib/survey-response/reset-test-response.server';
import { resetTestResponseRow } from '@/lib/survey-response/reset-test-response.server';
import {
  acquireTestTargetResponse,
  assertAnonymousTestSession,
  lockAndAssertResponseMutation,
} from '@/lib/survey-response/test-target-attempt.server';
import { withCalcValues } from '@/lib/survey/cell-formula';
import { stripDisabledCellValues } from '@/lib/survey/cell-gating';
import type { Question, SurveyLookup } from '@/types/survey';
import { substituteTokens } from '@/lib/survey/substitute-tokens';

import type { BlockReason } from '../../domain/duplicate';
import { toGateBlockReason } from '../../domain/gate-block-reason';
import { decideResponseReuse } from '../../domain/lifecycle';
import type {
  ClientSignals,
  CompleteResponseInput,
  CreateBlankResponseInput,
  CreateResponseWithFirstAnswerInput,
  FirstAnswerResult,
  SaveDraftResponseInput,
  StartResponseInput,
  SurveyResponse,
  UpdateQuestionResponseInput,
} from '../../domain/response';
import { replaceResponseAnswers } from './response-answers.service';

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ResponseQueryExecutor = Pick<DbTransaction, 'execute' | 'select'>;

// ========================
// 컨택 매칭 helper
// ========================

/** 재사용 후보 행 — status 는 decideResponseReuse 판정에 쓰인다. */
type ReuseCandidate = {
  id: string;
  contactTargetId: string | null;
  metadata: SurveyResponse['metadata'];
  status: string;
};

/**
 * 동일 컨택의 활성 응답(미완료, soft-delete 제외) 1건 조회.
 * idx_active_response_per_contact partial unique index 가 동일 contact_target_id 의
 * 미완료 응답을 1개로 제한하므로, 재진입 시 기존 행을 재사용한다.
 *
 * is_completed=false 만으로는 "쓰기 가능"을 뜻하지 않는다 — sweep_stale_sessions() 가
 * 3시간 유휴 행을 drop 으로 바꿔도 is_completed 는 false 로 남는다. status 를 함께
 * 실어 보내 호출부가 decideResponseReuse 로 판정하게 한다.
 */
async function findActiveResponseByContact(
  surveyId: string,
  contactTargetId: string,
): Promise<ReuseCandidate | null> {
  const [row] = await db
    .select({
      id: surveyResponses.id,
      contactTargetId: surveyResponses.contactTargetId,
      // 재사용되는 행의 draftSeq 를 클라이언트에 실어 보내기 위한 컬럼 — insertResponseWithContactReuse 참조.
      metadata: surveyResponses.metadata,
      status: surveyResponses.status,
    })
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
 * drop 행을 in_progress 로 되살린다 — resumeOrCreateResponse 의 회복과 동일 의미론.
 * 되살리기에 실패하면(경합으로 다른 status 가 됨) null 을 반환해 호출부가 차단하도록 한다.
 */
async function reviveDroppedResponse(responseId: string): Promise<boolean> {
  const revived = await db
    .update(surveyResponses)
    .set({ status: 'in_progress', lastActivityAt: new Date() })
    .where(
      and(
        eq(surveyResponses.id, responseId),
        isNull(surveyResponses.deletedAt),
        eq(surveyResponses.status, 'drop'),
      ),
    )
    .returning({ id: surveyResponses.id });
  return revived.length > 0;
}

/**
 * 재사용 후보를 실제로 쓸 수 있는 상태로 만든다.
 * - reuse: 그대로
 * - revive: drop → in_progress 로 되살린 뒤 사용
 * - restart: 테스트 세션 한정 — 종결된 행을 제자리에서 초기화해 처음부터 다시 응답
 * - blocked: 차단 사유 반환 (호출부가 500 대신 안내 화면으로 응답)
 *
 * `testRestart` 인자가 곧 "유효 테스트 세션임"의 증거이자 초기화 payload 다.
 * 넘기는 호출부는 insertAnonymousTestResponse 하나뿐이고, 그 함수는 정의상
 * `isAnonymousTest && testToken` 분기에서만 호출된다 — 실응답 경로
 * (insertResponseWithContactReuse)는 이 인자를 넘기지 않으므로 완화가 샐 수 없다.
 * 플래그와 payload 를 한 인자로 묶어 둔 이유도 "테스트 세션인데 초기화 값이 없는" 중간
 * 상태를 만들지 않기 위함이다.
 */
async function settleReuseCandidate(
  candidate: ReuseCandidate,
  testRestart?: TestResponseResetFields,
): Promise<{ ok: true; row: ReuseCandidate } | { ok: false; reason: BlockReason }> {
  const decision = decideResponseReuse(candidate.status, {
    hasContact: candidate.contactTargetId != null,
    isTestSession: testRestart != null,
  });
  if (decision.action === 'reuse') return { ok: true, row: candidate };
  if (decision.action === 'restart') {
    if (testRestart) {
      // draft 순번 하한은 초기화 후에도 살린다 — 직전 시도의 탭이 늦게 던진 beacon 이
      // 갓 초기화한 행에 적용되는 것을 claimDraftSeq 가 계속 막아야 한다.
      const draftSeq = extractDraftSeq(candidate.metadata);
      // 새 행 INSERT 는 테스트 유니크 인덱스에 걸리므로 반드시 제자리 초기화한다.
      await db.transaction((tx) =>
        resetTestResponseRow(tx, candidate.id, {
          ...testRestart,
          ...(draftSeq !== undefined ? { draftSeq } : {}),
        }),
      );
      // 남긴 하한을 그대로 실어 보내 새 탭의 draftSeqRef 를 seed 한다(0 부터 시작하면
      // 새 시도의 draft 가 전부 stale 로 떨어진다).
      return {
        ok: true,
        row: {
          ...candidate,
          status: 'in_progress',
          metadata: draftSeq !== undefined ? { draftSeq } : null,
        },
      };
    }
    // 도달 불가(restart 판정의 전제가 testRestart 존재) — 방어적으로 차단한다.
    return {
      ok: false,
      reason: candidate.contactTargetId != null ? 'token_already_used' : 'device_already_responded',
    };
  }
  if (decision.action === 'revive') {
    if (await reviveDroppedResponse(candidate.id)) {
      return { ok: true, row: { ...candidate, status: 'in_progress' } };
    }
    // 되살리기 경합 — 종결 상태로 넘어갔다고 보고 차단한다.
    return {
      ok: false,
      reason: candidate.contactTargetId != null ? 'token_already_used' : 'device_already_responded',
    };
  }
  return { ok: false, reason: decision.reason };
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
type ReuseOutcome =
  | { kind: 'ready'; row: ReuseCandidate }
  | { kind: 'blocked'; reason: BlockReason };

async function insertResponseWithContactReuse(params: {
  surveyId: string;
  sessionId: string;
  contactTargetId: string | null;
  newResponse: NewSurveyResponse;
  onReuse?: (id: string) => Promise<void>;
}): Promise<ReuseOutcome> {
  const { surveyId, sessionId, contactTargetId, newResponse, onReuse } = params;

  // 재사용 후보를 status 로 판정한 뒤에만 onReuse 를 돌린다 — 차단 대상 행에
  // 첫 답변을 머지하려 들면 쓰기 가드에서 0행이 되어 500 이 난다.
  const takeover = async (candidate: ReuseCandidate): Promise<ReuseOutcome> => {
    const settled = await settleReuseCandidate(candidate);
    if (!settled.ok) return { kind: 'blocked', reason: settled.reason };
    if (onReuse) await onReuse(settled.row.id);
    return { kind: 'ready', row: settled.row };
  };

  if (contactTargetId) {
    const active = await findActiveResponseByContact(surveyId, contactTargetId);
    if (active) return takeover(active);
  }

  let inserted: Array<{
    id: string;
    contactTargetId: string | null;
    metadata: SurveyResponse['metadata'];
    status: string;
  }>;
  try {
    inserted = await db
      .insert(surveyResponses)
      .values(newResponse)
      .onConflictDoNothing({
        target: [surveyResponses.surveyId, surveyResponses.sessionId],
      })
      .returning({
        id: surveyResponses.id,
        contactTargetId: surveyResponses.contactTargetId,
        metadata: surveyResponses.metadata,
        status: surveyResponses.status,
      });
  } catch (e) {
    // idx_active_response_per_contact 경합 — 다른 요청이 방금 활성 행을 만들었다.
    if (contactTargetId) {
      const active = await findActiveResponseByContact(surveyId, contactTargetId);
      if (active) return takeover(active);
    }
    throw e;
  }

  const firstInserted = inserted[0];
  if (firstInserted !== undefined) return { kind: 'ready', row: firstInserted };

  // (surveyId, sessionId) UNIQUE 충돌 — 기존 행을 물려받는다. soft-delete 된 행은
  // 쓰기 가드가 거부하므로 후보에서 제외하고, 종결 상태는 status 판정으로 걸러낸다.
  const [existing] = await db
    .select({
      id: surveyResponses.id,
      contactTargetId: surveyResponses.contactTargetId,
      metadata: surveyResponses.metadata,
      status: surveyResponses.status,
    })
    .from(surveyResponses)
    .where(
      and(
        eq(surveyResponses.surveyId, surveyId),
        eq(surveyResponses.sessionId, sessionId),
        isNull(surveyResponses.deletedAt),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new Error(
      `insertResponseWithContactReuse: 충돌 후 기존 행 조회 실패 (surveyId=${surveyId}, sessionId=${sessionId})`,
    );
  }

  return takeover(existing);
}

async function insertAnonymousTestResponse(
  input: { surveyId: string; sessionId: string; testToken: string },
  newResponse: NewSurveyResponse,
): Promise<ReuseOutcome> {
  const candidate = await db.transaction(async (tx): Promise<ReuseCandidate> => {
    await assertAnonymousTestSession(tx, input);
    const [inserted] = await tx
      .insert(surveyResponses)
      .values(newResponse)
      .onConflictDoNothing({
        target: [surveyResponses.surveyId, surveyResponses.sessionId],
      })
      .returning({ id: surveyResponses.id, status: surveyResponses.status });
    // 새로 만든 행은 물려받을 draftSeq 이력이 없다.
    if (inserted) {
      return { id: inserted.id, contactTargetId: null, metadata: null, status: inserted.status };
    }

    // 물려받는 기존 테스트 행도 sweep 으로 drop 이 됐을 수 있어 status 를 함께 읽는다.
    // metadata 는 draft 순번 하한 때문에 필요하다 — 같은 sessionId 로 재진입한 이전 시도의
    // draftSeq 를 초기화 후에도 이어가야 지연 도착 beacon 이 새 시도를 덮지 않는다.
    const [existing] = await tx
      .select({
        id: surveyResponses.id,
        status: surveyResponses.status,
        metadata: surveyResponses.metadata,
      })
      .from(surveyResponses)
      .where(
        and(
          eq(surveyResponses.surveyId, input.surveyId),
          eq(surveyResponses.sessionId, input.sessionId),
          eq(surveyResponses.isTest, true),
          isNull(surveyResponses.contactTargetId),
          isNull(surveyResponses.deletedAt),
        ),
      )
      .limit(1);
    if (!existing) throw new Error('테스트 응답을 시작할 수 없습니다');
    return {
      id: existing.id,
      contactTargetId: null,
      metadata: existing.metadata,
      status: existing.status,
    };
  });

  // 이 함수는 정의상 유효 익명 테스트 세션에서만 호출된다(createResponseWithFirstAnswer 의
  // `isAnonymousTest && testToken` 분기 + 위 assertAnonymousTestSession 재검증). 그래서
  // 종결 상태 재시작 payload 를 넘겨도 실응답으로 완화가 새지 않는다 —
  // 이 조건을 넓히려면 settleReuseCandidate 주석을 먼저 읽을 것.
  // 초기화 값은 새로 만들지 않고 방금 INSERT 하려던 행(newResponse)의 값을 그대로 쓴다.
  const settled = await settleReuseCandidate(candidate, {
    sessionId: input.sessionId,
    versionId: newResponse.versionId ?? null,
    currentStepId: newResponse.currentStepId ?? null,
    pageVisits: newResponse.pageVisits ?? [],
    visibleStepIndex: newResponse.visibleStepIndex,
    visibleStepTotal: newResponse.visibleStepTotal,
    userAgent: newResponse.userAgent,
    ipHash: newResponse.ipHash,
    fpHash: newResponse.fpHash,
    deviceId: newResponse.deviceId,
    platform: newResponse.platform,
    browser: newResponse.browser,
  });
  return settled.ok
    ? { kind: 'ready', row: settled.row }
    : { kind: 'blocked', reason: settled.reason };
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

/**
 * 가용성 게이트 위반을 응답자 화면이 이해하는 blocked 결과로 접는다.
 *
 * 미배포·마감 설문에 들어온 응답자에게 500 대신 안내 화면을 보여주기 위한 것이다. 500 이면
 * 클라이언트가 차단을 인지하지 못해 답을 고를 때마다 무의미한 INSERT 를 다시 쏜다.
 * 가용성과 무관한 사유(변조 가드 등)는 null 을 돌려받아 그대로 throw 된다.
 */
function toGateBlockedResult(err: unknown): { kind: 'blocked'; reason: BlockReason } | null {
  if (!(err instanceof SurveyNotAcceptingResponsesError)) return null;
  const reason = toGateBlockReason(err.reason);
  return reason ? { kind: 'blocked', reason } : null;
}

/** 응답 가용성 게이트 위반 시 던지는 에러. pub 엔드포인트라 호출자에 사유를 세분 노출하지 않는다. */
export class SurveyNotAcceptingResponsesError extends Error {
  /** 거부 사유. 메시지 문자열 파싱 없이 호출측이 분기할 수 있게 필드로 노출한다. */
  readonly reason: string;

  constructor(reason: string) {
    super(`응답을 받을 수 없는 설문입니다. (${reason})`);
    this.name = 'SurveyNotAcceptingResponsesError';
    this.reason = reason;
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
  if (opts.isTest) return;

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
 * 암호화 플래그는 스냅샷 ∪ 현재 설정 합집합 — 진행 중 세션이 옛 버전에 고정돼도 새로 켠
 * 토글이 새 저장분부터 적용되게 한다(과잉 암호화 방향만 허용). 멤버십 검증은 여전히 스냅샷 단독.
 *
 * 임의 키 JSONB 주입(설문에 없는 questionId 로 questionResponses 오염)을 차단한다.
 */
async function assertQuestionBelongsToResponse(
  versionId: string | null,
  surveyId: string,
  questionId: string,
  executor: ResponseQueryExecutor = db,
): Promise<{ piiEncrypted: boolean }> {
  if (versionId) {
    // 소속 검증(스냅샷 단독) + piiEncrypted 플래그(스냅샷 ∪ 라이브 questions 합집합)를 한
    // 쿼리로. 행이 없으면 미소속 → 거부. questionId 는 pub 입력이라 uuid 형식이 아닐 수
    // 있다 — 파라미터에 ::uuid 를 걸면 plan 시점 캐스트 에러(DB 500)가 나므로, 캐스트는
    // 컬럼 쪽(q.id::text)에 건다. 비정상 id 는 스냅샷 텍스트 비교에서 0행 → 정상 거부.
    const rows = await executor.execute<{ pii: boolean | null }>(sql`
      SELECT
        COALESCE((qe.elem->>'piiEncrypted')::boolean, false)
        OR COALESCE(
          (SELECT q.pii_encrypted FROM questions q
           WHERE q.id::text = ${questionId} AND q.survey_id = ${surveyId}::uuid),
          false
        ) AS pii
      FROM survey_versions sv,
           jsonb_array_elements(
             CASE WHEN jsonb_typeof(sv.snapshot->'questions') = 'array'
                  THEN sv.snapshot->'questions'
                  ELSE '[]'::jsonb
             END
           ) AS qe(elem)
      WHERE sv.id = ${versionId}
        AND qe.elem->>'id' = ${questionId}
      LIMIT 1
    `);
    const row = rows[0];
    if (!row) {
      throw new Error('해당 설문에 존재하지 않는 질문입니다.');
    }
    return { piiEncrypted: row.pii === true };
  }

  const [hit] = await executor
    .select({ id: questions.id, piiEncrypted: questions.piiEncrypted })
    .from(questions)
    .where(and(eq(questions.surveyId, surveyId), eq(questions.id, questionId)))
    .limit(1);
  if (!hit) {
    throw new Error('해당 설문에 존재하지 않는 질문입니다.');
  }
  return { piiEncrypted: hit.piiEncrypted === true };
}

async function applyQuestionResponseUpdate(
  executor: { update: typeof db.update },
  input: { responseId: string; questionId: string },
  storedValue: unknown,
): Promise<SurveyResponse> {
  const { responseId, questionId } = input;
  const [updated] = await executor
    .update(surveyResponses)
    .set({
      questionResponses: sql`jsonb_set(
        COALESCE(${surveyResponses.questionResponses}, '{}'::jsonb),
        ARRAY[${questionId}],
        ${JSON.stringify(storedValue)}::jsonb,
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
    .where(
      and(
        eq(surveyResponses.id, responseId),
        isNull(surveyResponses.deletedAt),
        eq(surveyResponses.status, 'in_progress'),
      ),
    )
    .returning();

  if (!updated) {
    throw new Error('응답을 수정할 수 없습니다.');
  }
  return updated;
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

/**
 * 버전 스냅샷과 현재 questions 플래그의 합집합에서 piiEncrypted=true 인 질문 id 집합을 로드한다.
 *
 * 암호화 판단은 스냅샷 단독이 아니라 스냅샷 ∪ 현재 설정 합집합이다 — 진행 중(이어하기) 세션은
 * 옛 versionId 에 고정되므로, 토글을 새로 켜고 배포해도 그 세션은 여전히 옛 스냅샷을 참조한다.
 * 합집합이면 어느 쪽이든 켜져 있을 때 암호화하므로 과소 암호화(평문 유출) 갭이 사라진다.
 * live-only id(스냅샷엔 없지만 현재 questions 에만 켜진 id)가 집합에 섞여도 무해하다 —
 * completeResponse/saveAdminEdit 는 이 집합을 "제출된 맵의 키 중 암호화 대상"으로만 쓰므로,
 * 애초에 제출 맵에 없는 키는 걸러지지 않는다(과잉 암호화 방향만 허용, 과소 암호화 없음).
 */
export async function loadPiiQuestionIds(
  versionId: string | null,
  surveyId: string,
): Promise<Set<string>> {
  if (versionId) {
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
        AND (qe.elem->>'piiEncrypted')::boolean IS TRUE
      UNION
      SELECT q.id::text AS id
      FROM questions q
      WHERE q.survey_id = ${surveyId}::uuid AND q.pii_encrypted = true
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
    .where(and(eq(questions.surveyId, surveyId), eq(questions.piiEncrypted, true)));
  return new Set(rows.map((r) => r.id));
}

/**
 * surveyId 의 완료 응답 수 (soft-delete 제외, 테스트 모드 응답 제외). complete 시점 정원
 * 하드체크용 — isTest 완료는 통계·쿼터 모수에서 제외되므로(스펙 4절) 정원 카운트에도 포함하지 않는다.
 */
async function countCompletedResponses(surveyId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(surveyResponses)
    .where(
      and(
        eq(surveyResponses.surveyId, surveyId),
        eq(surveyResponses.status, 'completed'),
        isNull(surveyResponses.deletedAt),
        notTestResponse,
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
  assertAnswerValueSize(value);

  // #5 변조 가드 2: 응답 행 조회 — versionId/surveyId 로 questionId 소속을 검증한다.
  const responseRow = await loadResponseRowForMutation(responseId);

  // #5 변조 가드 3: questionId 가 해당 응답의 versionId 스냅샷(또는 surveyId 의 questions)에
  // 존재해야 한다. 미존재면 거부 — 임의 키 JSONB 주입 차단.
  const { piiEncrypted } = await assertQuestionBelongsToResponse(
    responseRow.versionId,
    responseRow.surveyId,
    questionId,
  );
  // PII 문항이면 저장 직전 암호화. 이미 암호문이면 encryptAnswerValue 가 통과시킨다.
  const storedValue = piiEncrypted ? encryptAnswerValue(value) : value;

  // 중단 모드: 열려 있던 탭의 답변 저장 차단 (테스트 행 예외) — 스펙 5절 게이트 3.
  await assertSurveyNotPaused(responseRow);

  // jsonb_set 으로 답변 저장 + progress_pct 동기 갱신.
  // progress_pct 는 versionId 의 snapshot 에서 questionId 의 1-based position 을 찾아
  // (position / totalQuestions) × 100 으로 계산. GREATEST 로 단조 증가 보장 (앞 질문 수정
  // 시 % 후퇴 방지). snapshot 깨졌거나 questionId 가 snapshot 에 없으면 inner subquery
  // 가 NULL → COALESCE(0) → GREATEST 가 기존값 유지.
  // 방어: non-array snapshot 은 CASE 로 빈 배열 fallback (ERROR 방지). 최종 0 은 NULLIF
  // 로 NULL 로 변환해 "0%" 오표시 회피 (UI 가 NULL → '—' 표시).
  if (!responseRow.isTest) {
    return applyQuestionResponseUpdate(db, { responseId, questionId }, storedValue);
  }

  return db.transaction(async (tx) => {
    await lockAndAssertResponseMutation(tx, {
      responseId,
      attemptId: input.attemptId,
      sessionId: input.sessionId,
    });
    return applyQuestionResponseUpdate(tx, { responseId, questionId }, storedValue);
  });
}

/** 응답 변조 가드에 필요한 최소 응답 행. 단건/배치 경로가 공유한다. */
type ResponseMutationRow = {
  id: string;
  surveyId: string;
  versionId: string | null;
  isTest: boolean;
  contactTargetId: string | null;
};

/** #5 변조 가드 1: value 직렬화 바이트 상한. DB UPDATE 이전에 거대 JSONB 주입을 막는다. */
function assertAnswerValueSize(value: unknown): void {
  const serializedBytes = Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
  if (serializedBytes > MAX_ANSWER_VALUE_BYTES) {
    throw new SurveyNotAcceptingResponsesError('answer_value_too_large');
  }
}

/** #5 변조 가드 2: 응답 행 조회. 미존재면 기존 에러 메시지를 그대로 던진다. */
async function loadResponseRowForMutation(responseId: string): Promise<ResponseMutationRow> {
  const row = await db.query.surveyResponses.findFirst({
    where: eq(surveyResponses.id, responseId),
    columns: {
      id: true,
      surveyId: true,
      versionId: true,
      isTest: true,
      contactTargetId: true,
    },
  });
  if (!row) {
    throw new Error('응답을 찾을 수 없습니다.');
  }
  return row;
}

/** 중단 모드 게이트. isTest 행은 flags 조회 자체를 skip 해 정상 트래픽 비용을 늘리지 않는다. */
async function assertSurveyNotPaused(row: Pick<ResponseMutationRow, 'surveyId' | 'isTest'>): Promise<void> {
  if (row.isTest) return;
  const flags = await getSurveyControlFlags(row.surveyId);
  if (flags?.isPaused) {
    throw new SurveyNotAcceptingResponsesError('survey_paused');
  }
}

/**
 * assertQuestionBelongsToResponse 의 배치 버전 — 소속 검증 + piiEncrypted 를 1회 쿼리로.
 *
 * 페이지 이동 체크포인트는 답변을 한 번에 여러 개 받는다. 문항마다 검증 쿼리를 돌리면
 * 왕복이 답변 수에 비례해 늘어난다(10문항 페이지에서 2.3초 관측, 2026-08-04).
 * 하나라도 소속되지 않으면 단건 경로와 동일한 메시지로 거부한다 — 부분 저장은 하지 않는다.
 */
async function loadQuestionPiiFlags(
  versionId: string | null,
  surveyId: string,
  questionIds: string[],
): Promise<Map<string, boolean>> {
  const flags = new Map<string, boolean>();

  if (versionId) {
    // questionId 는 pub 입력이라 uuid 형식이 아닐 수 있다 — 캐스트는 컬럼 쪽(q.id::text)에 건다.
    // 비정상 id 는 스냅샷 텍스트 비교에서 매치되지 않아 아래 미존재 검사로 거부된다.
    const idList = sql.join(
      questionIds.map((id) => sql`${id}`),
      sql`, `,
    );
    const rows = await db.execute<{ id: string | null; pii: boolean | null }>(sql`
      SELECT
        qe.elem->>'id' AS id,
        (COALESCE((qe.elem->>'piiEncrypted')::boolean, false)
         OR COALESCE(q.pii_encrypted, false)) AS pii
      FROM survey_versions sv,
           jsonb_array_elements(
             CASE WHEN jsonb_typeof(sv.snapshot->'questions') = 'array'
                  THEN sv.snapshot->'questions'
                  ELSE '[]'::jsonb
             END
           ) AS qe(elem)
      LEFT JOIN questions q
        ON q.id::text = qe.elem->>'id' AND q.survey_id = ${surveyId}::uuid
      WHERE sv.id = ${versionId}
        AND qe.elem->>'id' IN (${idList})
    `);
    for (const row of rows) {
      if (row.id != null) flags.set(row.id, row.pii === true);
    }
  } else {
    const rows = await db
      .select({ id: questions.id, piiEncrypted: questions.piiEncrypted })
      .from(questions)
      .where(and(eq(questions.surveyId, surveyId), inArray(questions.id, questionIds)));
    for (const row of rows) {
      flags.set(row.id, row.piiEncrypted === true);
    }
  }

  for (const questionId of questionIds) {
    if (!flags.has(questionId)) {
      throw new Error('해당 설문에 존재하지 않는 질문입니다.');
    }
  }
  return flags;
}

/**
 * applyQuestionResponseUpdate 의 배치 버전 — 답변 전체를 단일 UPDATE 로 반영한다.
 *
 * questionResponses 는 top-level 키 병합이라 `|| jsonb` 가 문항별 jsonb_set 연쇄와 동치다.
 * progress_pct 는 배치 중 가장 뒤에 있는 문항의 위치로 계산한다(단건 경로를 답변 수만큼
 * 반복한 결과와 동일 — GREATEST 로 단조 증가라 최대값만 남는다).
 */
async function applyDraftAnswersUpdate(
  executor: { update: typeof db.update },
  responseId: string,
  questionIds: string[],
  storedAnswers: Record<string, unknown>,
): Promise<void> {
  const idList = sql.join(
    questionIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const [updated] = await executor
    .update(surveyResponses)
    .set({
      questionResponses: sql`COALESCE(${surveyResponses.questionResponses}, '{}'::jsonb)
        || ${JSON.stringify(storedAnswers)}::jsonb`,
      progressPct: sql`NULLIF(LEAST(100, GREATEST(
        COALESCE(${surveyResponses.progressPct}, 0),
        COALESCE((
          SELECT ROUND((
            (SELECT MAX(t.idx)
             FROM jsonb_array_elements(
                    CASE WHEN jsonb_typeof(sv.snapshot->'questions') = 'array'
                         THEN sv.snapshot->'questions'
                         ELSE '[]'::jsonb
                    END
                  ) WITH ORDINALITY AS t(elem, idx)
             WHERE t.elem->>'id' IN (${idList})
            )::numeric
            / NULLIF(jsonb_array_length(
                CASE WHEN jsonb_typeof(sv.snapshot->'questions') = 'array'
                     THEN sv.snapshot->'questions'
                     ELSE '[]'::jsonb
                END
              ), 0)) * 100)::int
          FROM survey_versions sv
          WHERE sv.id = ${surveyResponses.versionId}
          LIMIT 1
        ), 0)
      ))::smallint, 0)`,
    })
    .where(
      and(
        eq(surveyResponses.id, responseId),
        isNull(surveyResponses.deletedAt),
        eq(surveyResponses.status, 'in_progress'),
      ),
    )
    .returning();

  if (!updated) {
    throw new Error('응답을 수정할 수 없습니다.');
  }
}

type DraftSeqClaim = 'claimed' | 'stale' | 'not_found';

/**
 * metadata JSONB 의 draftSeq 를 안전하게 추출한다. claimDraftSeq 가 쓰는 값과 동일 키 —
 * 응답 행 id 를 클라이언트에 넘겨주는 모든 경로(resume, 컨택 재사용 등)가 이 값을 함께
 * 실어 보내 draftSeqRef 를 seed 하는 데 쓴다. lifecycle.service.ts 의 resumeOrCreateResponse
 * 도 이 헬퍼를 그대로 재사용한다(단일 소스, 사이클 방지를 위해 이쪽에 둔다). 비정상 값은
 * 무시하고 undefined 를 반환한다.
 */
export function extractDraftSeq(metadata: unknown): number | undefined {
  if (metadata == null || typeof metadata !== 'object') return undefined;
  const raw = (metadata as Record<string, unknown>)['draftSeq'];
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : undefined;
}

/**
 * draft 쓰기 순번을 선점한다.
 *
 * 저장된 draftSeq 보다 큰 요청만 통과시키고 그 자리에서 값을 올린다. 단일 UPDATE 라
 * 동시 요청에도 하나만 통과한다. 0행이면 seq 가 밀렸거나 행이 없는 것이므로 구분해서
 * 돌려준다 — 행 부재는 기존 에러 경로를 그대로 타야 하기 때문이다.
 */
async function claimDraftSeq(responseId: string, seq: number): Promise<DraftSeqClaim> {
  const claimed = await db.execute<{ id: string }>(sql`
    UPDATE survey_responses
    SET metadata = jsonb_set(
      COALESCE(metadata, '{}'::jsonb),
      ARRAY['draftSeq'],
      to_jsonb(${seq}::bigint),
      true
    )
    WHERE id = ${responseId}
      AND COALESCE((metadata->>'draftSeq')::bigint, 0) < ${seq}
    RETURNING id
  `);
  if (claimed.length > 0) return 'claimed';

  const existing = await db.execute<{ id: string }>(sql`
    SELECT id FROM survey_responses WHERE id = ${responseId} LIMIT 1
  `);
  return existing.length > 0 ? 'stale' : 'not_found';
}

/**
 * 페이지 이동 체크포인트.
 *
 * 외부 요청은 한 번만 받되 기존 단건 저장 경로를 재사용해 문항 소속 검증, 크기 제한,
 * PII 암호화, 테스트 attempt 소유권 검사를 모든 답에 동일하게 적용한다.
 *
 * seq 가 실려 있으면 요청 단위로 한 번 claim 한다(문항별 WHERE 절이 아니라 배치 단위인
 * 이유는 claimDraftSeq 주석 참조 — 0행 매치를 문항별로 두면 정상 시나리오가 500 으로 샌다).
 * 지연 도착한 stale 요청이면 답변을 전혀 쓰지 않고 applied:false 로 돌아간다.
 */
export async function saveDraftResponse(
  input: SaveDraftResponseInput,
): Promise<{ applied: boolean }> {
  if (input.seq !== undefined) {
    const claim = await claimDraftSeq(input.responseId, input.seq);
    // 더 새로운 쓰기가 이미 반영됐다. 지연 도착한 이 요청을 적용하면 최신 답변을 덮는다.
    if (claim === 'stale') return { applied: false };
    // 'not_found' 는 그대로 진행시켜 아래 응답 행 조회의 기존 에러 경로를 타게 한다.
  }

  const entries = Object.entries(input.answers);
  if (entries.length === 0) return { applied: true };

  // #5 변조 가드 1: value 직렬화 바이트 상한. 답변별로 검사해 단건 경로와 동일하게 거른다.
  for (const [, value] of entries) {
    assertAnswerValueSize(value);
  }

  // #5 변조 가드 2: 응답 행 조회. 배치 전체가 같은 행이라 1회면 충분하다.
  const responseRow = await loadResponseRowForMutation(input.responseId);

  // #5 변조 가드 3: 소속 검증 + PII 플래그를 questionId 전체에 대해 1회 쿼리로 수집.
  const piiFlags = await loadQuestionPiiFlags(
    responseRow.versionId,
    responseRow.surveyId,
    entries.map(([questionId]) => questionId),
  );

  // 중단 모드: 열려 있던 탭의 답변 저장 차단 (테스트 행 예외) — 스펙 5절 게이트 3.
  await assertSurveyNotPaused(responseRow);

  // PII 문항이면 저장 직전 암호화. 이미 암호문이면 encryptAnswerValue 가 통과시킨다.
  const storedAnswers: Record<string, unknown> = {};
  for (const [questionId, value] of entries) {
    storedAnswers[questionId] = piiFlags.get(questionId) ? encryptAnswerValue(value) : value;
  }
  const questionIds = entries.map(([questionId]) => questionId);

  if (!responseRow.isTest) {
    await applyDraftAnswersUpdate(db, input.responseId, questionIds, storedAnswers);
    return { applied: true };
  }

  // 테스트 행은 시도 소유권 락을 먼저 잡는다. 락도 배치당 1회.
  await db.transaction(async (tx) => {
    await lockAndAssertResponseMutation(tx, {
      responseId: input.responseId,
      ...(input.attemptId ? { attemptId: input.attemptId } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    });
    await applyDraftAnswersUpdate(tx, input.responseId, questionIds, storedAnswers);
  });
  return { applied: true };
}

/** saveDraftResponseIfActive 가 저장을 건너뛴 사유. 서버 로그·테스트 어서션용. */
export type SaveDraftSkipReason =
  | 'not_found'
  | 'deleted'
  | 'concluded'
  | 'survey_paused'
  | 'answer_value_too_large'
  | 'not_accepting'
  | 'stale';

export type SaveDraftIfActiveResult =
  | { saved: true }
  | { saved: false; skipped: SaveDraftSkipReason };

/** SurveyNotAcceptingResponsesError.reason 은 string 이라 미지의 값이 올 수 있다. union 을 닫는다. */
function toSkipReason(reason: string): SaveDraftSkipReason {
  return reason === 'survey_paused' || reason === 'answer_value_too_large'
    ? reason
    : 'not_accepting';
}

/** 응답 행의 not_found/deleted/concluded 판정. 사전 게이트와 저장 실패 후 재조회가 공유한다. */
function judgeRowGate(
  row: { status: string; deletedAt: Date | null } | undefined,
): { saved: false; skipped: 'not_found' | 'deleted' | 'concluded' } | null {
  if (!row) return { saved: false, skipped: 'not_found' };
  if (row.deletedAt !== null) return { saved: false, skipped: 'deleted' };
  if (row.status !== 'in_progress') return { saved: false, skipped: 'concluded' };
  return null;
}

/**
 * 이탈 시점 beacon 전용 draft 저장.
 *
 * saveDraftResponse 와 달리 "저장할 이유가 없는" 상태를 throw 가 아니라 skipped 로 돌려준다.
 * beacon 은 응답을 읽지 않으므로 상태 코드가 클라이언트 동작을 바꾸지 않는다. 제출 직후 탭
 * 닫기·중단된 설문 탭 닫기 같은 정상 시나리오를 5xx 로 올리면 Sentry 에러율만 오염된다.
 *
 * 상태 조회를 한 번 더 하지만 updateQuestionResponse 가 어차피 문항마다 행을 조회하므로
 * 비중은 작다. 라우트가 throw 메시지 문자열로 분기하지 않게 하는 것이 목적이다.
 */
export async function saveDraftResponseIfActive(
  input: SaveDraftResponseInput,
): Promise<SaveDraftIfActiveResult> {
  const row = await db.query.surveyResponses.findFirst({
    where: eq(surveyResponses.id, input.responseId),
    columns: { id: true, status: true, deletedAt: true },
  });
  const gateResult = judgeRowGate(row);
  if (gateResult) return gateResult;

  try {
    const result = await saveDraftResponse(input);
    // 지연 도착한 stale beacon — 답변 쓰기 자체를 하지 않았으므로 최신 답변은 그대로 남는다.
    if (!result.applied) return { saved: false, skipped: 'stale' };
  } catch (err) {
    if (err instanceof SurveyNotAcceptingResponsesError) {
      return { saved: false, skipped: toSkipReason(err.reason) };
    }
    // 게이트 통과 후 저장 사이에 행이 종결·삭제됐을 수 있다(제출 직후 탭 닫기 등). 다시
    // 읽어 확인되면 정상 skip 으로 접는다. 에러 메시지 문자열을 파싱하지 않는 이유는 이
    // 래퍼의 존재 이유(정상 시나리오를 throw 문자열 매칭 없이 판정)와 같다.
    const recheckRow = await db.query.surveyResponses.findFirst({
      where: eq(surveyResponses.id, input.responseId),
      columns: { id: true, status: true, deletedAt: true },
    });
    const recheckResult = judgeRowGate(recheckRow);
    if (recheckResult) return recheckResult;
    throw err;
  }
  return { saved: true };
}

export async function saveTestTargetFirstAnswer(
  input: Parameters<typeof acquireTestTargetResponse>[1] & {
    questionId: string;
    value: unknown;
  },
): Promise<{ responseId: string; reset: boolean }> {
  return db.transaction(async (tx) => {
    const acquired = await acquireTestTargetResponse(tx, input);
    const [response] = await tx
      .select({ versionId: surveyResponses.versionId })
      .from(surveyResponses)
      .where(eq(surveyResponses.id, acquired.responseId))
      .limit(1);
    if (!response) throw new Error('응답을 찾을 수 없습니다.');

    const { piiEncrypted } = await assertQuestionBelongsToResponse(
      response.versionId,
      input.surveyId,
      input.questionId,
      tx,
    );
    const storedValue = piiEncrypted ? encryptAnswerValue(input.value) : input.value;
    await applyQuestionResponseUpdate(
      tx,
      { responseId: acquired.responseId, questionId: input.questionId },
      storedValue,
    );
    return acquired;
  });
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
  try {
    return await createResponseWithFirstAnswerInner(input);
  } catch (err) {
    const blocked = toGateBlockedResult(err);
    if (blocked) return blocked;
    throw err;
  }
}

async function createResponseWithFirstAnswerInner(
  input: CreateResponseWithFirstAnswerInput,
): Promise<FirstAnswerResult> {
  const {
    surveyId,
    sessionId,
    versionId,
    questionId,
    value,
    currentStepId,
    visibleStepIndex,
    visibleStepTotal,
    inviteToken,
    clientSignals,
    honeypot,
    testToken,
    attemptId,
  } = input;

  if (inviteToken != null && testToken != null) {
    return { kind: 'blocked', reason: 'invalid_test_token' };
  }

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

  // 가용성 게이트 + 익명 테스트 세션 판정. 대상자 테스트는
  // invite Track A가 반환하는 isTestTarget을 권위 소스로 삼는다.
  const survey = await loadSurveyGateRow(surveyId);
  const isAnonymousTest = isValidTestToken(survey, testToken);

  // 무효 테스트 링크 차단(스펙 §9, 결정 5): testToken 이 왔는데 유효 세션으로 판정되지 않으면
  // (테스트 모드 OFF 또는 토큰 불일치) 익명 실데이터로 폴백하지 않고 즉시 차단한다.
  // 테스트 모드 OFF 후 stale 테스트 탭의 신규 응답이 isTest=false 실데이터로 새는 것 방지.
  // 위치: 봇 가드 뒤, 중복검사(Track A/B) 앞.
  if (testToken != null && !isAnonymousTest) {
    return { kind: 'blocked', reason: 'invalid_test_token' };
  }

  // 중복 감지 재검증 (bypass defense — checkDuplicateOnEntry 우회 시 server action에서 2차 차단)
  // checkTrackA 가 통과 시 contactTargetId 를 반환하므로 그대로 사용 (중복 DB 호출 회피)
  // clientSignals null 시 Track B 검사 skip (수용된 trade-off — fallback 신호로 거짓 차단 회피)
  // invite는 Track A로 실제/테스트 대상자를 구분한다. 익명 테스트만 Track A/B를
  // 우회하며, 비초대 실응답은 기존 Track B 재검증을 유지한다.
  let contactTargetId: string | null = null;
  let isTestTarget = false;
  if (inviteToken) {
    const trackA = await checkTrackA(surveyId, inviteToken);
    if (trackA.blocked) return { kind: 'blocked', reason: trackA.reason };
    contactTargetId = trackA.contactTargetId ?? null;
    isTestTarget = trackA.isTestTarget === true;
  } else if (!isAnonymousTest && signals) {
    const trackB = await checkTrackB({ surveyId, signals });
    if (trackB.blocked) return { kind: 'blocked', reason: trackB.reason };
  }
  const isTest = isAnonymousTest || isTestTarget;

  if (isTestTarget && (!attemptId || !contactTargetId)) {
    return { kind: 'blocked', reason: 'invalid_test_token' };
  }

  if (isTestTarget && contactTargetId && attemptId) {
    const acquired = await saveTestTargetFirstAnswer({
      surveyId,
      contactTargetId,
      sessionId,
      attemptId,
      versionId: versionId ?? null,
      questionId,
      value,
      currentStepId,
      visibleStepIndex,
      visibleStepTotal,
      userAgent,
      ipHash: signals?.ipHash ?? null,
      fpHash: signals?.fpHash ?? null,
      deviceId: signals?.deviceId ?? null,
      platform,
      browser,
    });
    return {
      kind: 'created',
      id: acquired.responseId,
      contactTargetId,
    };
  }

  // #24 버전 무결성: 클라 제공 versionId 가 동일 surveyId 의 유효 버전인지 검증(불일치 거부).
  // create 시점 정원은 soft(completedCount 미전달) — 잔여 race window 는 complete 하드체크가 보강.
  const version = await loadValidatedVersionGateRow(surveyId, versionId, survey.currentVersionId);
  assertSurveyAcceptingResponses(survey, version, { contactTargetId, isTest });

  // PII 문항이면 INSERT 전에 암호화 — 평문이 순간이라도 DB(WAL 포함)에 닿지 않게 한다.
  // 이후 updateQuestionResponse 재호출은 이미 암호문이라 이중 암호화되지 않는다.
  const { piiEncrypted } = await assertQuestionBelongsToResponse(
    versionId ?? null,
    surveyId,
    questionId,
  );
  const storedValue = piiEncrypted ? encryptAnswerValue(value) : value;

  const firstVisit: PageVisit = {
    stepId: currentStepId,
    enteredAt: new Date().toISOString(),
  };

  const newResponse: NewSurveyResponse = {
    surveyId,
    sessionId,
    versionId: versionId ?? null,
    questionResponses: { [questionId]: storedValue },
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

  const result =
    isAnonymousTest && testToken
      ? await insertAnonymousTestResponse({ surveyId, sessionId, testToken }, newResponse)
      : await insertResponseWithContactReuse({
          surveyId,
          sessionId,
          contactTargetId,
          newResponse,
        });
  // 종결 상태 행을 물려받으려던 경우 — 500 대신 "이미 끝난 응답" 안내로 돌려보낸다.
  if (result.kind === 'blocked') return { kind: 'blocked', reason: result.reason };

  // 신규 INSERT 든 reuse 든 모두 updateQuestionResponse 로 첫 답변 머지 + progress_pct
  // 갱신을 단일화. jsonb_set 은 동일 값 덮어쓰기라 멱등이라 신규 INSERT path 의 중복 set
  // 도 안전. onReuse 콜백을 사용하지 않는 이유: progress_pct 가 신규 INSERT 에서도 필요.
  await updateQuestionResponse({ responseId: result.row.id, questionId, value: storedValue });
  // 컨택 재사용으로 기존 행을 물려받았으면 그 행의 draftSeq 를 함께 실어 보낸다 — resume 이
  // 호출되지 않는 경로(localStorage 없는 재진입)에서도 draftSeqRef 를 올바르게 seed 하기 위함.
  const draftSeq = extractDraftSeq(result.row.metadata);
  return {
    kind: 'created',
    id: result.row.id,
    contactTargetId: result.row.contactTargetId,
    ...(draftSeq !== undefined ? { draftSeq } : {}),
  };
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
  try {
    return await createBlankResponseInner(input);
  } catch (err) {
    const blocked = toGateBlockedResult(err);
    if (blocked) return blocked;
    throw err;
  }
}

async function createBlankResponseInner(
  input: CreateBlankResponseInput,
): Promise<FirstAnswerResult> {
  const {
    surveyId,
    sessionId,
    versionId,
    currentStepId,
    inviteToken,
    clientSignals,
    honeypot,
    testToken,
    attemptId,
  } = input;

  if (inviteToken != null && testToken != null) {
    return { kind: 'blocked', reason: 'invalid_test_token' };
  }

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

  // 가용성 게이트 + 익명 테스트 세션 판정. 대상자 테스트는
  // createResponseWithFirstAnswer와 동일하게 Track A의 isTestTarget으로 판별한다.
  const survey = await loadSurveyGateRow(surveyId);
  const isAnonymousTest = isValidTestToken(survey, testToken);

  // 무효 테스트 링크 차단(스펙 §9, 결정 5): createResponseWithFirstAnswer 와 동일 정책 —
  // testToken 이 왔는데 유효 세션이 아니면 익명 폴백 없이 즉시 차단한다.
  // 위치: 봇 가드 뒤, 중복검사(Track A/B) 앞.
  if (testToken != null && !isAnonymousTest) {
    return { kind: 'blocked', reason: 'invalid_test_token' };
  }

  // 중복 감지 재검증 (bypass defense). checkTrackA 반환의 contactTargetId 를 재사용해 중복 DB 호출 회피
  // clientSignals null 시 Track B 검사 skip. 익명 테스트만 Track A/B를 우회한다.
  let contactTargetId: string | null = null;
  let isTestTarget = false;
  if (inviteToken) {
    const trackA = await checkTrackA(surveyId, inviteToken);
    if (trackA.blocked) return { kind: 'blocked', reason: trackA.reason };
    contactTargetId = trackA.contactTargetId ?? null;
    isTestTarget = trackA.isTestTarget === true;
  } else if (!isAnonymousTest && signals) {
    const trackB = await checkTrackB({ surveyId, signals });
    if (trackB.blocked) return { kind: 'blocked', reason: trackB.reason };
  }
  const isTest = isAnonymousTest || isTestTarget;

  if (isTestTarget && (!attemptId || !contactTargetId)) {
    return { kind: 'blocked', reason: 'invalid_test_token' };
  }

  if (isTestTarget && contactTargetId && attemptId) {
    const acquired = await db.transaction((tx) =>
      acquireTestTargetResponse(tx, {
        surveyId,
        contactTargetId,
        sessionId,
        attemptId,
        versionId: versionId ?? null,
        currentStepId,
        userAgent,
        ipHash: signals?.ipHash ?? null,
        fpHash: signals?.fpHash ?? null,
        deviceId: signals?.deviceId ?? null,
        platform,
        browser,
      }),
    );
    return {
      kind: 'created',
      id: acquired.responseId,
      contactTargetId,
    };
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

  const result =
    isAnonymousTest && testToken
      ? await insertAnonymousTestResponse({ surveyId, sessionId, testToken }, newResponse)
      : await insertResponseWithContactReuse({
          surveyId,
          sessionId,
          contactTargetId,
          newResponse,
        });
  if (result.kind === 'blocked') return { kind: 'blocked', reason: result.reason };
  return { kind: 'created', id: result.row.id, contactTargetId: result.row.contactTargetId };
}

// 응답 완료 (JSONB + response_answers 이중 쓰기)
// 읽기: response_answers 우선 (getResponsesWithAnswers), JSONB fallback
// JSONB 쓰기는 마이그레이션 완료 + 모든 읽기 경로 전환 후 제거 예정
export async function completeResponse(input: CompleteResponseInput): Promise<SurveyResponse> {
  const { responseId, data } = input;

  // 가용성 게이트(완료 시점 하드체크): 마감/폐쇄/draft/비공개 설문 완료를 차단하고,
  // maxResponses 정원을 완료 카운트로 하드 검사한다. 응답 행에서 surveyId/versionId/
  // contactTargetId 를 읽어 게이트 입력으로 사용한다. count 쿼리와 실제 완료 UPDATE 사이의
  // 동시성 갭(동시 완료가 마지막 정원을 함께 채우는 경우)은 DB 락 없이 허용하는 잔여 window 다.
  const gateRow = await db.query.surveyResponses.findFirst({
    where: eq(surveyResponses.id, responseId),
    columns: { surveyId: true, versionId: true, contactTargetId: true, isTest: true },
  });
  if (gateRow) {
    const survey = await loadSurveyGateRow(gateRow.surveyId);
    const version = await loadVersionGateRow(gateRow.versionId);
    const completedCount = await countCompletedResponses(gateRow.surveyId);
    assertSurveyAcceptingResponses(survey, version, {
      contactTargetId: gateRow.contactTargetId,
      completedCount,
      // 응답 행 자체의 isTest 컬럼이 권위 소스 — create 시점에 확정된 값을 그대로 신뢰한다
      // (여기서 재차 testToken 을 검증하지 않는다. complete 는 responseId 만 받는 pub 엔드포인트).
      isTest: gateRow.isTest,
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
          and(eq(questions.surveyId, gateRow.surveyId), isNotNull(questions.defaultValueTemplate)),
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

  // calc 셀 서버 재계산 (신뢰 경계) — 클라이언트가 주입한 계산값을 그대로 믿지 않고,
  // 응답 시점 버전 스냅샷의 수식으로 다시 계산해 덮어쓴다. 요청 변조나 구버전 클라이언트가
  // 수식과 다른 값을 보내도 최종 저장 데이터(export 원천)는 수식 결과와 일치한다
  // ("수식 결과와 다른 저장값은 존재하지 않는다" — CONTEXT.md 계산 셀 불변식).
  //
  // data 없이 complete 만 호출하는 우회도 막아야 한다: 위조값을 saveDraft/beacon 으로
  // 먼저 저장한 뒤 빈 complete 를 부르면 저장된 JSONB 가 그대로 확정되므로, 스냅샷에
  // calc 셀이 있으면 저장된 응답을 재계산해 덮어쓴다. 이 경로의 읽기·재계산·저장은
  // 아래 트랜잭션 안에서 row lock(FOR UPDATE) 으로 묶는다 — tx 밖에서 읽어 통째로
  // 덮어쓰면 읽기~UPDATE 사이에 도착한 draft 답변이 유실되는 경합이 생긴다.
  //
  // 반드시 PII 암호화 이전 평문 단계에서 수행한다. 스냅샷 미확보(레거시 versionId null,
  // 손상 행)면 스킵 — 응답자 저장을 막지 않는 fail-safe (saveAdminEdit 와 동일 정책).
  let storedRecalc: {
    questions: Question[];
    lookups: SurveyLookup[];
    contactAttrs: Record<string, string | undefined>;
    piiIds: Set<string>;
  } | null = null;
  if (gateRow?.versionId) {
    const [versionRow] = await db
      .select({ snapshot: surveyVersions.snapshot })
      .from(surveyVersions)
      .where(eq(surveyVersions.id, gateRow.versionId))
      .limit(1);
    const snap = versionRow?.snapshot as unknown as
      | { questions?: unknown; lookups?: unknown }
      | null
      | undefined;
    // JSONB 스키마 드리프트 방어 — 비배열이면 순회에서 크래시하므로 Array.isArray 로 거른다.
    const snapQuestions = Array.isArray(snap?.questions) ? (snap.questions as Question[]) : [];
    const snapLookups = Array.isArray(snap?.lookups) ? (snap.lookups as SurveyLookup[]) : [];
    const hasCalcCells = snapQuestions.some((q) =>
      (q.tableRowsData ?? []).some((row) => row.cells.some((c) => c.type === 'calc' && c.formula)),
    );
    const hasGatedCells = snapQuestions.some((q) =>
      (q.tableRowsData ?? []).some((row) => row.cells.some((c) => c.enabledWhen && !c.isHidden)),
    );

    // 게이팅 비활성 셀 값 strip (저장 경계 보증, 스펙 §저장 경계) — 컨트롤러 변경 직후
    // 이탈한 beacon 이 지움 전 값을 실어 보냈어도 확정 데이터에는 남지 않는다.
    // calc 재계산(withCalcValues)보다 먼저 수행해 수식이 지워진 값 기준으로 계산되게 한다.
    if (validatedResponses && hasGatedCells) {
      validatedResponses = stripDisabledCellValues(snapQuestions, validatedResponses);
    }

    if (hasCalcCells || hasGatedCells) {
      let calcAttrs: Record<string, string | undefined> = {};
      if (hasCalcCells && gateRow.contactTargetId) {
        const [target] = await db
          .select({ attrs: contactTargets.attrs })
          .from(contactTargets)
          .where(eq(contactTargets.id, gateRow.contactTargetId))
          .limit(1);
        calcAttrs = (target?.attrs ?? {}) as Record<string, string | undefined>;
      }
      if (validatedResponses) {
        // 페이로드 경로 — 제출된 전체 응답을 재계산 (tx 밖에서 안전: 컬럼을 페이로드로
        // 교체하는 것이 complete 의 기존 의미라 경합으로 잃을 저장분이 없다).
        // 게이팅만 있는 설문은 위 strip 으로 충분 — calc 셀이 있을 때만 재계산한다.
        if (hasCalcCells) {
          validatedResponses = withCalcValues(validatedResponses, {
            questions: snapQuestions,
            responses: validatedResponses,
            lookups: snapLookups,
            contactAttrs: calcAttrs,
          });
        }
      } else {
        // 빈 complete 경로 — 재계산 재료만 준비하고 실행은 tx 안 row lock 아래로 미룬다.
        storedRecalc = {
          questions: snapQuestions,
          lookups: snapLookups,
          contactAttrs: calcAttrs,
          piiIds: await loadPiiQuestionIds(gateRow.versionId, gateRow.surveyId),
        };
      }
    }
  }

  // PII 문항 암호화 — prefill 복원(평문 비교) 이후, 저장 직전에 수행한다.
  if (validatedResponses && gateRow) {
    const piiIds = await loadPiiQuestionIds(gateRow.versionId, gateRow.surveyId);
    if (piiIds.size > 0) {
      validatedResponses = encryptResponsesForStorage(validatedResponses, piiIds);
    }
  }

  const completedAt = new Date();
  const result = await db.transaction(async (tx) => {
    if (gateRow?.isTest) {
      await lockAndAssertResponseMutation(tx, {
        responseId,
        attemptId: input.attemptId,
        sessionId: input.sessionId,
      });
    }
    // 빈 complete 의 calc 재계산 — row lock 을 잡은 뒤 저장분을 읽어 재계산한다.
    // 동시 draft UPDATE 는 이 lock 을 대기하므로 읽기~쓰기 사이 유실 경합이 없다.
    let storedRecalcResponses: Record<string, unknown> | undefined;
    if (storedRecalc) {
      const [locked] = await tx
        .select({ questionResponses: surveyResponses.questionResponses })
        .from(surveyResponses)
        .where(eq(surveyResponses.id, responseId))
        .for('update');
      // 수식이 암호화된 숫자 단답을 참조할 수 있으므로 평문화 후 재계산, 저장 직전 재암호화.
      const plain = decryptQuestionResponses(
        (locked?.questionResponses ?? {}) as Record<string, unknown>,
        { responseId },
      );
      // 게이팅 strip → calc 재계산 순서 — 비활성 셀 잔존 값을 지운 뒤 그 기준으로
      // 수식을 계산한다 (스펙 §저장 경계. 빈 complete 우회로 저장된 값도 여기서 봉합).
      const stripped = stripDisabledCellValues(storedRecalc.questions, plain);
      let recomputed = withCalcValues(stripped, {
        questions: storedRecalc.questions,
        responses: stripped,
        lookups: storedRecalc.lookups,
        contactAttrs: storedRecalc.contactAttrs,
      });
      if (storedRecalc.piiIds.size > 0) {
        recomputed = encryptResponsesForStorage(recomputed, storedRecalc.piiIds);
      }
      storedRecalcResponses = recomputed;
    }
    // 1. 기존 JSONB 방식 저장 + 운영 현황 추적 컬럼 갱신
    const [updated] = await tx
      .update(surveyResponses)
      .set({
        isCompleted: true,
        completedAt,
        // 운영 현황 콘솔용 추적 컬럼
        status: 'completed',
        progressPct: 100,
        lastActivityAt: completedAt,
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
        ...(validatedResponses
          ? { questionResponses: validatedResponses }
          : storedRecalcResponses
            ? { questionResponses: storedRecalcResponses }
            : {}),
        ...(data?.exposedQuestionIds || data?.exposedRowIds
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

    let completedResponse = updated;
    if (!completedResponse) {
      // 가드에 막혀 0행 — 이미 완료된 같은 응답이면 멱등 재시도로 보고 기존 행을 그대로 반환.
      // (정상 제출 후 네트워크 응답 유실로 인한 사용자 수동 재시도 케이스 보존)
      const [existing] = await tx
        .select()
        .from(surveyResponses)
        .where(eq(surveyResponses.id, responseId))
        .limit(1);
      if (existing?.isCompleted && existing.deletedAt == null) {
        completedResponse = existing;
      } else {
        // 행이 없거나(삭제/존재 안 함) 종결 상태(screened_out 등)면 완료 처리를 거부한다.
        throw new Error(
          `completeResponse: 완료 처리 불가 행 (responseId=${responseId}, status=${existing?.status ?? 'not_found'}, deleted=${existing?.deletedAt != null})`,
        );
      }
    }

    if (updated) {
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
      // 빈 complete 의 calc 재계산 경로도 JSONB 와 동일한 맵으로 정규화한다.
      const normalizedSource = validatedResponses ?? storedRecalcResponses;
      if (normalizedSource && Object.keys(normalizedSource).length > 0) {
        await replaceResponseAnswers(tx, responseId, updated.surveyId, normalizedSource);
      }
    }

    // 대상자 테스트 응답만 response 완료와 target 연결을 원자적으로 커밋한다.
    // 테스트 reset/acquire와 같은 survey → target → response 잠금 순서를 보존해야 하므로
    // lockAndAssertResponseMutation에서 target을 먼저 잠근 뒤 여기서 같은 행을 갱신한다.
    if (completedResponse.isTest && completedResponse.contactTargetId) {
      await tx
        .update(contactTargets)
        .set({
          respondedAt: completedAt,
          responseId: completedResponse.id,
          updatedAt: completedAt,
        })
        .where(
          and(
            eq(contactTargets.id, completedResponse.contactTargetId),
            eq(contactTargets.surveyId, completedResponse.surveyId),
          ),
        );
    }

    return completedResponse;
  });

  // 실제 대상자 연결은 응답 완료 커밋 이후 best-effort로 유지한다. 이를 완료 트랜잭션에
  // 넣으면 response → target 순서가 되어, target → response 순서인 컨택 삭제/hard reset과
  // 교착할 수 있다. 후처리 실패는 이미 커밋된 완료 응답을 rollback하지 않는다.
  if (!result.isTest && result.contactTargetId) {
    try {
      await db
        .update(contactTargets)
        .set({
          respondedAt: completedAt,
          responseId: result.id,
          updatedAt: completedAt,
        })
        .where(
          and(
            eq(contactTargets.id, result.contactTargetId),
            eq(contactTargets.surveyId, result.surveyId),
          ),
        );
    } catch (err) {
      logger.error(
        {
          surveyId: result.surveyId,
          responseId: result.id,
          contactTargetId: result.contactTargetId,
          err,
        },
        '[completeResponse] contact_targets UPDATE 실패 — 응답 완료는 성공',
      );
    }
  }

  // revalidatePath('/analytics') 는 백엔드에서 제거 — 공개 응답이 admin /analytics
  // 캐시를 cross 무효화하던 부분으로, 소비처 통합 단계에서 query invalidation 등으로 보강.
  return result;
}
