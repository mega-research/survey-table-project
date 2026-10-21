import type { HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';

import { expandHeaderGrid } from './expand-header-grid';
import { buildTableRowspanCoverage } from './table-rowspan-coverage';

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
  /**
   * 행 제목보다 앞에 놓인 상위 구분 셀들(왼쪽 → 오른쪽) — 세로 병합으로 위 행에서 내려온 것 포함
   * (「내부 R&D」 아래 ①②③). 카드 안에서 구분이 바뀌는 자리에 소제목으로 선다.
   */
  groupCells: TableCell[];
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
export function headerPath(
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

const isLabelText = (cell: TableCell): boolean =>
  cell.type === 'text' && cell.mobileDisplay !== 'hidden' && (cell.content ?? '').trim() !== '';

/**
 * 행 제목 — 첫 응답 칸 앞의 글자 셀 중 마지막(저작자가 모바일에서 숨긴 셀은 제외). 그보다 앞의 글자
 * 셀은 상위 구분이다. 상위 구분은 세로 병합으로 위 행에서 내려온 셀도 센다 — 아래 행이 제 구분을
 * 잃지 않는다. 행 제목은 그 행 자신의 셀만 된다(내려온 셀은 여러 행의 것이라 행을 구분하지 못한다).
 */
function rowLabel(
  row: TableRow,
  covered: ReadonlyArray<TableCell | undefined>,
): Pick<ColumnAxisCardItem, 'label' | 'labelCell' | 'groupCells'> {
  const firstAnswer = row.cells.findIndex(isAnswerCell);
  const end = firstAnswer < 0 ? row.cells.length : firstAnswer;
  let labelIndex = -1;
  for (let index = end - 1; index >= 0; index -= 1) {
    const cell = row.cells[index]!;
    if (isVisible(cell) && isLabelText(cell)) {
      labelIndex = index;
      break;
    }
  }
  const groupCells: TableCell[] = [];
  for (let index = 0; index < (labelIndex < 0 ? end : labelIndex); index += 1) {
    const own = row.cells[index]!;
    // 자기 셀이 보이면 그 셀, 가려졌으면 위에서 내려온 세로 병합 셀(가로 병합에 덮인 자리는 자기 자신이 돌아온다)
    const cell = isVisible(own) ? own : covered[index];
    if (!cell || (cell === own && !isVisible(own))) continue;
    if (isLabelText(cell) && !groupCells.includes(cell)) groupCells.push(cell);
  }
  const labelCell = labelIndex < 0 ? undefined : row.cells[labelIndex];
  return labelCell
    ? { label: labelCell.content.trim(), labelCell, groupCells }
    : { label: (row.label ?? '').trim(), labelCell: undefined, groupCells };
}

/**
 * 열마다 카드를 만든다. `columns` 와 `displayRows` 의 셀은 인덱스가 맞아야 한다(표시 조건으로 걸러진
 * 뒤의 열·행). 응답 칸이 하나도 없는 열(구분·단위 열)은 카드가 되지 않는다. 가로 병합된 응답 칸은
 * 시작 열 카드에, 세로 병합된 칸은 시작 행에만 놓인다(가려진 자리는 isHidden 이라 건너뛴다).
 */
export function buildColumnAxisCards(input: {
  columns: readonly TableColumn[];
  headerGrid?: HeaderCell[][] | undefined;
  displayRows: TableRow[];
}): ColumnAxisCard[] {
  const coverage = buildTableRowspanCoverage(input.displayRows);
  const labels = new Map(
    input.displayRows.map((row) => [row.id, rowLabel(row, coverage.get(row.id) ?? row.cells)]),
  );
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

/**
 * 셀마다 「행 제목 · 열 제목」 — 축 단위 카드와 같은 행 제목·열 제목 규칙으로, 응답 칸이 아닌 셀
 * (표 이미지 셀 등)에도 자리를 붙인다. 이미지 크게 보기의 머리 줄이 쓴다. 빈 조각과 앞 조각과 같은
 * 글자는 뺀다. 토큰 치환 전이다.
 */
export function buildCellPositionLabels(input: {
  columns: readonly TableColumn[];
  headerGrid?: HeaderCell[][] | undefined;
  displayRows: TableRow[];
}): Map<string, string> {
  const coverage = buildTableRowspanCoverage(input.displayRows);
  const columnTitles = input.columns.map(
    (_, columnIndex) => headerPath(input.columns, input.headerGrid, columnIndex).at(-1) ?? '',
  );
  const labels = new Map<string, string>();
  for (const row of input.displayRows) {
    const rowTitle = normalize(rowLabel(row, coverage.get(row.id) ?? row.cells).label);
    for (const [columnIndex, cell] of row.cells.entries()) {
      if (!isVisible(cell)) continue;
      const parts: string[] = [];
      for (const part of [rowTitle, columnTitles[columnIndex] ?? '']) {
        if (part && !parts.includes(part)) parts.push(part);
      }
      labels.set(cell.id, parts.join(' · '));
    }
  }
  return labels;
}

/**
 * 행 제목을 체크 칸의 보기 라벨로 옮긴 셀 — 「행 제목 한 줄 + 그 아래 글자 없는 체크박스 하나」를
 * 「☐ 행 제목」 한 줄로 그리기 위한 것이다. 해당하지 않으면 null(종전대로 제목 위 · 컨트롤 아래).
 *
 * 대상은 **보기가 하나뿐이고 그 보기에 글자가 없는 체크 칸**이다 — 기관 × 연도 표처럼 행 제목이 곧
 * 그 체크의 뜻인 칸. 보기에 글자가 있거나 여럿이면 행 제목은 묶음 이름이라 위에 둬야 한다.
 * 라벨이 되면 눌러서 체크할 수 있고, 줄바꿈(좁은 PC 열에 맞춘 것)은 띄어쓰기로 편다.
 *
 * 그리는 자리만 바꾼다 — 원본 셀·응답값·보기 id 는 그대로다. 게이팅으로 닫힌 칸은 컨트롤과 함께
 * 이 라벨도 그려지지 않는다(라벨이 컨트롤의 일부가 됐으므로).
 */
export function withRowTitleAsCheckLabel(cell: TableCell, rowTitle: string): TableCell | null {
  if (cell.type !== 'checkbox') return null;
  const options = cell.checkboxOptions ?? [];
  const only = options[0];
  if (options.length !== 1 || !only) return null;
  if ((only.label ?? '').trim() !== '' || (cell.content ?? '').trim() !== '') return null;
  const label = normalize(rowTitle);
  if (!label) return null;
  return { ...cell, checkboxOptions: [{ ...only, label }] };
}
