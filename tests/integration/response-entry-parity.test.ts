/**
 * A-2 사전 박제 — 두 진입 경로(createResponseWithFirstAnswer / createBlankResponse)의
 * 차단 사유·부작용 순서·반환 shape 를 리팩터 전 동작 그대로 고정한다.
 *
 * 이 파일은 A-2 커밋 1~3 에서 한 줄도 고치지 않는다. 고쳐야 하는 상황이 오면
 * 그것은 리팩터가 동작을 바꿨다는 신호다.
 *
 * 알려진 드리프트(D-1 blank draftSeq 부재, D-2 blank visibleStep* 부재,
 * F-2 대상자 테스트 lane versionId 반환)는
 * "현행 그대로" 박제한다 — 후속 티켓에서 의도적으로 뒤집을 때 diff 에 드러나게 하기 위함이다.
 *
 * F-1(INSERT 경로 크기 가드 누락)은 A-2f-3 에서 뒤집었다 — T9 가 이제 "DB 쓰기 이전 차단"을 지킨다.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClientSignals } from '@/lib/duplicate-detection/types';

process.env['DUPLICATE_DETECTION_SALT'] = 'a2-entry-parity-salt';

// 부작용 순서 기록기 + 각 지점의 반환값 제어기. vi.mock factory 가 참조하므로 hoisted.
const H = vi.hoisted(() => ({
  order: [] as string[],
  headersMock: vi.fn(),
  surveyFindFirst: vi.fn(),
  versionFindFirst: vi.fn(),
  responseFindFirst: vi.fn(),
  executeMock: vi.fn(),
  selectLimitMock: vi.fn(),
  insertValuesArg: vi.fn(),
  insertReturningMock: vi.fn(),
  updateReturningMock: vi.fn(),
  trackAMock: vi.fn(),
  trackBMock: vi.fn(),
  acquireMock: vi.fn(),
  controlFlagsMock: vi.fn(),
}));

vi.mock('@/db', () => {
  const insertChain: Record<string, unknown> = {};
  insertChain['values'] = vi.fn((v: unknown) => {
    H.insertValuesArg(v);
    return insertChain;
  });
  insertChain['onConflictDoNothing'] = vi.fn(() => insertChain);
  insertChain['returning'] = vi.fn(() => H.insertReturningMock());

  const selectChain: Record<string, unknown> = {};
  selectChain['from'] = vi.fn(() => selectChain);
  selectChain['where'] = vi.fn(() => selectChain);
  selectChain['for'] = vi.fn(() => selectChain);
  selectChain['limit'] = vi.fn(() => H.selectLimitMock());

  const updateChain: Record<string, unknown> = {};
  updateChain['set'] = vi.fn(() => updateChain);
  updateChain['where'] = vi.fn(() => updateChain);
  updateChain['returning'] = vi.fn(() => H.updateReturningMock());

  const db: Record<string, unknown> = {
    insert: vi.fn(() => {
      H.order.push('insert');
      return insertChain;
    }),
    select: vi.fn(() => {
      H.order.push('select');
      return selectChain;
    }),
    update: vi.fn(() => {
      H.order.push('update');
      return updateChain;
    }),
    execute: vi.fn((...a: unknown[]) => {
      H.order.push('execute');
      return H.executeMock(...a);
    }),
    query: {
      surveys: {
        findFirst: vi.fn((...a: unknown[]) => {
          H.order.push('surveyGate');
          return H.surveyFindFirst(...a);
        }),
      },
      surveyVersions: {
        findFirst: vi.fn((...a: unknown[]) => {
          H.order.push('versionGate');
          return H.versionFindFirst(...a);
        }),
      },
      surveyResponses: {
        findFirst: vi.fn((...a: unknown[]) => {
          H.order.push('responseRow');
          return H.responseFindFirst(...a);
        }),
      },
      contactTargets: { findFirst: vi.fn(async () => undefined) },
    },
  };
  // tx 는 db 자신 — select/execute/update 스텁을 그대로 재사용한다.
  db['transaction'] = vi.fn(async (cb: (tx: unknown) => unknown) => {
    H.order.push('tx');
    return cb(db);
  });
  return { db };
});

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => {
    H.order.push('headers');
    return H.headersMock();
  }),
}));

vi.mock('@/server/survey-response/services/check', () => ({
  checkTrackA: vi.fn((...a: unknown[]) => {
    H.order.push('trackA');
    return H.trackAMock(...a);
  }),
  checkTrackB: vi.fn((...a: unknown[]) => {
    H.order.push('trackB');
    return H.trackBMock(...a);
  }),
}));

vi.mock('@/server/survey-response/services/test-target-attempt.server', () => ({
  acquireTestTargetResponse: vi.fn((...a: unknown[]) => {
    H.order.push('acquire');
    return H.acquireMock(...a);
  }),
  assertAnonymousTestSession: vi.fn(async () => undefined),
  lockAndAssertResponseMutation: vi.fn(async () => undefined),
  isResumableTestStatus: vi.fn(() => true),
}));

// isValidTestToken 은 실제 구현을 써야 무효 테스트 링크 판정이 현실과 같다.
vi.mock('@/server/read-models/survey-control', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/read-models/survey-control')>();
  return {
    ...actual,
    getSurveyControlFlags: vi.fn((...a: unknown[]) => {
      H.order.push('controlFlags');
      return H.controlFlagsMock(...a);
    }),
  };
});

vi.mock('@/server/survey-response/services/response-answers.service', () => ({
  replaceResponseAnswers: vi.fn(async () => undefined),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const SURVEY_ID = '00000000-0000-4000-8000-0000000000a2';
const VERSION_ID = 'version-1';
const SIGNALS: ClientSignals = {
  deviceId: 'dev-a2',
  screen: '1920x1080',
  tz: 'Asia/Seoul',
  lang: 'ko-KR',
  platform: 'MacIntel',
};

function publishedSurvey(over: Record<string, unknown> = {}) {
  return {
    status: 'published',
    endDate: null,
    maxResponses: null,
    isPublic: true,
    requireInviteToken: false,
    currentVersionId: VERSION_ID,
    isPaused: false,
    testModeEnabled: false,
    testToken: null,
    ...over,
  };
}

type Kind = 'first' | 'blank';

type Over = {
  sessionId?: string;
  versionId?: string | null;
  inviteToken?: string;
  testToken?: string;
  attemptId?: string;
  honeypot?: string;
  clientSignals?: ClientSignals | null;
  value?: unknown;
  visibleStepIndex?: number;
  visibleStepTotal?: number;
};

async function callCreate(kind: Kind, over: Over = {}) {
  const svc = await import('@/server/survey-response/services/response.service');
  const common = {
    surveyId: SURVEY_ID,
    sessionId: over.sessionId ?? 'sess-a2',
    versionId: over.versionId ?? null,
    currentStepId: 'step-1',
    clientSignals: over.clientSignals === undefined ? SIGNALS : over.clientSignals,
    ...(over.inviteToken !== undefined ? { inviteToken: over.inviteToken } : {}),
    ...(over.testToken !== undefined ? { testToken: over.testToken } : {}),
    ...(over.attemptId !== undefined ? { attemptId: over.attemptId } : {}),
    ...(over.honeypot !== undefined ? { honeypot: over.honeypot } : {}),
    // 진척은 두 경로의 공통 입력이다 (A-2f-2 이후). blank 에만 자리가 없던 것이 D-2 였다.
    ...(over.visibleStepIndex !== undefined ? { visibleStepIndex: over.visibleStepIndex } : {}),
    ...(over.visibleStepTotal !== undefined ? { visibleStepTotal: over.visibleStepTotal } : {}),
  };
  if (kind === 'blank') return svc.createBlankResponse(common);
  return svc.createResponseWithFirstAnswer({
    ...common,
    questionId: 'q1',
    value: over.value === undefined ? 'a' : over.value,
  });
}

function insertedRow(over: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    contactTargetId: null,
    metadata: null,
    status: 'in_progress',
    versionId: VERSION_ID,
    ...over,
  };
}

/** versionId 를 실어 보낼 때의 표준 성공 배선 — 멤버십은 execute, 재사용 조회는 select 로 갈린다. */
function wireHappyPath() {
  H.surveyFindFirst.mockResolvedValue(publishedSurvey());
  H.versionFindFirst.mockResolvedValue({ surveyId: SURVEY_ID, status: 'published' });
  H.trackAMock.mockResolvedValue({ blocked: false, contactTargetId: null, isTestTarget: false });
  H.trackBMock.mockResolvedValue({ blocked: false });
  H.executeMock.mockResolvedValue([{ pii: false }]);
  H.selectLimitMock.mockResolvedValue([]);
  H.insertReturningMock.mockResolvedValue([insertedRow()]);
  H.responseFindFirst.mockResolvedValue({
    id: 'r1',
    surveyId: SURVEY_ID,
    versionId: VERSION_ID,
    isTest: false,
    contactTargetId: null,
  });
  H.controlFlagsMock.mockResolvedValue(null);
  H.updateReturningMock.mockResolvedValue([{ id: 'r1' }]);
}

