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

    const { createBlankResponse } = await import('@/server/survey-response/services/response-entry.service');
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

describe('clientSignals null 익명 제출 — create 는 봇 차단, checkOnEntry 는 통과(advisory)', () => {
  // 보안 변경(봇 방어): 익명(invite 없음·test 없음) 제출에 clientSignals 가 없으면 봇으로 차단한다.
  // 정상 클라이언트는 신호를 ref 로 최신 유지해 create 시점에 non-null 로 보낸다
  // (use-response-lifecycle 스테일 클로저 회귀 시 첫 답변이 null 로 나가 전원 오차단됐던
  // 2026-08-11 사고 참조). null 은 Track B 우회용 직접 RPC 호출 봇으로 간주한다.
  it('createResponseWithFirstAnswer: 익명 + clientSignals null → 봇 차단(INSERT 없음)', async () => {
    const { createResponseWithFirstAnswer } = await import('@/server/survey-response/services/response-entry.service');
    const result = await createResponseWithFirstAnswer({
      surveyId: SURVEY_ID,
      sessionId: 'session-null-signals',
      versionId: null,
      questionId: 'q1',
      value: 'answer',
      currentStepId: 'group:z',
      clientSignals: null,
    });

    expect(result).toEqual({ kind: 'blocked', reason: 'device_already_responded' });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('createBlankResponse: 익명 + clientSignals null → 봇 차단(INSERT 없음)', async () => {
    const { createBlankResponse } = await import('@/server/survey-response/services/response-entry.service');
    const result = await createBlankResponse({
      surveyId: SURVEY_ID,
      sessionId: 'session-blank-null-signals',
      versionId: null,
      currentStepId: 'group:z',
      clientSignals: null,
    });

    expect(result).toEqual({ kind: 'blocked', reason: 'device_already_responded' });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('createResponseWithFirstAnswer: testToken 동반 + clientSignals null → 봇 가드 대신 토큰 검증으로 진행한다', async () => {
    // 테스트 세션은 신호 기반 검사 대상이 아니다 — 봇 가드가 testToken 을 면제하지 않으면
    // 유효 테스트 링크의 첫 답변이 device_already_responded 로 오차단된다.
    // 이 mock 의 surveys.findFirst 는 test_mode 필드가 없어 무효 토큰 판정(invalid_test_token)
    // 까지 도달하는 것 자체가 봇 가드 통과의 증거다.
    const { createResponseWithFirstAnswer } = await import('@/server/survey-response/services/response-entry.service');
    const result = await createResponseWithFirstAnswer({
      surveyId: SURVEY_ID,
      sessionId: 'session-test-token-null-signals',
      versionId: null,
      questionId: 'q1',
      value: 'answer',
      currentStepId: 'group:z',
      clientSignals: null,
      testToken: 'test-token-1',
    });

    expect(result).toEqual({ kind: 'blocked', reason: 'invalid_test_token' });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('createBlankResponse: testToken 동반 + clientSignals null → 봇 가드 대신 토큰 검증으로 진행한다', async () => {
    const { createBlankResponse } = await import('@/server/survey-response/services/response-entry.service');
    const result = await createBlankResponse({
      surveyId: SURVEY_ID,
      sessionId: 'session-blank-test-token-null-signals',
      versionId: null,
      currentStepId: 'group:z',
      clientSignals: null,
      testToken: 'test-token-1',
    });

    expect(result).toEqual({ kind: 'blocked', reason: 'invalid_test_token' });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('checkDuplicateOnEntry: clientSignals null → blocked false 즉시 반환', async () => {
    mockFindFirst.mockResolvedValue(undefined);

    const { checkDuplicateOnEntry } = await import('@/server/survey-response/services/duplicate.service');
    const result = await checkDuplicateOnEntry({
      surveyId: SURVEY_ID,
      clientSignals: null,
    });

    expect(result).toEqual({ blocked: false });
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockHeaders).not.toHaveBeenCalled();
  });
});
