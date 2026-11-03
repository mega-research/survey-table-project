import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import {
  FILTER_NONE_VALUE,
  FILTER_NOT_NONE_VALUE,
  HEADER_FILTER_VALUE_SEPARATOR as SEP,
} from '@/lib/operations/filter-shared';

import {
  PROFILES_EXTRA_CANDIDATES,
  type ProfilesClauseCols,
  buildProfilesFilterSql,
  parseProfilesClausesFromUrl,
  parseProfilesHeaderFiltersFromUrl,
} from './profiles-filters';
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
  entryParams: sql`"numbered"."entry_params"`,
  answers: sql`"numbered"."question_responses"`,
};

/** 응답값 열이 보이는 설문 — 페이지가 표시 중이고 암호화 저장이 아닌 응답값 열만 후보로 올린다. */
const COMPANY = 'answer.q-1.cell-company';
const OPINION = 'answer.q-2';
const answerCandidates: ColumnCandidate[] = [
  ...candidates,
  { source: COMPANY, label: '(1) 기업명' },
  { source: OPINION, label: '의견' },
  { source: 'answer.q-3', label: '숨긴 열', hidden: true },
];

/** 이어 넘길 값 열이 보이는 설문 — 페이지가 표시 중인 entry 열을 후보로 올린다. */
const entryCandidates: ColumnCandidate[] = [
  ...candidates,
  { source: 'entry.euid', label: 'euid' },
  { source: 'entry.pid', label: 'pid', hidden: true },
];

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

  it('전체 전개에 보이는 이어 넘길 값 열만 부분일치로 들어간다', () => {
    const clauses = parseProfilesClausesFromUrl(
      'system.all',
      '68e901de',
      undefined,
      entryCandidates,
    );
    const subs = clauses[0]?.condition.subConditions ?? [];
    expect(subs).toContainEqual({ source: 'entry.euid', mode: 'text', value: '68e901de' });
    expect(subs.some((s) => s.source === 'entry.pid')).toBe(false);
    const plain = parseProfilesClausesFromUrl('system.all', '68e901de', undefined, candidates);
    expect(
      (plain[0]?.condition.subConditions ?? []).some((s) => s.source.startsWith('entry.')),
    ).toBe(false);
  });

  it('이어 넘길 값 열을 골라 찾으면 부분일치 절 — 후보에 없거나 숨긴 열은 버린다', () => {
    const clauses = parseProfilesClausesFromUrl(
      'entry.euid',
      ' 59431873 ',
      undefined,
      entryCandidates,
    );
    expect(clauses[0]?.condition).toEqual({
      source: 'entry.euid',
      mode: 'text',
      value: '59431873',
    });
    expect(parseProfilesClausesFromUrl('entry.pid', 'x', undefined, entryCandidates)).toEqual([]);
    expect(parseProfilesClausesFromUrl('entry.euid', 'x', undefined, candidates)).toEqual([]);
  });
});

describe('응답값 열 검색', () => {
  it('검색바에서 응답값 열을 골라 찾으면 부분일치 절 — 후보에 없거나 숨긴 열은 버린다', () => {
    const clauses = parseProfilesClausesFromUrl(COMPANY, ' 메가 ', undefined, answerCandidates);
    expect(clauses[0]?.condition).toEqual({ source: COMPANY, mode: 'text', value: '메가' });
    expect(parseProfilesClausesFromUrl('answer.q-3', 'x', undefined, answerCandidates)).toEqual([]);
    expect(parseProfilesClausesFromUrl(COMPANY, 'x', undefined, candidates)).toEqual([]);
  });

  it('전체 검색에 보이는 응답값 열이 부분일치로 들어간다', () => {
    const clauses = parseProfilesClausesFromUrl('system.all', '메가', undefined, answerCandidates);
    const subs = clauses[0]?.condition.subConditions ?? [];
    expect(subs).toContainEqual({ source: COMPANY, mode: 'text', value: '메가' });
    expect(subs).toContainEqual({ source: OPINION, mode: 'text', value: '메가' });
    expect(subs.some((s) => s.source === 'answer.q-3')).toBe(false);
  });

  it('헤더 깔때기는 부분일치와 값 없음·값 있음 토글을 받는다', () => {
    expect(
      parseProfilesHeaderFiltersFromUrl(COMPANY, 'text', '메가', answerCandidates)[0]?.condition,
    ).toEqual({ source: COMPANY, mode: 'text', value: '메가' });
    expect(
      parseProfilesHeaderFiltersFromUrl(COMPANY, 'in', FILTER_NONE_VALUE, answerCandidates)[0]
        ?.condition,
    ).toMatchObject({ mode: 'in', includeNull: true });
    expect(
      parseProfilesHeaderFiltersFromUrl(COMPANY, 'in', FILTER_NOT_NONE_VALUE, answerCandidates)[0]
        ?.condition,
    ).toMatchObject({ mode: 'in', excludeNull: true });
    expect(parseProfilesHeaderFiltersFromUrl(COMPANY, 'in', 'A', answerCandidates)).toEqual([]);
  });

  it('표 칸은 문항 -> 칸 글자, 문항 전체는 문항 글자를 본다', () => {
    const cell = dialect.sqlToQuery(
      buildProfilesFilterSql(
        parseProfilesClausesFromUrl(COMPANY, '메가_리서치', undefined, answerCandidates),
        COLS,
      ),
    );
    expect(cell.sql).toContain('("numbered"."question_responses" -> $1 ->> $2) ILIKE');
    expect(cell.params).toEqual(['q-1', 'cell-company', '메가\\_리서치']);

    const whole = dialect.sqlToQuery(
      buildProfilesFilterSql(
        parseProfilesHeaderFiltersFromUrl(OPINION, 'in', FILTER_NONE_VALUE, answerCandidates),
        COLS,
      ),
    );
    expect(whole.sql).toContain(
      `COALESCE(btrim(("numbered"."question_responses" ->> $1)), '') = ''`,
    );
  });
});