beforeEach(() => {
  vi.clearAllMocks();
  H.order.length = 0;
  H.headersMock.mockReturnValue(
    new Headers({ 'x-forwarded-for': '10.0.0.2', 'user-agent': 'Chrome/120' }),
  );
});

// ============================================================================
// T1 — 차단 사유 대칭 매트릭스
// ============================================================================
describe.each(['first', 'blank'] as const)('T1 차단 사유 대칭 — %s', (kind: Kind) => {
  beforeEach(() => {
    wireHappyPath();
  });

  it('status 미배포 → not_accepting', async () => {
    H.surveyFindFirst.mockResolvedValue(publishedSurvey({ status: 'draft' }));
    const result = await callCreate(kind);
    expect(result).toEqual({ kind: 'blocked', reason: 'not_accepting' });
    expect(H.insertValuesArg).not.toHaveBeenCalled();
  });

  it('isPaused → survey_paused', async () => {
    H.surveyFindFirst.mockResolvedValue(publishedSurvey({ isPaused: true }));
    const result = await callCreate(kind);
    expect(result).toEqual({ kind: 'blocked', reason: 'survey_paused' });
    expect(H.insertValuesArg).not.toHaveBeenCalled();
  });

  it('endDate 경과 → not_accepting', async () => {
    H.surveyFindFirst.mockResolvedValue(
      publishedSurvey({ endDate: new Date(Date.now() - 60_000) }),
    );
    const result = await callCreate(kind);
    expect(result).toEqual({ kind: 'blocked', reason: 'not_accepting' });
    expect(H.insertValuesArg).not.toHaveBeenCalled();
  });

  it('requireInviteToken + contactTargetId 없음 → invalid_token', async () => {
    H.surveyFindFirst.mockResolvedValue(publishedSurvey({ requireInviteToken: true }));
    const result = await callCreate(kind);
    expect(result).toEqual({ kind: 'blocked', reason: 'invalid_token' });
    expect(H.insertValuesArg).not.toHaveBeenCalled();
  });
});

