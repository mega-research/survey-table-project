import { describe, it, expect } from 'vitest';

import type { HeaderCell } from '@/types/survey';
import {
  buildDefaultHeaderGrid,
  getHeaderGridColumnCount,
  reconcileHeaderGridForColumnChange,
  validateHeaderGrid,
} from '@/utils/table-merge-helpers';

// 헤더 셀 팩토리
function hc(label: string, overrides: Partial<HeaderCell> = {}): HeaderCell {
  return { id: `id-${label}`, label, colspan: 1, rowspan: 1, ...overrides };
}

// 그리드의 각 행 colspan 합이 모두 columnCount와 일치하는지(폭 정합성) 확인
function eachRowSpansTo(grid: HeaderCell[][], columnCount: number): boolean {
  return grid.every((row) => row.reduce((sum, c) => sum + (c.colspan || 1), 0) === columnCount);
}

describe('reconcileHeaderGridForColumnChange - 단일 행 그리드', () => {
  it('말단에 열 추가 시 새 1x1 헤더 셀이 끝에 붙는다', () => {
    // 3열 단일 행 → 4번째 열 append (slot=3)
    const grid = buildDefaultHeaderGrid([
      { id: 'c1', label: 'A' },
      { id: 'c2', label: 'B' },
      { id: 'c3', label: 'C' },
    ]);
    expect(getHeaderGridColumnCount(grid)).toBe(3);

    const next = reconcileHeaderGridForColumnChange(grid, { type: 'add', slot: 3 });

    expect(getHeaderGridColumnCount(next)).toBe(4);
    expect(validateHeaderGrid(next, 4)).toBe(true);
    expect(next[0]).toHaveLength(4);
    expect(next[0]![3]!.colspan).toBe(1);
  });

  it('중간에 열 삭제 시 해당 헤더 셀이 사라진다', () => {
    const grid: HeaderCell[][] = [[hc('A'), hc('B'), hc('C')]];

    const next = reconcileHeaderGridForColumnChange(grid, { type: 'delete', slot: 1 });

    expect(getHeaderGridColumnCount(next)).toBe(2);
    expect(validateHeaderGrid(next, 2)).toBe(true);
    expect(next[0]!.map((c) => c.label)).toEqual(['A', 'C']);
  });
});

describe('reconcileHeaderGridForColumnChange - 병합 셀 보존', () => {
  // 상단행: [그룹(colspan2)] [C]
  // 하단행: [a] [b] [c]
  function twoRowGrid(): HeaderCell[][] {
    return [
      [hc('그룹', { colspan: 2 }), hc('C')],
      [hc('a'), hc('b'), hc('c')],
    ];
  }

  it('병합 그룹 내부(slot=1)에 열 추가 시 그룹 colspan이 늘어난다', () => {
    const grid = twoRowGrid();
    expect(getHeaderGridColumnCount(grid)).toBe(3);

    // 그룹은 slot 0~1 차지. slot=1에 삽입하면 그룹 내부 → 그룹 colspan 2→3
    const next = reconcileHeaderGridForColumnChange(grid, { type: 'add', slot: 1 });

    expect(getHeaderGridColumnCount(next)).toBe(4);
    expect(validateHeaderGrid(next, 4)).toBe(true);
    // 상단행: 그룹 colspan 3 + C
    expect(next[0]![0]!.label).toBe('그룹');
    expect(next[0]![0]!.colspan).toBe(3);
    expect(next[0]![1]!.label).toBe('C');
    // 하단행: 1x1 리프 4개
    expect(next[1]).toHaveLength(4);
    expect(eachRowSpansTo(next, 4)).toBe(true);
  });

  it('병합 그룹 경계(slot=2, C 앞)에 열 추가 시 독립 1x1 셀이 삽입된다', () => {
    const grid = twoRowGrid();

    // slot=2는 그룹(0~1)도 C(2)도 내부가 아니라 경계 → C 앞에 새 셀
    const next = reconcileHeaderGridForColumnChange(grid, { type: 'add', slot: 2 });

    expect(getHeaderGridColumnCount(next)).toBe(4);
    expect(validateHeaderGrid(next, 4)).toBe(true);
    // 상단행: 그룹(colspan2) 유지 + 새 1x1 + C
    expect(next[0]![0]!.colspan).toBe(2);
    expect(next[0]).toHaveLength(3);
    expect(eachRowSpansTo(next, 4)).toBe(true);
  });

  it('병합 그룹에 속한 열(slot=0) 삭제 시 그룹 colspan이 줄어든다', () => {
    const grid = twoRowGrid();

    const next = reconcileHeaderGridForColumnChange(grid, { type: 'delete', slot: 0 });

    expect(getHeaderGridColumnCount(next)).toBe(2);
    expect(validateHeaderGrid(next, 2)).toBe(true);
    // 그룹 colspan 2→1, 라벨 보존
    expect(next[0]![0]!.label).toBe('그룹');
    expect(next[0]![0]!.colspan).toBe(1);
    expect(next[0]![1]!.label).toBe('C');
    expect(next[1]).toHaveLength(2);
  });

  it('colspan 1 그룹 셀이 가리키는 마지막 열 삭제 시 그 헤더 셀이 제거된다', () => {
    // 상단: [A][B] 하단: [a][b]  →  slot=1(B) 삭제
    const grid: HeaderCell[][] = [
      [hc('A'), hc('B')],
      [hc('a'), hc('b')],
    ];

    const next = reconcileHeaderGridForColumnChange(grid, { type: 'delete', slot: 1 });

    expect(getHeaderGridColumnCount(next)).toBe(1);
    expect(validateHeaderGrid(next, 1)).toBe(true);
    expect(next[0]!.map((c) => c.label)).toEqual(['A']);
    expect(next[1]!.map((c) => c.label)).toEqual(['a']);
  });
});

describe('reconcileHeaderGridForColumnChange - rowspan 보존', () => {
  // 상단행: [좌(rowspan2)] [그룹(colspan2)]
  // 하단행:               [b] [c]
  // 슬롯: 좌=col0(2행 점유), 그룹=col1~2, b=col1, c=col2
  function rowspanGrid(): HeaderCell[][] {
    return [
      [hc('좌', { rowspan: 2 }), hc('그룹', { colspan: 2 })],
      [hc('b'), hc('c')],
    ];
  }

  it('말단(slot=3)에 열 추가 시 rowspan 셀 구조가 유지되고 폭이 맞는다', () => {
    const grid = rowspanGrid();
    expect(getHeaderGridColumnCount(grid)).toBe(3);

    const next = reconcileHeaderGridForColumnChange(grid, { type: 'add', slot: 3 });

    expect(getHeaderGridColumnCount(next)).toBe(4);
    expect(validateHeaderGrid(next, 4)).toBe(true);
    // 좌 rowspan 보존
    expect(next[0]![0]!.label).toBe('좌');
    expect(next[0]![0]!.rowspan).toBe(2);
  });

  it('rowspan 셀이 점유한 열(slot=0) 삭제 시 rowspan 셀이 제거되고 정합성 유지', () => {
    const grid = rowspanGrid();

    const next = reconcileHeaderGridForColumnChange(grid, { type: 'delete', slot: 0 });

    expect(getHeaderGridColumnCount(next)).toBe(2);
    expect(validateHeaderGrid(next, 2)).toBe(true);
    // 상단행에서 좌(colspan1 rowspan2)가 제거됨 → 그룹만 남음
    expect(next[0]!.map((c) => c.label)).toEqual(['그룹']);
  });
});
