import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import type { ClientSignals } from '@/lib/duplicate-detection/types';

beforeAll(() => {
  process.env.DUPLICATE_DETECTION_SALT = 'integration-test-salt';
});

const { mockFindFirst, mockHeaders, mockInsert } = vi.hoisted(
  () => ({
    mockFindFirst: vi.fn(),
    mockHeaders: vi.fn(),
    mockInsert: vi.fn(),
  }),
);

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
});

describe('Track B bypass defense', () => {
  it('checkDuplicateOnEntry 우회 → 첫 답변 server action에서 차단', async () => {
    // 매칭되는 완료 응답이 이미 존재하는 상황 시뮬레이션
    mockFindFirst.mockResolvedValue({ id: 'prev-response' });

    const { createResponseWithFirstAnswer } = await import('@/actions/response-actions');
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