// ============================================================================
// T2 — 부작용 순서 박제. 이 배열이 곧 티켓이 말한 "부작용 순서 = 계약" 이다.
// ============================================================================
describe('T2 부작용 순서', () => {
  beforeEach(() => {
    wireHappyPath();
  });

  it('createResponseWithFirstAnswer 는 정확한 순서로 부작용을 낸다', async () => {
    const result = await callCreate('first', { versionId: VERSION_ID });
    expect(result).toMatchObject({ kind: 'created', id: 'r1' });
    expect(H.order).toEqual([
      'headers',
      'surveyGate',
      'trackB',
      'versionGate',
      'execute', // assertQuestionBelongsToResponse — INSERT 전 멤버십+PII
      'insert',
      'responseRow', // updateQuestionResponse → loadResponseRowForMutation
      'execute', // updateQuestionResponse 의 멤버십 재검증
      'controlFlags', // assertSurveyNotPaused
      'update',
    ]);
  });

  it('createBlankResponse 는 멤버십·머지 없이 같은 앞단 순서를 낸다', async () => {
    const result = await callCreate('blank', { versionId: VERSION_ID });
    expect(result).toMatchObject({ kind: 'created', id: 'r1' });
    expect(H.order).toEqual(['headers', 'surveyGate', 'trackB', 'versionGate', 'insert']);
  });
});

