import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClientSignals } from '@/lib/duplicate-detection/types';

beforeAll(() => {
  process.env['DUPLICATE_DETECTION_SALT'] = 'integration-test-salt';
});

// 익명 테스트 링크로 완료한 뒤 같은 sessionId 로 다시 첫 답변을 보내면
// (survey_id, session_id) UNIQUE 충돌로 종결 상태 행을 물려받는다. 예전에는
// decideResponseReuse 가 이를 device_already_responded 로 차단해 "이미 응답하신 설문입니다"
// 화면이 떴다. 지금은 그 행을 제자리에서 초기화하고 처음부터 다시 응답해야 한다.
const {
  mockFindFirst,
  mockSurveysFindFirst,
  mockHeaders,
  mockQuestionLimit,
  mockExistingStatus,
  txInsertReturning,
  txUpdateSet,
  resetDeleteTables,
  mockExecute,
} = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockSurveysFindFirst: vi.fn(),
  mockHeaders: vi.fn(),
  mockQuestionLimit: vi.fn(),
  mockExistingStatus: vi.fn(),
  txInsertReturning: vi.fn(),
  txUpdateSet: vi.fn(),
  resetDeleteTables: vi.fn(),
  mockExecute: vi.fn(),
}));

vi.mock('@/db', () => ({
  db: (() => {
    // insertAnonymousTestResponse 트랜잭션의 select 는 호출 형태로 구분한다:
    // - `.for('share').limit()` = assertAnonymousTestSession 의 surveys 잠금
    // - `await ...where()`      = 테스트 대상자 수 카운트
    // - `.limit()`              = 충돌 후 기존 테스트 응답 행(status 포함) 조회
    const txWhereResult = {
      then: (resolve: (rows: unknown) => void) => resolve([{ total: 0 }]),
      limit: vi.fn(() => mockExistingStatus()),
      for: vi.fn(() => ({
        limit: vi.fn(async () => [{ id: 'aaaaaaaa-0009-0009-0009-000000000009' }]),
      })),
    };
    const txSelectChain = {
      from: vi.fn(() => ({ where: vi.fn(() => txWhereResult) })),
    };

    const tx = {
      select: vi.fn(() => txSelectChain),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn(() => ({
            returning: vi.fn(() => txInsertReturning()),
          })),
        })),
      })),
      // 트랜잭션 내 UPDATE 는 둘이다: resetTestResponseRow 의 초기화와,
      // 테스트 행 답변 저장(applyQuestionResponseUpdate)의 jsonb_set. 둘 다 여기로 들어오므로
      // 호출 payload 를 모아 두고 초기화 호출만 골라내 검증한다.
      update: vi.fn(() => ({
        set: vi.fn((values: Record<string, unknown>) => {
          txUpdateSet(values);
          return {
            where: vi.fn(() => ({
              then: (resolve: (rows: unknown) => void) => resolve(undefined),
              returning: vi.fn(async () => [
                {
                  id: 'bbbbbbbb-0009-0009-0009-000000000009',
                  surveyId: 'ignored',
                  contactTargetId: null,
                  pageVisits: null,
                },
              ]),
            })),
          };
        }),
      })),
      delete: vi.fn((table: unknown) => {
        resetDeleteTables(table);
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    };

    return {
      query: {
        surveyResponses: { findFirst: mockFindFirst },
        surveys: { findFirst: mockSurveysFindFirst },
        surveyVersions: { findFirst: vi.fn(async () => null) },
      },
      insert: vi.fn(),
      // claimDraftSeq 의 순번 claim UPDATE / 존재 확인 SELECT 종단.
      execute: vi.fn(() => mockExecute()),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            // assertQuestionBelongsToResponse 의 questions 조회 종단.
            limit: vi.fn(() => mockQuestionLimit()),
          }),
        }),
      }),
      // updateQuestionResponse 의 jsonb_set + progress_pct 갱신.
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([
              {
                id: 'bbbbbbbb-0009-0009-0009-000000000009',
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

const SURVEY_ID = 'aaaaaaaa-0009-0009-0009-000000000009';
const EXISTING_RESPONSE_ID = 'bbbbbbbb-0009-0009-0009-000000000009';
const SESSION_ID = 'anon-test-session';
const SIGNALS: ClientSignals = {
  deviceId: 'DEV-TEST-RESTART',
  screen: '1920x1080',
  tz: 'Asia/Seoul',
  lang: 'ko-KR',
  platform: 'MacIntel',
};

/**
 * 물려받는 기존 테스트 행. insertAnonymousTestResponse 는 id·status 만 읽고,
 * 이후 updateQuestionResponse 의 소유권 preflight 는 나머지 필드를 읽는다
 * (isTest=false 로 두어 대상자 전용 소유권 검사 경로를 타지 않게 한다 — Task 2 영역).
 */
function existingRow(status: string, metadata: Record<string, unknown> | null = null) {
  return [
    {
      id: EXISTING_RESPONSE_ID,
      status,
      metadata,
      surveyId: SURVEY_ID,
      isTest: false,
      contactTargetId: null,
    },
  ];
}

/** 초기화(reset) UPDATE 만 골라낸다 — 답변 저장 UPDATE 와 구분하는 키는 completedAt. */
function resetCalls(): Array<Record<string, unknown>> {
  return txUpdateSet.mock.calls
    .map((call) => call[0] as Record<string, unknown>)
    .filter((values) => 'completedAt' in values);
}

async function firstAnswer() {
  const { createResponseWithFirstAnswer } = await import(
    '@/features/survey-response/server/services/response.service'
  );
  return createResponseWithFirstAnswer({
    surveyId: SURVEY_ID,
    sessionId: SESSION_ID,
    versionId: null,
    questionId: 'q1',
    value: '다시 시작한 답',
    currentStepId: 'group:x',
    clientSignals: SIGNALS,
    testToken: 'tok-valid',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHeaders.mockResolvedValue(
    new Headers({ 'x-forwarded-for': '10.0.0.9', 'user-agent': 'Chrome/120' }),
  );
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
  mockQuestionLimit.mockResolvedValue([{ id: 'q1', piiEncrypted: false }]);
  mockExecute.mockResolvedValue([{ id: null }]);
  // 충돌 → 물려받을 기존 행이 있다.
  txInsertReturning.mockResolvedValue([]);
  mockFindFirst.mockResolvedValue({
    id: EXISTING_RESPONSE_ID,
    surveyId: SURVEY_ID,
    versionId: null,
    isTest: true,
    contactTargetId: null,
  });
});

describe('익명 테스트 세션 재진입 — 종결 행 제자리 리셋', () => {
  it('완료된 테스트 행을 물려받으면 차단 대신 초기화하고 계속 응답한다', async () => {
    mockExistingStatus.mockResolvedValue(existingRow('completed'));

    const result = await firstAnswer();

    expect(result).toMatchObject({ kind: 'created', id: EXISTING_RESPONSE_ID });

    const resetValues = resetCalls()[0];
    expect(resetValues).toMatchObject({
      questionResponses: {},
      isCompleted: false,
      status: 'in_progress',
      completedAt: null,
      versionId: null,
      currentStepId: 'group:x',
      totalSeconds: null,
      progressPct: null,
      metadata: null,
      lastEditedAt: null,
      sessionId: SESSION_ID,
    });
    // 이전 시도의 정규화 응답·수정 로그도 함께 지운다(response_answers, response_edit_logs).
    expect(resetDeleteTables).toHaveBeenCalledTimes(2);
  });

  it('screened_out 종결 행도 초기화한다', async () => {
    mockExistingStatus.mockResolvedValue(existingRow('screened_out'));

    const result = await firstAnswer();

    expect(result.kind).toBe('created');
    expect(resetCalls()).toHaveLength(1);
  });

  it('진행 중 행은 초기화하지 않고 그대로 이어간다', async () => {
    mockExistingStatus.mockResolvedValue(existingRow('in_progress'));

    const result = await firstAnswer();

    expect(result.kind).toBe('created');
    expect(resetCalls()).toHaveLength(0);
  });

  // 초기화가 metadata 를 통째로 비우면 claimDraftSeq 의 하한이 0 으로 떨어져, 직전 시도의 탭이
  // 늦게 던진 unload beacon(seq=7)이 갓 초기화한 행에 그대로 쓰인다. 이 창은 초기화 도입으로
  // 새로 생긴 것이다 — 예전에는 행이 completed 로 남아 concluded skip 이 beacon 을 막았고,
  // 대상자 경로는 시도 장부(superseded)로 막지만 익명 경로에는 장부가 없다.
  it('초기화 후에도 draft 순번 하한이 남아 직전 시도의 지연 beacon 을 막는다', async () => {
    mockExistingStatus.mockResolvedValue(existingRow('completed', { draftSeq: 7 }));

    const created = await firstAnswer();

    // 하한만 남고(exposedQuestionIds 같은 시도별 상태는 버림), 클라이언트에도 실려 나가야
    // 한다 — 새 탭이 8 부터 발급하지 않으면 이번 시도의 draft 가 전부 stale 로 떨어진다.
    expect(resetCalls()[0]?.['metadata']).toEqual({ draftSeq: 7 });
    expect(created).toMatchObject({ kind: 'created', draftSeq: 7 });

    // 위에서 프로덕션 코드가 실제로 쓴 하한으로 claimDraftSeq 의 비교를 그대로 재현한다
    // (WHERE COALESCE((metadata->>'draftSeq')::bigint, 0) < seq).
    const floor = (resetCalls()[0]?.['metadata'] as { draftSeq?: number } | null)?.draftSeq ?? 0;
    const LATE_BEACON_SEQ = 7;
    mockExecute
      .mockResolvedValueOnce(floor < LATE_BEACON_SEQ ? [{ id: EXISTING_RESPONSE_ID }] : [])
      // claim 0행이면 행 존재 확인 SELECT → stale 판정.
      .mockResolvedValueOnce([{ id: EXISTING_RESPONSE_ID }]);

    const { saveDraftResponse } = await import(
      '@/features/survey-response/server/services/response.service'
    );
    const late = await saveDraftResponse({
      responseId: EXISTING_RESPONSE_ID,
      answers: { q1: '직전 시도의 답' },
      seq: LATE_BEACON_SEQ,
    });

    expect(late).toEqual({ applied: false });
  });

  it('알 수 없는 status 는 테스트 세션이어도 초기화하지 않고 차단한다', async () => {
    mockExistingStatus.mockResolvedValue(existingRow('weird_status'));

    const result = await firstAnswer();

    expect(result).toEqual({ kind: 'blocked', reason: 'device_already_responded' });
    expect(resetCalls()).toHaveLength(0);
  });
});
