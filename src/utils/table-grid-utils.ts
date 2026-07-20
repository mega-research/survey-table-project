import type { CSSProperties } from 'react';

import { cn } from '@/lib/utils';
import type { TableColumn, TableRow } from '@/types/survey';

// ── grid-template-columns 생성 ──

export function buildGridTemplateCols(columns: TableColumn[]): string {
  return columns.map((col) => `${col.width || 150}px`).join(' ');
}

export function buildGridTemplateColsWithRowHeader(
  rowHeaderWidth: number,
  columns: TableColumn[],
): string {
  return `${rowHeaderWidth}px ${buildGridTemplateCols(columns)}`;
}

// ── 전체 테이블 너비 계산 ──

export function calcTotalWidth(columns: TableColumn[]): number {
  return columns.reduce((sum, col) => sum + (col.width || 150), 0);
}

// ── 셀 grid span 스타일 ──

export function getGridSpanStyle(
  colspan?: number,
  rowspan?: number,
): CSSProperties | undefined {
  const cs = colspan && colspan > 1 ? `span ${colspan}` : undefined;
  const rs = rowspan && rowspan > 1 ? `span ${rowspan}` : undefined;
  if (!cs && !rs) return undefined;
  return {
    ...(cs && { gridColumn: cs }),
    ...(rs && { gridRow: rs }),
  };
}

// ── 셀 정렬 Tailwind 클래스 ──
// flex-col 기반:
//   세로 정렬 → justify-start/center/end (main axis)
//   가로 정렬 → items-start/center/end (cross axis) + text-left/center/right (텍스트용)

const H_ITEMS_MAP = {
  left: 'items-start text-left',
  center: 'items-center text-center',
  right: 'items-end text-right',
} as const;

const V_JUSTIFY_MAP = {
  top: 'justify-start',
  middle: 'justify-center',
  bottom: 'justify-end',
} as const;

export function getAlignmentClasses(
  horizontalAlign?: 'left' | 'center' | 'right',
  verticalAlign?: 'top' | 'middle' | 'bottom',
): string {
  return cn(
    'flex flex-col',
    V_JUSTIFY_MAP[verticalAlign || 'top'],
    H_ITEMS_MAP[horizontalAlign || 'left'],
  );
}

// ── ARIA 속성 ──

export function getGridCellAria(
  role: 'gridcell' | 'columnheader' | 'rowheader' = 'gridcell',
  colspan?: number,
  rowspan?: number,
): Record<string, string | number> {
  const attrs: Record<string, string | number> = { role };
  if (colspan && colspan > 1) attrs['aria-colspan'] = colspan;
  if (rowspan && rowspan > 1) attrs['aria-rowspan'] = rowspan;
  return attrs;
}

// ── Grid 컨테이너 공통 스타일 ──

export function getGridContainerStyle(
  columns: TableColumn[],
  extraWidth?: number,
): CSSProperties {
  const totalWidth = calcTotalWidth(columns) + (extraWidth || 0);
  return {
    display: 'grid',
    gridTemplateColumns: extraWidth
      ? buildGridTemplateColsWithRowHeader(extraWidth, columns)
      : buildGridTemplateCols(columns),
    width: `${totalWidth}px`,
    minWidth: `${totalWidth}px`,
  };
}

// ── Sticky 좌측 열 판정 ──

// 좌측 sticky 대상 셀 타입: 정적 셀 + 라벨 전용 radio
const STICKY_ELIGIBLE_CELL_TYPES = new Set(['text', 'image', 'video']);

/**
 * 셀이 좌측 sticky 후보인지. radio 는 "라디오 1개짜리 라벨 셀"(행 라벨 용도)만
 * 허용한다 — 응답용 radio(옵션 여러 개)까지 후보로 인정하면 colspan 점유 열
 * (판정 스킵)과 결합해 sticky 범위가 척도 영역까지 번지고, 태블릿 폭에서
 * 너비 클램프에 걸리면 "몇 열만 고정 + 다음 열 겹침" 깨짐이 생긴다.
 */
function isStickyEligibleCell(cell: TableRow['cells'][number]): boolean {
  if (STICKY_ELIGIBLE_CELL_TYPES.has(cell.type)) return true;
  return cell.type === 'radio' && (cell.radioOptions?.length ?? 0) <= 1;
}
// 2 = [라벨 열 + 응답 colspan 열] 구조도 라벨 고정 대상 (스크롤 열 1개 이상만 남으면 됨)
const MIN_COLUMNS_FOR_STICKY = 2;

/** 헤더 행의 최소 높이(px). sticky 활성 시 grid row가 contents 높이로 붕괴되는 것을 방지 */
export const HEADER_ROW_MIN_HEIGHT = 40;
/** 바디 sticky 셀의 z-index (페이지 sticky 헤더보다 낮게) */
export const STICKY_BODY_Z = 10;
/**
 * 좌측 sticky 열이 차지할 수 있는 스크롤 뷰포트 너비의 최대 비율.
 * 누적 sticky 너비가 (뷰포트 폭 × 이 비율)을 넘으면 뒤쪽 sticky 후보 열부터
 * 일반 스크롤 열로 돌린다. 좁은 화면(태블릿 등)에서 넓은 텍스트 열이 sticky로
 * 화면을 거의 다 덮어 가로 스크롤 영역이 사라지는 것을 방지한다. 최소 1열은 유지.
 * 데스크톱처럼 넓은 뷰포트에서는 임계가 커져 기존 동작(다열 sticky)이 유지된다.
 * 체감이 안 맞으면 이 값만 조정한다.
 */
export const STICKY_MAX_VIEWPORT_RATIO = 0.6;

