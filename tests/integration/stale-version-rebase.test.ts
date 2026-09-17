import { beforeEach, describe, expect, it, vi } from 'vitest';

// ========================
// 모듈 모킹
// ========================
// 무중단 갈아타기(티켓 04) — 배포 전 열린 탭이 들고 있던 구버전 versionId 로 첫 답변이
// 도착했을 때, loadValidatedVersionGateRow 가 거부(version_not_active) 대신 현재 버전
// (surveys.currentVersionId)으로 재핀해 응답 행을 생성하는지 검증한다.
//
// 불변 조건:
// - 타 설문 versionId 주입은 기존대로 version_mismatch(→ not_accepting blocked) 거부.
// - currentVersionId 가 null 이면 재핀 목적지가 없으므로 기존대로 version_not_active 거부.
// - versionId 가 현재 버전과 일치하면 기존 동작 그대로.
// - created 결과에 실제 행에 기록된 versionId 가 포함된다(클라이언트 재핀 감지용).
//
// db 는 기존 게이트 테스트(response-availability-gate.test.ts)와 같은 fluent chain 흉내.
// 재핀 경로는 versionId 가 non-null 이라 assertQuestionBelongsToResponse 가 스냅샷 멤버십을
// db.execute(sql) 로 검사하므로 execute mock 이 추가로 필요하다.

const {
  surveyFindFirstMock,
  versionFindFirstMock,
  responseFindFirstMock,
  insertReturningMock,
  selectLimitMock,
  countResultMock,
  executeMock,
  headersMock,
} = vi.hoisted(() => ({
  surveyFindFirstMock: vi.fn(),
  versionFindFirstMock: vi.fn(),
  responseFindFirstMock: vi.fn(),
  insertReturningMock: vi.fn(),
  selectLimitMock: vi.fn(),
  countResultMock: vi.fn(),
  // 스냅샷 멤버십(assertQuestionBelongsToResponse) — versionId 경로의 raw SQL 실행.
  executeMock: vi.fn(),
  headersMock: vi.fn(),
}));

const insertChain = {
  values: vi.fn(() => insertChain),
  onConflictDoNothing: vi.fn(() => insertChain),
  returning: vi.fn(() => insertReturningMock()),
};

function makeSelectChain(): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  chain['from'] = vi.fn(() => chain);
  chain['innerJoin'] = vi.fn(() => chain);
  chain['where'] = vi.fn(() => {
    const whereResult: Record<string, unknown> = {
      limit: vi.fn(() => selectLimitMock()),
      for: vi.fn(() => whereResult),
      then: (resolve: (v: unknown) => unknown) => resolve(countResultMock()),
    };
    return whereResult;
  });
  chain['limit'] = vi.fn(() => selectLimitMock());
  chain['for'] = vi.fn(() => chain);
  return chain;
}

function makeUpdateChain(): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  chain['set'] = vi.fn(() => chain);
  chain['where'] = vi.fn(() => chain);
  chain['returning'] = vi.fn(async () => [
    { id: 'r1', surveyId: SURVEY_ID, contactTargetId: null, pageVisits: null, metadata: null },
  ]);
  (chain as { then?: unknown })['then'] = (resolve: (v: unknown) => unknown) => resolve(undefined);
  return chain;
}

vi.mock('@/db', () => {
  const db: Record<string, unknown> = {
    insert: vi.fn(() => insertChain),
    select: vi.fn(() => makeSelectChain()),
    update: vi.fn(() => makeUpdateChain()),
    execute: vi.fn((...a: unknown[]) => executeMock(...a)),
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        update: vi.fn(() => makeUpdateChain()),
        insert: vi.fn(() => insertChain),
        delete: vi.fn(() => makeUpdateChain()),
        select: vi.fn(() => makeSelectChain()),
        execute: vi.fn((...a: unknown[]) => executeMock(...a)),
      };
      return cb(tx);
    }),
    query: {
      surveys: { findFirst: (...a: unknown[]) => surveyFindFirstMock(...a) },
      surveyVersions: { findFirst: (...a: unknown[]) => versionFindFirstMock(...a) },
      surveyResponses: { findFirst: (...a: unknown[]) => responseFindFirstMock(...a) },
    },
  };
  return { db };
});

