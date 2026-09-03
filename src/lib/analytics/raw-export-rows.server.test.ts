import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Raw 내보내기 로더의 SQL 경계 — 토글이 꺼지면 도입 전과 같은 쿼리만 나가고,
// 켜지면 미응답 조사 대상 count·조회가 스코프 파티션 안에서만 붙는지 본다.
// test-mode-boundaries 와 같은 모양으로 db 체인을 가짜로 두고 where 를 캡처한다.

interface SelectCall {
  where: unknown;
  orderBy: unknown[] | null;
}

const { state, responseFindManyMock } = vi.hoisted(() => ({
  state: {
    calls: [] as SelectCall[],
    resolve: null as null | ((call: SelectCall) => unknown[]),
  },
  responseFindManyMock: vi.fn(),
}));

vi.mock('@/db', () => ({
  db: {
    query: { surveyResponses: { findMany: responseFindManyMock } },
    select: vi.fn(() => {
      const call: SelectCall = { where: undefined, orderBy: null };
      const settle = () => Promise.resolve(state.resolve?.(call) ?? [{ total: 0 }]);
      const afterWhere = {
        orderBy: (...args: unknown[]) => {
          call.orderBy = args;
          return settle();
        },
        then: (
          onFulfilled?: (value: unknown[]) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) => settle().then(onFulfilled, onRejected),
      };
      const chain = {
        from: () => chain,
        where: (where: unknown) => {
          call.where = where;
          state.calls.push(call);
          return afterWhere;
        },
      };
      return chain;
    }),
  },
}));

// 정렬 함수 호출 여부를 세기 위해 원본 구현을 유지한 채 스파이만 씌운다.
vi.mock('@/lib/analytics/raw-export-rows', { spy: true });

// PII 복호화는 contact_pii 를 직접 읽으므로 가짜 db 체인에 태우지 않고 호출 횟수·인자만 본다.
vi.mock('@/lib/operations/contacts-export.server', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/operations/contacts-export.server')>();
  return { ...actual, decryptPiiForExport: vi.fn(async () => new Map()) };
});

import { db } from '@/db';
import { sortRowsForContactPopulation } from '@/lib/analytics/raw-export-rows';
import {
  MAX_EXPORT_RESPONSES,
  countRawExportPopulation,
  loadRawExportRows,
} from '@/lib/analytics/raw-export-rows.server';
import type { RawExportContactColumn } from '@/lib/operations/contacts';
import { decryptPiiForExport } from '@/lib/operations/contacts-export.server';
import { NOT_RESPONDED_STATUS } from '@/lib/operations/profiles';

const dialect = new PgDialect();
const surveyId = 'survey-loader';

function render(value: unknown): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(value as never);
}

type SelectKind = 'responseCount' | 'nonRespondentCount' | 'contactsById' | 'nonRespondentTargets';

function classify(call: SelectCall): SelectKind {
  const { sql } = render(call.where);
  if (sql.includes('not exists')) return call.orderBy ? 'nonRespondentTargets' : 'nonRespondentCount';
  if (sql.includes(' in (')) return 'contactsById';
  return 'responseCount';
}

function kinds(): SelectKind[] {
  return state.calls.map(classify);
}

function responseRow(over: Record<string, unknown>) {
  return {
    id: 'r',
    contactTargetId: null,
    questionResponses: { q1: 'opt1' },
    ipHash: 'hash',
    currentStepId: null,
    platform: 'desktop',
    browser: 'Chrome',
    status: 'completed',
    startedAt: new Date('2026-09-01T09:00:00Z'),
    completedAt: null,
    totalSeconds: 60,
    ...over,
  };
}

const nonRespondentTargets = [
  { id: 't1', resid: 1, groupValue: 'A', inviteCode: 'c1' },
  { id: 't3', resid: 3, groupValue: null, inviteCode: 'c3' },
];

function useCounts(counts: { responses: number; nonRespondents: number }) {
  state.resolve = (call) => {
    switch (classify(call)) {
      case 'responseCount':
        return [{ total: counts.responses }];
      case 'nonRespondentCount':
        return [{ total: counts.nonRespondents }];
      case 'contactsById':
        return [
          { id: 'ct2', resid: 2, groupValue: 'B', inviteCode: 'c2' },
          { id: 'ct4', resid: 4, groupValue: null, inviteCode: 'c4' },
        ];
      case 'nonRespondentTargets':
        return nonRespondentTargets;
    }
  };
}

