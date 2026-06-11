import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

import { buildContactsFilterSql } from '@/lib/operations/contacts-filter-sql';
import type { FilterClause } from '@/lib/operations/contacts-filters.server';

const dialect = new PgDialect();

function textClause(key: string, value: string, op: FilterClause['op']): FilterClause {
  return {
    op,
    condition: { source: `attrs.${key}`, mode: 'text', value },
  };
}

/** depth 0 에서 외부 괄호 밖에 토큰이 노출되는지 — 노출되면 최상위 그룹화가 깨진 것. */
function hasTokenOutsideOuterParens(sqlText: string): boolean {
  const trimmed = sqlText.trim();
  let depth = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    // 마지막 문자(닫는 괄호) 이전인데 depth 가 0 으로 떨어지면 외부 괄호 밖에 내용이 있는 것.
    if (depth === 0 && i < trimmed.length - 1) return true;
  }
  return false;
}

describe('buildContactsFilterSql', () => {
  it('빈 배열 → TRUE', () => {
    const query = dialect.sqlToQuery(buildContactsFilterSql([]));
    expect(query.sql.trim()).toBe('TRUE');
  });

  it('단일 절은 (...) 괄호로 감싸 외부 AND 결합에 안전하다', () => {
    const query = dialect.sqlToQuery(buildContactsFilterSql([textClause('지역', '서울', null)]));
    const trimmed = query.sql.trim();
    expect(trimmed).toContain('"contact_targets".attrs');
    expect(trimmed.startsWith('(')).toBe(true);
    expect(trimmed.endsWith(')')).toBe(true);
    expect(hasTokenOutsideOuterParens(trimmed)).toBe(false);
  });

  it('혼합 AND/OR 는 누적마다 괄호로 그룹화해 좌→우 평가를 강제한다', () => {
    // A OR B AND C — 평탄 연결 시 PG AND>OR 우선순위로 A OR (B AND C) 가 되어
    // 의도한 (A OR B) AND C 와 어긋난다. 누적 그룹화로 ((A OR B) AND C) 가 되어야 한다.
    const clauses: FilterClause[] = [
      textClause('a', '1', null),
      textClause('b', '2', 'OR'),
      textClause('c', '3', 'AND'),
    ];
    const query = dialect.sqlToQuery(buildContactsFilterSql(clauses));
    const sqlText = query.sql;

    const orIdx = sqlText.indexOf(' OR ');
    const andIdx = sqlText.indexOf(' AND ');
    expect(orIdx).toBeGreaterThan(-1);
    expect(andIdx).toBeGreaterThan(-1);
    // OR 가 AND 보다 먼저 나타나고(좌→우), 그 사이에 닫는 괄호가 있어
    // (A OR B) 가 하나의 그룹으로 닫힌 뒤 AND C 와 결합됨을 검증한다.
    expect(orIdx).toBeLessThan(andIdx);
    expect(sqlText.slice(orIdx, andIdx)).toContain(')');
    // 전체가 외부 괄호 하나로 묶여 호출자 and() 결합 시 가지 탈출이 없어야 한다.
    expect(hasTokenOutsideOuterParens(sqlText)).toBe(false);
  });

  it('순수 OR 체인 전체를 외부 괄호로 감싼다 — 호출자 and() 결합 시 OR 가지 탈출 방지', () => {
    const clauses: FilterClause[] = [
      textClause('a', '1', null),
      textClause('b', '2', 'OR'),
      textClause('c', '3', 'OR'),
    ];
    const query = dialect.sqlToQuery(buildContactsFilterSql(clauses));
    const trimmed = query.sql.trim();
    expect(trimmed.startsWith('(')).toBe(true);
    expect(trimmed.endsWith(')')).toBe(true);
    // 최상위 OR 가 외부 괄호 밖으로 노출되면 surveyId 제약을 탈출한다 — 노출 0 이어야 한다.
    expect(hasTokenOutsideOuterParens(trimmed)).toBe(false);
  });
});
