import { describe, expect, it } from 'vitest';

import type { TableCell, TableRow } from '@/types/survey';

import { recalculateRowspansForVisibleRows } from './table-merge-helpers';

/**
 * 세로 병합이 걸친 범위의 일부 행만 가려질 때 — 행 반복·행 차례로 열기·행 표시조건이
 * 전부 이 재계산을 탄다. 가려지는 자리가 시작이 아니라 가운데·끝이어도 병합 칸은
 * 보이는 행 수만큼만 덮어야 한다.
 */

function text(id: string, extra: Partial<TableCell> = {}): TableCell {
  return { id, content: id, type: 'text', ...extra };
}

/** 왼쪽 구분 칸이 5행(r1~r5)을 세로로 덮는 표. r6 은 병합 밖. */
const rows: TableRow[] = [
  { id: 'r1', label: '1', cells: [text('label', { rowspan: 5 }), text('a1')] },
  { id: 'r2', label: '2', cells: [text('l2', { isHidden: true }), text('a2')] },
  { id: 'r3', label: '3', cells: [text('l3', { isHidden: true }), text('a3')] },
  { id: 'r4', label: '4', cells: [text('l4', { isHidden: true }), text('a4')] },
  { id: 'r5', label: '5', cells: [text('l5', { isHidden: true }), text('a5')] },
  { id: 'r6', label: '6', cells: [text('l6'), text('a6')] },
];

function spanOf(result: TableRow[], rowId: string): number {
  return result.find((row) => row.id === rowId)!.cells[0]!.rowspan ?? 1;
}

describe('recalculateRowspansForVisibleRows — 병합 범위의 가운데·끝 행이 가려질 때', () => {
  it('가운데 행들이 가려지면 보이는 행 수만큼만 덮는다', () => {
    const result = recalculateRowspansForVisibleRows(rows, new Set(['r1', 'r2', 'r5', 'r6']));

    expect(result.map((row) => row.id)).toEqual(['r1', 'r2', 'r5', 'r6']);
    expect(spanOf(result, 'r1')).toBe(3);
    expect(result[1]!.cells[0]!.isHidden).toBe(true);
    expect(result[2]!.cells[0]!.isHidden).toBe(true);
  });

  it('끝 행들이 가려지면 그만큼 줄어든다', () => {
    const result = recalculateRowspansForVisibleRows(rows, new Set(['r1', 'r2', 'r6']));

    expect(spanOf(result, 'r1')).toBe(2);
    // 병합 밖의 행은 제 칸을 그대로 갖는다.
    expect(result[2]!.cells[0]!.isHidden).toBeFalsy();
    expect(spanOf(result, 'r6')).toBe(1);
  });

  it('한 행만 남으면 병합이 풀린다', () => {
    const result = recalculateRowspansForVisibleRows(rows, new Set(['r1', 'r6']));

    expect(result[0]!.cells[0]!.rowspan).toBeUndefined();
    expect(result[0]!.cells[0]!.id).toBe('label');
  });

  it('전부 보이면 원래대로다', () => {
    const result = recalculateRowspansForVisibleRows(rows, new Set(rows.map((row) => row.id)));
    expect(spanOf(result, 'r1')).toBe(5);
  });
});
