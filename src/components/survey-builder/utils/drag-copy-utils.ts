import type { TableCell, TableRow } from '@/types/survey';

// ── 타입 ──

/** 복사된 영역 데이터 (위치 무관 스냅샷) */
export interface CopiedRegion {
  cells: (TableCell | null)[][]; // [relativeRow][relativeCol], null = hidden 위치
  width: number;
  height: number;
}

// ── 상수 ──

/**
 * 영역 복사 시 제외할 속성 키 (위치/ID/병합 관련)
 * 이 키들은 대상 셀의 원래 값을 유지하거나 재생성해야 함
 */
const REGION_EXCLUDED_KEYS = new Set<keyof TableCell>([
  'id',
  'cellCode',
  'exportLabel',
  'isCustomCellCode',
  'isCustomExportLabel',
  'radioGroupName',
]);

/** 타입별 정리 대상 속성 — 셀 타입이 바뀔 때 이전 타입의 잔여 데이터 제거용 */
const TYPE_SPECIFIC_KEYS: Record<string, (keyof TableCell)[]> = {
  checkbox: ['checkboxOptions', 'minSelections', 'maxSelections'],
  radio: ['radioOptions', 'radioGroupName'],
  select: ['selectOptions', 'allowOtherOption'],
  input: ['placeholder', 'inputMaxLength'],
  image: ['imageUrl'],
  video: ['videoUrl'],
  ranking: ['rankingOptions', 'rankingConfig', 'rankSuffixPattern', 'rankVarNames'],
  ranking_opt: ['rankingLabel', 'isOtherRankingCell'],
  choice_opt: ['choiceLabel', 'branchRule', 'allowTextInput', 'textInputPlaceholder'],
};

/**
 * 대상 셀에서 새 타입에 해당하지 않는 잔여 속성을 정리한다.
 * 예: checkbox → radio 복사 시, 대상의 기존 checkboxOptions 제거
 */
export function clearStaleTypeProperties(
  targetCell: Record<string, unknown>,
  newType: string,
): void {
  for (const [type, keys] of Object.entries(TYPE_SPECIFIC_KEYS)) {
    if (type === newType) continue;
    for (const key of keys) {
      if (key in targetCell) {
        targetCell[key] = undefined;
      }
    }
  }
}

// ── 영역 선택 함수 ──

/**
 * 소스↔현재 마우스 위치 셀 사이의 2D 사각형 범위를 계산한다.
 * 소스 셀을 포함한 전체 사각형 영역의 visible 셀을 반환.
 */
export function calculateDragRange(
  sourceRow: number,
  sourceCell: number,
  currentRow: number,
  currentCell: number,
  rows: TableRow[],
): Array<{ rowIndex: number; cellIndex: number }> {
  const minRow = Math.min(sourceRow, currentRow);
  const maxRow = Math.max(sourceRow, currentRow);
  const minCol = Math.min(sourceCell, currentCell);
  const maxCol = Math.max(sourceCell, currentCell);

  const cells: Array<{ rowIndex: number; cellIndex: number }> = [];

  for (let r = minRow; r <= maxRow; r++) {
    const row = rows[r];
    if (!row) continue;
    for (let c = minCol; c <= maxCol; c++) {
      const cell = row.cells[c];
      if (!cell || cell.isHidden) continue;
      cells.push({ rowIndex: r, cellIndex: c });
    }
  }

  return cells;
}

/**
 * 선택 영역이 병합 셀 경계를 자르는 경우 자동 확장한다.
 * 영역 내 앵커 셀의 span이 밖으로 나가거나, 영역 밖 앵커가 영역 안 hidden 셀을 커버하면 확장.
 */
