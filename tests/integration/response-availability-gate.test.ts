import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ========================
// 모듈 모킹
// ========================
// 응답 가용성 게이트(assertSurveyAcceptingResponses)를 검증한다.
// 설문이 마감/draft/closed/정원초과/비공개+토큰없음이면 응답 mutation 이 거부되고,
// 정상 published 설문은 통과해야 한다.
//
// 게이트는 startResponse / createResponseWithFirstAnswer / createBlankResponse /
// completeResponse 진입부에서 survey(+version) 를 조회해 검사한다. 조회는
// db.query.surveys.findFirst / db.query.surveyVersions.findFirst, 정원 하드체크는
// db.select(count) 체인을 사용한다.

const {
  surveyFindFirstMock,
  versionFindFirstMock,
  responseFindFirstMock,
  contactFindFirstMock,
  insertReturningMock,
  selectLimitMock,
  countResultMock,
  headersMock,
  selectWhereLogMock,
  inviteLookupMock,
} = vi.hoisted(() => ({
  surveyFindFirstMock: vi.fn(),
  versionFindFirstMock: vi.fn(),
  responseFindFirstMock: vi.fn(),
  contactFindFirstMock: vi.fn(),
  insertReturningMock: vi.fn(),
  selectLimitMock: vi.fn(),
  countResultMock: vi.fn(),
  headersMock: vi.fn(),
  // db.select(...).where(조건) 에 실제로 전달된 SQL 조건을 기록 — countCompletedResponses 의
  // notTestResponse 포함 여부를 where 절 SQL 문자열/파라미터로 검증하는 데 사용한다.
  selectWhereLogMock: vi.fn(),
  // resumeOrCreateResponse 의 컨택 분기(inviteToken → findContactByInviteToken) 검증용.
  inviteLookupMock: vi.fn(),
}));

const insertChain = {
  values: vi.fn(() => insertChain),
  onConflictDoNothing: vi.fn(() => insertChain),
  returning: vi.fn(() => insertReturningMock()),
};

// select 체인: count 쿼리는 .from().where() 를 await(thenable), 그 외 .limit() 종단.
function makeSelectChain(): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  chain['from'] = vi.fn(() => chain);
  chain['innerJoin'] = vi.fn(() => chain);
  chain['where'] = vi.fn((cond: unknown) => {
    selectWhereLogMock(cond);
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
    { id: 'r1', surveyId: 's1', contactTargetId: null, pageVisits: null },
  ]);
  (chain as { then?: unknown })['then'] = (resolve: (v: unknown) => unknown) => resolve(undefined);
  return chain;
}

vi.mock('@/db', () => {
  const db: Record<string, unknown> = {
    insert: vi.fn(() => insertChain),
    select: vi.fn(() => makeSelectChain()),
    update: vi.fn(() => makeUpdateChain()),
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        update: vi.fn(() => makeUpdateChain()),
        insert: vi.fn(() => insertChain),
        delete: vi.fn(() => makeUpdateChain()),
        select: vi.fn((fields?: Record<string, unknown>) => {
          const terminal = async () => {
            if (
              fields &&
              'surveyId' in fields &&
              'isTest' in fields &&
              'contactTargetId' in fields
            ) {
              const row = await responseFindFirstMock();
              return row ? [row] : [];
            }
            if (fields && 'enabled' in fields) {
              const row = await surveyFindFirstMock();
              return row ? [{ enabled: row.testModeEnabled }] : [];
            }
            if (fields && 'total' in fields) return countResultMock();
            return selectLimitMock();
          };
          const result: Record<string, unknown> = {
            for: vi.fn(() => result),
            limit: vi.fn(() => terminal()),
            then: (resolve: (value: unknown) => unknown) => terminal().then(resolve),
          };
          const chain: Record<string, unknown> = {
            from: vi.fn(() => chain),
            where: vi.fn(() => result),
          };
          return chain;
        }),
      };
      return cb(tx);
    }),
    query: {
      surveys: { findFirst: (...a: unknown[]) => surveyFindFirstMock(...a) },
      surveyVersions: { findFirst: (...a: unknown[]) => versionFindFirstMock(...a) },
      surveyResponses: { findFirst: (...a: unknown[]) => responseFindFirstMock(...a) },
      contactTargets: { findFirst: (...a: unknown[]) => contactFindFirstMock(...a) },
    },
  };
  return { db };
});

