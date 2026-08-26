import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * saveWithDetails 모드 분기 (역할 모델 v2 티켓 09).
 *
 * 신규 생성(create 페이지)과 기존 갱신이 한 입구로 들어오므로 존재 판정과 쓰기가 같은
 * 트랜잭션에 있어야 한다 — procedure 층에서 미리 가르면 판정·쓰기 사이의 레이스가
 * tombstone 부활·소유 없는 생성이 된다.
 */

const insertedValues: Record<string, unknown>[] = [];
const updateCalls: unknown[] = [];

const findFirstSurvey = vi.fn<() => Promise<Record<string, unknown> | undefined>>();

function fakeTx() {
  return {
    query: {
      surveys: { findFirst: findFirstSurvey },
      questionGroups: { findMany: vi.fn(async () => []) },
      questions: { findMany: vi.fn(async () => []) },
    },
    update: vi.fn(() => ({
      set: (v: unknown) => {
        updateCalls.push(v);
        return { where: () => Promise.resolve() };
      },
    })),
    insert: vi.fn(() => ({
      values: (v: Record<string, unknown>) => {
        insertedValues.push(v);
        return {
          onConflictDoUpdate: () => Promise.resolve(),
          then: (resolve: (value: unknown) => unknown) => resolve(undefined),
        };
      },
    })),
    delete: vi.fn(() => ({ where: () => Promise.resolve() })),
  };
}

vi.mock('@/db', () => ({
  db: {
    transaction: (cb: (tx: unknown) => Promise<unknown>) => cb(fakeTx()),
    query: { surveys: { findFirst: vi.fn(async () => undefined) } },
  },
}));

// 에러 클래스는 실물, 관문만 모킹 — 관문 자체의 판정은 survey-access 테스트 소관.
vi.mock('@/server/survey-access', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  assertSurveyCapability: vi.fn(),
}));

vi.mock('./surveys', () => ({ resolveNewSurveyOwnership: vi.fn() }));

vi.mock('@/server/storage-lifecycle/key-extract', () => ({
  extractR2KeysFromJsonbValue: vi.fn(() => []),
}));
vi.mock('@/server/storage-lifecycle/save-diff-collector', () => ({
  collectSaveDiffAndRevival: vi.fn(),
  collectFieldLimitedSaveDiff: vi.fn(),
}));
vi.mock('@/lib/survey/survey-image-promote', () => ({
  promoteSurveyImages: vi.fn(async (v: unknown) => v),
  promoteSurveyResponseHeader: vi.fn(async (v: unknown) => v ?? null),
}));
vi.mock('@/lib/survey/notice-attachment-promote', () => ({
  promoteNoticeAttachments: vi.fn(async (v: unknown) => v),
}));

import { assertSurveyCapability, SurveyAccessError } from '@/server/survey-access';

import { saveSurveyWithDetails } from './survey-save';
import { resolveNewSurveyOwnership } from './surveys';

const actor = { id: 'u-1', isSuperadmin: false, userType: 'internal' as const };
const SURVEY_ID = '11111111-2222-4333-8444-555555555555';

const SETTINGS = {
  isPublic: true,
  allowMultipleResponses: false,
  showProgressBar: true,
  shuffleQuestions: false,
  requireLogin: false,
  thankYouMessage: '감사합니다',
};

function surveyPayload() {
  return {
    id: SURVEY_ID,
    title: '설문',
    questions: [],
    groups: [],
    settings: SETTINGS,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  insertedValues.length = 0;
  updateCalls.length = 0;
});

describe('saveSurveyWithDetails — 생성 모드', () => {
  it('없는 설문이면 소유·배치를 스탬프해 만든다 — 다른 생성 경로와 같은 판정', async () => {
    findFirstSurvey.mockResolvedValue(undefined);
    vi.mocked(resolveNewSurveyOwnership).mockResolvedValue({
      teamId: 'team-1',
      ownerUserId: 'u-1',
      createdBy: 'u-1',
      assignmentStatus: 'assigned',
    });

    await saveSurveyWithDetails(actor, surveyPayload());

    expect(resolveNewSurveyOwnership).toHaveBeenCalledWith(actor, undefined);
    expect(insertedValues[0]).toMatchObject({
      id: SURVEY_ID,
      teamId: 'team-1',
      ownerUserId: 'u-1',
      createdBy: 'u-1',
      assignmentStatus: 'assigned',
    });
    // 새 행에는 capability 를 물을 대상이 없다 — 생성 판정만 지난다.
    expect(assertSurveyCapability).not.toHaveBeenCalled();
  });
});

describe('saveSurveyWithDetails — 갱신 모드', () => {
  it('기존 설문이면 survey.edit 을 요구하고 소유 스탬프를 다시 찍지 않는다', async () => {
    findFirstSurvey.mockResolvedValue({ id: SURVEY_ID, deletedAt: null });
    vi.mocked(assertSurveyCapability).mockResolvedValue(undefined);

    const result = await saveSurveyWithDetails(actor, surveyPayload());

    expect(result).toEqual({ surveyId: SURVEY_ID });
    expect(assertSurveyCapability).toHaveBeenCalledWith(actor, SURVEY_ID, 'survey.edit');
    expect(resolveNewSurveyOwnership).not.toHaveBeenCalled();
    expect(updateCalls.length).toBe(1);
    expect(insertedValues).toEqual([]);
  });

  it('편집 권한이 없으면 forbidden — 아무것도 쓰지 않는다', async () => {
    findFirstSurvey.mockResolvedValue({ id: SURVEY_ID, deletedAt: null });
    vi.mocked(assertSurveyCapability).mockRejectedValue(new SurveyAccessError('forbidden'));

    await expect(saveSurveyWithDetails(actor, surveyPayload())).rejects.toMatchObject({
      name: 'SurveyAccessError',
      reason: 'forbidden',
    });
    expect(updateCalls).toEqual([]);
    expect(insertedValues).toEqual([]);
  });

  it('볼 수조차 없는 설문(타 팀)은 not_found — 존재를 알리지 않는다', async () => {
    findFirstSurvey.mockResolvedValue({ id: SURVEY_ID, deletedAt: null });
    vi.mocked(assertSurveyCapability).mockRejectedValue(new SurveyAccessError('not_found'));

    await expect(saveSurveyWithDetails(actor, surveyPayload())).rejects.toMatchObject({
      reason: 'not_found',
    });
    expect(updateCalls).toEqual([]);
    expect(insertedValues).toEqual([]);
  });
});

describe('saveSurveyWithDetails — tombstone', () => {
  it('삭제된 설문 id 로는 저장할 수 없다 — 갱신도 생성도 아닌 not_found', async () => {
    findFirstSurvey.mockResolvedValue({ id: SURVEY_ID, deletedAt: new Date('2026-08-01') });

    await expect(saveSurveyWithDetails(actor, surveyPayload())).rejects.toMatchObject({
      name: 'SurveyAccessError',
      reason: 'not_found',
    });
    // 부활 금지 — capability 관문 전에 끝나고, 어떤 쓰기도 일어나지 않는다.
    expect(assertSurveyCapability).not.toHaveBeenCalled();
    expect(resolveNewSurveyOwnership).not.toHaveBeenCalled();
    expect(updateCalls).toEqual([]);
    expect(insertedValues).toEqual([]);
  });
});
