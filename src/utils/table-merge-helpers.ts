import { HeaderCell, TableColumn, TableRow } from '@/types/survey';

/**
 * 병합된 행 ID들을 가져오는 헬퍼 함수
 * @param rowId 행 ID
 * @param tableRowsData 테이블 행 데이터
 * @param colIndex 열 인덱스 (선택사항)
 * @returns 병합된 행 ID 배열
 */
export function getMergedRowIds(
  rowId: string,
  tableRowsData: TableRow[] | undefined,
  colIndex?: number,
): string[] {
  if (!tableRowsData) return [rowId];

  const rowIndex = tableRowsData.findIndex((r) => r.id === rowId);
  if (rowIndex === -1) return [rowId];

  // 열 인덱스가 지정되지 않았으면 해당 행만 반환
  if (colIndex === undefined) return [rowId];

  const row = tableRowsData[rowIndex];
  const cell = row?.cells[colIndex];

  // 셀이 숨겨진 경우 (다른 셀의 병합 영역에 포함됨)
  if (cell?.isHidden) {
    // 위쪽 행들을 확인하여 병합 시작 셀 찾기
    for (let r = 0; r < rowIndex; r++) {
      const checkRow = tableRowsData[r];
      const checkCell = checkRow?.cells[colIndex];
      if (checkCell && checkCell.rowspan && checkCell.rowspan > 1 && !checkCell.isHidden) {
        const isInMergedRange = rowIndex >= r && rowIndex < r + checkCell.rowspan;
        if (isInMergedRange) {
          const mergedRowIds: string[] = [];
          for (let i = 0; i < checkCell.rowspan; i++) {
            const mergedRow = tableRowsData[r + i];
            if (mergedRow) mergedRowIds.push(mergedRow.id);
          }
          return mergedRowIds;
        }
      }
    }
  }

  // 현재 행의 셀이 병합 시작 셀인 경우
  if (cell && cell.rowspan && cell.rowspan > 1 && !cell.isHidden) {
    const mergedRowIds: string[] = [];
    for (let i = 0; i < cell.rowspan; i++) {
      const mergedRow = tableRowsData[rowIndex + i];
      if (mergedRow) mergedRowIds.push(mergedRow.id);
    }
    return mergedRowIds;
  }

  // 다른 행의 병합된 셀에 포함되어 있는지 확인 (셀이 숨겨지지 않은 경우)
  if (!cell?.isHidden) {
    for (let r = 0; r < rowIndex; r++) {
      const checkRow = tableRowsData[r];
      const checkCell = checkRow?.cells[colIndex];
      if (checkCell && checkCell.rowspan && checkCell.rowspan > 1 && !checkCell.isHidden) {
        const isInMergedRange = rowIndex >= r && rowIndex < r + checkCell.rowspan;
        if (isInMergedRange) {
          const mergedRowIds: string[] = [];
          for (let i = 0; i < checkCell.rowspan; i++) {
            const mergedRow = tableRowsData[r + i];
            if (mergedRow) mergedRowIds.push(mergedRow.id);
          }
          return mergedRowIds;
        }
      }
    }
  }

  return [rowId];
}

export interface RowMergeInfo {
  isMerged: boolean;
  mergedRowIds: string[];
  mergeStartRowId: string | null;
}

/**
 * 행의 병합 정보를 가져오는 헬퍼 함수
 * @param rowId 행 ID
 * @param tableRowsData 테이블 행 데이터
 * @param colIndex 열 인덱스 (선택사항)
 * @returns 병합 정보 객체
 */
