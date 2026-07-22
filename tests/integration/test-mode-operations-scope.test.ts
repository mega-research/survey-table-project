import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const { mockWhere } = vi.hoisted(() => ({ mockWhere: vi.fn() }));

function queryChain() {
  const chain = {
    from: () => chain,
    leftJoin: () => chain,
    innerJoin: () => chain,
    where: (where: unknown) => {
      mockWhere(where);
      return chain;
    },
    groupBy: () => Promise.resolve([]),
    orderBy: () => chain,
    limit: () => chain,
    offset: () => Promise.resolve([]),
    then: <T>(resolve: (value: never[]) => T) => Promise.resolve([]).then(resolve),
  };
  return chain;
}

vi.mock('@/db', () => ({
  db: {
    select: () => queryChain(),
    execute: () => Promise.resolve([]),
  },
}));

const dialect = new PgDialect();

function whereQuery() {
  expect(mockWhere).toHaveBeenCalledTimes(1);
  return dialect.sqlToQuery(mockWhere.mock.calls[0]![0] as never);
}

function whereQueries() {
  return mockWhere.mock.calls.map(([where]) => dialect.sqlToQuery(where as never));
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

  it('contacts는 test scope의 조사대상만 조회한다', async () => {
    const { listContactsForSurvey } = await import('@/lib/operations/contacts.server');

    await listContactsForSurvey({
      surveyId: 'survey-1',
      scope: 'test',
      clauses: [],
      page: 1,
      pageSize: 20,
      sort: 'resid',
      dir: 'asc',
    });

    expect(whereQueries().some((query) => query.params.includes(true))).toBe(true);
  });

  it('campaign 목록은 real scope와 보관되지 않은 캠페인만 조회한다', async () => {
    const { listCampaignsForSurvey } = await import('@/lib/operations/campaigns.server');

    await listCampaignsForSurvey({ surveyId: 'survey-1', scope: 'real', page: 1, pageSize: 20 });

    const queries = whereQueries();
    expect(
      queries.some((query) => query.sql.replaceAll('"', '').includes('archived_at is null')),
    ).toBe(true);
    expect(queries.some((query) => query.params.includes(false))).toBe(true);
  });
});
