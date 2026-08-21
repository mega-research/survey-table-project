/**
 * 테이블 셀 병합/해제 실행 로직 (순수 함수)
 *
 * 기존 table-merge-helpers.ts(headerGrid 관련)와 역할이 다름:
 * - table-merge-helpers.ts: 다단계 헤더 그리드 생성/관리
 * - table-cell-merge.ts: 본문 셀의 병합/해제 실행
 */
import { TableColumn, TableRow } from '@/types/survey';

/** 병합 실행 결과 */
export interface MergeResult {
  updatedRows: TableRow[];
  newSelectedCell?: { rowId: string; cellId: string } | undefined;
}

/**
 * 병합 가능 여부 확인
 *
 * @param direction - 병합 방향
 * @param rowIndex - 기준 셀의 행 인덱스
 * @param cellIndex - 기준 셀의 열 인덱스
 * @param rows - 현재 테이블 행 데이터
 * @param columns - 현재 테이블 열 데이터
 */
export function checkCanMerge(
  direction: 'up' | 'down' | 'left' | 'right',
  rowIndex: number,
  cellIndex: number,
  rows: TableRow[],
  columns: TableColumn[],
): boolean {
  if (rowIndex < 0 || rowIndex >= rows.length) return false;
  const currentRow = rows[rowIndex];
  if (!currentRow) return false;
  if (cellIndex < 0 || cellIndex >= currentRow.cells.length) return false;

  const cell = currentRow.cells[cellIndex];
  if (!cell) return false;
  const rowspan = cell.rowspan || 1;
  const colspan = cell.colspan || 1;

  if (direction === 'down') {
    if (rowIndex + rowspan >= rows.length) return false;
    const targetRow = rows[rowIndex + rowspan];
    if (!targetRow) return false;
    const targetCell = targetRow.cells[cellIndex];
    if (!targetCell || targetCell.isHidden) return false;
    const targetColspan = targetCell.colspan || 1;
    if (colspan !== targetColspan) return false;
    return true;
  }

  if (direction === 'right') {
    if (cellIndex + colspan >= columns.length) return false;
    const targetCell = currentRow.cells[cellIndex + colspan];
    if (!targetCell || targetCell.isHidden) return false;
    const targetRowspan = targetCell.rowspan || 1;
    if (rowspan !== targetRowspan) return false;
    return true;
  }

  if (direction === 'up') {
    if (rowIndex === 0) return false;
    const targetCell = rows[rowIndex - 1]?.cells[cellIndex];
    if (!targetCell || targetCell.isHidden) return false;
    const targetColspan = targetCell.colspan || 1;
    if (colspan !== targetColspan) return false;
    return true;
  }

  if (direction === 'left') {
    if (cellIndex === 0) return false;
    const targetCell = rows[rowIndex]?.cells[cellIndex - 1];
    if (!targetCell || targetCell.isHidden) return false;
    const targetRowspan = targetCell.rowspan || 1;
    if (rowspan !== targetRowspan) return false;
    return true;
  }

  return false;
}

/** 병합 대상 셀을 빈 텍스트 셀로 초기화 */
function resetCell(cell: TableRow['cells'][number]): TableRow['cells'][number] {
  const { checkboxOptions: _cb, radioOptions: _ro, selectOptions: _so, imageUrl: _iu, videoUrl: _vu, rowspan: _rs, colspan: _cs, ...rest } = cell;
  return {
    ...rest,
    content: '',
    type: 'text',
  };
}

/**
 * 병합 실행
 *
 * 호출 전에 checkCanMerge로 유효성을 확인해야 합니다.
 * 반환된 updatedRows는 아직 isHidden이 재계산되지 않은 상태이므로,
 * 호출자가 recalculateHiddenCells를 적용해야 합니다.
 */
