import { describe, it, expect, beforeEach, vi } from 'vitest';
import { extractRawSql } from './_helpers/result-code-mock';

const { setMock, whereMock } = vi.hoisted(() => ({
  setMock: vi.fn(),
  whereMock: vi.fn(),
}));

vi.mock('@/db', () => {
  const chainable: Record<string, unknown> = {};
  chainable['update'] = vi.fn(() => chainable);
  chainable['set'] = vi.fn((arg: unknown) => {
    setMock(arg);
    return chainable;
  });
  chainable['where'] = vi.fn((arg: unknown) => {
    whereMock(arg);
    return chainable; // await 시 chainable 자신으로 resolve (no-op)
  });
  return { db: chainable };
});

describe('recordVisibilitySegment — SQL 분기', () => {
  beforeEach(() => {
    setMock.mockReset();
    whereMock.mockReset();
  });

  it('hide: pageVisits set에 jsonb_set + leftAt 백필, lastActivityAt 미갱신', async () => {
    const { recordVisibilitySegment } = await import('@/actions/response-actions');
    await recordVisibilitySegment({ responseId: 'r1', action: 'hide' });

    const setArg = setMock.mock.calls[0][0] as Record<string, unknown>;
    const pvSql = extractRawSql(setArg['pageVisits']);
    expect(pvSql).toContain('jsonb_set');
    expect(pvSql).toContain("'leftAt'");
    expect('lastActivityAt' in setArg).toBe(false); // hide는 떠남 → 미갱신
  });

  it('show: pageVisits set에 append(||), lastActivityAt 갱신', async () => {
    const { recordVisibilitySegment } = await import('@/actions/response-actions');
    await recordVisibilitySegment({ responseId: 'r1', action: 'show' });

    const setArg = setMock.mock.calls[0][0] as Record<string, unknown>;
    const pvSql = extractRawSql(setArg['pageVisits']);
    expect(pvSql).toContain('jsonb_build_array');
    expect(pvSql).toContain('||');
    expect('lastActivityAt' in setArg).toBe(true); // show는 복귀 → 갱신
  });

  it('hide: where 가드에 status in_progress + leftAt NULL 조건이 포함된다', async () => {
    const { recordVisibilitySegment } = await import('@/actions/response-actions');
    await recordVisibilitySegment({ responseId: 'r1', action: 'hide' });
    expect(whereMock).toHaveBeenCalledTimes(1); // 단일 UPDATE + WHERE 가드
    const whereSql = extractRawSql(whereMock.mock.calls[0][0]);
    expect(whereSql).toContain('leftAt');
  });

  it('show: where 가드에 멱등 조건(leftAt IS NOT NULL)이 포함된다', async () => {
    const { recordVisibilitySegment } = await import('@/actions/response-actions');
    await recordVisibilitySegment({ responseId: 'r1', action: 'show' });
    expect(whereMock).toHaveBeenCalledTimes(1);
    const whereSql = extractRawSql(whereMock.mock.calls[0][0]);
    expect(whereSql).toContain('leftAt');
    expect(whereSql).toContain('IS NOT NULL');
  });
});