export interface StickyLeftInfo {
  stickyColCount: number;
  leftOffsets: number[];
}

/**
 * 좌측부터 연속된 정적(text/image/video) 셀로만 이루어진 열의 개수를 계산한다.
 * 인터랙티브 셀(radio/checkbox/select/input)이 나오면 경계. colspan으로 경계를 가로지르는 셀도 경계로 간주.
 *
 * 가드:
 * - 열이 MIN_COLUMNS_FOR_STICKY 미만이면 비활성 (가로 스크롤이 없거나 적음)
 * - 전체 열이 sticky 대상이 되어 가로 스크롤 의미가 없어지면 비활성
 * - 누적 sticky 너비가 maxStickyWidth를 넘으면 뒤쪽 열부터 sticky 제외 (최소 1열 유지)
 *
 * @param maxStickyWidth sticky 열 누적 너비 상한(px). 좁은 뷰포트에서 넓은 텍스트 열이
 *   화면을 다 가리는 것을 막는다. undefined면 너비 제한 없음(미측정 시점 fallback).
 */
export function computeStickyLeftColumns(
  visibleColumns: TableColumn[],
  visibleRows: TableRow[],
  maxStickyWidth?: number,
): StickyLeftInfo {
  const leftOffsets: number[] = [];
  let acc = 0;
  for (const col of visibleColumns) {
    leftOffsets.push(acc);
    acc += col.width || 150;
  }

  if (visibleColumns.length < MIN_COLUMNS_FOR_STICKY) {
    return { stickyColCount: 0, leftOffsets };
  }

  let stickyColCount = 0;
  let stickyWidth = 0;
  for (let colIdx = 0; colIdx < visibleColumns.length; colIdx++) {
    let ok = true;
    for (const row of visibleRows) {
      const cell = row.cells[colIdx];
      if (!cell) continue;
      // colspan으로 점유돼 숨겨진 셀은 건너뜀 (colspan 자체는 경계 위반 아님 — 각 열 독립 판정)
      if (cell.isHidden) continue;
      if (cell._isContinuation) continue;
      if (!isStickyEligibleCell(cell)) {
        ok = false;
        break;
      }
    }
    if (!ok) break;

    // 너비 컷: 이미 1열 이상 확보했고 이 열을 더하면 상한을 넘으면 중단한다.
    // 좁은 화면에서 넓은 텍스트 열(예: "직업 설명 및 예시")이 sticky로 뷰포트를
    // 거의 다 덮어 가로 스크롤 공간이 사라지는 것을 방지. 최소 1열은 항상 sticky.
    const colWidth = visibleColumns[colIdx]?.width || 150;
    if (
      maxStickyWidth !== undefined &&
      stickyColCount >= 1 &&
      stickyWidth + colWidth > maxStickyWidth
    ) {
      break;
    }
    stickyWidth += colWidth;
    stickyColCount++;
  }

  // 스크롤할 열이 하나도 안 남으면(전 열 고정) 비활성
  if (stickyColCount >= visibleColumns.length) {
    return { stickyColCount: 0, leftOffsets };
  }

  return { stickyColCount, leftOffsets };
}

// ── 헤더 셀 sticky 스타일 ──
//
// 좌측 sticky 영역에 들어가는 헤더 셀에 left sticky + z-index + 경계 그림자를
// 부여한다. 페이지 기준 sticky 헤더 래퍼 내부에서 동작하므로 top은 적용하지 않는다.

const STICKY_CORNER_Z = 30;

/** 좌측 sticky 영역에 속하는 헤더 셀인지 판정 */
export function isHeaderCellInStickyLeft(
  startCol: number,
  stickyColCount: number,
): boolean {
  return startCol <= stickyColCount;
}

/** 좌측 sticky 영역의 **마지막** 열을 차지하는 셀인지 (경계 그림자용) */
export function isHeaderCellAtStickyBoundary(
  startCol: number,
  colspan: number,
  stickyColCount: number,
): boolean {
  return startCol + colspan - 1 === stickyColCount;
}

/**
 * 헤더 셀의 sticky 스타일을 생성한다 (left sticky 전용).
 * - 좌측 sticky 영역 바깥이면 undefined 반환
 * - 마지막 sticky 열이면 우측에 경계 그림자 적용
 */
export function getHeaderCellStickyStyle(
  startCol: number,
  colspan: number,
  stickyInfo: StickyLeftInfo | undefined,
): CSSProperties | undefined {
  if (!stickyInfo || stickyInfo.stickyColCount === 0) return undefined;
  if (!isHeaderCellInStickyLeft(startCol, stickyInfo.stickyColCount)) return undefined;
  const style: CSSProperties = {
    position: 'sticky',
    left: stickyInfo.leftOffsets[startCol - 1],
    zIndex: STICKY_CORNER_Z,
  };
  if (isHeaderCellAtStickyBoundary(startCol, colspan, stickyInfo.stickyColCount)) {
    style.boxShadow = '2px 0 4px rgba(0,0,0,0.06)';
  }
  return style;
}

// ── 행 hover/완료 상태 클래스 ──

export function getRowCellClasses(completed: boolean): string {
  return completed ? 'bg-green-50/40' : 'bg-white';
}

export function getHeaderCellClasses(): string {
  return 'bg-gray-50 px-4 py-3 text-center font-semibold text-gray-800';
}

export function getBodyCellClasses(
  horizontalAlign?: 'left' | 'center' | 'right',
  verticalAlign?: 'top' | 'middle' | 'bottom',
): string {
  return cn(
    'min-w-0 p-3',
    getAlignmentClasses(horizontalAlign, verticalAlign),
  );
}
