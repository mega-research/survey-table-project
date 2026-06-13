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
} = vi.hoisted(() => ({
  surveyFindFirstMock: vi.fn(),
  versionFindFirstMock: vi.fn(),
  responseFindFirstMock: vi.fn(),
  contactFindFirstMock: vi.fn(),
  insertReturningMock: vi.fn(),
  selectLimitMock: vi.fn(),
  countResultMock: vi.fn(),
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
  chain['where'] = vi.fn(() => {
    const whereResult: Record<string, unknown> = {
      limit: vi.fn(() => selectLimitMock()),
      then: (resolve: (v: unknown) => unknown) => resolve(countResultMock()),
    };
    return whereResult;
  });
  chain['limit'] = vi.fn(() => selectLimitMock());
  return chain;
}

function makeUpdateChain(): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  chain['set'] = vi.fn(() => chain);
  chain['where'] = vi.fn(() => chain);
  chain['returning'] = vi.fn(async () => [{ id: 'r1', surveyId: 's1', contactTargetId: null, pageVisits: null }]);
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
        insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
        select: vi.fn(() => makeSelectChain()),
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

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const SURVEY_ID = '00000000-0000-4000-8000-000000000001';

function publishedSurvey(over: Record<string, unknown> = {}) {
  return {
    id: SURVEY_ID,
    status: 'published',
    endDate: null,
    maxResponses: null,
    isPublic: true,
    requireInviteToken: false,
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
    const { startResponse } = await import('@/features/survey-response/server/services/response.service');
    const res = await startResponse({ surveyId: SURVEY_ID });
    expect(res).toMatchObject({ id: 'r1' });
  });

  it('status=draft 면 거부한다', async () => {
    surveyFindFirstMock.mockResolvedValue(publishedSurvey({ status: 'draft' }));
    const { startResponse } = await import('@/features/survey-response/server/services/response.service');
    await expect(startResponse({ surveyId: SURVEY_ID })).rejects.toThrow();
  });

  it('status=closed 면 거부한다', async () => {
    surveyFindFirstMock.mockResolvedValue(publishedSurvey({ status: 'closed' }));
    const { startResponse } = await import('@/features/survey-response/server/services/response.service');
    await expect(startResponse({ surveyId: SURVEY_ID })).rejects.toThrow();
  });

  it('endDate 가 과거(경과)면 거부한다', async () => {
    surveyFindFirstMock.mockResolvedValue(
      publishedSurvey({ endDate: new Date(Date.now() - 60_000) }),
    );
    const { startResponse } = await import('@/features/survey-response/server/services/response.service');
    await expect(startResponse({ surveyId: SURVEY_ID })).rejects.toThrow();
  });

  it('endDate 가 미래면 통과한다', async () => {
    surveyFindFirstMock.mockResolvedValue(
      publishedSurvey({ endDate: new Date(Date.now() + 60_000) }),
    );
    const { startResponse } = await import('@/features/survey-response/server/services/response.service');
    const res = await startResponse({ surveyId: SURVEY_ID });
    expect(res).toMatchObject({ id: 'r1' });
  });

  it('비공개(isPublic=false) + invite(contactTargetId) 없음이면 거부한다', async () => {
    surveyFindFirstMock.mockResolvedValue(publishedSurvey({ isPublic: false }));
    const { startResponse } = await import('@/features/survey-response/server/services/response.service');
    // startResponse 는 inviteToken 을 받지 않으므로 비공개면 항상 거부.
    await expect(startResponse({ surveyId: SURVEY_ID })).rejects.toThrow();
  });

  it('설문 자체가 존재하지 않으면 거부한다', async () => {
    surveyFindFirstMock.mockResolvedValue(undefined);
    const { startResponse } = await import('@/features/survey-response/server/services/response.service');
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
    const { completeResponse } = await import('@/features/survey-response/server/services/response.service');
    await expect(completeResponse({ responseId: 'r1' })).rejects.toThrow();
  });

  it('완료 카운트가 maxResponses 미만이면 완료를 통과시킨다', async () => {
    countResultMock.mockResolvedValue([{ total: 1 }]);
    const { completeResponse } = await import('@/features/survey-response/server/services/response.service');
    const res = await completeResponse({ responseId: 'r1' });
    expect(res).toMatchObject({ id: 'r1' });
  });
});