// ============================================================================
// T3 — 게이트 앞단 조기 차단은 headers/db 를 건드리지 않는다
// ============================================================================
describe.each(['first', 'blank'] as const)('T3 무접촉 조기 차단 — %s', (kind: Kind) => {
  beforeEach(() => {
    wireHappyPath();
  });

  it('inviteToken + testToken 동시 → invalid_test_token, 무접촉', async () => {
    const result = await callCreate(kind, {
      inviteToken: '11111111-1111-4111-8111-111111111111',
      testToken: 'tok',
    });
    expect(result).toEqual({ kind: 'blocked', reason: 'invalid_test_token' });
    expect(H.order).toEqual([]);
  });

  it('honeypot 채움 → device_already_responded, 무접촉', async () => {
    const result = await callCreate(kind, { honeypot: 'bot' });
    expect(result).toEqual({ kind: 'blocked', reason: 'device_already_responded' });
    expect(H.order).toEqual([]);
  });

  it('익명 + clientSignals null → device_already_responded, 무접촉', async () => {
    const result = await callCreate(kind, { clientSignals: null });
    expect(result).toEqual({ kind: 'blocked', reason: 'device_already_responded' });
    expect(H.order).toEqual([]);
  });
});

// ============================================================================
// T4 — 무효 테스트 토큰은 봇 가드 뒤, 중복검사 앞에서 차단된다
// ============================================================================
describe.each(['first', 'blank'] as const)('T4 무효 테스트 토큰 위치 — %s', (kind: Kind) => {
  it('testModeEnabled=false 인데 testToken 전달 → 중복검사 전에 차단', async () => {
    wireHappyPath();
    H.surveyFindFirst.mockResolvedValue(publishedSurvey({ testModeEnabled: false }));
    const result = await callCreate(kind, { testToken: 'tok' });
    expect(result).toEqual({ kind: 'blocked', reason: 'invalid_test_token' });
    expect(H.order).toEqual(['headers', 'surveyGate']);
  });
});

// ============================================================================
// T5 — 대상자 테스트 attempt 가드
// ============================================================================
describe.each(['first', 'blank'] as const)('T5 attempt 가드 — %s', (kind: Kind) => {
  beforeEach(() => {
    wireHappyPath();
    H.trackAMock.mockResolvedValue({
      blocked: false,
      contactTargetId: 'c1',
      isTestTarget: true,
    });
  });

  it('isTestTarget 인데 attemptId 미전달 → invalid_test_token, INSERT 없음', async () => {
    const result = await callCreate(kind, {
      inviteToken: '11111111-1111-4111-8111-111111111111',
    });
    expect(result).toEqual({ kind: 'blocked', reason: 'invalid_test_token' });
    expect(H.order).toEqual(['headers', 'surveyGate', 'trackA']);
    expect(H.insertValuesArg).not.toHaveBeenCalled();
  });

  it('isTestTarget 인데 contactTargetId 없음 → invalid_test_token, INSERT 없음', async () => {
    H.trackAMock.mockResolvedValue({ blocked: false, contactTargetId: null, isTestTarget: true });
    const result = await callCreate(kind, {
      inviteToken: '11111111-1111-4111-8111-111111111111',
      attemptId: '22222222-2222-4222-8222-222222222222',
    });
    expect(result).toEqual({ kind: 'blocked', reason: 'invalid_test_token' });
    expect(H.insertValuesArg).not.toHaveBeenCalled();
  });
});

// ============================================================================
// T6 — 반환 shape 박제. 드리프트 D-1(blank draftSeq 부재)을 현행 그대로 못박는다.
// ============================================================================
describe('T6 draftSeq 반환 (A-2f-1 — 두 경로 대칭)', () => {
  beforeEach(() => {
    wireHappyPath();
    H.insertReturningMock.mockResolvedValue([insertedRow({ metadata: { draftSeq: 7 } })]);
  });

  it('firstAnswer 는 물려받은 행의 draftSeq 를 싣는다', async () => {
    const result = await callCreate('first', { versionId: VERSION_ID });
    if (result.kind !== 'created') throw new Error('created 아님');
    expect(result.draftSeq).toBe(7);
  });

  it('blank 도 물려받은 행의 draftSeq 를 싣는다 (D-1 해소)', async () => {
    const result = await callCreate('blank', { versionId: VERSION_ID });
    if (result.kind !== 'created') throw new Error('created 아님');
    expect(result.draftSeq).toBe(7);
  });

  it('물려받을 draftSeq 가 없으면 두 경로 모두 키를 싣지 않는다', async () => {
    H.insertReturningMock.mockResolvedValue([insertedRow({ metadata: null })]);
    for (const kind of ['first', 'blank'] as const) {
      const result = await callCreate(kind, { versionId: VERSION_ID });
      if (result.kind !== 'created') throw new Error('created 아님');
      expect('draftSeq' in result).toBe(false);
    }
  });
});

