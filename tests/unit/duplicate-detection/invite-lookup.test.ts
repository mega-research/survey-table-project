import { describe, it, expect, vi, beforeEach } from 'vitest';

// db.execute / db.query 를 mock 해 실제 PG 연결 없이 형식 검증 분기만 검증한다.
const { mockExecute, mockFindFirst, mockGetResultCodeStatuses } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockFindFirst: vi.fn(),
  mockGetResultCodeStatuses: vi.fn(),
}));

vi.mock('@/db', () => ({
  db: {
    execute: mockExecute,
    query: { contactTargets: { findFirst: mockFindFirst } },
  },
}));

vi.mock('@/lib/operations/result-code-statuses.server', () => ({
  getResultCodeStatuses: mockGetResultCodeStatuses,
  buildNegativeCodeExists: vi.fn(),
}));

const SURVEY_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_SURVEY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TOKEN = '22222222-2222-2222-2222-222222222222';

function mockLookupId(id = '33333333-3333-3333-3333-333333333333') {
  mockExecute.mockResolvedValueOnce([{ id }]);
}

function mockTarget(overrides: Record<string, unknown> = {}) {
  mockFindFirst.mockResolvedValue({
    id: '33333333-3333-3333-3333-333333333333',
    surveyId: SURVEY_ID,
    isTest: false,
    respondedAt: null,
    survey: { testModeEnabled: false, deletedAt: null },
    ...overrides,
  });
}

describe('findContactByInviteToken (UUID 형식 가드)', () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockFindFirst.mockReset();
    mockGetResultCodeStatuses.mockReset();
  });

  it('UUID 형식이 아닌 토큰은 ::uuid 캐스트(db.execute) 전에 invalid 로 폴백', async () => {
    const { findContactByInviteToken } = await import(
      '@/lib/duplicate-detection/invite-lookup'
    );
    const r = await findContactByInviteToken(
      SURVEY_ID,
      'test',
    );
    expect(r).toEqual({ kind: 'invalid' });
    // 캐스트 자체가 발생하지 않아야 PG 22P02 throw 가 차단됨
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('빈 문자열 토큰도 invalid 로 폴백 (db 미접근)', async () => {
    const { findContactByInviteToken } = await import(
      '@/lib/duplicate-detection/invite-lookup'
    );
    const r = await findContactByInviteToken(
      SURVEY_ID,
      '',
    );
    expect(r).toEqual({ kind: 'invalid' });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('UUID 형식 토큰이지만 매칭 컨택 없음 → invalid (기존 동작 보존)', async () => {
    mockExecute.mockResolvedValueOnce([{ id: null }]);
    mockFindFirst.mockResolvedValue(undefined);
    const { findContactByInviteToken } = await import(
      '@/lib/duplicate-detection/invite-lookup'
    );
    const r = await findContactByInviteToken(
      SURVEY_ID,
      TOKEN,
    );
    expect(r).toEqual({ kind: 'invalid' });
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('OFF인 테스트 대상자 토큰은 invalid_test이고 익명으로 폴백하지 않는다', async () => {
    mockLookupId();
    mockTarget({
      isTest: true,
      survey: { testModeEnabled: false, deletedAt: null },
    });

    const { findContactByInviteToken } = await import(
      '@/lib/duplicate-detection/invite-lookup'
    );
    const result = await findContactByInviteToken(SURVEY_ID, TOKEN);

    expect(result).toEqual({ kind: 'invalid_test' });
    expect(mockGetResultCodeStatuses).not.toHaveBeenCalled();
  });

  it('ON인 테스트 대상자는 사용·제외 상태를 검사하지 않고 test target으로 반환한다', async () => {
    mockLookupId();
    mockTarget({
      isTest: true,
      respondedAt: new Date('2026-07-21T00:00:00.000Z'),
      survey: { testModeEnabled: true, deletedAt: null },
    });

    const { findContactByInviteToken } = await import(
      '@/lib/duplicate-detection/invite-lookup'
    );
    const result = await findContactByInviteToken(SURVEY_ID, TOKEN);

    expect(result).toEqual({
      kind: 'valid',
      contactTargetId: '33333333-3333-3333-3333-333333333333',
      respondedAt: new Date('2026-07-21T00:00:00.000Z'),
      isTest: true,
    });
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockGetResultCodeStatuses).not.toHaveBeenCalled();
  });

  it('실제 대상자 토큰은 테스트 모드 ON에서도 기존 제외 정책을 유지한다', async () => {
    mockLookupId();
    mockTarget({
      survey: { testModeEnabled: true, deletedAt: null },
    });
    mockGetResultCodeStatuses.mockResolvedValue({ negative: [] });
    mockExecute.mockResolvedValueOnce([]);

    const { findContactByInviteToken } = await import(
      '@/lib/duplicate-detection/invite-lookup'
    );
    const result = await findContactByInviteToken(SURVEY_ID, TOKEN);

    expect(result).toEqual({
      kind: 'valid',
      contactTargetId: '33333333-3333-3333-3333-333333333333',
      respondedAt: null,
      isTest: false,
    });
  });

  it('교차 설문 테스트 대상자 토큰은 invalid_test로 종류를 보존한다', async () => {
    // 실제 SECURITY DEFINER 함수는 survey_id를 함수 안에서 제한하므로 교차 설문이면 null이다.
    mockExecute.mockResolvedValueOnce([{ id: null }]);
    mockTarget({
      surveyId: OTHER_SURVEY_ID,
      isTest: true,
      survey: { testModeEnabled: true, deletedAt: null },
    });

    const { findContactByInviteToken } = await import(
      '@/lib/duplicate-detection/invite-lookup'
    );
    const result = await findContactByInviteToken(SURVEY_ID, TOKEN);

    expect(result).toEqual({ kind: 'invalid_test' });
    expect(mockFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      columns: {
        id: true,
        surveyId: true,
        isTest: true,
        respondedAt: true,
      },
    }));
    expect(mockGetResultCodeStatuses).not.toHaveBeenCalled();
  });

  it('교차 설문 실제 대상자 토큰은 기존 invalid 계약을 유지한다', async () => {
    mockExecute.mockResolvedValueOnce([{ id: null }]);
    mockTarget({ surveyId: OTHER_SURVEY_ID, isTest: false });

    const { findContactByInviteToken } = await import(
      '@/lib/duplicate-detection/invite-lookup'
    );
    const result = await findContactByInviteToken(SURVEY_ID, TOKEN);

    expect(result).toEqual({ kind: 'invalid' });
    expect(mockGetResultCodeStatuses).not.toHaveBeenCalled();
  });

  it('삭제된 설문의 테스트 대상자 owner는 RPC null이어도 invalid_test로 보존한다', async () => {
    mockExecute.mockResolvedValueOnce([{ id: null }]);
    mockTarget({
      isTest: true,
      survey: {
        testModeEnabled: true,
        deletedAt: new Date('2026-07-22T01:00:00.000Z'),
      },
    });

    const { findContactByInviteToken } = await import(
      '@/lib/duplicate-detection/invite-lookup'
    );

    await expect(findContactByInviteToken(SURVEY_ID, TOKEN)).resolves.toEqual({
      kind: 'invalid_test',
    });
  });
});