beforeEach(() => {
  state.calls.length = 0;
  state.resolve = null;
  responseFindManyMock.mockReset();
  responseFindManyMock.mockResolvedValue([]);
  vi.mocked(sortRowsForContactPopulation).mockClear();
  vi.mocked(db.select).mockClear();
  vi.mocked(decryptPiiForExport).mockReset();
  vi.mocked(decryptPiiForExport).mockResolvedValue(new Map());
});

describe('loadRawExportRows — 토글 꺼짐', () => {
  it('select 는 응답 count 1회뿐이고 not exists 술어가 없다', async () => {
    const result = await loadRawExportRows(surveyId, 'real', { includeNonRespondents: false });
    expect(result).toEqual({ kind: 'ok', rows: [], responseCount: 0, nonRespondentCount: 0 });
    expect(kinds()).toEqual(['responseCount']);
    for (const call of state.calls) expect(render(call.where).sql).not.toContain('not exists');
  });

  it('응답에 컨택이 있으면 inArray 조회 1회가 더 붙을 뿐이다', async () => {
    useCounts({ responses: 2, nonRespondents: 99 });
    responseFindManyMock.mockResolvedValue([
      responseRow({ id: 'r1', contactTargetId: 'ct2' }),
      responseRow({ id: 'r2', contactTargetId: 'ct4', status: 'in_progress' }),
    ]);
    const result = await loadRawExportRows(surveyId, 'real', { includeNonRespondents: false });
    expect(kinds()).toEqual(['responseCount', 'contactsById']);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.rows.map((r) => [r.id, r.resid, r.groupValue, r.inviteCode])).toEqual([
      ['r1', 2, 'B', 'c2'],
      ['r2', 4, null, 'c4'],
    ]);
    expect(result.nonRespondentCount).toBe(0);
  });

  it('findMany 는 startedAt 오름차순이고 반환 순서가 그대로 파일 순서다', async () => {
    useCounts({ responses: 3, nonRespondents: 0 });
    responseFindManyMock.mockResolvedValue([
      responseRow({ id: 'late', startedAt: new Date('2026-09-01T09:05:00Z') }),
      responseRow({ id: 'early', startedAt: new Date('2026-09-01T09:00:00Z') }),
    ]);
    const result = await loadRawExportRows(surveyId, 'real', { includeNonRespondents: false });

    const options = responseFindManyMock.mock.calls[0]![0] as {
      orderBy: (columns: { startedAt: unknown }, ops: { asc: (col: unknown) => unknown }) => unknown;
    };
    const asc = (col: unknown) => ({ col, dir: 'asc' as const });
    expect(options.orderBy({ startedAt: 'STARTED_AT' }, { asc })).toEqual([
      { col: 'STARTED_AT', dir: 'asc' },
    ]);

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.rows.map((r) => r.id)).toEqual(['late', 'early']);
    expect(sortRowsForContactPopulation).not.toHaveBeenCalled();
  });
});

describe('loadRawExportRows — 토글 켜짐', () => {
  it('count 2회 뒤 미응답 조사 대상을 조회해 시스템ID 순으로 합친다', async () => {
    useCounts({ responses: 4, nonRespondents: 2 });
    responseFindManyMock.mockResolvedValue([
      responseRow({ id: 'r1', contactTargetId: 'ct2', startedAt: new Date('2026-09-01T09:00:00Z') }),
      responseRow({ id: 'r4', startedAt: new Date('2026-09-01T09:01:00Z') }),
      responseRow({ id: 'r3', startedAt: new Date('2026-09-01T09:02:00Z') }),
      responseRow({ id: 'r2', contactTargetId: 'ct4', startedAt: new Date('2026-09-01T09:05:00Z') }),
    ]);

    const result = await loadRawExportRows(surveyId, 'real', { includeNonRespondents: true });

    expect(kinds()).toEqual([
      'responseCount',
      'nonRespondentCount',
      'contactsById',
      'nonRespondentTargets',
    ]);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.responseCount).toBe(4);
    expect(result.nonRespondentCount).toBe(2);
    expect(result.rows).toHaveLength(6);
    expect(result.rows.filter((r) => r.status === NOT_RESPONDED_STATUS)).toHaveLength(2);
    expect(result.rows.map((r) => r.id)).toEqual(['t1', 'r1', 't3', 'r2', 'r4', 'r3']);
    expect(sortRowsForContactPopulation).toHaveBeenCalledTimes(1);

    const targets = state.calls[3]!;
    expect(render(targets.orderBy![0]).sql).toBe('"contact_targets"."resid" asc');
  });

  it.each([
    ['real', false, true],
    ['test', true, false],
  ] as const)(
    '미응답 술어는 %s 스코프 파티션의 raw 모수에 응답이 없는 조사 대상만 잡는다',
    async (scope, expected, forbidden) => {
      useCounts({ responses: 0, nonRespondents: 0 });
      await loadRawExportRows(surveyId, scope, { includeNonRespondents: true });

      const nonRespondent = state.calls.find((c) => classify(c) === 'nonRespondentCount');
      expect(nonRespondent).toBeDefined();
      const { sql, params } = render(nonRespondent!.where);
      expect(sql).toContain('not exists');
      expect(sql).toContain('contact_target_id');
      expect(sql).toContain('deleted_at');
      expect(sql).toContain('is_test');
      expect(params).toContain(expected);
      expect(params).not.toContain(forbidden);
    },
  );
});