// 보기 열(성별·복수 선택·표 선택 칸)은 저장값이 번호라 보기 글자로 거른다 — 글자에 검색어가 든 보기들의
// 저장값으로 바꿔 JSONB 안 문자열 값과 맞춘다(2026-10-30).
describe('buildProfilesFilterSql — 보기 열', () => {
  const GENDER = 'answer.q-g';
  const choiceCandidates: ColumnCandidate[] = [...candidates, { source: GENDER, label: '성별' }];
  const choices = new Map([
    [GENDER, [
      { id: 'o1', value: '1', label: '① 남성' },
      { id: 'o2', value: '2', label: '② 여성' },
    ]],
  ]);
  const build = (clauses: Parameters<typeof buildProfilesFilterSql>[0]) =>
    dialect.sqlToQuery(buildProfilesFilterSql(clauses, COLS, choices));

  it('보기 글자로 맞춰 그 보기들의 저장값을 JSONB 안 문자열 값과 비교한다', () => {
    const q = build(parseProfilesClausesFromUrl(GENDER, '성', undefined, choiceCandidates));
    expect(q.sql).toContain(`jsonb_path_query(("numbered"."question_responses" -> $1), 'lax $.**')`);
    expect(q.sql).toContain("jsonb_typeof(v) = 'string'");
    expect(q.params).toEqual(['q-g', '1', '2']);
  });

  it('맞는 보기가 없으면 0건 — 저장값 번호로는 걸리지 않는다', () => {
    expect(build(parseProfilesClausesFromUrl(GENDER, '1', undefined, choiceCandidates)).sql).toContain('FALSE');
  });

  it('값 없음/있음은 문자열 값이 하나라도 있는가로 본다(배열·그룹 맵 포함)', () => {
    const none = build(parseProfilesHeaderFiltersFromUrl(GENDER, 'in', FILTER_NONE_VALUE, choiceCandidates));
    expect(none.sql).toContain('NOT EXISTS');
    const some = build(parseProfilesHeaderFiltersFromUrl(GENDER, 'in', FILTER_NOT_NONE_VALUE, choiceCandidates));
    expect(some.sql).not.toContain('NOT EXISTS');
    expect(some.sql).toContain('EXISTS');
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
    const attrs = parseProfilesHeaderFiltersFromUrl('attrs.전시회명', 'in', `A${SEP}B`, candidates);
    expect(attrs[0]?.condition).toMatchObject({ mode: 'in', values: ['A', 'B'] });
  });
});

describe('buildProfilesFilterSql — 응답 내역 절 SQL', () => {
  it('이어 넘길 값 절은 entryParams jsonb 의 이름 칸을 부분일치로 본다', () => {
    const clauses = parseProfilesClausesFromUrl(
      'entry.euid',
      '5943_1873',
      undefined,
      entryCandidates,
    );
    const query = dialect.sqlToQuery(buildProfilesFilterSql(clauses, COLS));
    expect(query.sql).toContain('"numbered"."entry_params"->>$1 ILIKE');
    expect(query.params).toEqual(['euid', '5943\\_1873']);
  });

  it('idx/browser/status 는 numbered 컬럼 참조로 렌더된다', () => {
    const clauses = [
      ...parseProfilesClausesFromUrl(
        ['idx', 'browser'],
        ['1-5', 'Chrome'],
        ['', 'AND'],
        candidates,
      ),
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
