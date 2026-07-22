import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const { mockExecute, mockInnerJoin, mockWhere } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockInnerJoin: vi.fn(),
  mockWhere: vi.fn(),
}));

function queryChain() {
  const chain = {
    from: () => chain,
    leftJoin: () => chain,
    innerJoin: (...args: unknown[]) => {
      mockInnerJoin(...args);
      return chain;
    },
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
    execute: (query: unknown) => {
      mockExecute(query);
      return Promise.resolve([]);
    },
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

function executeQueries() {
  return mockExecute.mock.calls.map(([query]) => dialect.sqlToQuery(query as never));
}

const SCOPE_CASES = [
  ['test', true],
  ['real', false],
] as const;

describe('운영 응답 범위', () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockInnerJoin.mockReset();
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

  it.each(SCOPE_CASES)('contacts는 %s scope의 조사대상만 조회한다', async (scope, isTest) => {
    const { listContactsForSurvey } = await import('@/lib/operations/contacts.server');

    await listContactsForSurvey({
      surveyId: `contacts-${scope}`,
      scope,
      clauses: [],
      page: 1,
      pageSize: 20,
      sort: 'resid',
      dir: 'asc',
    });

    expect(whereQueries().every((query) => query.params.includes(isTest))).toBe(true);
  });

  it.each(SCOPE_CASES)('contact 상세는 %s scope 밖의 대상을 조회하지 않는다', async (scope, isTest) => {
    const { getContactDetailById } = await import('@/lib/operations/contacts.server');

    const result = await getContactDetailById(`contact-${scope}`, scope);

    expect(result).toBeNull();
    expect(whereQuery().params).toContain(isTest);
  });

  it.each(SCOPE_CASES)('contact 메일 이력은 %s scope와 보관 상태를 제한한다', async (scope, isTest) => {
    const { getMailRecipientsForTarget } = await import('@/lib/operations/contacts.server');

    await getMailRecipientsForTarget(`contact-${scope}`, scope);

    const query = whereQuery();
    expect(query.params).toContain(isTest);
    expect(query.sql.replaceAll('"', '')).toContain('mail_recipients.archived_at is null');
    expect(query.sql.replaceAll('"', '')).toContain('mail_campaigns.archived_at is null');
  });

  it.each(SCOPE_CASES)('report는 contact와 response를 모두 %s scope로 제한한다', async (scope, isTest) => {
    const { getProgressRows } = await import('@/lib/operations/report-progress.server');

    await getProgressRows({
      surveyId: `report-${scope}`,
      scope,
      condition: null,
      page: 1,
      size: 20,
      sort: 'groupLabel',
      dir: 'asc',
      metaKeys: [],
    });

    const [query] = executeQueries();
    expect(query).toBeDefined();
    const normalizedSql = query!.sql.replaceAll('"', '');
    expect(normalizedSql).toContain('sr.is_test =');
    expect(normalizedSql).toContain('ct.is_test =');
    expect(query!.params.filter((param) => param === isTest)).toHaveLength(2);
  });

  it.each(SCOPE_CASES)('메일 미리보기 sample은 %s scope의 첫 대상만 조회한다', async (scope, isTest) => {
    const { getFirstContactSample } = await import('@/lib/operations/contact-sample.server');

    const result = await getFirstContactSample(`sample-${scope}`, scope);

    expect(result).toBeNull();
    expect(whereQuery().params).toContain(isTest);
  });

  it.each(SCOPE_CASES)('campaign 목록은 %s scope와 보관되지 않은 캠페인만 조회한다', async (scope, isTest) => {
    const { listCampaignsForSurvey } = await import('@/lib/operations/campaigns.server');

    await listCampaignsForSurvey({
      surveyId: `campaign-${scope}`,
      scope,
      page: 1,
      pageSize: 20,
    });

    const queries = whereQueries();
    expect(queries).toHaveLength(2);
    expect(
      queries.every((query) => query.sql.replaceAll('"', '').includes('archived_at is null')),
    ).toBe(true);
    expect(queries.every((query) => query.params.includes(isTest))).toBe(true);
  });

  it.each(SCOPE_CASES)('campaign 상세는 %s survey scope와 보관 상태를 제한한다', async (scope, isTest) => {
    const { getCampaignDetail } = await import('@/lib/operations/campaigns.server');

    const result = await getCampaignDetail(
      `campaign-survey-${scope}`,
      `campaign-detail-${scope}`,
      scope,
    );

    expect(result).toBeNull();
    const queries = whereQueries();
    expect(queries).toHaveLength(2);
    expect(
      queries.every(
        (query) =>
          query.params.includes(`campaign-survey-${scope}`) &&
          query.params.includes(isTest) &&
          query.sql.replaceAll('"', '').includes('mail_campaigns.archived_at is null'),
      ),
    ).toBe(true);
  });

  it.each(SCOPE_CASES)('campaign recipient count와 목록은 %s survey scope를 공유한다', async (scope, isTest) => {
    const { mailCampaigns } = await import('@/db/schema');
    const { listCampaignRecipients } = await import('@/lib/operations/campaigns.server');

    const result = await listCampaignRecipients({
      surveyId: `recipient-survey-${scope}`,
      campaignId: `campaign-${scope}`,
      scope,
      page: 1,
      pageSize: 20,
    });

    expect(result).toEqual({ rows: [], total: 0, page: 1 });
    expect(mockInnerJoin).toHaveBeenCalledTimes(2);
    expect(mockInnerJoin.mock.calls[0]?.[0]).toBe(mailCampaigns);
    expect(mockInnerJoin.mock.calls[1]?.[0]).toBe(mailCampaigns);
    const queries = whereQueries();
    expect(queries).toHaveLength(2);
    expect(
      queries.every(
        (query) =>
          query.params.includes(`recipient-survey-${scope}`) && query.params.includes(isTest),
      ),
    ).toBe(true);
  });
});