export function getRowMergeInfo(
  rowId: string,
  tableRowsData: TableRow[] | undefined,
  colIndex?: number,
): RowMergeInfo {
  if (!tableRowsData || colIndex === undefined) {
    return { isMerged: false, mergedRowIds: [rowId], mergeStartRowId: null };
  }

  const rowIndex = tableRowsData.findIndex((r) => r.id === rowId);
  if (rowIndex === -1) {
    return { isMerged: false, mergedRowIds: [rowId], mergeStartRowId: null };
  }

  const row = tableRowsData[rowIndex];
  const cell = row?.cells[colIndex];

  // 셀이 숨겨진 경우 (다른 셀의 병합 영역에 포함됨)
  if (cell?.isHidden) {
    // 위쪽 행들을 확인하여 병합 시작 셀 찾기
    for (let r = 0; r < rowIndex; r++) {
      const checkRow = tableRowsData[r];
      const checkCell = checkRow?.cells[colIndex];
      if (checkCell && checkCell.rowspan && checkCell.rowspan > 1 && !checkCell.isHidden) {
        const isInMergedRange = rowIndex >= r && rowIndex < r + checkCell.rowspan;
        if (isInMergedRange) {
          const mergedRowIds: string[] = [];
          for (let i = 0; i < checkCell.rowspan; i++) {
            const mergedRow = tableRowsData[r + i];
            if (mergedRow) mergedRowIds.push(mergedRow.id);
          }
          return {
            isMerged: true,
            mergedRowIds,
            mergeStartRowId: tableRowsData[r].id,
          };
        }
      }
    }
  }

  // 현재 행의 셀이 병합 시작 셀인 경우
  if (cell && cell.rowspan && cell.rowspan > 1 && !cell.isHidden) {
    const mergedRowIds: string[] = [];
    for (let i = 0; i < cell.rowspan; i++) {
      const mergedRow = tableRowsData[rowIndex + i];
      if (mergedRow) mergedRowIds.push(mergedRow.id);
    }
    return {
      isMerged: true,
      mergedRowIds,
      mergeStartRowId: rowId,
    };
  }

  // 다른 행의 병합된 셀에 포함되어 있는지 확인 (셀이 숨겨지지 않은 경우)
  if (!cell?.isHidden) {
    for (let r = 0; r < rowIndex; r++) {
      const checkRow = tableRowsData[r];
      const checkCell = checkRow?.cells[colIndex];
      if (checkCell && checkCell.rowspan && checkCell.rowspan > 1 && !checkCell.isHidden) {
        const isInMergedRange = rowIndex >= r && rowIndex < r + checkCell.rowspan;
        if (isInMergedRange) {
          const mergedRowIds: string[] = [];
          for (let i = 0; i < checkCell.rowspan; i++) {
            const mergedRow = tableRowsData[r + i];
            if (mergedRow) mergedRowIds.push(mergedRow.id);
          }
          return {
            isMerged: true,
            mergedRowIds,
            mergeStartRowId: tableRowsData[r].id,
          };
        }
      }
    }
  }

  return { isMerged: false, mergedRowIds: [rowId], mergeStartRowId: null };
}

/**
 * 가시 행 기준으로 rowspan을 재계산하여 새로운 행 배열을 반환
 *
 * 원본 rows에서 병합 시작 셀(rowspan > 1)을 식별하고,
 * 해당 병합이 커버하는 범위 중 visibleRowIds에 포함된 행 수로 rowspan을 재조정.
 *
 * @param originalRows 원본 전체 행 배열
 * @param visibleRowIds 표시할 행 ID Set
 * @returns 재계산된 셀 병합이 적용된 가시 행 배열 (deep copy)
 */
export function recalculateRowspansForVisibleRows(
  originalRows: TableRow[],
  visibleRowIds: Set<string>,
): TableRow[] {
  const visibleRows = originalRows.filter((row) => visibleRowIds.has(row.id));

  if (visibleRows.length === 0) return visibleRows;

  const colCount = visibleRows[0].cells.length;

  // 변경이 필요한 셀만 추적: Map<visibleRowIndex, Map<colIdx, cellOverrides>>
  const modifications = new Map<number, Map<number, Partial<TableRow['cells'][0]>>>();

  const setMod = (rowIdx: number, colIdx: number, overrides: Partial<TableRow['cells'][0]>) => {
    let rowMods = modifications.get(rowIdx);
    if (!rowMods) {
      rowMods = new Map();
      modifications.set(rowIdx, rowMods);
    }
    rowMods.set(colIdx, { ...rowMods.get(colIdx), ...overrides });
  };

  // 각 열에 대해 병합 재계산
  for (let colIdx = 0; colIdx < colCount; colIdx++) {
    // 1. 원본에서 병합 그룹 식별 (rowspan > 1인 셀 기준)
    interface MergeGroup {
      startOrigIdx: number;
      endOrigIdx: number;
      cellContent: typeof originalRows[0]['cells'][0];
    }
    const mergeGroups: MergeGroup[] = [];

    for (let r = 0; r < originalRows.length; r++) {
      const cell = originalRows[r].cells[colIdx];
      if (cell && cell.rowspan && cell.rowspan > 1 && !cell.isHidden) {
        mergeGroups.push({
          startOrigIdx: r,
          endOrigIdx: r + cell.rowspan,
          cellContent: cell,
        });
      }
    }

    // 2. 각 병합 그룹에 대해, 가시 행 중 해당 범위에 속하는 행들을 찾아 재계산
    for (const group of mergeGroups) {
      const groupOrigRowIds = new Set<string>();
      for (let r = group.startOrigIdx; r < group.endOrigIdx && r < originalRows.length; r++) {
        groupOrigRowIds.add(originalRows[r].id);
      }

      const visibleInGroup: number[] = [];
      for (let v = 0; v < visibleRows.length; v++) {
        if (groupOrigRowIds.has(visibleRows[v].id)) {
          visibleInGroup.push(v);
        }
      }

      if (visibleInGroup.length === 0) continue;

      // 첫 번째 가시 행에 병합 시작 셀 배치
      setMod(visibleInGroup[0], colIdx, {
        isHidden: false,
        content: group.cellContent.content,
        type: group.cellContent.type,
        rowspan: visibleInGroup.length > 1 ? visibleInGroup.length : undefined,
      });

      // 나머지 가시 행의 해당 열 셀은 isHidden
      for (let i = 1; i < visibleInGroup.length; i++) {
        setMod(visibleInGroup[i], colIdx, {
          isHidden: true,
          rowspan: undefined,
        });
      }
    }
  }

  // 변경 필요한 행만 복사, 나머지는 원본 참조 유지
  return visibleRows.map((row, rowIdx) => {
    const rowMods = modifications.get(rowIdx);
    if (!rowMods) return row;

    return {
      ...row,
      cells: row.cells.map((cell, colIdx) => {
        const cellMod = rowMods.get(colIdx);
        if (!cellMod) return cell;
        return { ...cell, ...cellMod };
      }),
    };
  });
}

