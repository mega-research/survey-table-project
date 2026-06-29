import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Survey as SurveyType } from '@/types/survey';

// data/surveys.ts 의 단일 구현(매핑 SoT)에 위임하는지 검증한다.
// publish/analytics 와 빌더 read 가 동일 매핑을 공유하도록 강제하여
// "신규 질문 컬럼이 한쪽 사본에만 추가돼 publish 스냅샷/분석에서 누락"되는 divergence 를 차단한다.
vi.mock('@/data/surveys', () => ({
  getSurveyWithDetails: vi.fn(),
}));

vi.mock('@/data/responses', () => ({
  getResponseCountsGroupedBySurvey: vi.fn(),
}));

const surveysFindFirst = vi.fn();
const surveysFindMany = vi.fn();
const surveyVersionsFindFirst = vi.fn();

vi.mock('@/db', () => ({
  db: {
    query: {
      surveys: {
        findFirst: (...args: unknown[]) => surveysFindFirst(...args),
        findMany: (...args: unknown[]) => surveysFindMany(...args),
      },
      surveyVersions: {
        findFirst: (...args: unknown[]) => surveyVersionsFindFirst(...args),
      },
    },
  },
}));

import { getResponseCountsGroupedBySurvey } from '@/data/responses';
import { getSurveyWithDetails as getSurveyWithDetailsData } from '@/data/surveys';

import {
  getSurveyForResponse,
  getSurveyListWithCounts,
  getSurveyWithDetails,
} from './survey-read.service';

const SURVEY_ID = 'survey-1';

describe('survey-read.service getSurveyWithDetails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('data/surveys 의 단일 구현에 위임한다', async () => {
    const fake = { id: SURVEY_ID, title: 'T' } as unknown as SurveyType;
    vi.mocked(getSurveyWithDetailsData).mockResolvedValue(fake);

    const result = await getSurveyWithDetails(SURVEY_ID);

    expect(getSurveyWithDetailsData).toHaveBeenCalledWith(SURVEY_ID);
    expect(result).toBe(fake);
  });

  it('null 반환을 그대로 전달한다', async () => {
    vi.mocked(getSurveyWithDetailsData).mockResolvedValue(null);

    const result = await getSurveyWithDetails(SURVEY_ID);

    expect(result).toBeNull();
  });
});

describe('survey-read.service getSurveyListWithCounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('목록에 필요한 survey 컬럼만 조회하고 전체/완료 응답 수를 병합한다', async () => {
    const createdAt = new Date('2026-06-01T00:00:00.000Z');
    const updatedAt = new Date('2026-06-02T00:00:00.000Z');
    surveysFindMany.mockResolvedValue([
      {
        id: 'survey-1',
        title: '첫 설문',
        description: null,
        slug: 'first',
        privateToken: '11111111-1111-1111-1111-111111111111',
        createdAt,
        updatedAt,
        isPublic: true,
      },
      {
        id: 'survey-2',
        title: '둘째 설문',
        description: '설명',
        slug: null,
        privateToken: null,
        createdAt,
        updatedAt,
        isPublic: false,
      },
    ]);
    vi.mocked(getResponseCountsGroupedBySurvey).mockResolvedValue(
      new Map([['survey-1', { total: 5, completed: 3 }]]),
    );

    const result = await getSurveyListWithCounts();

    expect(surveysFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        columns: {
          id: true,
          title: true,
          description: true,
          slug: true,
          privateToken: true,
          createdAt: true,
          updatedAt: true,
          isPublic: true,
        },
      }),
    );
    expect(getResponseCountsGroupedBySurvey).toHaveBeenCalledWith(['survey-1', 'survey-2']);
    expect(result).toEqual([
      {
        id: 'survey-1',
        title: '첫 설문',
        description: null,
        slug: 'first',
        privateToken: '11111111-1111-1111-1111-111111111111',
        responseCount: 5,
        completedResponseCount: 3,
        createdAt,
        updatedAt,
        isPublic: true,
      },
      {
        id: 'survey-2',
        title: '둘째 설문',
        description: '설명',
        slug: null,
        privateToken: null,
        responseCount: 0,
        completedResponseCount: 0,
        createdAt,
        updatedAt,
        isPublic: false,
      },
    ]);
    expect(result[0]).not.toHaveProperty('questionCount');
  });
});

