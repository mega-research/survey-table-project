import { describe, expect, it } from 'vitest';

import { FILTER_NONE_VALUE, type ColumnCandidateWithPii } from '@/lib/operations/filter-shared';

import {
  contactFilterInputFromUrl,
  resolveContactFilterWith,
  type ContactFilterContext,
} from './contact-filter-resolution';

const A1 = '11111111-1111-4111-8111-111111111111';
const GONE = '99999999-9999-4999-8999-999999999999';
const LIST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const CANDIDATES: ColumnCandidateWithPii[] = [
  { source: 'system.all', label: '전체' },
  { source: 'system.resid', label: '시스템ID' },
  { source: 'system.contact_owner', label: '컨택원' },
  { source: 'attrs.기업명', label: '기업명' },
];

function ctx(over: Partial<Omit<ContactFilterContext, never>> = {}): ContactFilterContext {
  return {
    surveyId: 's1',
    scheme: null,
    columnCandidates: CANDIDATES,
    headerCandidates: CANDIDATES,
    resultCodes: [],
    assignmentOptions: [{ id: A1, name: '10차', order: 1 }],
    isExternal: false,
    ...over,
  } as ContactFilterContext;
}

const NO_LISTS = new Map<string, number[]>();

describe('조사 대상 필터 해석 — 컨택원 조건', () => {
  it('이 파티션 컨택원이면 그 컨택원 절, 배정 없음은 NULL 절이다', () => {
    const r = resolveContactFilterWith(
      ctx(),
      {
        clauses: [
          { source: 'system.contact_owner', value: A1, op: null },
          { source: 'system.contact_owner', value: FILTER_NONE_VALUE, op: 'OR' },
        ],
      },
      NO_LISTS,
      'read',
    );
    expect(r.clauses).toEqual([
      { op: null, condition: { source: 'system.contact_owner', mode: 'enum', value: A1 } },
      {
        op: 'OR',
        condition: {
          source: 'system.contact_owner',
          mode: 'enum',
          value: FILTER_NONE_VALUE,
          includeNull: true,
        },
      },
    ]);
    expect(r.unresolved).toEqual([]);
  });

  it('지워진 컨택원은 읽기에서 버려지고 해석 안 되는 조건으로 적힌다', () => {
    const r = resolveContactFilterWith(
      ctx(),
      {
        clauses: [
          { source: 'attrs.기업명', value: '가', op: null },
          { source: 'system.contact_owner', value: GONE, op: 'AND' },
        ],
      },
      NO_LISTS,
      'read',
    );
    expect(r.clauses).toEqual([
      { op: null, condition: { source: 'attrs.기업명', mode: 'text', value: '가' } },
    ]);
    expect(r.unresolved).toEqual([{ part: 'clause', index: 1, reason: 'unparseable' }]);
  });

  it('쓰기는 지워진 컨택원을 몇 번째 조건인지 담아 거부한다', () => {
    expect(() =>
      resolveContactFilterWith(
        ctx(),
        {
          clauses: [
            { source: 'attrs.기업명', value: '가', op: null },
            { source: 'system.contact_owner', value: GONE, op: 'AND' },
          ],
        },
        NO_LISTS,
        'write',
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'BAD_REQUEST',
        message: expect.stringContaining('조건 2을(를) 지금 적용할 수 없습니다'),
      }),
    );
  });

  it('게스트에게는 컨택원 절을 만들지 않는다 — 후보에 열이 남아 있어도 같다', () => {
    const r = resolveContactFilterWith(
      ctx({ isExternal: true, assignmentOptions: [] }),
      {
        clauses: [{ source: 'system.contact_owner', value: FILTER_NONE_VALUE, op: null }],
        headerClauses: [{ source: 'system.contact_owner', mode: 'in', hv: A1 }],
      },
      NO_LISTS,
      'read',
    );
    expect(r.clauses).toEqual([]);
    expect(r.unresolved).toEqual([
      { part: 'clause', index: 0, reason: 'unparseable' },
      { part: 'header', index: 0, reason: 'unparseable' },
    ]);
  });

  it('열 머리 필터의 지워진 컨택원은 쓰기에서 열 머리 필터로 지칭해 거부한다', () => {
    expect(() =>
      resolveContactFilterWith(
        ctx(),
        { headerClauses: [{ source: 'system.contact_owner', mode: 'in', hv: GONE }] },
        NO_LISTS,
        'write',
      ),
    ).toThrow(expect.objectContaining({ message: expect.stringContaining('열 머리 필터 1') }));
  });
});