/**
 * 가시 열 기준으로 columns, rows의 cells, headerGrid를 필터링하고 colspan을 재계산
 *
 * @param originalColumns 원본 전체 열 배열
 * @param originalRows 원본 전체 행 배열
 * @param visibleColumnIds 표시할 열 ID Set
 * @param headerGrid 다단계 헤더 (선택사항)
 * @returns 필터링된 columns, rows, headerGrid (deep copy)
 */
export function recalculateColspansForVisibleColumns(
  originalColumns: TableColumn[],
  originalRows: TableRow[],
  visibleColumnIds: Set<string>,
  headerGrid?: HeaderCell[][],
): { columns: TableColumn[]; rows: TableRow[]; headerGrid?: HeaderCell[][] } {
  // 가시 열 인덱스 Set 생성
  const visibleColIndices = new Set<number>();
  originalColumns.forEach((col, idx) => {
    if (visibleColumnIds.has(col.id)) visibleColIndices.add(idx);
  });

  // 열 필터링 + 헤더 colspan 재계산
  const filteredColumns: TableColumn[] = [];
  for (let i = 0; i < originalColumns.length; i++) {
    if (!visibleColIndices.has(i)) continue;
    const col = { ...originalColumns[i] };

    // 이 열이 헤더 병합 시작이면 colspan 재계산
    if (col.colspan && col.colspan > 1) {
      let newColspan = 0;
      for (let j = i; j < i + col.colspan && j < originalColumns.length; j++) {
        if (visibleColIndices.has(j)) newColspan++;
      }
      col.colspan = newColspan > 1 ? newColspan : undefined;
    }
    col.isHeaderHidden = false; // 필터링 후에는 모두 표시
    filteredColumns.push(col);
  }

  // 행의 cells 필터링 + colspan 재계산
  const filteredRows = originalRows.map((row) => {
    const newCells = [];
    for (let i = 0; i < row.cells.length; i++) {
      if (!visibleColIndices.has(i)) continue;
      const cell = { ...row.cells[i] };

      // colspan 재계산
      if (cell.colspan && cell.colspan > 1) {
        let newColspan = 0;
        for (let j = i; j < i + cell.colspan && j < row.cells.length; j++) {
          if (visibleColIndices.has(j)) newColspan++;
        }
        cell.colspan = newColspan > 1 ? newColspan : undefined;
        cell.isHidden = false;
      }

      // colspan에 의해 숨겨진 셀이면 건너뜀 (원본 기준 isHidden이고 해당 병합 시작 셀이 숨겨진 열에 있는 경우)
      // → 필터링 후에는 보이는 열만 남으므로, 여전히 다른 가시 셀의 colspan에 포함되는지 확인
      newCells.push(cell);
    }
    return { ...row, cells: newCells };
  });

  // 다단계 헤더 재계산 (rowspan으로 점유된 열 위치를 추적)
  let filteredHeaderGrid: HeaderCell[][] | undefined;
  if (headerGrid && headerGrid.length > 0) {
    const totalHeaderRows = headerGrid.length;
    // occupied[row][col] = true이면 이전 행의 rowspan에 의해 점유됨
    const occupied = Array.from({ length: totalHeaderRows }, () => new Set<number>());

    filteredHeaderGrid = headerGrid.map((headerRow, rowIdx) => {
      const newRow: HeaderCell[] = [];
      let origColIdx = 0;

      // 이전 행의 rowspan으로 점유된 열 건너뛰기
      while (occupied[rowIdx]?.has(origColIdx)) origColIdx++;

      for (const cell of headerRow) {
        // rowspan 점유된 열 건너뛰기
        while (occupied[rowIdx]?.has(origColIdx)) origColIdx++;

        const cellColspan = cell.colspan || 1;
        const cellRowspan = cell.rowspan || 1;

        // 이 헤더 셀이 커버하는 원본 열 범위에서 가시 열 수 카운트
        let visibleCount = 0;
        for (let j = 0; j < cellColspan && origColIdx + j < originalColumns.length; j++) {
          if (visibleColIndices.has(origColIdx + j)) visibleCount++;
        }

        // rowspan > 1이면 후속 행에 점유 마킹
        if (cellRowspan > 1) {
          for (let r = rowIdx + 1; r < rowIdx + cellRowspan && r < totalHeaderRows; r++) {
            for (let c = origColIdx; c < origColIdx + cellColspan; c++) {
              occupied[r].add(c);
            }
          }
        }

        if (visibleCount > 0) {
          newRow.push({
            ...cell,
            colspan: visibleCount,
          });
        }

        origColIdx += cellColspan;
      }

      return newRow;
    });

    // 빈 행 제거
    filteredHeaderGrid = filteredHeaderGrid.filter((row) => row.length > 0);
    if (filteredHeaderGrid.length === 0) filteredHeaderGrid = undefined;
  }

  return { columns: filteredColumns, rows: filteredRows, headerGrid: filteredHeaderGrid };
}

