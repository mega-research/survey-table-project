import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const { mockWhere } = vi.hoisted(() => ({ mockWhere: vi.fn() }));

vi.mock('@/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (where: unknown) => {
          mockWhere(where);
          return { groupBy: () => Promise.resolve([]) };
        },
      }),
    }),
  },
}));

const dialect = new PgDialect();

function whereQuery() {
  expect(mockWhere).toHaveBeenCalledTimes(1);
  return dialect.sqlToQuery(mockWhere.mock.calls[0]![0] as never);
}

describe('운영 응답 범위', () => {
  beforeEach(() => {
    mockWhere.mockReset();
  });

  it('aggregateStatus는 전달된 test scope의 응답만 집계한다', async () => {
    const { aggregateStatus } = await import('@/lib/operations/aggregate-status.server');

    await aggregateStatus('survey-1', 'test');

    const query = whereQuery();
    expect(query.sql).toContain('is_test');
    expect(query.params).toContain(true);
  });

  it('aggregateStatus는 전달된 real scope의 응답만 집계한다', async () => {
    const { aggregateStatus } = await import('@/lib/operations/aggregate-status.server');

    await aggregateStatus('survey-1', 'real');

    const query = whereQuery();
    expect(query.sql).toContain('is_test');
    expect(query.params).toContain(false);
  });
});