describe('조사 대상 필터 해석 — 저장된 ID 목록', () => {
  it('읽은 목록은 그 ID 들의 절이다', () => {
    const r = resolveContactFilterWith(
      ctx(),
      { clauses: [{ source: 'system.resid', value: `list:${LIST}:3`, op: null }] },
      new Map([[LIST, [3, 5]]]),
      'read',
    );
    expect(r.clauses[0]?.condition).toMatchObject({
      mode: 'idlist',
      ranges: [
        { from: 3, to: 3 },
        { from: 5, to: 5 },
      ],
    });
    expect(r.unresolved).toEqual([]);
  });

  it('읽지 못한 목록은 읽기에서 버리지 않고 0건 조건으로 남긴다', () => {
    const r = resolveContactFilterWith(
      ctx(),
      { clauses: [{ source: 'attrs.기업명', value: `list:${LIST}:3000`, op: null }] },
      NO_LISTS,
      'read',
    );
    expect(r.clauses).toHaveLength(1);
    expect(r.clauses[0]?.condition).toMatchObject({ mode: 'idlist', ranges: [] });
    expect(r.unresolved).toEqual([{ part: 'clause', index: 0, reason: 'id_list_missing' }]);
  });

  it('쓰기는 읽지 못한 목록을 거부한다', () => {
    expect(() =>
      resolveContactFilterWith(
        ctx(),
        { clauses: [{ source: 'system.resid', value: `list:${LIST}:3000`, op: null }] },
        NO_LISTS,
        'write',
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'BAD_REQUEST',
        message: expect.stringContaining('저장된 ID 목록을 찾을 수 없습니다'),
      }),
    );
  });
});

describe('조사 대상 필터 해석 — 후보와 합치기', () => {
  it('후보에 없는 열은 해석 안 되는 조건이고, 값이 빈 조건 줄은 세지 않는다', () => {
    const r = resolveContactFilterWith(
      ctx(),
      {
        clauses: [
          { source: 'attrs.없는열', value: '가', op: null },
          { source: 'attrs.기업명', value: '  ', op: 'AND' },
        ],
      },
      NO_LISTS,
      'read',
    );
    expect(r.clauses).toEqual([]);
    expect(r.unresolved).toEqual([{ part: 'clause', index: 0, reason: 'unparseable' }]);
  });

  it('앞 조건이 버려지면 다음 조건이 첫 절이 된다(op=null)', () => {
    const r = resolveContactFilterWith(
      ctx(),
      {
        clauses: [
          { source: 'attrs.없는열', value: '가', op: null },
          { source: 'attrs.기업명', value: '나', op: 'OR' },
        ],
      },
      NO_LISTS,
      'read',
    );
    expect(r.clauses.map((c) => c.op)).toEqual([null]);
  });

  it('검색바와 열 머리 필터가 함께 오면 AND 로 잇는다', () => {
    const r = resolveContactFilterWith(
      ctx(),
      {
        clauses: [{ source: 'attrs.기업명', value: '가', op: null }],
        headerClauses: [{ source: 'system.contact_owner', mode: 'in', hv: A1 }],
      },
      NO_LISTS,
      'read',
    );
    expect(r.clauses.map((c) => [c.op, c.condition.source])).toEqual([
      [null, 'attrs.기업명'],
      ['AND', 'system.contact_owner'],
    ]);
    expect(r.builderClauses).toHaveLength(1);
    expect(r.headerClauses).toHaveLength(1);
  });

  it('열 머리 필터만 있으면 첫 절이 op=null 이다', () => {
    const r = resolveContactFilterWith(
      ctx(),
      { headerClauses: [{ source: 'system.contact_owner', mode: 'in', hv: A1 }] },
      NO_LISTS,
      'read',
    );
    expect(r.clauses.map((c) => c.op)).toEqual([null]);
  });

  it('열 머리 필터는 열 머리 후보로 검증한다 — 단체 메일 고정 열', () => {
    const mail = ctx({
      columnCandidates: CANDIDATES,
      headerCandidates: [...CANDIDATES, { source: 'system.web', label: '응답' }],
    });
    const r = resolveContactFilterWith(
      mail,
      { headerClauses: [{ source: 'system.web', mode: 'in', hv: 'completed' }] },
      NO_LISTS,
      'read',
    );
    expect(r.clauses).toHaveLength(1);
    expect(r.unresolved).toEqual([]);
  });
});

describe('contactFilterInputFromUrl', () => {
  it('평행 배열을 짧은 쪽 기준으로 묶는다', () => {
    expect(
      contactFilterInputFromUrl({
        col: ['attrs.기업명', 'system.resid'],
        q: ['가'],
        op: [],
        hcol: 'system.web',
        hm: ['in', 'text'],
        hv: 'completed',
      }),
    ).toEqual({
      clauses: [{ source: 'attrs.기업명', value: '가', op: '' }],
      headerClauses: [{ source: 'system.web', mode: 'in', hv: 'completed' }],
    });
  });
});