/**
 * tableColumns에서 기본 단일 행 headerGrid를 생성 (폴백용)
 * 기존 colspan 설정이 있으면 반영
 */
export function buildDefaultHeaderGrid(columns: TableColumn[]): HeaderCell[][] {
  const cells: HeaderCell[] = columns
    .filter((col) => !col.isHeaderHidden)
    .map((col) => ({
      id: `hc-${col.id}`,
      label: col.label,
      colspan: col.colspan || 1,
      rowspan: 1,
    }));

  return [cells];
}

/**
 * headerGrid 유효성 검증
 * - 각 행의 colspan 합이 총 컬럼 수와 일치하는지
 * - rowspan이 범위를 초과하지 않는지
 */
export function validateHeaderGrid(grid: HeaderCell[][], columnCount: number): boolean {
  if (!grid || grid.length === 0) return false;

  const totalRows = grid.length;

  // 각 행의 colspan 합 검증
  // rowspan으로 점유된 슬롯을 추적하는 2D 그리드
  const occupied: boolean[][] = Array.from({ length: totalRows }, () =>
    Array(columnCount).fill(false),
  );

  for (let rowIdx = 0; rowIdx < totalRows; rowIdx++) {
    const row = grid[rowIdx];
    let colPos = 0;

    for (const cell of row) {
      // 이미 rowspan으로 점유된 슬롯 건너뛰기
      while (colPos < columnCount && occupied[rowIdx][colPos]) {
        colPos++;
      }

      if (colPos >= columnCount) return false; // 넘침

      const cs = cell.colspan;
      const rs = cell.rowspan;

      // rowspan 범위 검증
      if (rowIdx + rs > totalRows) return false;

      // 슬롯 점유 마킹
      for (let r = 0; r < rs; r++) {
        for (let c = 0; c < cs; c++) {
          if (colPos + c >= columnCount) return false; // colspan 넘침
          if (occupied[rowIdx + r][colPos + c]) return false; // 겹침
          occupied[rowIdx + r][colPos + c] = true;
        }
      }

      colPos += cs;
    }
  }

  // 모든 슬롯이 정확히 점유되었는지 확인
  for (let r = 0; r < totalRows; r++) {
    for (let c = 0; c < columnCount; c++) {
      if (!occupied[r][c]) return false;
    }
  }

  return true;
}

/**
 * headerGrid의 최하위 행에서 실제 리프 셀 수를 계산
 * (최하위 행의 colspan 합 = 데이터 컬럼 수여야 함)
 */
export function getHeaderGridColumnCount(grid: HeaderCell[][]): number {
  if (!grid || grid.length === 0) return 0;

  // 첫 번째 행의 colspan 합이 총 컬럼 수
  return grid[0].reduce((sum, cell) => sum + cell.colspan, 0);
}
