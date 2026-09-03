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

import { sortRowsForContactPopulation } from '@/lib/analytics/raw-export-rows';
import {
  MAX_EXPORT_RESPONSES,
  countRawExportPopulation,
  loadRawExportRows,
} from '@/lib/analytics/raw-export-rows.server';
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
