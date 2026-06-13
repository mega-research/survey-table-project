import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import type { ClientSignals } from '@/lib/duplicate-detection/types';

beforeAll(() => {
  process.env['DUPLICATE_DETECTION_SALT'] = 'integration-test-salt';
});

const { mockFindFirst, mockHeaders, mockInsert } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockHeaders: vi.fn(),
  mockInsert: vi.fn(),
}));

const mockQuestionLimit = vi.hoisted(() => vi.fn());

vi.mock('@/db', () => ({
  db: {
    query: {
      surveyResponses: { findFirst: mockFindFirst },
      // 가용성 게이트(#3): published 공개 설문으로 통과시킨다.
      surveys: {
        findFirst: vi.fn(async () => ({
          status: 'published',
          endDate: null,
          maxResponses: null,
          isPublic: true,
          requireInviteToken: false,
        })),
      },
      surveyVersions: { findFirst: vi.fn(async () => null) },
    },
    insert: mockInsert,
    execute: vi.fn().mockResolvedValue([{ id: null }]),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          // updateQuestionResponse 의 questionId 존재 검사 등 select().limit() 종단.
          limit: vi.fn(() => mockQuestionLimit()),
        }),
      }),
    }),
    // createResponseWithFirstAnswer 가 INSERT 후 updateQuestionResponse 를 호출하므로
    // db.update 체인도 모킹 (progress_pct sync 흐름).
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'new-response-id' }]),
        }),
      }),
    }),
  },
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

const SURVEY_ID = 'aaaaaaaa-0004-0004-0004-000000000004';
const SIGNALS: ClientSignals = {
  deviceId: 'DEV-BLANK-BYPASS',
  screen: '1920x1080',
  tz: 'Asia/Seoul',
  lang: 'ko-KR',
  platform: 'MacIntel',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockHeaders.mockResolvedValue(
    new Headers({ 'x-forwarded-for': '10.0.0.6', 'user-agent': 'Chrome/120' }),
  );
  // 기본: questionId 존재 검사가 hit (select().limit()).
  mockQuestionLimit.mockResolvedValue([{ id: 'q1' }]);
});

describe('createBlankResponse bypass defense', () => {
  it('checkDuplicateOnEntry 우회 → createBlankResponse 에서 차단', async () => {
    mockFindFirst.mockResolvedValue({ id: 'prev-blank-response' });

    const { createBlankResponse } = await import('@/features/survey-response/server/services/response.service');
    const result = await createBlankResponse({
      surveyId: SURVEY_ID,
      sessionId: 'fresh-session-blank-bypass',
      versionId: null,
      currentStepId: 'group:y',
      clientSignals: SIGNALS,
    });

    expect(result).toEqual({ kind: 'blocked', reason: 'device_already_responded' });
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

describe('clientSignals null 시 신호 기반 검사 skip', () => {
  it('createResponseWithFirstAnswer: clientSignals null → checkTrackB 호출 없이 INSERT 진행', async () => {
    // 변조 가드(#5): INSERT 후 updateQuestionResponse 가 응답 행을 조회하므로 유효 행을 돌려준다.
    // (clientSignals null 이라 checkTrackB 는 skip — block 없이 created 반환되는 것으로 검증한다.)
    mockFindFirst.mockResolvedValue({ id: 'new-response-id', surveyId: SURVEY_ID, versionId: null });
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            { id: 'new-response-id', contactTargetId: null },
          ]),
        }),
      }),
    });

    const { createResponseWithFirstAnswer } = await import('@/features/survey-response/server/services/response.service');
    const result = await createResponseWithFirstAnswer({
      surveyId: SURVEY_ID,
      sessionId: 'session-null-signals',
      versionId: null,
      questionId: 'q1',
      value: 'answer',
      currentStepId: 'group:z',
      clientSignals: null,
    });

    // clientSignals null → checkTrackB skip 이 입증된다 (device_already_responded 차단 없이 created).
    // (findFirst 자체는 변조 가드의 응답 행 조회로 호출되므로 더 이상 skip 지표가 아니다.)
    expect(result).toEqual({ kind: 'created', id: 'new-response-id', contactTargetId: null });
    expect(mockInsert).toHaveBeenCalled();
  });

  it('createBlankResponse: clientSignals null → checkTrackB 호출 없이 INSERT 진행', async () => {
    mockFindFirst.mockResolvedValue(undefined);
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            { id: 'new-blank-id', contactTargetId: null },
          ]),
        }),
      }),
    });

    const { createBlankResponse } = await import('@/features/survey-response/server/services/response.service');
    const result = await createBlankResponse({
      surveyId: SURVEY_ID,
      sessionId: 'session-blank-null-signals',
      versionId: null,
      currentStepId: 'group:z',
      clientSignals: null,
    });

    expect(result).toEqual({ kind: 'created', id: 'new-blank-id', contactTargetId: null });
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalled();
  });

  it('checkDuplicateOnEntry: clientSignals null → blocked false 즉시 반환', async () => {
    mockFindFirst.mockResolvedValue(undefined);

    const { checkDuplicateOnEntry } = await import('@/features/survey-response/server/services/duplicate.service');
    const result = await checkDuplicateOnEntry({
      surveyId: SURVEY_ID,
      clientSignals: null,
    });

    expect(result).toEqual({ blocked: false });
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockHeaders).not.toHaveBeenCalled();
  });
});
