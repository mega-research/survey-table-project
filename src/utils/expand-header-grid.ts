import type { HeaderCell } from '@/types/survey';

/**
 * 다단계 헤더 그리드의 점유 추적 결과.
 *
 * 헤더 셀의 grid 배치 정보를 담는다. className/빈 라벨/sticky 등 표현 관련
 * 차이는 포함하지 않으며, 호출부에서 별도로 처리한다.
 */
export interface PlacedHeaderCell {
  /** 원본 헤더 셀 */
  cell: HeaderCell;
  /** 1-based 시작 열 위치 */
  startCol: number;
  /** 0-based 행 인덱스 */
  rowIdx: number;
  /** 가로 병합 수 (최소 1) */
  colSpan: number;
  /** 세로 병합 수 (최소 1) */
  rowSpan: number;
  /** CSS grid-column 값 (병합 시 `${startCol} / span ${colSpan}`, 아니면 startCol) */
  gridColumn: string | number;
  /** CSS grid-row 값 (병합 시 `${rowIdx + 1} / span ${rowSpan}`, 아니면 rowIdx + 1) */
  gridRow: string | number;
}

/**
 * 다단계 헤더 그리드를 점유 추적하여 각 셀의 grid 배치를 계산한다.
 *
 * 행마다 점유 맵을 두고, 이미 위쪽 셀의 rowspan이 차지한 칸은 건너뛰며
 * 빈 칸을 찾아 셀을 배치한다. rowspan이 1보다 크면 아래 행들의 해당 열 범위를
 * 점유로 마킹해 다음 셀이 그 칸을 건너뛰도록 한다.
 *
 * 입력 순서(행 → 행 내 셀)를 보존한 평탄화된 배열을 반환한다.
 */
export function expandHeaderGrid(headerGrid: HeaderCell[][]): PlacedHeaderCell[] {
  const totalRows = headerGrid.length;
  const occupied = Array.from({ length: totalRows }, () => new Map<number, boolean>());

  return headerGrid.flatMap((headerRow, rowIdx) => {
    let col = 1;
    return headerRow.map((cell): PlacedHeaderCell => {
      while (occupied[rowIdx]?.get(col)) col++;

      const startCol = col;
      const colSpan = cell.colspan || 1;
      const rowSpan = cell.rowspan || 1;

      if (rowSpan > 1) {
        for (let r = rowIdx + 1; r < rowIdx + rowSpan && r < totalRows; r++) {
          for (let c = startCol; c < startCol + colSpan; c++) {
            occupied[r]?.set(c, true);
          }
        }
      }
      col += colSpan;

      return {
        cell,
        startCol,
        rowIdx,
        colSpan,
        rowSpan,
        gridColumn: colSpan > 1 ? `${startCol} / span ${colSpan}` : startCol,
        gridRow: rowSpan > 1 ? `${rowIdx + 1} / span ${rowSpan}` : rowIdx + 1,
      };
    });
  });
}