// getSurveyForResponse 의 snapshot 기반 원칙 회귀.
// published 응답 경로는 freeze 된 snapshot.settings.requireInviteToken 을 따라야 하며
// 빌더 draft 토글이 들어있는 현재 surveys 행으로 덮어쓰면 안 된다.
describe('survey-read.service getSurveyForResponse requireInviteToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function snapshotSettings(requireInviteToken: boolean | undefined) {
    const base = {
      isPublic: true,
      allowMultipleResponses: false,
      showProgressBar: true,
      shuffleQuestions: false,
      requireLogin: false,
      thankYouMessage: '감사합니다',
    };
    return requireInviteToken === undefined
      ? base
      : { ...base, requireInviteToken };
  }

  it('published 경로는 snapshot 값을 따르고 현재 surveys 행으로 덮어쓰지 않는다', async () => {
    const surveyId = 'survey-published-1';
    // 현재 surveys 행: draft 에서 토글이 true 로 바뀐 상태
    surveysFindFirst.mockResolvedValue({
      id: surveyId,
      currentVersionId: 'ver-1',
      requireInviteToken: true,
      slug: null,
      privateToken: null,
      contactColumns: null,
      contactEmail: null,
      lookups: [],
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    // snapshot: publish 시점 freeze 값은 false
    surveyVersionsFindFirst.mockResolvedValue({
      id: 'ver-1',
      snapshot: {
        title: '설문',
        questions: [],
        groups: [],
        settings: snapshotSettings(false),
      },
    });

    const result = await getSurveyForResponse({ surveyId });

    expect(result).not.toBeNull();
    // snapshot 의 false 가 우선 — 현재 행의 true 가 새지 않아야 한다
    expect(result?.survey.settings.requireInviteToken).toBe(false);
    expect(result?.versionId).toBe('ver-1');
  });

  it('snapshot 에 requireInviteToken 이 없는 이전 publish 본은 현재 surveys 행으로 fallback 한다', async () => {
    const surveyId = 'survey-legacy-1';
    surveysFindFirst.mockResolvedValue({
      id: surveyId,
      currentVersionId: 'ver-legacy',
      requireInviteToken: true,
      slug: null,
      privateToken: null,
      contactColumns: null,
      contactEmail: null,
      lookups: [],
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    surveyVersionsFindFirst.mockResolvedValue({
      id: 'ver-legacy',
      snapshot: {
        title: '설문',
        questions: [],
        groups: [],
        settings: snapshotSettings(undefined),
      },
    });

    const result = await getSurveyForResponse({ surveyId });

    expect(result?.survey.settings.requireInviteToken).toBe(true);
  });

  it('responseHeader 는 published snapshot 값을 따르고 현재 surveys 행으로 덮어쓰지 않는다', async () => {
    const surveyId = 'survey-header-published';
    surveysFindFirst.mockResolvedValue({
      id: surveyId,
      currentVersionId: 'ver-header',
      requireInviteToken: false,
      responseHeader: {
        style: 'logo-title',
        titleSize: 'lg',
        logo: { imageUrl: 'https://example.com/draft.png', size: 'lg' },
        logoTitle: { logoPosition: 'right' },
      },
      slug: null,
      privateToken: null,
      contactColumns: null,
      contactEmail: null,
      lookups: [],
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    surveyVersionsFindFirst.mockResolvedValue({
      id: 'ver-header',
      snapshot: {
        title: '설문',
        questions: [],
        groups: [],
        settings: {
          ...snapshotSettings(false),
          responseHeader: {
            style: 'plain',
            titleSize: 'auto',
          },
        },
      },
    });

    const result = await getSurveyForResponse({ surveyId });

    expect(result?.survey.settings.responseHeader).toEqual({
      style: 'plain',
      titleSize: 'auto',
      titleAlign: 'left',
    });
  });

  it('responseHeader 가 없는 기존 snapshot 은 현재 surveys 행이 아니라 새 기본형으로 fallback 한다', async () => {
    const surveyId = 'survey-header-legacy';
    surveysFindFirst.mockResolvedValue({
      id: surveyId,
      currentVersionId: 'ver-header-legacy',
      requireInviteToken: false,
      responseHeader: {
        style: 'logo-title',
        titleSize: 'lg',
        logo: { imageUrl: 'https://example.com/draft.png', size: 'lg' },
        logoTitle: { logoPosition: 'right' },
      },
      slug: null,
      privateToken: null,
      contactColumns: null,
      contactEmail: null,
      lookups: [],
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    surveyVersionsFindFirst.mockResolvedValue({
      id: 'ver-header-legacy',
      snapshot: {
        title: '설문',
        questions: [],
        groups: [],
        settings: snapshotSettings(false),
      },
    });

    const result = await getSurveyForResponse({ surveyId });

    expect(result?.survey.settings.responseHeader).toEqual({
      style: 'plain',
      titleSize: 'auto',
      titleAlign: 'left',
    });
  });

  it('requirePublished 옵션이면 배포 버전 없는 설문을 현재 draft 로 fallback 하지 않는다', async () => {
    const surveyId = 'survey-draft-only';
    surveysFindFirst.mockResolvedValue({
      id: surveyId,
      currentVersionId: null,
      requireInviteToken: false,
      slug: null,
      privateToken: null,
      contactColumns: null,
      contactEmail: null,
      lookups: [],
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    vi.mocked(getSurveyWithDetailsData).mockResolvedValue({
      id: surveyId,
      title: 'draft',
      groups: [],
      questions: [],
      settings: snapshotSettings(false),
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    } as unknown as SurveyType);

    const result = await getSurveyForResponse({ surveyId }, { requirePublished: true });

    expect(result).toBeNull();
    expect(getSurveyWithDetailsData).not.toHaveBeenCalled();
  });
});
