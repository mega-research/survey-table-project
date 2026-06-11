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

vi.mock('@/db/schema', () => ({
  contactTargets: { id: 'id' },
}));

vi.mock('@/lib/operations/result-code-statuses.server', () => ({
  getResultCodeStatuses: mockGetResultCodeStatuses,
  buildNegativeCodeExists: vi.fn(),
}));

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
      '11111111-1111-1111-1111-111111111111',
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
      '11111111-1111-1111-1111-111111111111',
      '',
    );
    expect(r).toEqual({ kind: 'invalid' });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('UUID 형식 토큰이지만 매칭 컨택 없음 → invalid (기존 동작 보존)', async () => {
    mockExecute.mockResolvedValueOnce([{ id: null }]);
    const { findContactByInviteToken } = await import(
      '@/lib/duplicate-detection/invite-lookup'
    );
    const r = await findContactByInviteToken(
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
    );
    expect(r).toEqual({ kind: 'invalid' });
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });
});
