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

const dialect = new PgDialect();

describe('aggregateStatus', () => {
  beforeEach(() => {
    mockWhere.mockReset();
  });

  it('real scope 응답만 상태 집계 모수에 포함한다 (where 절에 is_test=false 조건 포함)', async () => {
    const { aggregateStatus } = await import('@/lib/operations/aggregate-status.server');
    await aggregateStatus('survey-1', 'real');

    expect(mockWhere).toHaveBeenCalledTimes(1);
    // noUncheckedIndexedAccess 대응 — 직전 toHaveBeenCalledTimes(1) 단언이 존재를 보장한다.
    const whereArg = mockWhere.mock.calls[0]![0];
    const query = dialect.sqlToQuery(whereArg as never);
    expect(query.sql).toContain('is_test');
    expect(query.params).toContain(false);
  });
});
