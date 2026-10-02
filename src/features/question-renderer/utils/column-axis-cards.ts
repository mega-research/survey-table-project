import type { HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';

import { expandHeaderGrid } from './expand-header-grid';

/**
 * 테이블 유형의 「축 단위 카드」 — 응답 칸이 놓인 **열마다 카드 하나**, 그 안에 행을 차례로 세운다
 * (CONTEXT.md 「축 단위 카드」). 「2025년 · 2026년」처럼 열이 축이고 행 목록이 같은 입력 표에서,
 * 행 카드(행마다 열을 되풀이)보다 한 축을 끝까지 채우고 다음 축으로 넘어가는 편이 읽기 쉽다.
 *
 * 보기 소스 표의 축 단위 카드(보기 그룹 = 축)와 얼굴은 같고 재료만 다르다 — 여기는 축이 열이다.
 * 묶음 규칙은 이 투영 하나이고 컴포넌트는 그리기만 한다.
 */

export interface ColumnAxisCardItem {
  cell: TableCell;
  row: TableRow;
  /** 행 제목 — 그 행의 응답 칸 앞에 놓인 글자 셀 중 마지막. 없으면 row.label */
  label: string;
  /** 행 제목이 된 글자 셀 — 서식본(contentHtml)·굵게를 그대로 쓰려고 넘긴다 */
  labelCell: TableCell | undefined;
}

export interface ColumnAxisCard {
  /** 열 id */
  key: string;
  /** 카드 제목 — 그 열을 덮는 가장 아래 헤더 글자(줄바꿈은 공백으로) */
  title: string;
  /** 다단 헤더의 위쪽 글자들(위 → 아래) — 제목 위 작은 회색 줄 */
  ancestors: string[];
  items: ColumnAxisCardItem[];
}

/** 응답 칸 — 표시 전용(text·image·video)과 보기 소스 칸(choice_opt·ranking_opt)은 축 카드 몫이 아니다 */
const ANSWER_CELL_TYPES = new Set<TableCell['type']>([
  'input',
  'radio',
  'checkbox',
  'select',
  'ranking',
  'calc',
]);

function isVisible(cell: TableCell): boolean {
  return !cell.isHidden && !cell._isContinuation;
}

function isAnswerCell(cell: TableCell): boolean {
  return isVisible(cell) && ANSWER_CELL_TYPES.has(cell.type);
}

function normalize(label: string | undefined): string {
  return (label ?? '').replace(/\s+/g, ' ').trim();
}

/** 열 하나를 덮는 헤더 글자 경로(위 → 아래, 이웃 중복 제거). 다단 헤더가 없으면 열 제목 하나 */
function headerPath(
  columns: readonly TableColumn[],
  headerGrid: HeaderCell[][] | undefined,
  columnIndex: number,
): string[] {
  if (!headerGrid || headerGrid.length === 0) {
    const label = normalize(columns[columnIndex]?.label);
    return label ? [label] : [];
  }
  const path: string[] = [];
  const covering = expandHeaderGrid(headerGrid)
    .filter(
      (item) => columnIndex >= item.startCol - 1 && columnIndex < item.startCol - 1 + item.colSpan,
    )
    .sort((a, b) => a.rowIdx - b.rowIdx);
  for (const item of covering) {
    const label = normalize(item.cell.label);
    if (label && path.at(-1) !== label) path.push(label);
  }
  return path;
}

/** 행 제목 — 첫 응답 칸 앞의 글자 셀 중 마지막(저작자가 모바일에서 숨긴 셀은 제외) */
function rowLabel(row: TableRow): Pick<ColumnAxisCardItem, 'label' | 'labelCell'> {
  const firstAnswer = row.cells.findIndex(isAnswerCell);
  const leading = firstAnswer < 0 ? row.cells : row.cells.slice(0, firstAnswer);
  for (let index = leading.length - 1; index >= 0; index -= 1) {
    const cell = leading[index]!;
    if (
      cell.type === 'text' &&
      isVisible(cell) &&
      cell.mobileDisplay !== 'hidden' &&
      (cell.content ?? '').trim() !== ''
    ) {
      return { label: cell.content.trim(), labelCell: cell };
    }
  }
  return { label: (row.label ?? '').trim(), labelCell: undefined };
}

/**
 * 열마다 카드를 만든다. `columns` 와 `displayRows` 의 셀은 인덱스가 맞아야 한다(표시 조건으로 걸러진
 * 뒤의 열·행). 응답 칸이 하나도 없는 열(구분·단위 열)은 카드가 되지 않는다. 가로 병합된 응답 칸은
 * 시작 열 카드에, 세로 병합된 칸은 시작 행에만 놓인다(가려진 자리는 isHidden 이라 건너뛴다).
 */
export function buildColumnAxisCards(input: {
  columns: readonly TableColumn[];
  headerGrid?: HeaderCell[][] | undefined;
  displayRows: readonly TableRow[];
}): ColumnAxisCard[] {
  const labels = new Map(input.displayRows.map((row) => [row.id, rowLabel(row)]));
  const cards: ColumnAxisCard[] = [];
  for (const [columnIndex, column] of input.columns.entries()) {
    const items: ColumnAxisCardItem[] = [];
    for (const row of input.displayRows) {
      const cell = row.cells[columnIndex];
      if (!cell || !isAnswerCell(cell)) continue;
      items.push({ cell, row, ...labels.get(row.id)! });
    }
    if (items.length === 0) continue;
    const path = headerPath(input.columns, input.headerGrid, columnIndex);
    cards.push({
      key: column.id,
      title: path.at(-1) ?? '',
      ancestors: path.slice(0, -1),
      items,
    });
  }
  return cards;
}
