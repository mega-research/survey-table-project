import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

import { buildContactsFilterSql } from '@/lib/operations/contacts-filter-sql.server';
import type { FilterClause } from '@/lib/operations/filter-shared';
import { describeIdListValue } from '@/lib/operations/id-list-paste';
import { parseParityKeyword } from '@/lib/operations/range-list';

const dialect = new PgDialect();

describe('parseParityKeyword — 입력이 그 한 단어일 때만 키워드', () => {
  it('짝수·홀수 한 단어', () => {
    expect(parseParityKeyword('짝수')).toBe('even');
    expect(parseParityKeyword(' 홀수 ')).toBe('odd');
  });

  it('다른 토큰과 섞이면 키워드가 아니다', () => {
    expect(parseParityKeyword('짝수 1-10')).toBeNull();
    expect(parseParityKeyword('짝수,홀수')).toBeNull();
    expect(parseParityKeyword('짝')).toBeNull();
    expect(parseParityKeyword('')).toBeNull();
  });
});

describe('홀짝 조건 SQL', () => {
  it('시스템ID 짝수는 resid 나머지 0', () => {
    const clause: FilterClause = {
      op: null,
      condition: { source: 'system.resid', mode: 'idlist', value: '짝수', ranges: [], parity: 'even' },
    };
    const q = dialect.sqlToQuery(buildContactsFilterSql([clause]));
    expect(q.sql).toContain('"contact_targets".resid % 2');
    expect(q.params).toContain(0);
  });

  it('명단 열 홀수는 값 전체가 숫자인 행만 정수로 읽어 판정한다', () => {
    const clause: FilterClause = {
      op: null,
      condition: { source: 'attrs.명단ID', mode: 'idlist', value: '홀수', ranges: [], parity: 'odd' },
    };
    const q = dialect.sqlToQuery(buildContactsFilterSql([clause]));
    expect(q.sql).toContain("~ '^[0-9]+$'");
    expect(q.sql).toContain('::numeric');
    expect(q.sql).toContain('% 2');
    expect(q.params).toContain(1);
  });
});

describe('describeIdListValue — 홀짝 상태', () => {
  it('시스템ID·명단 열의 짝수/홀수 한 단어', () => {
    expect(describeIdListValue('system.resid', '짝수')).toEqual({ kind: 'parity', parity: 'even' });
    expect(describeIdListValue('attrs.명단ID', '홀수')).toEqual({ kind: 'parity', parity: 'odd' });
  });

  it('섞이면 종전 규칙 — 시스템ID 는 무효 토큰', () => {
    expect(describeIdListValue('system.resid', '짝수 1-10').kind).toBe('invalid');
  });
});