export function executeMerge(
  direction: 'up' | 'down' | 'left' | 'right',
  rowIndex: number,
  cellIndex: number,
  rows: TableRow[],
): MergeResult {
  const newRows = structuredClone(rows);
  let newSelectedCell: MergeResult['newSelectedCell'] = undefined;

  if (direction === 'down') {
    const row = newRows[rowIndex];
    if (!row) return { updatedRows: newRows, newSelectedCell };
    const cell = row.cells[cellIndex];
    if (!cell) return { updatedRows: newRows, newSelectedCell };
    const currentRowspan = cell.rowspan || 1;
    const targetRowIndex = rowIndex + currentRowspan;
    const targetRow = newRows[targetRowIndex];
    if (!targetRow) return { updatedRows: newRows, newSelectedCell };
    const targetCell = targetRow.cells[cellIndex];
    if (!targetCell) return { updatedRows: newRows, newSelectedCell };
    const targetRowspan = targetCell.rowspan || 1;

    cell.rowspan = currentRowspan + targetRowspan;
    targetRow.cells[cellIndex] = resetCell(targetCell);
  } else if (direction === 'right') {
    const row = newRows[rowIndex];
    if (!row) return { updatedRows: newRows, newSelectedCell };
    const cell = row.cells[cellIndex];
    if (!cell) return { updatedRows: newRows, newSelectedCell };
    const currentColspan = cell.colspan || 1;
    const targetCellIndex = cellIndex + currentColspan;
    const targetCell = row.cells[targetCellIndex];
    if (!targetCell) return { updatedRows: newRows, newSelectedCell };
    const targetColspan = targetCell.colspan || 1;

    cell.colspan = currentColspan + targetColspan;
    row.cells[targetCellIndex] = resetCell(targetCell);
  } else if (direction === 'up') {
    const baseRowIndex = rowIndex - 1;
    const baseRow = newRows[baseRowIndex];
    if (!baseRow) return { updatedRows: newRows, newSelectedCell };
    const baseCell = baseRow.cells[cellIndex];
    if (!baseCell) return { updatedRows: newRows, newSelectedCell };
    const currentRow = newRows[rowIndex];
    if (!currentRow) return { updatedRows: newRows, newSelectedCell };
    const targetCell = currentRow.cells[cellIndex];
    if (!targetCell) return { updatedRows: newRows, newSelectedCell };
    const baseRowspan = baseCell.rowspan || 1;
    const targetRowspan = targetCell.rowspan || 1;

    baseCell.rowspan = baseRowspan + targetRowspan;
    currentRow.cells[cellIndex] = resetCell(targetCell);

    newSelectedCell = {
      rowId: baseRow.id,
      cellId: baseCell.id,
    };
  } else if (direction === 'left') {
    const row = newRows[rowIndex];
    if (!row) return { updatedRows: newRows, newSelectedCell };
    const baseCellIndex = cellIndex - 1;
    const baseCell = row.cells[baseCellIndex];
    if (!baseCell) return { updatedRows: newRows, newSelectedCell };
    const targetCell = row.cells[cellIndex];
    if (!targetCell) return { updatedRows: newRows, newSelectedCell };
    const baseColspan = baseCell.colspan || 1;
    const targetColspan = targetCell.colspan || 1;

    baseCell.colspan = baseColspan + targetColspan;
    row.cells[cellIndex] = resetCell(targetCell);

    newSelectedCell = {
      rowId: row.id,
      cellId: baseCell.id,
    };
  }

  return { updatedRows: newRows, newSelectedCell };
}

/**
 * 병합 해제
 *
 * 반환된 행 데이터는 isHidden이 재계산되지 않은 상태이므로,
 * 호출자가 recalculateHiddenCells를 적용해야 합니다.
 */
export function executeUnmerge(
  rowIndex: number,
  cellIndex: number,
  rows: TableRow[],
): TableRow[] {
  const row = rows[rowIndex];
  if (!row) return rows;
  const cell = row.cells[cellIndex];
  if (!cell) return rows;
  const rowspan = cell.rowspan || 1;
  const colspan = cell.colspan || 1;

  if (rowspan <= 1 && colspan <= 1) return rows;

  const newRows = structuredClone(rows);
  const newRow = newRows[rowIndex];
  if (!newRow) return rows;
  const targetCell = newRow.cells[cellIndex];
  if (!targetCell) return rows;
  const { rowspan: _rs, colspan: _cs, ...restCell } = targetCell;
  newRow.cells[cellIndex] = restCell;

  return newRows;
}