// ============================================================================
// T7 — INSERT 키 집합. 진척은 두 경로가 같은 자리에서 읽는다 (A-2f-2, 드리프트 D-2 해소).
// ============================================================================
describe('T7 INSERT 키 집합 (A-2f-2 — 진척은 answer 가 아니라 입력 소유)', () => {
  beforeEach(() => {
    wireHappyPath();
  });

  function capturedValues(): Record<string, unknown> {
    const call = H.insertValuesArg.mock.calls[0];
    if (!call) throw new Error('insertValuesArg 호출 없음');
    return call[0] as Record<string, unknown>;
  }

  it('firstAnswer 는 visibleStep* 키를 명시적으로 싣는다', async () => {
    await callCreate('first', { versionId: VERSION_ID, visibleStepIndex: 2, visibleStepTotal: 5 });
    const values = capturedValues();
    expect('visibleStepIndex' in values).toBe(true);
    expect('visibleStepTotal' in values).toBe(true);
    expect(values['visibleStepIndex']).toBe(2);
    expect(values['visibleStepTotal']).toBe(5);
    expect(values['questionResponses']).toEqual({ q1: 'a' });
  });

  it('blank 도 visibleStep* 를 싣는다 — 공지형 설문의 진척이 공란이던 것이 D-2 였다', async () => {
    await callCreate('blank', { versionId: VERSION_ID, visibleStepIndex: 2, visibleStepTotal: 5 });
    const values = capturedValues();
    expect(values['visibleStepIndex']).toBe(2);
    expect(values['visibleStepTotal']).toBe(5);
    // 답은 없다 — 진척과 첫 답변은 별개다.
    expect(values['questionResponses']).toEqual({});
  });

  it('진척 미전송이면 두 경로 모두 null 로 기록한다 (구 클라 호환)', async () => {
    for (const kind of ['first', 'blank'] as const) {
      H.insertValuesArg.mockClear();
      await callCreate(kind, { versionId: VERSION_ID });
      const values = capturedValues();
      expect(values['visibleStepIndex']).toBeNull();
      expect(values['visibleStepTotal']).toBeNull();
    }
  });
});

// ============================================================================
// T8 — 대상자 테스트 lane 반환 (A-2f-4 에서 F-2 를 뒤집었다).
//
// 예전에는 입력 versionId 를 그대로 돌려주었다. 그러면 클라이언트의
// resolveRebasedVersionId 가 자기 값과 자기 값을 비교하게 되어 이 lane 에서만
// 무중단 갈아타기 재핀 감지가 죽는다. 행에 적힌 값을 돌려주도록 뒤집었다.
// ============================================================================
describe.each(['first', 'blank'] as const)('T8 대상자 테스트 lane 반환 — %s', (kind: Kind) => {
  it('입력이 아니라 행에 기록된 versionId 를 돌려준다', async () => {
    wireHappyPath();
    H.trackAMock.mockResolvedValue({ blocked: false, contactTargetId: 'c1', isTestTarget: true });
    // 행은 항상 현재 버전에 핀된다 — 입력(VERSION_ID)과 다른 값을 acquire 가 보고한다.
    H.acquireMock.mockResolvedValue({
      responseId: 'r-test',
      reset: false,
      versionId: 'row-version-999',
    });
    H.selectLimitMock.mockResolvedValue([{ versionId: 'row-version-999' }]);
    H.updateReturningMock.mockResolvedValue([{ id: 'r-test' }]);

    const result = await callCreate(kind, {
      versionId: VERSION_ID,
      inviteToken: '11111111-1111-4111-8111-111111111111',
      attemptId: '22222222-2222-4222-8222-222222222222',
    });

    expect(result).toMatchObject({
      kind: 'created',
      id: 'r-test',
      contactTargetId: 'c1',
      versionId: 'row-version-999',
    });
    // 입력을 되돌려주지 않는다는 것이 이 검사의 내용이다.
    expect((result as { versionId?: string | null }).versionId).not.toBe(VERSION_ID);
    expect(H.acquireMock).toHaveBeenCalledOnce();
    // 버전 게이트와 수용 게이트를 타지 않는다 — 양쪽 공통(의도).
    expect(H.order).not.toContain('versionGate');
  });
});

