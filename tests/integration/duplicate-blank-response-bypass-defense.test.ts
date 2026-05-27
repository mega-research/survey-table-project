import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import type { ClientSignals } from '@/lib/duplicate-detection/types';

beforeAll(() => {
  process.env.DUPLICATE_DETECTION_SALT = 'integration-test-salt';
});

const { mockFindFirst, mockHeaders, mockInsert } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockHeaders: vi.fn(),
  mockInsert: vi.fn(),
}));

vi.mock('@/db', () => ({
  db: {
    query: { surveyResponses: { findFirst: mockFindFirst } },
    insert: mockInsert,
    execute: vi.fn().mockResolvedValue([{ id: null }]),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
  },
}));

vi.mock('next/headers', () => ({
  headers: mockHeaders,
}));

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
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
  dpr: 2,
  tz: 'Asia/Seoul',
  lang: 'ko-KR',
  platform: 'MacIntel',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockHeaders.mockResolvedValue(
    new Headers({ 'x-forwarded-for': '10.0.0.6', 'user-agent': 'Chrome/120' }),
  );
});

describe('createBlankResponse bypass defense', () => {
  it('checkDuplicateOnEntry 우회 → createBlankResponse 에서 차단', async () => {
    mockFindFirst.mockResolvedValue({ id: 'prev-blank-response' });

    const { createBlankResponse } = await import('@/actions/response-actions');
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
    // findFirst 가 호출되었다면 mock 이 resolve 되도록 안전망. 단 호출 자체가 없어야 정상
    mockFindFirst.mockResolvedValue(undefined);
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            { id: 'new-response-id', contactTargetId: null },
          ]),
        }),
      }),
    });

    const { createResponseWithFirstAnswer } = await import('@/actions/response-actions');
    const result = await createResponseWithFirstAnswer({
      surveyId: SURVEY_ID,
      sessionId: 'session-null-signals',
      versionId: null,
      questionId: 'q1',
      value: 'answer',
      currentStepId: 'group:z',
      clientSignals: null,
    });

    expect(result).toEqual({ kind: 'created', id: 'new-response-id', contactTargetId: null });
    expect(mockFindFirst).not.toHaveBeenCalled();
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

    const { createBlankResponse } = await import('@/actions/response-actions');
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

    const { checkDuplicateOnEntry } = await import('@/actions/duplicate-detection-actions');
    const result = await checkDuplicateOnEntry({
      surveyId: SURVEY_ID,
      clientSignals: null,
    });

    expect(result).toEqual({ blocked: false });
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockHeaders).not.toHaveBeenCalled();
  });
});
