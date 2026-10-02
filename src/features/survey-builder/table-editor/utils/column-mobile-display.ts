import type { TableCell, TableRow } from '@/types/survey';

/**
 * 열 단위 모바일 표시 일괄 지정 — 셀 편집 모달에서 고른 「모바일 카드 표시」를 같은 열의
 * 다른 표시 셀에 한 번에 건다. 설명 열처럼 행마다 같은 설정을 반복해야 하는 자리를 위한 것.
 *
 * 대상은 기준 셀과 **같은 유형**의 표시 셀(글자·이미지·영상)이다. 병합으로 가려진 자리와
 * 내용이 빈 글자 셀은 뺀다 — 빈 칸은 장식·들여쓰기 표시라 설명 지정이 걸리면 안 된다.
 * 다른 열에 닻을 둔 가로 병합 셀은 이 열 자리가 가려진 셀이라 저절로 빠진다.
 */
/**
 * 셀 저장과 같은 커밋에 실어야 하는 표 단위 부수 변경.
 * `columnMobileDisplay` 는 `{ value }` 로 감싼다 — 값 자체가 undefined(미지정으로 저장되는 숨기기)일 수
 * 있어, 감싸지 않으면 "지정을 지워라" 와 "일괄 적용 안 함" 을 구분할 수 없다.
 */
export interface CellSaveOptions {
  columnMobileDisplay?: { value: TableCell['mobileDisplay'] } | undefined;
}

const DISPLAY_TYPES = new Set<TableCell['type']>(['text', 'image', 'video']);

function locate(rows: TableRow[], anchorCellId: string): { column: number; anchor: TableCell } | null {
  for (const row of rows) {
    const column = row.cells.findIndex((cell) => cell.id === anchorCellId);
    const anchor = row.cells[column];
    if (anchor) return { column, anchor };
  }
  return null;
}

function isTarget(cell: TableCell | undefined, anchor: TableCell): cell is TableCell {
  if (!cell || cell.id === anchor.id) return false;
  if (cell.isHidden || cell._isContinuation) return false;
  if (!DISPLAY_TYPES.has(cell.type) || cell.type !== anchor.type) return false;
  return cell.type !== 'text' || (cell.content ?? '').trim() !== '';
}

/** 일괄 적용이 바꿀 셀 수 — 기준 셀 자신은 세지 않는다. */
export function countColumnMobileDisplayTargets(rows: TableRow[], anchorCellId: string): number {
  const found = locate(rows, anchorCellId);
  if (!found) return 0;
  return rows.filter((row) => isTarget(row.cells[found.column], found.anchor)).length;
}

/**
 * 기준 셀과 같은 열의 대상 셀에 값을 건다. 기준 셀 자신은 건드리지 않는다(모달 저장이 쓴다).
 * `value` 가 undefined 면 지정을 지운다 — 기준 셀이 미지정으로 저장되는 「숨기기」와 같은 상태로 맞춘다.
 */
export function applyMobileDisplayToColumn(
  rows: TableRow[],
  anchorCellId: string,
  value: TableCell['mobileDisplay'],
): TableRow[] {
  const found = locate(rows, anchorCellId);
  if (!found) return rows;
  return rows.map((row) => {
    const cell = row.cells[found.column];
    if (!isTarget(cell, found.anchor)) return row;
    const { mobileDisplay: _previous, ...rest } = cell;
    const next: TableCell = value === undefined ? rest : { ...rest, mobileDisplay: value };
    return { ...row, cells: row.cells.map((c, index) => (index === found.column ? next : c)) };
  });
}
