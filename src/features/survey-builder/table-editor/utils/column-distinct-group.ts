import type { TableCell, TableRow } from '@/types/survey';

/**
 * 열 단위 중복 불가 묶음 일괄 지정 — 셀 편집 모달에서 적은 묶음 이름을 같은 열의 다른 선택 칸에
 * 한 번에 건다. 「같은 열을 따라 내려가며 고른다」는 가장 흔한 묶음 모양을 위한 것이고,
 * 다른 배치는 칸마다 이름을 적으면 된다 (열 일괄 지정 선례: column-mobile-display).
 *
 * 대상은 기준 칸과 같은 열의 선택(select) 칸이다. 병합으로 가려진 자리는 뺀다 — 가려진 칸은
 * 묶음 구성원이 아니다(question-renderer/utils/distinct-select-group).
 */

function locateColumn(rows: TableRow[], anchorCellId: string): number {
  for (const row of rows) {
    const column = row.cells.findIndex((cell) => cell.id === anchorCellId);
    if (column !== -1) return column;
  }
  return -1;
}

function isTarget(cell: TableCell | undefined, anchorCellId: string): cell is TableCell {
  if (!cell || cell.id === anchorCellId) return false;
  if (cell.isHidden || cell._isContinuation) return false;
  return cell.type === 'select';
}

/** 일괄 적용이 바꿀 칸 수 — 기준 칸 자신은 세지 않는다. */
export function countColumnDistinctGroupTargets(rows: TableRow[], anchorCellId: string): number {
  const column = locateColumn(rows, anchorCellId);
  if (column === -1) return 0;
  return rows.filter((row) => isTarget(row.cells[column], anchorCellId)).length;
}

/**
 * 기준 칸과 같은 열의 선택 칸에 묶음 이름을 건다. 기준 칸 자신은 건드리지 않는다(모달 저장이 쓴다).
 * `value` 가 undefined 면 이름을 지운다 — 기준 칸에서 이름을 비우고 일괄 적용한 경우다.
 */
export function applyDistinctGroupToColumn(
  rows: TableRow[],
  anchorCellId: string,
  value: string | undefined,
): TableRow[] {
  const column = locateColumn(rows, anchorCellId);
  if (column === -1) return rows;
  return rows.map((row) => {
    const cell = row.cells[column];
    if (!isTarget(cell, anchorCellId)) return row;
    const { distinctGroup: _previous, ...rest } = cell;
    const next: TableCell = value === undefined ? rest : { ...rest, distinctGroup: value };
    return { ...row, cells: row.cells.map((c, index) => (index === column ? next : c)) };
  });
}
