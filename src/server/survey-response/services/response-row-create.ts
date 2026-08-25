import { and, eq, isNull } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { NewSurveyResponse, surveyResponses } from '@/db/schema';
import { isUniqueViolation } from '@/lib/pg-error';

import type { BlockReason } from '../domain/duplicate';
import { extractDraftSeq } from '../domain/draft-seq';
import { decideResponseReuse } from '../domain/lifecycle';
import type { SurveyResponse } from '../domain/response';
import {
  type TestResponseResetFields,
  resetTestResponseRow,
} from './reset-test-response.server';
import { assertAnonymousTestSession } from './test-target-attempt.server';

/**
 * 컨택에 묶인 응답 행의 생성·재사용 — 진행 중 행을 찾고, 되살리고, 재사용 여부를 확정하고,
 * 없으면 새로 INSERT 한다.
 *
 * response.service 에서 갈라져 나왔다 — 그쪽으로 되돌아가는 import 가 없어야 한다(순환 금지).
 */

// ========================
// 컨택 매칭 helper
// ========================

/** 재사용 후보 행 — status 는 decideResponseReuse 판정에 쓰인다. */
export type ReuseCandidate = {
  id: string;
  contactTargetId: string | null;
  metadata: SurveyResponse['metadata'];
  status: string;
  // 행에 실제 기록된 versionId — create 결과에 실어 보내 클라이언트가 재핀(티켓 04)을 감지한다.
  versionId: string | null;
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
export async function findActiveResponseByContact(
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
      versionId: surveyResponses.versionId,
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
export async function reviveDroppedResponse(responseId: string): Promise<boolean> {
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
export async function settleReuseCandidate(
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
          // 제자리 초기화가 versionId 도 새 시도 값으로 덮으므로 반환 행에도 반영한다.
          versionId: testRestart.versionId,
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
export type ReuseOutcome =
  { kind: 'ready'; row: ReuseCandidate } | { kind: 'blocked'; reason: BlockReason };

export async function insertResponseWithContactReuse(params: {
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
    versionId: string | null;
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
        versionId: surveyResponses.versionId,
      });
  } catch (e) {
    // idx_active_response_per_contact 경합 — 다른 요청이 방금 활성 행을 만들었다.
    //
    // UNIQUE 위반일 때만 물려받는다. 종전에는 모든 예외를 잡아, 컨택에 활성 행이 있기만 하면
    // NOT NULL·체크 제약·커넥션 오류까지 삼키고 기존 행을 물려받았다 — 응답자에게는 성공으로
    // 보이지만 원인은 Sentry 에도 남지 않는다.
    // 이 INSERT 가 걸릴 수 있는 UNIQUE 는 (survey_id, session_id) 와 partial
    // idx_active_response_per_contact 둘인데 앞은 onConflictDoNothing 이 흡수하므로,
    // 여기까지 온 UNIQUE 위반은 곧 그 partial 인덱스 경합이다.
    if (contactTargetId && isUniqueViolation(e)) {
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
      versionId: surveyResponses.versionId,
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

export async function insertAnonymousTestResponse(
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
      .returning({
        id: surveyResponses.id,
        status: surveyResponses.status,
        versionId: surveyResponses.versionId,
      });
    // 새로 만든 행은 물려받을 draftSeq 이력이 없다.
    if (inserted) {
      return {
        id: inserted.id,
        contactTargetId: null,
        metadata: null,
        status: inserted.status,
        versionId: inserted.versionId,
      };
    }

    // 물려받는 기존 테스트 행도 sweep 으로 drop 이 됐을 수 있어 status 를 함께 읽는다.
    // metadata 는 draft 순번 하한 때문에 필요하다 — 같은 sessionId 로 재진입한 이전 시도의
    // draftSeq 를 초기화 후에도 이어가야 지연 도착 beacon 이 새 시도를 덮지 않는다.
    const [existing] = await tx
      .select({
        id: surveyResponses.id,
        status: surveyResponses.status,
        metadata: surveyResponses.metadata,
        versionId: surveyResponses.versionId,
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
      versionId: existing.versionId,
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
