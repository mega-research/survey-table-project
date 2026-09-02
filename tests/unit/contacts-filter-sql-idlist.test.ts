import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { buildClauseSql } from '@/lib/operations/contacts-filter-sql';
import type { FilterCondition } from '@/lib/operations/contacts-filters.server';

const dialect = new PgDialect();
const render = (cond: FilterCondition) => dialect.sqlToQuery(buildClauseSql(cond));

/**
 * idlist 절 SQL — 붙여넣은 ID 목록(단건 수백~수천 개)이 `= $1 OR = $2 OR …` 로
 * 늘어지지 않고 IN 한 방으로 나가는지. 범위 토큰만 BETWEEN 으로 남는다.
 */
describe('buildClauseSql idlist — 단건은 IN 한 방, 범위는 BETWEEN', () => {
  it('system.resid 단건 목록 → IN ($1, $2, $3)', () => {
    const q = render({
      source: 'system.resid',
      mode: 'idlist',
      value: '99 292 235',
      ranges: [
        { from: 99, to: 99 },
        { from: 292, to: 292 },
        { from: 235, to: 235 },
      ],
    });
    expect(q.sql).toMatch(/IN \(\$1, \$2, \$3\)/);
    expect(q.params).toEqual([99, 292, 235]);
    expect(q.sql).not.toContain(' OR ');
  });

  it('system.resid 단건 + 범위 혼합 → IN 과 BETWEEN 을 OR 로', () => {
    const q = render({
      source: 'system.resid',
      mode: 'idlist',
      value: '1, 5-9, 12',
      ranges: [
        { from: 1, to: 1 },
        { from: 5, to: 9 },
        { from: 12, to: 12 },
      ],
    });
    expect(q.sql).toMatch(/IN \(\$1, \$2\)/);
    expect(q.sql).toMatch(/BETWEEN \$3 AND \$4/);
    expect(q.params).toEqual([1, 12, 5, 9]);
  });

  it('attrs.* 단건 목록 → 숫자 캐스트 식에 IN', () => {
    const q = render({
      source: 'attrs.ID',
      mode: 'idlist',
      value: '99 292',
      ranges: [
        { from: 99, to: 99 },
        { from: 292, to: 292 },
      ],
    });
    expect(q.sql).toContain('->>');
    expect(q.sql).toMatch(/IN \(\$\d+, \$\d+\)/);
    expect(q.params).toEqual(expect.arrayContaining([99, 292]));
  });
});