vi.mock('@/server/survey-response/services/response-answers', () => ({
  replaceResponseAnswers: vi.fn(async () => undefined),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('next/headers', () => ({ headers: headersMock }));

// ========================
// 테스트
// ========================

const SURVEY_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_SURVEY_ID = '00000000-0000-4000-8000-000000000002';
const CURRENT_VID = '11111111-1111-4111-8111-111111111111';
const OLD_VID = '22222222-2222-4222-8222-222222222222';

const VALID_SIGNALS = {
  deviceId: 'dev-rebase-1',
  screen: '1920x1080',
  tz: 'Asia/Seoul',
  lang: 'ko-KR',
  platform: 'MacIntel',
};

function publishedSurvey(over: Record<string, unknown> = {}) {
  return {
    id: SURVEY_ID,
    status: 'published',
    endDate: null,
    maxResponses: null,
    isPublic: true,
    requireInviteToken: false,
    currentVersionId: CURRENT_VID,
    isPaused: false,
    testModeEnabled: false,
    testToken: null,
    ...over,
  };
}

/** insertChain.values 에 실제 전달된 첫 INSERT 페이로드. */
function firstInsertedValues(): Record<string, unknown> {
  const calls = insertChain.values.mock.calls as unknown as Array<[Record<string, unknown>]>;
  expect(calls.length).toBeGreaterThan(0);
  return calls[0]![0];
}

describe('무중단 갈아타기 — createResponseWithFirstAnswer 버전 재핀', () => {
  beforeEach(() => {
    surveyFindFirstMock.mockReset();
    versionFindFirstMock.mockReset();
    responseFindFirstMock.mockReset();
    insertReturningMock.mockReset();
    selectLimitMock.mockReset();
    countResultMock.mockReset();
    executeMock.mockReset();
    headersMock.mockReset();
    insertChain.values.mockClear();

    headersMock.mockResolvedValue(
      new Headers({ 'x-forwarded-for': '10.0.0.9', 'user-agent': 'Chrome/120' }),
    );
    // Track B(첫 findFirst) 는 매칭 없음, 이후 updateQuestionResponse 의 행 조회는 재핀된 행.
    responseFindFirstMock
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue({
        id: 'r1',
        surveyId: SURVEY_ID,
        versionId: CURRENT_VID,
        isTest: false,
        contactTargetId: null,
      });
    // 스냅샷 멤버십 — questionId 가 현재 버전 스냅샷에 존재(piiEncrypted=false).
    executeMock.mockResolvedValue([{ pii: false }]);
    selectLimitMock.mockResolvedValue([{ id: 'q1', piiEncrypted: false }]);
    countResultMock.mockResolvedValue([{ total: 0 }]);
    insertReturningMock.mockResolvedValue([
      {
        id: 'r1',
        contactTargetId: null,
        metadata: null,
        status: 'in_progress',
        versionId: CURRENT_VID,
      },
    ]);
  });

  it('같은 설문의 superseded versionId 는 거부 대신 현재 버전으로 재핀되어 created 를 반환한다', async () => {
    surveyFindFirstMock.mockResolvedValue(publishedSurvey());
    versionFindFirstMock.mockResolvedValue({ surveyId: SURVEY_ID, status: 'superseded' });

    const { createResponseWithFirstAnswer } =
      await import('@/server/survey-response/services/response-entry');
    const result = await createResponseWithFirstAnswer({
      surveyId: SURVEY_ID,
      sessionId: 'rebase-session-1',
      versionId: OLD_VID,
      questionId: 'q1',
      value: 'a',
      currentStepId: 'step1',
      clientSignals: VALID_SIGNALS,
    });

    // 거부 대신 생성 성공 + 결과에 재핀된 versionId 포함(클라이언트 재핀 감지용).
    expect(result).toMatchObject({ kind: 'created', id: 'r1', versionId: CURRENT_VID });
    // INSERT 되는 행의 versionId 가 구버전이 아니라 현재 버전이어야 한다.
    expect(firstInsertedValues()['versionId']).toBe(CURRENT_VID);
  });

  it('타 설문 소속 versionId 주입은 기존대로 거부한다 (version_mismatch 불변)', async () => {
    surveyFindFirstMock.mockResolvedValue(publishedSurvey());
    versionFindFirstMock.mockResolvedValue({ surveyId: OTHER_SURVEY_ID, status: 'published' });

    const { createResponseWithFirstAnswer } =
      await import('@/server/survey-response/services/response-entry');
    const result = await createResponseWithFirstAnswer({
      surveyId: SURVEY_ID,
      sessionId: 'rebase-session-2',
      versionId: OLD_VID,
      questionId: 'q1',
      value: 'a',
      currentStepId: 'step1',
      clientSignals: VALID_SIGNALS,
    });

    expect(result).toEqual({ kind: 'blocked', reason: 'not_accepting' });
    expect(insertChain.values).not.toHaveBeenCalled();
  });

  it('versionId 가 currentVersionId 와 일치하면 기존 동작 그대로 통과한다 (결과 versionId 포함)', async () => {
    surveyFindFirstMock.mockResolvedValue(publishedSurvey());
    versionFindFirstMock.mockResolvedValue({ surveyId: SURVEY_ID, status: 'published' });

    const { createResponseWithFirstAnswer } =
      await import('@/server/survey-response/services/response-entry');
    const result = await createResponseWithFirstAnswer({
      surveyId: SURVEY_ID,
      sessionId: 'rebase-session-3',
      versionId: CURRENT_VID,
      questionId: 'q1',
      value: 'a',
      currentStepId: 'step1',
      clientSignals: VALID_SIGNALS,
    });

    expect(result).toMatchObject({ kind: 'created', id: 'r1', versionId: CURRENT_VID });
    expect(firstInsertedValues()['versionId']).toBe(CURRENT_VID);
  });

  it('currentVersionId 가 null 이면 구버전 versionId 는 기존대로 version_not_active 거부한다', async () => {
    surveyFindFirstMock.mockResolvedValue(publishedSurvey({ currentVersionId: null }));
    versionFindFirstMock.mockResolvedValue({ surveyId: SURVEY_ID, status: 'superseded' });

    const { createResponseWithFirstAnswer } =
      await import('@/server/survey-response/services/response-entry');
    const result = await createResponseWithFirstAnswer({
      surveyId: SURVEY_ID,
      sessionId: 'rebase-session-4',
      versionId: OLD_VID,
      questionId: 'q1',
      value: 'a',
      currentStepId: 'step1',
      clientSignals: VALID_SIGNALS,
    });

    expect(result).toEqual({ kind: 'blocked', reason: 'not_accepting' });
    expect(insertChain.values).not.toHaveBeenCalled();
  });
});

describe('무중단 갈아타기 — createBlankResponse 버전 재핀', () => {
  beforeEach(() => {
    surveyFindFirstMock.mockReset();
    versionFindFirstMock.mockReset();
    responseFindFirstMock.mockReset();
    insertReturningMock.mockReset();
    selectLimitMock.mockReset();
    countResultMock.mockReset();
    executeMock.mockReset();
    headersMock.mockReset();
    insertChain.values.mockClear();

    headersMock.mockResolvedValue(
      new Headers({ 'x-forwarded-for': '10.0.0.9', 'user-agent': 'Chrome/120' }),
    );
    responseFindFirstMock.mockResolvedValue(undefined);
    countResultMock.mockResolvedValue([{ total: 0 }]);
    insertReturningMock.mockResolvedValue([
      {
        id: 'r2',
        contactTargetId: null,
        metadata: null,
        status: 'in_progress',
        versionId: CURRENT_VID,
      },
    ]);
  });

  it('같은 설문의 superseded versionId 는 현재 버전으로 재핀되어 created 를 반환한다', async () => {
    surveyFindFirstMock.mockResolvedValue(publishedSurvey());
    versionFindFirstMock.mockResolvedValue({ surveyId: SURVEY_ID, status: 'superseded' });

    const { createBlankResponse } =
      await import('@/server/survey-response/services/response-entry');
    const result = await createBlankResponse({
      surveyId: SURVEY_ID,
      sessionId: 'rebase-blank-session-1',
      versionId: OLD_VID,
      currentStepId: 'step1',
      clientSignals: VALID_SIGNALS,
    });

    expect(result).toMatchObject({ kind: 'created', id: 'r2', versionId: CURRENT_VID });
    expect(firstInsertedValues()['versionId']).toBe(CURRENT_VID);
  });

  it('타 설문 소속 versionId 주입은 기존대로 거부한다', async () => {
    surveyFindFirstMock.mockResolvedValue(publishedSurvey());
    versionFindFirstMock.mockResolvedValue({ surveyId: OTHER_SURVEY_ID, status: 'superseded' });

    const { createBlankResponse } =
      await import('@/server/survey-response/services/response-entry');
    const result = await createBlankResponse({
      surveyId: SURVEY_ID,
      sessionId: 'rebase-blank-session-2',
      versionId: OLD_VID,
      currentStepId: 'step1',
      clientSignals: VALID_SIGNALS,
    });

    expect(result).toEqual({ kind: 'blocked', reason: 'not_accepting' });
    expect(insertChain.values).not.toHaveBeenCalled();
  });
});
