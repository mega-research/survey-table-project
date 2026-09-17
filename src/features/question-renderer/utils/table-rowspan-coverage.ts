import type { TableCell, TableRow } from '@/types/survey';

/**
 * 각 표시 행·열 좌표가 실제로 가리키는 rowspan anchor 셀을 계산한다.
 * continuation placeholder의 id/content가 탐색 라벨이나 선택 행 상세 identity로 쓰이지 않게 한다.
 */
export function buildTableRowspanCoverage(
  rows: TableRow[],
): Map<string, Array<TableCell | undefined>> {
  const coverage = new Map<string, Array<TableCell | undefined>>(
    rows.map((row) => [row.id, row.cells.slice()]),
  );

  rows.forEach((row, rowIndex) => {
    row.cells.forEach((cell, columnIndex) => {
      if (cell._isContinuation) return;
      const rowspan = Math.max(1, cell.rowspan ?? 1);
      if (rowspan <= 1) return;

      for (let offset = 1; offset < rowspan; offset += 1) {
        const coveredRow = rows[rowIndex + offset];
        if (!coveredRow) break;
        const placeholder = coveredRow.cells[columnIndex];
        if (!placeholder || (!placeholder.isHidden && !placeholder._isContinuation)) break;
        const coveredCells = coverage.get(coveredRow.id);
        if (coveredCells) coveredCells[columnIndex] = cell;
      }
    });
  });

  return coverage;
}