describe('loadRawExportRows — 한도 가드', () => {
  it('응답 9,999 + 미응답 2 는 켜짐일 때만 too_many 이고 findMany 를 부르지 않는다', async () => {
    useCounts({ responses: MAX_EXPORT_RESPONSES - 1, nonRespondents: 2 });

    const on = await loadRawExportRows(surveyId, 'real', { includeNonRespondents: true });
    expect(on).toEqual({
      kind: 'too_many',
      responseCount: MAX_EXPORT_RESPONSES - 1,
      nonRespondentCount: 2,
    });
    expect(responseFindManyMock).not.toHaveBeenCalled();

    state.calls.length = 0;
    const off = await loadRawExportRows(surveyId, 'real', { includeNonRespondents: false });
    expect(off.kind).toBe('ok');
    expect(kinds()).toEqual(['responseCount']);
  });

  it('합이 정확히 한도면 통과한다', async () => {
    useCounts({ responses: MAX_EXPORT_RESPONSES - 2, nonRespondents: 2 });
    const result = await loadRawExportRows(surveyId, 'real', { includeNonRespondents: true });
    expect(result.kind).toBe('ok');
  });
});

describe('countRawExportPopulation', () => {
  it('꺼짐이면 응답 count 만 하고 미응답은 0 이다', async () => {
    useCounts({ responses: 7, nonRespondents: 3 });
    const result = await countRawExportPopulation(surveyId, 'real', { includeNonRespondents: false });
    expect(result).toEqual({ responseCount: 7, nonRespondentCount: 0 });
    expect(kinds()).toEqual(['responseCount']);
  });

  it('켜짐이면 두 count 를 돌려준다', async () => {
    useCounts({ responses: 7, nonRespondents: 3 });
    const result = await countRawExportPopulation(surveyId, 'test', { includeNonRespondents: true });
    expect(result).toEqual({ responseCount: 7, nonRespondentCount: 3 });
    expect(kinds()).toEqual(['responseCount', 'nonRespondentCount']);
  });
});

