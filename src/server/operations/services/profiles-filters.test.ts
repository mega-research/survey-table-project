import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import {
  buildProfilesFilterSql,
  parseProfilesClausesFromUrl,
  parseProfilesHeaderFiltersFromUrl,
  PROFILES_EXTRA_CANDIDATES,
  type ProfilesClauseCols,
} from './profiles-filters';
import { HEADER_FILTER_VALUE_SEPARATOR as SEP } from '@/lib/operations/filter-shared';
import type { ColumnCandidate } from './progress-filters';

const candidates: ColumnCandidate[] = [
  ...PROFILES_EXTRA_CANDIDATES,
  { source: 'system.all', label: '전체' },
  { source: 'system.resid', label: '컨택번호' },
  { source: 'attrs.전시회명', label: '전시회명' },
  { source: 'pii.email', label: '이메일', piiType: 'email' },
];

const dialect = new PgDialect();

const COLS: ProfilesClauseCols = {
  idx: sql`"numbered"."idx"`,
  browser: sql`"numbered"."browser"`,
  status: sql`"numbered"."status"`,
  contactResid: sql`"numbered"."contact_resid"`,
  contactAttrs: sql`"numbered"."contact_attrs"`,
  contactTargetId: sql`"numbered"."contact_target_id"`,
};

describe('parseProfilesClausesFromUrl — 검색바 다중 조건', () => {
  it('col 없으면 빈 배열', () => {
    expect(parseProfilesClausesFromUrl(undefined, '5', undefined, candidates)).toEqual([]);
  });

  it('빈/공백 검색어는 절 미생성', () => {
    expect(parseProfilesClausesFromUrl('browser', '', undefined, candidates)).toEqual([]);
    expect(parseProfilesClausesFromUrl('browser', '   ', undefined, candidates)).toEqual([]);
  });

  it('idx 는 범위 리스트로 파싱된다', () => {
    const clauses = parseProfilesClausesFromUrl('idx', '1-20, 25', undefined, candidates);
    expect(clauses).toEqual([
      {
        op: null,
        condition: {
          source: 'idx',
          mode: 'idlist',
          value: '1-20, 25',
          ranges: [
            { from: 1, to: 20 },
            { from: 25, to: 25 },
          ],
        },
      },
    ]);
  });

  it('idx 비숫자 입력은 ranges=[] (SQL FALSE — 전체 노출 방지)', () => {
    const clauses = parseProfilesClausesFromUrl('idx', 'abc', undefined, candidates);
    expect(clauses[0]?.condition).toMatchObject({ source: 'idx', mode: 'idlist', ranges: [] });
  });

  it('browser 는 trim 된 부분검색', () => {
    const clauses = parseProfilesClausesFromUrl('browser', '  Chrome ', undefined, candidates);
    expect(clauses[0]?.condition).toEqual({ source: 'browser', mode: 'text', value: 'Chrome' });
  });

  it('resid / attrs / pii 는 공용 파서에 위임된다', () => {
    const resid = parseProfilesClausesFromUrl('system.resid', '1-3, 9', undefined, candidates);
    expect(resid[0]?.condition).toMatchObject({ source: 'system.resid', mode: 'idlist' });
    const attrs = parseProfilesClausesFromUrl('attrs.전시회명', '핵심', undefined, candidates);
    expect(attrs[0]?.condition).toEqual({ source: 'attrs.전시회명', mode: 'text', value: '핵심' });
    expect(parseProfilesClausesFromUrl('attrs.unknown', 'x', undefined, candidates)).toEqual([]);
  });

  it('다중 절 AND/OR — 첫 절은 항상 op=null', () => {
    const clauses = parseProfilesClausesFromUrl(
      ['browser', 'idx'],
      ['Chrome', '1-5'],
      ['', 'OR'],
      candidates,
    );
    expect(clauses.map((c) => c.op)).toEqual([null, 'OR']);
  });

  it('전체(system.all) 전개에 browser 부분일치가 포함된다', () => {
    const clauses = parseProfilesClausesFromUrl('system.all', '핵심', undefined, candidates);
    const subs = clauses[0]?.condition.subConditions ?? [];
    expect(subs.some((s) => s.source === 'attrs.전시회명' && s.mode === 'text')).toBe(true);
    expect(subs.some((s) => s.source === 'browser' && s.mode === 'text')).toBe(true);
  });
});

describe('parseProfilesHeaderFiltersFromUrl — 헤더 깔때기', () => {
  it('status in — 유효 상태만 통과, 어휘 외 값 필터링', () => {
    const result = parseProfilesHeaderFiltersFromUrl(
      'status',
      'in',
      `completed${SEP}drop${SEP}maybe`,
      candidates,
    );
    expect(result).toEqual([
      {
        op: null,
        condition: { source: 'status', mode: 'in', value: '', values: ['completed', 'drop'] },
      },
    ]);
  });

  it('attrs in / pii exact 는 공용 파서에 위임된다', () => {
    const attrs = parseProfilesHeaderFiltersFromUrl(
      'attrs.전시회명',
      'in',
      `A${SEP}B`,
      candidates,
    );
    expect(attrs[0]?.condition).toMatchObject({ mode: 'in', values: ['A', 'B'] });
  });
});

describe('buildProfilesFilterSql — 응답 내역 절 SQL', () => {
  it('idx/browser/status 는 numbered 컬럼 참조로 렌더된다', () => {
    const clauses = [
      ...parseProfilesClausesFromUrl(['idx', 'browser'], ['1-5', 'Chrome'], ['', 'AND'], candidates),
      {
        op: 'AND' as const,
        condition: { source: 'status', mode: 'in' as const, value: '', values: ['drop'] },
      },
    ];
    const query = dialect.sqlToQuery(buildProfilesFilterSql(clauses, COLS));
    expect(query.sql).toContain('"numbered"."idx" BETWEEN');
    expect(query.sql).toContain('"numbered"."browser" ILIKE');
    expect(query.sql).toContain('"numbered"."status" IN');
    expect(query.sql).not.toContain('contact_targets');
  });

  it('attrs/resid/pii 절은 컨택 LEFT JOIN 컬럼 참조로 렌더된다', () => {
    const clauses = parseProfilesClausesFromUrl(
      ['system.resid', 'attrs.전시회명'],
      ['1-3', '핵심'],
      ['', 'AND'],
      candidates,
    );
    const query = dialect.sqlToQuery(buildProfilesFilterSql(clauses, COLS));
    expect(query.sql).toContain('"numbered"."contact_resid"');
    expect(query.sql).toContain('"numbered"."contact_attrs"');
    expect(query.sql).not.toContain('"contact_targets".attrs');
  });
});