vi.mock('@/features/survey-response/server/services/response-answers.service', () => ({
  replaceResponseAnswers: vi.fn(async () => undefined),
}));

// resumeOrCreateResponse 의 컨택 분기(inviteToken)에서 호출. 기본은 미설정(undefined) —
// inviteToken 을 넘기지 않는 테스트는 이 mock 을 타지 않으므로 영향 없다.
vi.mock('@/lib/duplicate-detection/invite-lookup', () => ({
  findContactByInviteToken: (...a: unknown[]) => inviteLookupMock(...a),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

// createResponseWithFirstAnswer 는 UA 파싱을 위해 next/headers 를 호출한다(테스트 세션
// 판정 게이트 테스트에서만 필요 — startResponse/completeResponse 는 호출하지 않는다).
vi.mock('next/headers', () => ({ headers: headersMock }));

const dialect = new PgDialect();

const SURVEY_ID = '00000000-0000-4000-8000-000000000001';

function publishedSurvey(over: Record<string, unknown> = {}) {
  return {
    id: SURVEY_ID,
    status: 'published',
    endDate: null,
    maxResponses: null,
    isPublic: true,
    requireInviteToken: false,
    // 설문 중단·테스트 모드 (Task 5) — 기본은 off.
    isPaused: false,
    testModeEnabled: false,
    testToken: null,
    ...over,
  };
}

describe('assertSurveyAcceptingResponses — startResponse 게이트', () => {
  beforeEach(() => {
    surveyFindFirstMock.mockReset();
    versionFindFirstMock.mockReset();
    responseFindFirstMock.mockReset();
    contactFindFirstMock.mockReset();
    insertReturningMock.mockReset();
    selectLimitMock.mockReset();
    countResultMock.mockReset();
    insertReturningMock.mockResolvedValue([{ id: 'r1', contactTargetId: null }]);
    selectLimitMock.mockResolvedValue([]);
    countResultMock.mockResolvedValue([{ total: 0 }]);
  });

  it('published 정상 설문이면 통과해 응답 행을 반환한다', async () => {
    surveyFindFirstMock.mockResolvedValue(publishedSurvey());
    const { startResponse } =
      await import('@/features/survey-response/server/services/response.service');
    const res = await startResponse({ surveyId: SURVEY_ID });
    expect(res).toMatchObject({ id: 'r1' });
  });

  it('sessionId 미제공 시 예측 불가능한 UUID 세션 식별자를 생성한다', async () => {
    // pub(무인증) start procedure 로 sessionId 없이 호출 가능 — 서버 폴백이 예측가능한
    // session-<밀리초> 면 resume→updateQuestionResponse 변조 윈도가 열린다(클라 fix 우회 차단).
    surveyFindFirstMock.mockResolvedValue(publishedSurvey());
    insertChain.values.mockClear();
    const { startResponse } =
      await import('@/features/survey-response/server/services/response.service');
    await startResponse({ surveyId: SURVEY_ID });

    const valuesCalls = insertChain.values.mock.calls as unknown as Array<[{ sessionId: string }]>;
    const inserted = valuesCalls[0]![0];
    expect(inserted.sessionId).not.toMatch(/^session-\d+$/);
    expect(inserted.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('status=draft 면 거부한다', async () => {
    surveyFindFirstMock.mockResolvedValue(publishedSurvey({ status: 'draft' }));
    const { startResponse } =
      await import('@/features/survey-response/server/services/response.service');
    await expect(startResponse({ surveyId: SURVEY_ID })).rejects.toThrow();
  });

  it('status=closed 면 거부한다', async () => {
    surveyFindFirstMock.mockResolvedValue(publishedSurvey({ status: 'closed' }));
    const { startResponse } =
      await import('@/features/survey-response/server/services/response.service');
    await expect(startResponse({ surveyId: SURVEY_ID })).rejects.toThrow();
  });

  it('endDate 가 과거(경과)면 거부한다', async () => {
    surveyFindFirstMock.mockResolvedValue(
      publishedSurvey({ endDate: new Date(Date.now() - 60_000) }),
    );
    const { startResponse } =
      await import('@/features/survey-response/server/services/response.service');
    await expect(startResponse({ surveyId: SURVEY_ID })).rejects.toThrow();
  });

  it('endDate 가 미래면 통과한다', async () => {
    surveyFindFirstMock.mockResolvedValue(
      publishedSurvey({ endDate: new Date(Date.now() + 60_000) }),
    );
    const { startResponse } =
      await import('@/features/survey-response/server/services/response.service');
    const res = await startResponse({ surveyId: SURVEY_ID });
    expect(res).toMatchObject({ id: 'r1' });
  });

  it('비공개(isPublic=false) + invite(contactTargetId) 없음이면 거부한다', async () => {
    surveyFindFirstMock.mockResolvedValue(publishedSurvey({ isPublic: false }));
    const { startResponse } =
      await import('@/features/survey-response/server/services/response.service');
    // startResponse 는 inviteToken 을 받지 않으므로 비공개면 항상 거부.
    await expect(startResponse({ surveyId: SURVEY_ID })).rejects.toThrow();
  });

  it('설문 자체가 존재하지 않으면 거부한다', async () => {
    surveyFindFirstMock.mockResolvedValue(undefined);
    const { startResponse } =
      await import('@/features/survey-response/server/services/response.service');
    await expect(startResponse({ surveyId: SURVEY_ID })).rejects.toThrow();
  });
});

describe('assertSurveyAcceptingResponses — completeResponse 정원 하드체크', () => {
  beforeEach(() => {
    surveyFindFirstMock.mockReset();
    versionFindFirstMock.mockReset();
    responseFindFirstMock.mockReset();
    contactFindFirstMock.mockReset();
    selectLimitMock.mockReset();
    countResultMock.mockReset();
    surveyFindFirstMock.mockResolvedValue(publishedSurvey({ maxResponses: 2 }));
    // completeResponse 진입부에서 응답 행(surveyId/versionId/contactTargetId)을 조회한다.
    responseFindFirstMock.mockResolvedValue({
      surveyId: SURVEY_ID,
      versionId: null,
      contactTargetId: null,
    });
    selectLimitMock.mockResolvedValue([]);
  });

  it('완료 카운트가 maxResponses 이상이면 완료를 거부한다', async () => {
    countResultMock.mockResolvedValue([{ total: 2 }]);
    const { completeResponse } =
      await import('@/features/survey-response/server/services/response.service');
    await expect(completeResponse({ responseId: 'r1' })).rejects.toThrow();
  });

  it('완료 카운트가 maxResponses 미만이면 완료를 통과시킨다', async () => {
    countResultMock.mockResolvedValue([{ total: 1 }]);
    const { completeResponse } =
      await import('@/features/survey-response/server/services/response.service');
    const res = await completeResponse({ responseId: 'r1' });
    expect(res).toMatchObject({ id: 'r1' });
  });
});

describe('assertSurveyAcceptingResponses — createResponseWithFirstAnswer 테스트 세션 판정 + 중단 게이트', () => {
  const VALID_SIGNALS = {
    deviceId: 'dev-gate-1',
    screen: '1920x1080',
    tz: 'Asia/Seoul',
    lang: 'ko-KR',
    platform: 'MacIntel',
  };

  beforeEach(() => {
    surveyFindFirstMock.mockReset();
    versionFindFirstMock.mockReset();
    responseFindFirstMock.mockReset();
    contactFindFirstMock.mockReset();
    insertReturningMock.mockReset();
    selectLimitMock.mockReset();
    countResultMock.mockReset();
    headersMock.mockReset();
    insertChain.values.mockClear();

    headersMock.mockResolvedValue(
      new Headers({ 'x-forwarded-for': '10.0.0.9', 'user-agent': 'Chrome/120' }),
    );
    insertReturningMock.mockResolvedValue([{ id: 'r1', contactTargetId: null }]);
    // updateQuestionResponse 의 questionId 존재 검사(select().where().limit()) 기본 hit.
    selectLimitMock
      .mockResolvedValueOnce([{ id: 'q1' }])
      .mockResolvedValueOnce([
        {
          id: 'target-test-response',
          surveyId: SURVEY_ID,
          isTest: true,
          contactTargetId: 'target-test-contact',
        },
      ])
      .mockResolvedValueOnce([{ enabled: true }])
      .mockResolvedValueOnce([{ id: 'target-test-contact' }]);
    countResultMock.mockResolvedValue([{ total: 0 }]);
  });

  it('isPaused 설문은 create 를 survey_paused 로 거부한다', async () => {
    surveyFindFirstMock.mockResolvedValue(publishedSurvey({ isPaused: true }));
    // Track B: 매칭되는 완료 응답 없음 → 통과 후 paused 게이트에서 거부되는지 확인.
    responseFindFirstMock.mockResolvedValue(undefined);

    const { createResponseWithFirstAnswer } =
      await import('@/features/survey-response/server/services/response.service');
    await expect(
      createResponseWithFirstAnswer({
        surveyId: SURVEY_ID,
        sessionId: 'gate-session-paused',
        versionId: null,
        questionId: 'q1',
        value: 'a',
        currentStepId: 'step1',
        clientSignals: VALID_SIGNALS,
      }),
    ).rejects.toThrow(/survey_paused/);
  });

  it('테스트 응답은 종료·중단·종료일·최대 응답·초대 요구를 우회하고 isTest=true로 기록된다', async () => {
    surveyFindFirstMock.mockResolvedValue(
      publishedSurvey({
        status: 'closed',
        isPaused: true,
        endDate: new Date(Date.now() - 60_000),
        maxResponses: 0,
        isPublic: false,
        requireInviteToken: true,
        testModeEnabled: true,
        testToken: 'tok',
      }),
    );
    // isTest 세션이므로 Track B 는 호출되지 않아야 한다. updateQuestionResponse 내부의
    // 응답 행 조회(surveyResponses.findFirst)에만 쓰인다. isTest: true 는 실제로 INSERT
    // 된 행을 그대로 반영(Task 6: isTest 행이면 updateQuestionResponse 의 중단 게이트가
    // flags 조회 자체를 skip해야 한다).
    responseFindFirstMock.mockResolvedValue({
      id: 'r1',
      surveyId: SURVEY_ID,
      versionId: null,
      isTest: true,
    });

    const { createResponseWithFirstAnswer } =
      await import('@/features/survey-response/server/services/response.service');
    const result = await createResponseWithFirstAnswer({
      surveyId: SURVEY_ID,
      sessionId: 'gate-session-test-token',
      versionId: null,
      questionId: 'q1',
      value: 'a',
      currentStepId: 'step1',
      clientSignals: VALID_SIGNALS,
      testToken: 'tok',
    });

    expect(result).toMatchObject({ kind: 'created', id: 'r1' });
    const valuesCalls = insertChain.values.mock.calls as unknown as Array<[{ isTest: boolean }]>;
    const inserted = valuesCalls[0]![0];
    expect(inserted.isTest).toBe(true);
  });

  it('무효 testToken(모드 OFF)은 invalid_test_token 으로 신규 응답 생성을 차단한다 (스펙 §9)', async () => {
    surveyFindFirstMock.mockResolvedValue(publishedSurvey({ testModeEnabled: false }));
    // Track B 에 매칭될 완료 응답이 있어도, 무효 테스트 링크는 그 전에 차단돼야 한다
    // (테스트 모드 OFF 후 stale 탭의 신규 응답이 익명 실데이터로 새는 것 방지).
    responseFindFirstMock.mockResolvedValue({ id: 'prior-response' });

    const { createResponseWithFirstAnswer } =
      await import('@/features/survey-response/server/services/response.service');
    const result = await createResponseWithFirstAnswer({
      surveyId: SURVEY_ID,
      sessionId: 'gate-session-invalid-token',
      versionId: null,
      questionId: 'q1',
      value: 'a',
      currentStepId: 'step1',
      clientSignals: VALID_SIGNALS,
      testToken: 'tok',
    });

    expect(result).toEqual({ kind: 'blocked', reason: 'invalid_test_token' });
  });

  it('토큰 불일치(모드 ON + 다른 토큰)도 invalid_test_token 으로 차단한다', async () => {
    surveyFindFirstMock.mockResolvedValue(
      publishedSurvey({ testModeEnabled: true, testToken: 'right' }),
    );
    responseFindFirstMock.mockResolvedValue(undefined);

    const { createResponseWithFirstAnswer } =
      await import('@/features/survey-response/server/services/response.service');
    const result = await createResponseWithFirstAnswer({
      surveyId: SURVEY_ID,
      sessionId: 'gate-session-token-mismatch',
      versionId: null,
      questionId: 'q1',
      value: 'a',
      currentStepId: 'step1',
      clientSignals: VALID_SIGNALS,
      testToken: 'wrong',
    });

    expect(result).toEqual({ kind: 'blocked', reason: 'invalid_test_token' });
  });

  it('inviteToken과 testToken을 섞으면 create 진입점에서 invalid_test_token으로 차단한다', async () => {
    surveyFindFirstMock.mockResolvedValue(
      publishedSurvey({ testModeEnabled: true, testToken: 'tok' }),
    );

    const { createResponseWithFirstAnswer } =
      await import('@/features/survey-response/server/services/response.service');
    const result = await createResponseWithFirstAnswer({
      surveyId: SURVEY_ID,
      sessionId: 'gate-session-mixed-token',
      versionId: null,
      questionId: 'q1',
      value: 'a',
      currentStepId: 'step1',
      inviteToken: '11111111-2222-4333-8444-555555555555',
      clientSignals: VALID_SIGNALS,
      testToken: 'tok',
    });

    expect(result).toEqual({ kind: 'blocked', reason: 'invalid_test_token' });
    expect(inviteLookupMock).not.toHaveBeenCalled();
    expect(insertChain.values).not.toHaveBeenCalled();
  });

  it('createBlankResponse: 무효 testToken 은 invalid_test_token 으로 신규 응답 생성을 차단한다 (스펙 §9)', async () => {
    surveyFindFirstMock.mockResolvedValue(publishedSurvey({ testModeEnabled: false }));
    // Track B 차단 후보가 있어도, 무효 테스트 링크는 그 전에 차단돼야 한다.
    responseFindFirstMock.mockResolvedValue({ id: 'prior-response' });

    const { createBlankResponse } =
      await import('@/features/survey-response/server/services/response.service');
    const result = await createBlankResponse({
      surveyId: SURVEY_ID,
      sessionId: 'gate-session-blank-invalid-token',
      versionId: null,
      currentStepId: 'step1',
      clientSignals: VALID_SIGNALS,
      testToken: 'tok',
    });

    expect(result).toEqual({ kind: 'blocked', reason: 'invalid_test_token' });
  });

  it('createBlankResponse도 inviteToken과 testToken 혼합을 invalid_test_token으로 차단한다', async () => {
    surveyFindFirstMock.mockResolvedValue(
      publishedSurvey({ testModeEnabled: true, testToken: 'tok' }),
    );

    const { createBlankResponse } =
      await import('@/features/survey-response/server/services/response.service');
    const result = await createBlankResponse({
      surveyId: SURVEY_ID,
      sessionId: 'gate-session-blank-mixed-token',
      versionId: null,
      currentStepId: 'step1',
      inviteToken: '11111111-2222-4333-8444-555555555555',
      clientSignals: VALID_SIGNALS,
      testToken: 'tok',
    });

    expect(result).toEqual({ kind: 'blocked', reason: 'invalid_test_token' });
    expect(inviteLookupMock).not.toHaveBeenCalled();
    expect(insertChain.values).not.toHaveBeenCalled();
  });
});

describe('resumeOrCreateResponse — 중단 게이트 (Task 6)', () => {
  beforeEach(() => {
    surveyFindFirstMock.mockReset();
    versionFindFirstMock.mockReset();
    responseFindFirstMock.mockReset();
    contactFindFirstMock.mockReset();
    selectLimitMock.mockReset();
    countResultMock.mockReset();
    inviteLookupMock.mockReset();
  });

  it('inviteToken과 testToken을 섞으면 resume 진입점에서 invalid_test_token으로 차단한다', async () => {
    surveyFindFirstMock.mockResolvedValue(
      publishedSurvey({ testModeEnabled: true, testToken: 'tok' }),
    );

    const { resumeOrCreateResponse } =
      await import('@/features/survey-response/server/services/lifecycle.service');
    await expect(
      resumeOrCreateResponse({
        surveyId: SURVEY_ID,
        sessionId: 'sess-mixed-token',
        inviteToken: '11111111-2222-4333-8444-555555555555',
        testToken: 'tok',
      }),
    ).rejects.toThrow(/invalid_test_token/);

    expect(surveyFindFirstMock).not.toHaveBeenCalled();
    expect(inviteLookupMock).not.toHaveBeenCalled();
  });

  it('invalid_test inviteToken은 익명 sessionId 회복과 touch로 폴백하지 않는다', async () => {
    surveyFindFirstMock.mockResolvedValue(publishedSurvey());
    inviteLookupMock.mockResolvedValue({ kind: 'invalid_test' });
    selectLimitMock.mockResolvedValue([
      { id: 'anonymous-response', status: 'in_progress', isTest: false },
    ]);

    const { resumeOrCreateResponse } =
      await import('@/features/survey-response/server/services/lifecycle.service');

    await expect(
      resumeOrCreateResponse({
        surveyId: SURVEY_ID,
        sessionId: 'anonymous-session-with-test-token',
        inviteToken: '11111111-2222-4333-8444-555555555555',
      }),
    ).rejects.toThrow(/invalid_test_token/);

    expect(selectLimitMock).not.toHaveBeenCalled();
  });

  it('컨택 분기(inviteToken)도 isPaused 설문의 drop 회복을 survey_paused 로 거부한다', async () => {
    // 세션 분기와 대칭 — existingByContact drop 행이 비-테스트면 중단 중 재개를 막아야 한다.
    surveyFindFirstMock.mockResolvedValue(publishedSurvey({ isPaused: true }));
    inviteLookupMock.mockResolvedValue({
      kind: 'valid',
      contactTargetId: 'ct-1',
      respondedAt: null,
    });
    selectLimitMock.mockResolvedValue([{ id: 'resp-c1', status: 'drop', isTest: false }]);

    const { resumeOrCreateResponse } =
      await import('@/features/survey-response/server/services/lifecycle.service');
    await expect(
      resumeOrCreateResponse({
        surveyId: SURVEY_ID,
        sessionId: 'sess-contact-paused',
        inviteToken: '11111111-2222-4333-8444-555555555555',
      }),
    ).rejects.toThrow(/survey_paused/);
  });

  it('isPaused 설문은 in_progress 재개를 survey_paused 로 거부한다', async () => {
    surveyFindFirstMock.mockResolvedValue(publishedSurvey({ isPaused: true }));
    selectLimitMock.mockResolvedValue([{ id: 'resp-1', status: 'in_progress', isTest: false }]);

    const { resumeOrCreateResponse } =
      await import('@/features/survey-response/server/services/lifecycle.service');
    await expect(
      resumeOrCreateResponse({ surveyId: SURVEY_ID, sessionId: 'sess-paused-1' }),
    ).rejects.toThrow(/survey_paused/);
  });

  it('isPaused 설문의 drop → in_progress 회복도 거부한다', async () => {
    surveyFindFirstMock.mockResolvedValue(publishedSurvey({ isPaused: true }));
    selectLimitMock.mockResolvedValue([{ id: 'resp-2', status: 'drop', isTest: false }]);

    const { resumeOrCreateResponse } =
      await import('@/features/survey-response/server/services/lifecycle.service');
    await expect(
      resumeOrCreateResponse({ surveyId: SURVEY_ID, sessionId: 'sess-paused-2' }),
    ).rejects.toThrow(/survey_paused/);
  });

  it('isTest 행은 isPaused 여도 재개된다', async () => {
    surveyFindFirstMock.mockResolvedValue(publishedSurvey({ isPaused: true }));
    selectLimitMock.mockResolvedValue([{ id: 'resp-3', status: 'drop', isTest: true }]);

    const { resumeOrCreateResponse } =
      await import('@/features/survey-response/server/services/lifecycle.service');
    const result = await resumeOrCreateResponse({
      surveyId: SURVEY_ID,
      sessionId: 'sess-paused-3',
    });
    expect(result).toEqual({ id: 'resp-3', status: 'in_progress', resumed: true });
  });

  it('같은 버전의 대상자 테스트 응답은 저장된 답변과 함께 재개한다', async () => {
    const versionId = '11111111-1111-4111-8111-111111111111';
    surveyFindFirstMock.mockResolvedValue(
      publishedSurvey({ testModeEnabled: true, currentVersionId: versionId }),
    );
    inviteLookupMock.mockResolvedValue({
      kind: 'valid',
      contactTargetId: 'ct-test-1',
      respondedAt: null,
      isTest: true,
    });
    selectLimitMock.mockResolvedValue([
      {
        id: 'resp-test-1',
        status: 'in_progress',
        isTest: true,
        versionId,
        questionResponses: { q1: '저장된 답변' },
      },
    ]);

    const { resumeOrCreateResponse } =
      await import('@/features/survey-response/server/services/lifecycle.service');

    await expect(
      resumeOrCreateResponse({
        surveyId: SURVEY_ID,
        sessionId: 'new-page-session',
        inviteToken: '11111111-2222-4333-8444-555555555555',
      }),
    ).resolves.toEqual({
      id: 'resp-test-1',
      status: 'in_progress',
      resumed: false,
      questionResponses: { q1: '저장된 답변' },
    });
  });

  it('이전 버전의 대상자 테스트 응답은 GET에서 재개하거나 변경하지 않는다', async () => {
    surveyFindFirstMock.mockResolvedValue(
      publishedSurvey({
        testModeEnabled: true,
        currentVersionId: '11111111-1111-4111-8111-111111111111',
      }),
    );
    inviteLookupMock.mockResolvedValue({
      kind: 'valid',
      contactTargetId: 'ct-test-old-version',
      respondedAt: null,
      isTest: true,
    });
    selectLimitMock.mockResolvedValue([
      {
        id: 'resp-test-old-version',
        status: 'in_progress',
        isTest: true,
        versionId: '22222222-2222-4222-8222-222222222222',
        questionResponses: { q1: '이전 답변' },
      },
    ]);

    const { resumeOrCreateResponse } =
      await import('@/features/survey-response/server/services/lifecycle.service');

    await expect(
      resumeOrCreateResponse({
        surveyId: SURVEY_ID,
        sessionId: 'old-version-page-session',
        inviteToken: '11111111-2222-4333-8444-555555555555',
      }),
    ).resolves.toBeNull();
  });
});

describe('updateQuestionResponse — 중단 게이트 (Task 6)', () => {
  beforeEach(() => {
    surveyFindFirstMock.mockReset();
    responseFindFirstMock.mockReset();
    selectLimitMock.mockReset();
    countResultMock.mockReset();
    countResultMock.mockResolvedValue([{ total: 0 }]);
  });

  it('isPaused 설문은 updateQuestionResponse 를 거부한다 (isTest 행은 허용)', async () => {
    const { updateQuestionResponse } =
      await import('@/features/survey-response/server/services/response.service');
    selectLimitMock.mockResolvedValue([{ id: 'q1' }]);

    // 비-테스트 행: paused 설문이면 거부한다.
    surveyFindFirstMock.mockResolvedValue(publishedSurvey({ isPaused: true }));
    responseFindFirstMock.mockResolvedValue({
      id: 'r1',
      surveyId: SURVEY_ID,
      versionId: null,
      isTest: false,
    });
    await expect(
      updateQuestionResponse({ responseId: 'r1', questionId: 'q1', value: 'a' }),
    ).rejects.toThrow(/survey_paused/);

    // 테스트 행: 중단은 우회하되 전역 테스트 모드가 아직 ON인지는 재확인한다.
    surveyFindFirstMock.mockClear();
    surveyFindFirstMock.mockResolvedValue(
      publishedSurvey({ isPaused: true, testModeEnabled: true }),
    );
    responseFindFirstMock.mockResolvedValue({
      id: 'r1',
      surveyId: SURVEY_ID,
      versionId: null,
      isTest: true,
    });
    const result = await updateQuestionResponse({
      responseId: 'r1',
      questionId: 'q1',
      value: 'a',
    });
    expect(result).toMatchObject({ id: 'r1' });
    expect(surveyFindFirstMock).toHaveBeenCalled();
  });

  it('대상자 테스트 응답은 active attempt와 세션 없이 저장할 수 없다', async () => {
    const { updateQuestionResponse } =
      await import('@/features/survey-response/server/services/response.service');
    selectLimitMock
      .mockResolvedValueOnce([{ id: 'q1' }])
      .mockResolvedValueOnce([
        {
          id: 'target-test-response',
          surveyId: SURVEY_ID,
          isTest: true,
          contactTargetId: 'target-test-contact',
        },
      ])
      .mockResolvedValueOnce([{ enabled: true }])
      .mockResolvedValueOnce([{ id: 'target-test-contact' }]);
    surveyFindFirstMock.mockResolvedValue(publishedSurvey({ testModeEnabled: true }));
    responseFindFirstMock.mockResolvedValue({
      id: 'target-test-response',
      surveyId: SURVEY_ID,
      versionId: null,
      isTest: true,
      contactTargetId: 'target-test-contact',
    });

    await expect(
      updateQuestionResponse({
        responseId: 'target-test-response',
        questionId: 'q1',
        value: 'answer',
      }),
    ).rejects.toThrow('테스트 세션이 다른 화면에서 시작되었습니다');
  });
});

describe('countCompletedResponses — isTest 제외 (Task 6)', () => {
  beforeEach(() => {
    surveyFindFirstMock.mockReset();
    versionFindFirstMock.mockReset();
    responseFindFirstMock.mockReset();
    selectLimitMock.mockReset();
    countResultMock.mockReset();
    selectWhereLogMock.mockReset();
  });

  it('countCompletedResponses 는 isTest 완료를 세지 않는다 (where 절에 is_test=false 조건 포함)', async () => {
    surveyFindFirstMock.mockResolvedValue(publishedSurvey({ maxResponses: 2 }));
    responseFindFirstMock.mockResolvedValue({
      surveyId: SURVEY_ID,
      versionId: null,
      contactTargetId: null,
      isTest: false,
    });
    countResultMock.mockResolvedValue([{ total: 1 }]);

    const { completeResponse } =
      await import('@/features/survey-response/server/services/response.service');
    await completeResponse({ responseId: 'r1' });

    // completeResponse 이 시나리오(data 없음, versionId 없음)에서는 정원 count 쿼리 1건만
    // db.select(...).where(...) 를 탄다 — 그 조건에 notTestResponse(is_test=false) 가
    // 실제로 포함됐는지 SQL 문자열/파라미터로 검증한다(mock 은 조건을 해석하지 않으므로
    // 결과값 비교만으로는 누락을 잡지 못한다).
    expect(selectWhereLogMock).toHaveBeenCalledTimes(1);
    const whereArg = selectWhereLogMock.mock.calls[0]![0];
    const query = dialect.sqlToQuery(whereArg);
    expect(query.sql).toContain('is_test');
    expect(query.params).toContain(false);
  });
});

describe('회귀: 비공개 설문 + 유효 테스트 세션 create→complete 왕복 (Task 6)', () => {
  const VALID_SIGNALS = {
    deviceId: 'dev-roundtrip-1',
    screen: '1920x1080',
    tz: 'Asia/Seoul',
    lang: 'ko-KR',
    platform: 'MacIntel',
  };

  beforeEach(() => {
    surveyFindFirstMock.mockReset();
    versionFindFirstMock.mockReset();
    responseFindFirstMock.mockReset();
    contactFindFirstMock.mockReset();
    insertReturningMock.mockReset();
    selectLimitMock.mockReset();
    countResultMock.mockReset();
    headersMock.mockReset();
    insertChain.values.mockClear();

    headersMock.mockResolvedValue(
      new Headers({ 'x-forwarded-for': '10.0.0.9', 'user-agent': 'Chrome/120' }),
    );
    insertReturningMock.mockResolvedValue([{ id: 'r1', contactTargetId: null }]);
    selectLimitMock.mockResolvedValue([{ id: 'q1' }]);
    countResultMock.mockResolvedValue([{ total: 0 }]);
  });

  it('비공개 설문에서 유효 테스트 세션은 create 후 complete 까지 성공한다', async () => {
    // isPublic=false 설문 — 테스트 세션(isTest)이 아니면 invite_required 로 거부되는 설정.
    surveyFindFirstMock.mockResolvedValue(
      publishedSurvey({ isPublic: false, testModeEnabled: true, testToken: 'tok' }),
    );
    // updateQuestionResponse(내부 호출)의 응답 행 조회와 completeResponse 의 gateRow 조회가
    // 모두 이 값을 사용 — isTest=true 라 두 게이트 모두 예외를 타야 한다.
    responseFindFirstMock.mockResolvedValue({
      id: 'r1',
      surveyId: SURVEY_ID,
      versionId: null,
      contactTargetId: null,
      isTest: true,
    });

    const { createResponseWithFirstAnswer, completeResponse } =
      await import('@/features/survey-response/server/services/response.service');

    const createResult = await createResponseWithFirstAnswer({
      surveyId: SURVEY_ID,
      sessionId: 'roundtrip-session',
      versionId: null,
      questionId: 'q1',
      value: 'answer',
      currentStepId: 'step1',
      clientSignals: VALID_SIGNALS,
      testToken: 'tok',
    });
    expect(createResult).toMatchObject({ kind: 'created', id: 'r1' });

    // Task 6 이전에는 completeResponse 가 isTest 를 false 로 고정해 여기서
    // invite_required 로 거부됐다(비공개 설문 + contactTargetId 없음).
    const completeResult = await completeResponse({ responseId: 'r1' });
    expect(completeResult).toMatchObject({ id: 'r1' });
  });
});