describe('loadRawExportRows — 조사 대상 명단 열', () => {
  const rosterColumns: RawExportContactColumn[] = [
    { source: 'attrs.기수', label: '기수', kind: 'attrs', key: '기수' },
    { source: 'pii.성명', label: '성명', kind: 'pii', key: '성명' },
  ];
  const attrsOnly: RawExportContactColumn[] = [rosterColumns[0]!];

  /** select() 에 넘긴 필드 객체 — state.calls 와 같은 순서로 기록된다 (모든 select 가 where 까지 간다). */
  function selectFields(kind: SelectKind): Record<string, unknown> | undefined {
    const idx = state.calls.findIndex((c) => classify(c) === kind);
    if (idx < 0) return undefined;
    return vi.mocked(db.select).mock.calls[idx]![0] as Record<string, unknown>;
  }

  function useRoster(opts: { withAttrs: boolean }) {
    const attrs = (v: Record<string, string>) => (opts.withAttrs ? { attrs: v } : {});
    state.resolve = (call) => {
      switch (classify(call)) {
        case 'responseCount':
          return [{ total: 3 }];
        case 'nonRespondentCount':
          return [{ total: 1 }];
        case 'contactsById':
          return [
            { id: 't1', resid: 1, groupValue: 'A', inviteCode: 'c1', ...attrs({ 기수: '15기' }) },
            { id: 't2', resid: 2, groupValue: null, inviteCode: 'c2', ...attrs({}) },
          ];
        case 'nonRespondentTargets':
          return [
            {
              id: 't3',
              resid: 3,
              groupValue: null,
              inviteCode: 'c3',
              ...attrs({ 기수: '16기', 스킴에없는키: 'x' }),
            },
          ];
      }
    };
  }

  const threeResponses = () => [
    responseRow({ id: 'r1', contactTargetId: 't1' }),
    responseRow({ id: 'r2', contactTargetId: 't2' }),
    responseRow({ id: 'r-anon' }),
  ];

  it('attrs 는 컨택 조회에 실리고 pii 는 한 번에 복호화돼 행마다 contactValues 가 붙는다', async () => {
    useRoster({ withAttrs: true });
    responseFindManyMock.mockResolvedValue(threeResponses());
    vi.mocked(decryptPiiForExport).mockResolvedValue(new Map([['t1', { 성명: '홍길동' }]]));

    const result = await loadRawExportRows(surveyId, 'real', {
      includeNonRespondents: true,
      contactColumns: rosterColumns,
    });

    expect(kinds()).toEqual([
      'responseCount',
      'nonRespondentCount',
      'contactsById',
      'nonRespondentTargets',
    ]);
    expect(selectFields('contactsById')).toHaveProperty('attrs');
    expect(selectFields('nonRespondentTargets')).toHaveProperty('attrs');

    expect(decryptPiiForExport).toHaveBeenCalledTimes(1);
    const [ids, keys] = vi.mocked(decryptPiiForExport).mock.calls[0]!;
    expect([...ids].sort()).toEqual(['t1', 't2', 't3']);
    expect(keys).toEqual(['성명']);

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const byId = new Map(result.rows.map((r) => [r.id, r]));
    expect(byId.get('r1')?.contactValues).toEqual({ 'attrs.기수': '15기', 'pii.성명': '홍길동' });
    // attrs 에 없는 키·piiMap 에 없는 컨택은 빈 문자열 — 컨택이 있다는 뜻으로 객체는 붙는다
    expect(byId.get('r2')?.contactValues).toEqual({ 'attrs.기수': '', 'pii.성명': '' });
    expect(byId.get('t3')?.contactValues).toEqual({ 'attrs.기수': '16기', 'pii.성명': '' });
    expect(byId.get('t3')?.status).toBe(NOT_RESPONDED_STATUS);
    // 익명 응답은 키 자체가 없다
    expect(byId.get('r-anon')).toBeDefined();
    expect('contactValues' in byId.get('r-anon')!).toBe(false);
  });

  it('pii 열이 없으면 복호화를 부르지 않는다', async () => {
    useRoster({ withAttrs: true });
    responseFindManyMock.mockResolvedValue(threeResponses());

    const result = await loadRawExportRows(surveyId, 'real', {
      includeNonRespondents: false,
      contactColumns: attrsOnly,
    });

    expect(decryptPiiForExport).not.toHaveBeenCalled();
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.rows.find((r) => r.id === 'r1')?.contactValues).toEqual({ 'attrs.기수': '15기' });
  });

  it('contactColumns 가 비면 attrs 를 select 하지 않고 복호화도 없으며 행에 키가 없다 — 꺼짐 = 기존', async () => {
    useRoster({ withAttrs: false });
    responseFindManyMock.mockResolvedValue(threeResponses());

    const result = await loadRawExportRows(surveyId, 'real', {
      includeNonRespondents: false,
      contactColumns: [],
    });

    expect(kinds()).toEqual(['responseCount', 'contactsById']);
    expect(selectFields('contactsById')).not.toHaveProperty('attrs');
    expect(decryptPiiForExport).not.toHaveBeenCalled();
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    for (const row of result.rows) expect('contactValues' in row).toBe(false);
  });

  it('응답이 10건이어도 컨택 조회와 복호화는 각 1회다 — N+1 없음', async () => {
    useRoster({ withAttrs: true });
    responseFindManyMock.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) =>
        responseRow({ id: `r${i}`, contactTargetId: i % 2 === 0 ? 't1' : 't2' }),
      ),
    );

    const result = await loadRawExportRows(surveyId, 'real', {
      includeNonRespondents: false,
      contactColumns: rosterColumns,
    });

    expect(kinds()).toEqual(['responseCount', 'contactsById']);
    expect(decryptPiiForExport).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.rows).toHaveLength(10);
    expect(result.rows.every((r) => r.contactValues !== undefined)).toBe(true);
  });
});
