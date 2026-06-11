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
            mergeStartRowId: tableRowsData[r]?.id ?? null,
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
            mergeStartRowId: tableRowsData[r]?.id ?? null,
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

  const colCount = visibleRows[0]?.cells.length ?? 0;

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
      const origRow = originalRows[r];
      if (!origRow) continue;
      const cell = origRow.cells[colIdx];
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
        const origRow = originalRows[r];
        if (origRow) groupOrigRowIds.add(origRow.id);
      }

      const visibleInGroup: number[] = [];
      for (let v = 0; v < visibleRows.length; v++) {
        const vRow = visibleRows[v];
        if (vRow && groupOrigRowIds.has(vRow.id)) {
          visibleInGroup.push(v);
        }
      }

      if (visibleInGroup.length === 0) continue;

      // 첫 번째 가시 행에 병합 시작 셀 배치
      const firstIdx = visibleInGroup[0];
      if (firstIdx === undefined) continue;
      setMod(firstIdx, colIdx, {
        isHidden: false,
        content: group.cellContent.content,
        type: group.cellContent.type,
        ...(visibleInGroup.length > 1 ? { rowspan: visibleInGroup.length } : {}),
      });

      // 나머지 가시 행의 해당 열 셀은 isHidden
      for (let i = 1; i < visibleInGroup.length; i++) {
        const nextIdx = visibleInGroup[i];
        if (nextIdx === undefined) continue;
        const mod: Partial<TableRow['cells'][0]> = { isHidden: true };
        delete mod.rowspan;
        setMod(nextIdx, colIdx, mod);
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
    const origCol = originalColumns[i];
    if (!origCol) continue;
    const col = { ...origCol } as TableColumn;

    // 이 열이 헤더 병합 시작이면 colspan 재계산
    if (col.colspan && col.colspan > 1) {
      let newColspan = 0;
      for (let j = i; j < i + col.colspan && j < originalColumns.length; j++) {
        if (visibleColIndices.has(j)) newColspan++;
      }
      if (newColspan > 1) { col.colspan = newColspan; } else { delete col.colspan; }
    }
    col.isHeaderHidden = false; // 필터링 후에는 모두 표시
    filteredColumns.push(col);
  }

  // 가시 병합 시작 셀이 점유하는 (row, col) 좌표 집합 계산
  // 병합 시작 셀이 가시 열에 남아있을 때만 continuation 셀의 isHidden을 유지한다.
  // 병합 시작 셀이 필터링되어 사라지면, 가시 열에 남은 continuation 셀은 선두 가시 셀로
  // 승격하고 isHidden을 해제해야 한다 (미해제 시 렌더에서 if isHidden return null 로 사라짐).
  const coveredCoords = new Set<string>();
  for (let r = 0; r < originalRows.length; r++) {
    const origRow = originalRows[r];
    if (!origRow) continue;
    for (let c = 0; c < origRow.cells.length; c++) {
      // 병합 시작 셀의 열이 가시일 때만 점유 좌표로 인정
      if (!visibleColIndices.has(c)) continue;
      const startCell = origRow.cells[c];
      if (!startCell || startCell.isHidden) continue;
      const rowspan = startCell.rowspan && startCell.rowspan > 1 ? startCell.rowspan : 1;
      const colspan = startCell.colspan && startCell.colspan > 1 ? startCell.colspan : 1;
      if (rowspan <= 1 && colspan <= 1) continue;
      for (let dr = 0; dr < rowspan; dr++) {
        for (let dc = 0; dc < colspan; dc++) {
          if (dr === 0 && dc === 0) continue;
          coveredCoords.add(`${r + dr},${c + dc}`);
        }
      }
    }
  }

  // 행의 cells 필터링 + colspan 재계산
  const filteredRows: TableRow[] = originalRows.map((row, rowIdx) => {
    const newCells: TableRow['cells'] = [];
    for (let i = 0; i < row.cells.length; i++) {
      if (!visibleColIndices.has(i)) continue;
      const origCell = row.cells[i];
      if (!origCell) continue;
      const cell = { ...origCell };

      // colspan 재계산
      if (cell.colspan && cell.colspan > 1) {
        let newColspan = 0;
        for (let j = i; j < i + cell.colspan && j < row.cells.length; j++) {
          if (visibleColIndices.has(j)) newColspan++;
        }
        if (newColspan > 1) { cell.colspan = newColspan; } else { delete cell.colspan; }
        cell.isHidden = false;
      } else if (cell.isHidden && !coveredCoords.has(`${rowIdx},${i}`)) {
        // continuation 셀(자체 colspan 없음)인데 이를 덮던 가시 병합 시작 셀이 사라진 경우
        // → 선두 가시 셀로 승격하고 isHidden 해제
        cell.isHidden = false;
      }

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
              occupied[r]?.add(c);
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

  return { columns: filteredColumns, rows: filteredRows, ...(filteredHeaderGrid !== undefined ? { headerGrid: filteredHeaderGrid } : {}) };
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
    if (!row) return false;
    const occupiedRow = occupied[rowIdx];
    if (!occupiedRow) return false;
    let colPos = 0;

    for (const cell of row) {
      // 이미 rowspan으로 점유된 슬롯 건너뛰기
      while (colPos < columnCount && occupiedRow[colPos]) {
        colPos++;
      }

      if (colPos >= columnCount) return false; // 넘침

      const cs = cell.colspan;
      const rs = cell.rowspan;

      // rowspan 범위 검증
      if (rowIdx + rs > totalRows) return false;

      // 슬롯 점유 마킹
      for (let r = 0; r < rs; r++) {
        const occupiedMergeRow = occupied[rowIdx + r];
        if (!occupiedMergeRow) return false;
        for (let c = 0; c < cs; c++) {
          if (colPos + c >= columnCount) return false; // colspan 넘침
          if (occupiedMergeRow[colPos + c]) return false; // 겹침
          occupiedMergeRow[colPos + c] = true;
        }
      }

      colPos += cs;
    }
  }

  // 모든 슬롯이 정확히 점유되었는지 확인
  for (let r = 0; r < totalRows; r++) {
    const occupiedCheckRow = occupied[r];
    for (let c = 0; c < columnCount; c++) {
      if (!occupiedCheckRow?.[c]) return false;
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
  return grid[0]?.reduce((sum, cell) => sum + cell.colspan, 0) ?? 0;
}

/**
 * 헤더 그리드의 한 행에서 각 셀이 차지하는 시작 그리드 열(0-based)을 계산한다.
 * 위쪽 행의 rowspan으로 점유된 슬롯은 occupied로 추적해 건너뛴다.
 *
 * @returns 셀별 { startCol, colspan } 배열 (입력 셀 순서 보존)
 */
function computeHeaderRowSlots(
  row: HeaderCell[],
  rowIdx: number,
  occupied: Set<number>[],
): Array<{ startCol: number; colspan: number }> {
  const slots: Array<{ startCol: number; colspan: number }> = [];
  let col = 0;
  for (const cell of row) {
    while (occupied[rowIdx]?.has(col)) col++;
    const colspan = cell.colspan || 1;
    const rowspan = cell.rowspan || 1;
    if (rowspan > 1) {
      for (let r = rowIdx + 1; r < rowIdx + rowspan && r < occupied.length; r++) {
        for (let c = col; c < col + colspan; c++) occupied[r]?.add(c);
      }
    }
    slots.push({ startCol: col, colspan });
    col += colspan;
  }
  return slots;
}

/**
 * 다단계 헤더 그리드를 데이터 컬럼 변경에 맞춰 재동기화한다.
 *
 * 빌더에서 다단계 헤더가 켜진 상태로 열을 추가/삭제하면, 기존 headerGrid는
 * 변경 전 컬럼 수 기준이라 그대로 두면 헤더 폭이 바디와 어긋난다
 * (추가된 열에 헤더 셀이 없거나, 삭제된 열의 헤더가 남아 라벨이 밀림).
 *
 * 슬롯(그리드 열) 좌표로 각 행을 보정한다:
 * - add: 삽입 슬롯이 기존 병합 셀 내부면 그 셀의 colspan을 +1, 경계/말단이면 1x1 리프 셀 삽입.
 * - delete: 삭제 슬롯을 덮는 셀의 colspan을 -1, 1 미만이 되면 셀 제거.
 *
 * rowspan은 슬롯 점유로만 추적하므로 세로 병합은 보존된다.
 *
 * @param grid 기존 헤더 그리드
 * @param change add(삽입될 슬롯) 또는 delete(제거될 슬롯). slot은 0-based 그리드 열.
 * @returns 재동기화된 헤더 그리드 (빈 행은 발생하지 않도록 셀 1개 이상 유지)
 */
export function reconcileHeaderGridForColumnChange(
  grid: HeaderCell[][],
  change: { type: 'add'; slot: number } | { type: 'delete'; slot: number },
): HeaderCell[][] {
  if (!grid || grid.length === 0) return grid;

  const totalRows = grid.length;
  const occupied: Set<number>[] = Array.from({ length: totalRows }, () => new Set<number>());

  return grid.map((row, rowIdx) => {
    const slots = computeHeaderRowSlots(row, rowIdx, occupied);

    if (change.type === 'add') {
      // 삽입 슬롯을 내부에 포함하는 셀(startCol < slot < startCol+colspan)을 찾으면 colspan +1.
      const containingIdx = slots.findIndex(
        (s) => change.slot > s.startCol && change.slot < s.startCol + s.colspan,
      );
      if (containingIdx >= 0) {
        return row.map((cell, i) =>
          i === containingIdx ? { ...cell, colspan: (cell.colspan || 1) + 1 } : cell,
        );
      }
      // 경계/말단: 삽입 슬롯 이후의 첫 셀 앞에 새 1x1 리프 셀 삽입(없으면 끝에 추가).
      const insertIdx = slots.findIndex((s) => s.startCol >= change.slot);
      const newCell: HeaderCell = { id: `hc-${generateInsertId()}`, label: '', colspan: 1, rowspan: 1 };
      const newRow = [...row];
      newRow.splice(insertIdx === -1 ? newRow.length : insertIdx, 0, newCell);
      return newRow;
    }

    // delete: 삭제 슬롯을 덮는 셀을 찾아 colspan -1, 1 미만이면 제거.
    const coverIdx = slots.findIndex(
      (s) => change.slot >= s.startCol && change.slot < s.startCol + s.colspan,
    );
    if (coverIdx < 0) return row;
    const target = row[coverIdx];
    if (!target) return row;
    const nextColspan = (target.colspan || 1) - 1;
    if (nextColspan < 1) {
      return row.filter((_, i) => i !== coverIdx);
    }
    return row.map((cell, i) => (i === coverIdx ? { ...cell, colspan: nextColspan } : cell));
  });
}

let headerCellInsertCounter = 0;
/** 재동기화로 삽입되는 헤더 셀의 고유 id 생성 (generateId 의존 없이 결정적) */
function generateInsertId(): string {
  headerCellInsertCounter += 1;
  return `${Date.now().toString(36)}-${headerCellInsertCounter}`;
}