// ============================================================================
// T9 — 크기 가드는 DB 쓰기 이전에 차단한다 (A-2f-3 에서 F-1 을 뒤집었다).
// ============================================================================
describe('T9 answer_value_too_large 는 DB 쓰기 이전에 차단된다', () => {
  const HUGE = 'x'.repeat(300 * 1024);

  it('firstAnswer: INSERT 도 UPDATE 도 일어나지 않는다', async () => {
    wireHappyPath();
    // versionId null → 멤버십은 select 경로.
    H.selectLimitMock.mockResolvedValue([{ id: 'q1', piiEncrypted: false }]);
    const gate = await import('@/server/survey-response/services/response-gate');

    await expect(callCreate('first', { value: HUGE })).rejects.toBeInstanceOf(
      gate.SurveyNotAcceptingResponsesError,
    );
    await expect(callCreate('first', { value: HUGE })).rejects.toMatchObject({
      reason: 'answer_value_too_large',
    });
    // 이 세 줄이 티켓의 본체다 — 거대 JSONB 는 DB 에 닿지 않는다.
    expect(H.insertValuesArg).not.toHaveBeenCalled();
    expect(H.order).not.toContain('insert');
    expect(H.order).not.toContain('update');
    // 헤더·게이트 조회조차 없다 — 봇 가드 바로 뒤, 모든 I/O 앞에서 끊긴다.
    expect(H.order).toEqual([]);
  });

  it('대상자 테스트 lane: export 직접 호출도 tx 를 열기 전에 차단한다', async () => {
    wireHappyPath();
    const svc = await import('@/server/survey-response/services/response.service');

    await expect(
      svc.saveTestTargetFirstAnswer({
        surveyId: SURVEY_ID,
        contactTargetId: 'c1',
        sessionId: 'sess-a2',
        attemptId: '22222222-2222-4222-8222-222222222222',
        currentStepId: 'step-1',
        questionId: 'q1',
        value: HUGE,
      }),
    ).rejects.toMatchObject({ reason: 'answer_value_too_large' });
    // acquireMock 미호출 = 컨택 FOR UPDATE 잠금도 회차 INSERT 도 없었다.
    expect(H.acquireMock).not.toHaveBeenCalled();
    expect(H.order).toEqual([]);
  });
});

// ============================================================================
// T10 — Track A/B 차단 대칭
// ============================================================================
describe.each(['first', 'blank'] as const)('T10 중복 감지 차단 대칭 — %s', (kind: Kind) => {
  beforeEach(() => {
    wireHappyPath();
  });

  it('Track A 차단 사유를 그대로 돌려주고 INSERT 하지 않는다', async () => {
    H.trackAMock.mockResolvedValue({ blocked: true, reason: 'token_already_used' });
    const result = await callCreate(kind, {
      inviteToken: '11111111-1111-4111-8111-111111111111',
    });
    expect(result).toEqual({ kind: 'blocked', reason: 'token_already_used' });
    expect(H.insertValuesArg).not.toHaveBeenCalled();
  });

  it('Track B 차단 사유를 그대로 돌려주고 INSERT 하지 않는다', async () => {
    H.trackBMock.mockResolvedValue({ blocked: true, reason: 'device_already_responded' });
    const result = await callCreate(kind);
    expect(result).toEqual({ kind: 'blocked', reason: 'device_already_responded' });
    expect(H.insertValuesArg).not.toHaveBeenCalled();
  });
});

// ============================================================================
// T11 — 종결 상태 행 인수 차단
// ============================================================================
describe.each(['first', 'blank'] as const)('T11 종결 행 인수 차단 — %s', (kind: Kind) => {
  it('completed 재사용 후보는 token_already_used 로 접힌다', async () => {
    wireHappyPath();
    H.trackAMock.mockResolvedValue({ blocked: false, contactTargetId: 'c1', isTestTarget: false });
    // versionId 를 실어 멤버십을 execute 경로로 보내고, select 는 재사용 후보 조회 전용으로 둔다.
    H.selectLimitMock.mockResolvedValue([
      {
        id: 'r-old',
        contactTargetId: 'c1',
        metadata: null,
        status: 'completed',
        versionId: VERSION_ID,
      },
    ]);

    const result = await callCreate(kind, {
      versionId: VERSION_ID,
      inviteToken: '11111111-1111-4111-8111-111111111111',
    });

    expect(result).toEqual({ kind: 'blocked', reason: 'token_already_used' });
    expect(H.insertValuesArg).not.toHaveBeenCalled();
  });
});
