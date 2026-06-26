import type { TableCell } from '@/types/survey';

export interface SplitDisplayCells {
  inline: TableCell[];
  collapsed: TableCell[];
}

const DISPLAY_CELL_TYPES = new Set<TableCell['type']>(['text', 'image', 'video']);

function isMobileDisplayCell(cell: TableCell): boolean {
  return (
    !cell.isHidden &&
    !cell._isContinuation &&
    DISPLAY_CELL_TYPES.has(cell.type) &&
    (cell.mobileDisplay === 'inline' || cell.mobileDisplay === 'collapsed')
  );
}

/**
 * 셀 배열(보통 한 행의 cells)에서 모바일 카드에 표시할 display 셀(text/image/video)을
 * mobileDisplay 설정에 따라 분류한다.
 * - 입력 셀 타입(radio, checkbox, select, input, ranking, ranking_opt, choice_opt) / isHidden / _isContinuation 은 제외
 *   (입력 셀은 응답 컨트롤로 렌더링되므로 표시 콘텐츠가 아님)
 * - mobileDisplay 'hidden' 또는 미지정 → 어느 목록에도 포함하지 않음(기본 숨김)
 */
export function splitMobileDisplayCells(cells: TableCell[]): SplitDisplayCells {
  const inline: TableCell[] = [];
  const collapsed: TableCell[] = [];
  for (const cell of cells) {
    if (!isMobileDisplayCell(cell)) continue;
    if (cell.mobileDisplay === 'inline') {
      inline.push(cell);
    } else {
      collapsed.push(cell);
    }
  }
  return { inline, collapsed };
}

export function hasMobileDisplayCells(cells: TableCell[]): boolean {
  return cells.some(isMobileDisplayCell);
}

/**
 * 모바일 카드의 제목으로 사용할 셀을 찾는다.
 * mobileDisplay 'header' 로 명시 지정된 첫 text 셀(비숨김/비continuation)을 반환.
 * 없으면 undefined — 호출부가 자체 폴백(옵션 라벨, 행 라벨 등)을 사용한다.
 */
export function findMobileHeaderCell(cells: TableCell[]): TableCell | undefined {
  return cells.find(
    (cell) =>
      !cell.isHidden &&
      !cell._isContinuation &&
      cell.type === 'text' &&
      cell.mobileDisplay === 'header',
  );
}

/**
 * 저작자가 모바일 카드 제목으로 쓰일 수 있는 text 셀을 명시적으로 숨겼는지 확인한다.
 * 이 경우 호출부는 row.label/라디오 라벨 폴백 제목을 만들지 않아야 한다.
 */
export function hasExplicitHiddenMobileHeaderCell(cells: TableCell[]): boolean {
  return cells.some(
    (cell) =>
      !cell.isHidden &&
      !cell._isContinuation &&
      cell.type === 'text' &&
      cell.mobileDisplay === 'hidden',
  );
}
