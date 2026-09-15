import { describe, expect, it } from 'vitest';

import { buildChoiceGroupOutline, outlineBoxShadow } from '@/utils/choice-group-outline';
import type { TableRow } from '@/types/survey';

const cell = (id: string, groupId?: string, extra: Record<string, unknown> = {}) =>
  ({ id, type: 'choice_opt', content: '', ...(groupId ? { choiceGroupId: groupId } : {}), ...extra }) as never;

/** 한 행: [라벨] [g1 두 칸] [g2 세 칸] */
const rows: TableRow[] = [
  {
    id: 'r1',
    cells: [
      cell('label', undefined, { type: 'text' }),
      cell('a1', 'g1'),
      cell('a2', 'g1'),
      cell('b1', 'g2'),
      cell('b2', 'g2'),
      cell('b3', 'g2'),
    ],
  } as never,
];

describe('buildChoiceGroupOutline', () => {
  it('표시할 셀이 없으면 빈 결과', () => {
    expect(buildChoiceGroupOutline(rows, new Set()).size).toBe(0);
  });

  it('한 그룹을 덩어리로 묶어 바깥 변만 낸다', () => {
    const edges = buildChoiceGroupOutline(rows, new Set(['b1', 'b2', 'b3']));
    expect(edges.get('b1')).toEqual({ top: true, bottom: true, left: true, right: false });
    expect(edges.get('b2')).toEqual({ top: true, bottom: true, left: false, right: false });
    expect(edges.get('b3')).toEqual({ top: true, bottom: true, left: false, right: true });
    // 다른 그룹은 표시 대상이 아니다
    expect(edges.has('a1')).toBe(false);
  });

  it('그룹이 다르면 이웃이어도 덩어리가 갈린다', () => {
    const edges = buildChoiceGroupOutline(rows, new Set(['a1', 'a2', 'b1', 'b2', 'b3']));
    expect(edges.get('a2')?.right).toBe(true);
    expect(edges.get('b1')?.left).toBe(true);
  });

  it('한 칸짜리 그룹은 사방이 바깥이다', () => {
    const one: TableRow[] = [{ id: 'r', cells: [cell('x', 'g')] } as never];
    expect(buildChoiceGroupOutline(one, new Set(['x']))).toEqual(
      new Map([['x', { top: true, bottom: true, left: true, right: true }]]),
    );
  });

  /** 보이지 않는 칸이 이웃으로 세어지면 덩어리 중간에 선이 생긴다. */
  it('열 방향으로 선 그룹은 위아래로 이어 덩어리 하나가 된다', () => {
    // 열마다 하나씩 고르는 표: [라벨] [12월 기준=g1] [현재=g2] 가 세 행
    const columnRows: TableRow[] = [
      { id: 'r1', cells: [cell('l1', undefined, { type: 'text' }), cell('m1', 'g1'), cell('c1', 'g2')] },
      { id: 'r2', cells: [cell('l2', undefined, { type: 'text' }), cell('m2', 'g1'), cell('c2', 'g2')] },
      { id: 'r3', cells: [cell('l3', undefined, { type: 'text' }), cell('m3', 'g1'), cell('c3', 'g2')] },
    ] as never;
    const edges = buildChoiceGroupOutline(columnRows, new Set(['c1', 'c2', 'c3']));
    expect(edges.get('c1')).toEqual({ top: true, bottom: false, left: true, right: true });
    expect(edges.get('c2')).toEqual({ top: false, bottom: false, left: true, right: true });
    expect(edges.get('c3')).toEqual({ top: false, bottom: true, left: true, right: true });
    // 같은 열이라도 표시 대상이 아닌 그룹 쪽은 그대로
    expect(edges.has('m2')).toBe(false);
  });

  it('위아래 자리가 숨은 셀이면 세로 이웃이 아니다', () => {
    const columnRows: TableRow[] = [
      { id: 'r1', cells: [cell('l1', undefined, { type: 'text' }), cell('c1', 'g2')] },
      { id: 'r2', cells: [cell('l2', undefined, { type: 'text' }), cell('c2', 'g2', { isHidden: true })] },
      { id: 'r3', cells: [cell('l3', undefined, { type: 'text' }), cell('c3', 'g2')] },
    ] as never;
    const edges = buildChoiceGroupOutline(columnRows, new Set(['c1', 'c2', 'c3']));
    expect(edges.get('c1')?.bottom).toBe(true);
    expect(edges.get('c3')?.top).toBe(true);
    expect(edges.has('c2')).toBe(false);
  });

  it('숨은 셀은 이웃 판정에서 빠진다', () => {
    const withHidden: TableRow[] = [
      {
        id: 'r',
        cells: [cell('c1', 'g'), cell('gap', 'g', { isHidden: true }), cell('c2', 'g')],
      } as never,
    ];
    const edges = buildChoiceGroupOutline(withHidden, new Set(['c1', 'c2']));
    expect(edges.get('c1')?.right).toBe(false);
    expect(edges.get('c2')?.left).toBe(false);
  });
});

describe('outlineBoxShadow', () => {
  it('변마다 inset 그림자를 낸다 — border 를 바꾸면 격자 두께가 흔들린다', () => {
    expect(outlineBoxShadow({ top: true, bottom: true, left: true, right: false })).toBe(
      'inset 0 2px 0 0 #ef4444, inset 0 -2px 0 0 #ef4444, inset 2px 0 0 0 #ef4444',
    );
  });

  it('표시할 변이 없으면 undefined', () => {
    expect(outlineBoxShadow(undefined)).toBeUndefined();
    expect(outlineBoxShadow({ top: false, bottom: false, left: false, right: false })).toBeUndefined();
  });
});