export function expandSelectionForMerges(
  minRow: number,
  maxRow: number,
  minCol: number,
  maxCol: number,
  rows: TableRow[],
): { minRow: number; maxRow: number; minCol: number; maxCol: number } {
  let mr = minRow;
  let MR = maxRow;
  let mc = minCol;
  let MC = maxCol;

  // 수렴할 때까지 반복 (최대 10회)
  for (let iter = 0; iter < 10; iter++) {
    let expanded = false;

    // 전체 테이블에서 앵커 셀을 찾아 영역과 겹치는지 확인
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (!row) continue;
      for (let c = 0; c < row.cells.length; c++) {
        const cell = row.cells[c];
        if (!cell) continue;
        const rs = cell.rowspan || 1;
        const cs = cell.colspan || 1;
        if (rs <= 1 && cs <= 1) continue;

        // 앵커 셀의 span 영역
        const anchorEndRow = r + rs - 1;
        const anchorEndCol = c + cs - 1;

        // 앵커 영역과 선택 영역이 겹치는지 확인
        const overlaps =
          r <= MR && anchorEndRow >= mr && c <= MC && anchorEndCol >= mc;

        if (overlaps) {
          // 앵커 영역이 선택 영역 밖으로 나가면 확장
          if (r < mr) { mr = r; expanded = true; }
          if (anchorEndRow > MR) { MR = anchorEndRow; expanded = true; }
          if (c < mc) { mc = c; expanded = true; }
          if (anchorEndCol > MC) { MC = anchorEndCol; expanded = true; }
        }
      }
    }

    if (!expanded) break;
  }

  return { minRow: mr, maxRow: MR, minCol: mc, maxCol: MC };
}

/**
 * 사각형 범위의 셀을 딥클론하여 CopiedRegion으로 추출한다.
 * hidden 셀은 null, 나머지는 위치/ID 관련 속성 제거 후 저장.
 */
export function extractRegionFromRows(
  minRow: number,
  maxRow: number,
  minCol: number,
  maxCol: number,
  rows: TableRow[],
): CopiedRegion {
  const height = maxRow - minRow + 1;
  const width = maxCol - minCol + 1;
  const cells: (TableCell | null)[][] = [];

  for (let r = minRow; r <= maxRow; r++) {
    const rowCells: (TableCell | null)[] = [];
    const row = rows[r];

    for (let c = minCol; c <= maxCol; c++) {
      const cell = row?.cells[c];
      if (!cell || cell.isHidden) {
        rowCells.push(null);
        continue;
      }

      // 위치/ID 관련 속성 제거 후 딥클론
      const cleaned: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(cell)) {
        if (!REGION_EXCLUDED_KEYS.has(key as keyof TableCell)) {
          cleaned[key] = value;
        }
      }
      rowCells.push(structuredClone(cleaned) as unknown as TableCell);
    }

    cells.push(rowCells);
  }

  return { cells, width, height };
}

// ── 붙여넣기 검증 ──

export interface PasteConflictResult {
  blocked: boolean;
  message?: string;
}

/**
 * 붙여넣기 대상 영역의 충돌을 검사한다.
 * - 테이블 범위 초과
 * - 대상 영역 내/외 병합 셀 충돌
 */
export function checkPasteConflict(
  region: CopiedRegion,
  targetRow: number,
  targetCol: number,
  rows: TableRow[],
): PasteConflictResult {
  const endRow = targetRow + region.height - 1;
  const endCol = targetCol + region.width - 1;
  const totalRows = rows.length;
  const totalCols = rows[0]?.cells.length ?? 0;

  // 범위 초과 검사
  if (endRow >= totalRows || endCol >= totalCols) {
    return {
      blocked: true,
      message: `테이블 범위를 초과합니다. (필요: ${region.height}행 × ${region.width}열, 남은 공간: ${totalRows - targetRow}행 × ${totalCols - targetCol}열)`,
    };
  }

  // 대상 영역 내 병합 충돌 검사
  for (let r = 0; r < totalRows; r++) {
    const row = rows[r];
    if (!row) continue;
    for (let c = 0; c < row.cells.length; c++) {
      const cell = row.cells[c];
      if (!cell) continue;
      const rs = cell.rowspan || 1;
      const cs = cell.colspan || 1;
      if (rs <= 1 && cs <= 1) continue;

      const anchorEndRow = r + rs - 1;
      const anchorEndCol = c + cs - 1;

      // 앵커 영역과 대상 영역이 겹치는지
      const overlaps =
        r <= endRow && anchorEndRow >= targetRow &&
        c <= endCol && anchorEndCol >= targetCol;

      if (!overlaps) continue;

      // 앵커 영역이 대상 영역을 벗어나면 충돌
      const fullyInside =
        r >= targetRow && anchorEndRow <= endRow &&
        c >= targetCol && anchorEndCol <= endCol;

      if (!fullyInside) {
        return {
          blocked: true,
          message: '대상 영역에 충돌하는 병합 셀이 있습니다.',
        };
      }
    }
  }

  return { blocked: false };
}
