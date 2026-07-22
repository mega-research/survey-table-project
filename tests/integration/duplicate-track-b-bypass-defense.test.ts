import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClientSignals } from '@/lib/duplicate-detection/types';

beforeAll(() => {
  process.env['DUPLICATE_DETECTION_SALT'] = 'integration-test-salt';
});

const { mockFindFirst, mockSurveysFindFirst, mockHeaders, mockInsert, mockQuestionLimit } =
  vi.hoisted(() => ({
    mockFindFirst: vi.fn(),
    mockSurveysFindFirst: vi.fn(),
    mockHeaders: vi.fn(),
    mockInsert: vi.fn(),
    mockQuestionLimit: vi.fn(),
  }));

// createResponseWithFirstAnswer 는 중복 감지(Track A/B) 이전에 가용성 게이트(#3, Task 5)
// 용 survey 행을 먼저 로드해 isTest(테스트 세션) 여부를 판정한다 — query.surveys 모킹 필요.
const insertChain = {
  values: vi.fn(() => insertChain),
  onConflictDoNothing: vi.fn(() => insertChain),
  returning: vi.fn(async () => [{ id: 'new-response-id', contactTargetId: null }]),
};

vi.mock('@/db', () => ({
  db: (() => {
    const surveyLockChain = {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          for: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: 'aaaaaaaa-0003-0003-0003-000000000003' }]),
          }),
        }),
      }),
    };
    const targetCountChain = {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ total: 0 }]),
      }),
    };
    const txSelect = vi
      .fn()
      .mockReturnValueOnce(surveyLockChain)
      .mockReturnValueOnce(targetCountChain);
    const tx = {
      select: txSelect,
      insert: mockInsert,
    };

    return {
      query: {
        surveyResponses: { findFirst: mockFindFirst },
        surveys: { findFirst: mockSurveysFindFirst },
        surveyVersions: { findFirst: vi.fn(async () => null) },
      },
      insert: mockInsert,
      execute: vi.fn().mockResolvedValue([{ id: null }]),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            // updateQuestionResponse 의 questionId 존재 검사(select().where().limit()) 종단.
            limit: vi.fn(() => mockQuestionLimit()),
          }),
        }),
      }),
      // 테스트 세션 성공 경로에서 createResponseWithFirstAnswer 가 INSERT 후
      // updateQuestionResponse 를 호출하므로 update 체인도 모킹(progress_pct sync).
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi
              .fn()
              .mockResolvedValue([
                {
                  id: 'new-response-id',
                  surveyId: 'ignored',
                  contactTargetId: null,
                  pageVisits: null,
                },
              ]),
          }),
        }),
      }),
      transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
  })(),
}));

vi.mock('next/headers', () => ({
  headers: mockHeaders,
}));

vi.mock('@/lib/operations/parse-ua', () => ({
  parseBrowser: vi.fn().mockReturnValue('chrome'),
  parsePlatform: vi.fn().mockReturnValue('desktop'),
}));

vi.mock('@/lib/survey/substitute-tokens', () => ({
  substituteTokens: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

const SURVEY_ID = 'aaaaaaaa-0003-0003-0003-000000000003';
const SIGNALS: ClientSignals = {
  deviceId: 'DEV-BYPASS',
  screen: '1920x1080',
  tz: 'Asia/Seoul',
  lang: 'ko-KR',
  platform: 'MacIntel',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockHeaders.mockResolvedValue(
    new Headers({ 'x-forwarded-for': '10.0.0.5', 'user-agent': 'Chrome/120' }),
  );
  // 가용성 게이트(#3): published 공개 설문 + 테스트 모드 off 로 기본 통과시킨다.
  mockSurveysFindFirst.mockResolvedValue({
    status: 'published',
    endDate: null,
    maxResponses: null,
    isPublic: true,
    requireInviteToken: false,
    isPaused: false,
    testModeEnabled: false,
    testToken: null,
  });
  mockQuestionLimit.mockResolvedValue([{ id: 'q1' }]);
});

describe('Track B bypass defense', () => {
  it('checkDuplicateOnEntry 우회 → 첫 답변 service에서 차단', async () => {
    // 매칭되는 완료 응답이 이미 존재하는 상황 시뮬레이션
    mockFindFirst.mockResolvedValue({ id: 'prev-response' });

    const { createResponseWithFirstAnswer } =
      await import('@/features/survey-response/server/services/response.service');
    const result = await createResponseWithFirstAnswer({
      surveyId: SURVEY_ID,
      sessionId: 'fresh-session-bypass',
      versionId: null,
      questionId: 'q1',
      value: 'attempt',
      currentStepId: 'group:x',
      clientSignals: SIGNALS,
    });

    expect(result).toEqual({ kind: 'blocked', reason: 'device_already_responded' });
    // INSERT는 호출되지 않아야 함
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

describe('테스트 세션(isTest) — Track B skip', () => {
  it('유효한 testToken 이면 Track B 가 차단할 상황이어도 skip 하고 isTest=true 로 생성한다', async () => {
    // Track B 관점에서는 차단 대상(매칭되는 완료 응답 존재)이지만, 테스트 세션은
    // 중복 감지 자체를 skip 해야 한다(스펙 4절) — 즉 이 값이 그대로 쓰이면 안 된다.
    mockFindFirst.mockResolvedValue({ id: 'prev-response' });
    mockSurveysFindFirst.mockResolvedValue({
      status: 'published',
      endDate: null,
      maxResponses: null,
      isPublic: true,
      requireInviteToken: false,
      isPaused: false,
      testModeEnabled: true,
      testToken: 'tok-valid',
    });
    mockInsert.mockReturnValue(insertChain);

    const { createResponseWithFirstAnswer } =
      await import('@/features/survey-response/server/services/response.service');
    const result = await createResponseWithFirstAnswer({
      surveyId: SURVEY_ID,
      sessionId: 'test-session-skip',
      versionId: null,
      questionId: 'q1',
      value: 'answer',
      currentStepId: 'group:x',
      clientSignals: SIGNALS,
      testToken: 'tok-valid',
    });

    expect(result.kind).toBe('created');
    const valuesCalls = insertChain.values.mock.calls as unknown as Array<[{ isTest: boolean }]>;
    const inserted = valuesCalls[0]![0];
    expect(inserted.isTest).toBe(true);
  });
});
