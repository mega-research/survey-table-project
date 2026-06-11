/**
 * pretext 기반 행 높이 사전 계산 훅
 * DOM 접근 없이 각 행의 높이를 순수 산술로 계산
 */
import { useMemo } from 'react';

import { prepare, layout } from '@chenglou/pretext';
import type { PreparedText } from '@chenglou/pretext';

import type { TableCell, TableColumn, TableRow } from '@/types/survey';

// 셀 렌더링 상수 (CSS와 동기화 필요)
const MIN_ROW_HEIGHT = 44;
const CELL_PADDING_Y = 24; // py-3 = 12px × 2
const CELL_PADDING_X = 24; // px-3 = 12px × 2
const OPTION_HEIGHT = 28; // 체크박스/라디오 한 줄 높이
const SELECT_HEIGHT = 36; // 드롭다운 높이
const IMAGE_HEIGHT = 120; // 기본 이미지 높이
const VIDEO_HEIGHT = 80; // 비디오 링크 높이
const LINE_HEIGHT = 20; // 텍스트 라인 높이

// 프로젝트 폰트 (globals.css --font-sans와 일치)
// pretext는 canvas font 엔진을 ground truth로 쓰므로 실제 로드된 폰트명과 정확히 일치해야 함.
// layout.tsx에서 "Wanted Sans Variable" 웹폰트를 로드하고 globals.css --font-sans도 동일.
// (이전 'Pretendard'는 미로드 폰트 → 브라우저 폴백 대체 → 측정값이 렌더 높이와 어긋남)
const TABLE_FONT = '14px "Wanted Sans Variable"';

/**
 * 셀 타입에 따른 높이 계산
 */
export function computeCellHeight(
  cell: TableCell,
  colWidth: number,
  preparedCache: Map<string, PreparedText>,
  cacheKey: string,
): number {
  const contentWidth = colWidth - CELL_PADDING_X;

  switch (cell.type) {
    case 'text': {
      const prepared = preparedCache.get(cacheKey);
      if (prepared && contentWidth > 0) {
        const { height } = layout(prepared, contentWidth, LINE_HEIGHT);
        return height + CELL_PADDING_Y;
      }
      return MIN_ROW_HEIGHT;
    }

    case 'input':
      return MIN_ROW_HEIGHT;

    case 'checkbox': {
      const count = cell.checkboxOptions?.length ?? 1;
      return count * OPTION_HEIGHT + CELL_PADDING_Y;
    }

    case 'radio': {
      const count = cell.radioOptions?.length ?? 1;
      return count * OPTION_HEIGHT + CELL_PADDING_Y;
    }

    case 'select':
      return SELECT_HEIGHT + CELL_PADDING_Y;

    case 'image':
      return IMAGE_HEIGHT + CELL_PADDING_Y;

    case 'video':
      return VIDEO_HEIGHT + CELL_PADDING_Y;

    default:
      return MIN_ROW_HEIGHT;
  }
}

interface UseRowHeightsOptions {
  displayRows: TableRow[];
  columnWidths: number[];
  /** pretext font 문자열 (기본: '14px "Wanted Sans Variable"') */
  font?: string;
}

/**
 * 행별 높이를 pretext로 사전 계산
 *
 * - prepare(): 텍스트 변경 시에만 재실행 (Map 캐시)
 * - layout(): 열 너비 변경 시마다 호출해도 ~0.09ms/500개
 *
 * @returns rowHeights — 각 행의 계산된 높이 (px)
 */
export function useRowHeights({
  displayRows,
  columnWidths,
  font = TABLE_FONT,
}: UseRowHeightsOptions): number[] {
  // 1단계: prepare 캐시 — 텍스트 내용이 바뀔 때만 재생성
  const preparedCache = useMemo(() => {
    const cache = new Map<string, PreparedText>();

    for (const row of displayRows) {
      for (let colIdx = 0; colIdx < row.cells.length; colIdx++) {
        const cell = row.cells[colIdx];
        if (!cell || cell.isHidden) continue;

        // text 타입만 pretext로 측정 (나머지는 공식 기반)
        if (cell.type === 'text' && cell.content) {
          cache.set(`${row.id}-${colIdx}`, prepare(cell.content, font));
        }
      }
    }

    return cache;
  }, [displayRows, font]);

  // 2단계: 행 높이 계산 — 열 너비 변경 시에도 재계산 (layout은 순수 산술)
  const rowHeights = useMemo(() => {
    return displayRows.map((row) => {
      let maxHeight = MIN_ROW_HEIGHT;

      for (let colIdx = 0; colIdx < row.cells.length; colIdx++) {
        const cell = row.cells[colIdx];
        if (!cell || cell.isHidden) continue;

        const colWidth = columnWidths[colIdx] ?? 150;
        const cacheKey = `${row.id}-${colIdx}`;
        const cellHeight = computeCellHeight(cell, colWidth, preparedCache, cacheKey);

        maxHeight = Math.max(maxHeight, cellHeight);
      }

      return maxHeight;
    });
  }, [displayRows, columnWidths, preparedCache]);

  return rowHeights;
}

// ── 헤더/행 합산 상수 ──
const HEADER_ROW_HEIGHT = 45; // py-3 + font + border
const TABLE_CARD_PADDING = 32; // CardContent padding + border

/**
 * 테이블 전체 높이를 pretext로 사전 계산 (DOM 접근 없음)
 * LazyMount placeholder 높이로 사용 → 스크롤 밀림 방지
 */
export function computeTableEstimatedHeight(
  columns: TableColumn[],
  rows: TableRow[],
  headerGrid?: { colspan?: number; rowspan?: number; label?: string }[][],
  font = TABLE_FONT,
): number {
  if (columns.length === 0 || rows.length === 0) return 128;

  // 열 너비 (column.width 또는 기본 150px)
  const columnWidths = columns.map((col) => col.width || 150);

  // prepare 캐시 (텍스트 셀만)
  const preparedCache = new Map<string, PreparedText>();
  for (const row of rows) {
    for (let colIdx = 0; colIdx < row.cells.length; colIdx++) {
      const cell = row.cells[colIdx];
      if (!cell || cell.isHidden) continue;
      if (cell.type === 'text' && cell.content) {
        preparedCache.set(`${row.id}-${colIdx}`, prepare(cell.content, font));
      }
    }
  }

  // 행 높이 합산
  let totalRowHeight = 0;
  for (const row of rows) {
    let maxHeight = MIN_ROW_HEIGHT;
    for (let colIdx = 0; colIdx < row.cells.length; colIdx++) {
      const cell = row.cells[colIdx];
      if (!cell || cell.isHidden) continue;
      const colWidth = columnWidths[colIdx] ?? 150;
      const cellHeight = computeCellHeight(cell, colWidth, preparedCache, `${row.id}-${colIdx}`);
      maxHeight = Math.max(maxHeight, cellHeight);
    }
    totalRowHeight += maxHeight;
  }

  // 헤더 높이
  const headerRows = headerGrid?.length || 1;
  const headerHeight = headerRows * HEADER_ROW_HEIGHT;

  return headerHeight + totalRowHeight + TABLE_CARD_PADDING;
}
