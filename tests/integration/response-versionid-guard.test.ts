import { beforeEach, describe, expect, it, vi } from 'vitest';

// ========================
// 모듈 모킹
// ========================
// #24 response-versionid 가드를 검증한다.
// 클라이언트가 제공한 versionId 가 해당 surveyId 의 survey_versions 에 속하고
// 유효(published 또는 현재 활성 currentVersionId)한지 검증한다.
// - 타 설문의 versionId / 미존재 versionId / 비published(또한 현재 활성 아님) → 거부
// - 정상(published 또는 현재 활성) versionId → 통과
// - versionId 미전달(null/undefined) → 기존 동작 보존(검증 skip)
//
// startResponse 는 versionId 를 받으므로(StartResponseInput.versionId optional)
// 진입부에서 surveyId 소속/유효성을 검사한다. 검사는
// loadSurveyGateRow(db.query.surveys.findFirst) + 버전 검증 쿼리(db.query.surveyVersions.findFirst)
// 를 사용한다.

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

vi.mock('@/db', () => {
  const db: Record<string, unknown> = {
    insert: vi.fn(() => insertChain),
    select: vi.fn(() => makeSelectChain()),
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
const OTHER_SURVEY_ID = '00000000-0000-4000-8000-0000000000ff';
const VERSION_ID = '00000000-0000-4000-8000-0000000000a1';

function publishedSurvey(over: Record<string, unknown> = {}) {
  return {
    id: SURVEY_ID,
    status: 'published',
    endDate: null,
    maxResponses: null,
    isPublic: true,
    requireInviteToken: false,
    currentVersionId: null,
    ...over,
  };
}

function versionRow(over: Record<string, unknown> = {}) {
  return {
    id: VERSION_ID,
    surveyId: SURVEY_ID,
    status: 'published',
    ...over,
  };
}

describe('#24 response-versionid 가드 — startResponse', () => {
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

  it('versionId 미전달이면 기존 동작 보존(검증 skip, 통과)', async () => {
    surveyFindFirstMock.mockResolvedValue(publishedSurvey());
    const { startResponse } = await import(
      '@/features/survey-response/server/services/response.service'
    );
    const res = await startResponse({ surveyId: SURVEY_ID });
    expect(res).toMatchObject({ id: 'r1' });
    // versionId 가 없으면 버전 조회를 하지 않아야 한다.
    expect(versionFindFirstMock).not.toHaveBeenCalled();
  });

  it('정상 published versionId(동일 surveyId)면 통과', async () => {
    surveyFindFirstMock.mockResolvedValue(publishedSurvey());
    versionFindFirstMock.mockResolvedValue(versionRow());
    const { startResponse } = await import(
      '@/features/survey-response/server/services/response.service'
    );
    const res = await startResponse({ surveyId: SURVEY_ID, versionId: VERSION_ID });
    expect(res).toMatchObject({ id: 'r1' });
  });

  it('현재 활성(currentVersionId) 이면 published 아니어도 통과', async () => {
    surveyFindFirstMock.mockResolvedValue(publishedSurvey({ currentVersionId: VERSION_ID }));
    versionFindFirstMock.mockResolvedValue(versionRow({ status: 'superseded' }));
    const { startResponse } = await import(
      '@/features/survey-response/server/services/response.service'
    );
    const res = await startResponse({ surveyId: SURVEY_ID, versionId: VERSION_ID });
    expect(res).toMatchObject({ id: 'r1' });
  });

  it('미존재 versionId 면 거부한다', async () => {
    surveyFindFirstMock.mockResolvedValue(publishedSurvey());
    versionFindFirstMock.mockResolvedValue(undefined);
    const { startResponse } = await import(
      '@/features/survey-response/server/services/response.service'
    );
    await expect(
      startResponse({ surveyId: SURVEY_ID, versionId: VERSION_ID }),
    ).rejects.toThrow();
  });

  it('타 설문의 versionId 면 거부한다(surveyId 불일치)', async () => {
    surveyFindFirstMock.mockResolvedValue(publishedSurvey());
    versionFindFirstMock.mockResolvedValue(versionRow({ surveyId: OTHER_SURVEY_ID }));
    const { startResponse } = await import(
      '@/features/survey-response/server/services/response.service'
    );
    await expect(
      startResponse({ surveyId: SURVEY_ID, versionId: VERSION_ID }),
    ).rejects.toThrow();
  });

  it('비published 이고 현재 활성도 아니면 거부한다', async () => {
    surveyFindFirstMock.mockResolvedValue(publishedSurvey({ currentVersionId: null }));
    versionFindFirstMock.mockResolvedValue(versionRow({ status: 'closed' }));
    const { startResponse } = await import(
      '@/features/survey-response/server/services/response.service'
    );
    await expect(
      startResponse({ surveyId: SURVEY_ID, versionId: VERSION_ID }),
    ).rejects.toThrow();
  });
});
