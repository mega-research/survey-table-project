import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

// aggregateStatus 는 db.select({...}).from(surveyResponses).where(...).groupBy(...) 체인을 쓴다.
// 실 PG 없는 vitest 환경이라 where 절 자체를 캡처해 SQL 을 검증한다 (T3 duplicate-detection
// check.test.ts 선례 — mock 이 where 를 해석하지 않으므로 결과값 비교만으로는 조건 누락을 못 잡는다).
const { mockWhere } = vi.hoisted(() => ({ mockWhere: vi.fn() }));

vi.mock('@/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (w: unknown) => {
          mockWhere(w);
          return { groupBy: () => Promise.resolve([]) };
        },
      }),
    }),
  },
}));

vi.mock('@/server/read-models/result-code-statuses', () => ({
  getResultCodeStatuses: vi.fn(async () => ({ positive: ['1.조사완료'], negative: [] })),
}));

vi.mock('@/server/read-models/fieldwork-completions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/read-models/fieldwork-completions')>()),
  getFieldworkCompletedCounts: vi.fn(async () => new Map([['survey-1', 7]])),
}));

const dialect = new PgDialect();

describe('aggregateStatus', () => {
  beforeEach(() => {
    mockWhere.mockReset();
  });

  it('real scope 응답만 상태 집계 모수에 포함한다 (where 절에 is_test=false 조건 포함)', async () => {
    const { aggregateStatus } = await import('./aggregate-status');
    await aggregateStatus('survey-1', 'real');

    expect(mockWhere).toHaveBeenCalledTimes(1);
    // noUncheckedIndexedAccess 대응 — 직전 toHaveBeenCalledTimes(1) 단언이 존재를 보장한다.
    const whereArg = mockWhere.mock.calls[0]![0];
    const query = dialect.sqlToQuery(whereArg as never);
    expect(query.sql).toContain('is_test');
    expect(query.params).toContain(false);
  });

  it('실사 완료 처리 수를 전체에 더한다', async () => {
    const { aggregateStatus } = await import('./aggregate-status');
    const counts = await aggregateStatus('survey-1', 'real');

    expect(counts.fieldworkCompleted).toBe(7);
    expect(counts.total).toBe(7);
  });
});
