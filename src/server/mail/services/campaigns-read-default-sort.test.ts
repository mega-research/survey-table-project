import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 컬럼 설정의 기본 정렬 열이 단체 메일 쪽 세 표(위저드 수신자 목록·수신거부 명단·캠페인 수신자 표)의
 * ORDER BY 에 실리는지. 실제 순서(숫자순·공백)는 `contacts-filter-sql.test.ts` 의 식 테스트가 맡는다.
 */

const dialect = new PgDialect();
const captured: { orderBy: string[][] } = { orderBy: [] };

function buildChain() {
  const tail = {
    orderBy: (...exprs: SQL[]) => {
      captured.orderBy.push(exprs.map((e) => dialect.sqlToQuery(e as SQL).sql));
      return tail;
    },
    limit: () => tail,
    offset: () => Promise.resolve([]),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve([{ total: 0 }]).then(resolve),
  };
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    where: () => tail,
  };
  return chain;
}

vi.mock('@/db', () => ({
  db: { select: vi.fn(() => buildChain()) },
}));

vi.mock('@/server/read-models/send-address', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/read-models/send-address')>()),
  loadMailEmailOrder: vi.fn(async () => null),
}));

import {
  buildCandidateOrderBy,
  listCampaignRecipients,
  listUnsubscribedContacts,
} from './campaigns-read';

const SURVEY_ID = '00000000-0000-4000-8000-000000000051';
const lastOrderBy = () => captured.orderBy[captured.orderBy.length - 1]!;

describe('단체 메일 표의 기본 정렬 열', () => {
  beforeEach(() => {
    captured.orderBy = [];
  });

  it('위저드 수신자 목록 — attrs 정렬은 숫자 → 글자 → 시스템ID 순이고 방향을 따른다', () => {
    const asc = buildCandidateOrderBy('attrs.ID', 'asc', 'real').map((e) => dialect.sqlToQuery(e).sql);
    expect(asc).toHaveLength(3);
    expect(asc[0]).toContain('::numeric END) ASC NULLS LAST');
    expect(asc[1]).toContain('attrs->>');
    expect(asc[1]).toContain('ASC NULLS LAST');
    expect(asc[2]).toContain('"resid" ASC');

    const desc = buildCandidateOrderBy('attrs.ID', 'desc', 'real').map((e) => dialect.sqlToQuery(e).sql);
    expect(desc[0]).toContain('::numeric END) DESC NULLS LAST');
  });

  it('위저드 수신자 목록 — 시스템 정렬 키는 종전 식 하나 그대로', () => {
    const resid = buildCandidateOrderBy('resid', 'asc', 'real').map((e) => dialect.sqlToQuery(e).sql);
    expect(resid).toHaveLength(1);
    expect(resid[0]).toContain('"resid"');
    expect(resid[0]).not.toContain('attrs');
  });

  it('수신거부 명단 — 기본 정렬 열이 있으면 그 열이 먼저, 최근 수신거부 순은 그 뒤', async () => {
    await listUnsubscribedContacts({ surveyId: SURVEY_ID, scope: 'real', defaultSort: 'attrs.ID' });
    const order = lastOrderBy();
    expect(order).toHaveLength(3);
    expect(order[0]).toContain('::numeric END) ASC NULLS LAST');
    expect(order[2]).toContain('COALESCE');
    expect(order[2]).toContain('DESC NULLS LAST');
  });

  it('수신거부 명단 — 지정이 없으면 종전대로 최근 수신거부 순 하나', async () => {
    await listUnsubscribedContacts({ surveyId: SURVEY_ID, scope: 'real', defaultSort: 'resid' });
    expect(lastOrderBy()).toHaveLength(1);
    await listUnsubscribedContacts({ surveyId: SURVEY_ID, scope: 'real' });
    expect(lastOrderBy()).toHaveLength(1);
    expect(lastOrderBy()[0]).toContain('COALESCE');
  });

  it('캠페인 수신자 표 — 기본 정렬 열이 있으면 그 열이 먼저, 없으면 종전대로 만든 시각 역순', async () => {
    const base = { surveyId: SURVEY_ID, campaignId: 'c-1', scope: 'real' as const };
    await listCampaignRecipients({ ...base, defaultSort: 'attrs.ID' });
    const withDefault = lastOrderBy();
    expect(withDefault).toHaveLength(3);
    expect(withDefault[0]).toContain('::numeric END) ASC NULLS LAST');
    expect(withDefault[2]).toContain('created_at');

    await listCampaignRecipients(base);
    expect(lastOrderBy()).toHaveLength(1);
    expect(lastOrderBy()[0]).toContain('created_at');
  });
});
