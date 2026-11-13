import type { HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';
import { collectGateControllerIds } from '@/utils/cell-gate-tree';

import { expandHeaderGrid } from './expand-header-grid';
import { buildTableRowspanCoverage } from './table-rowspan-coverage';

/**
 * 테이블 유형의 「축 단위 카드」 — 응답 칸이 놓인 **열마다 카드 하나**, 그 안에 행을 차례로 세운다
 * (CONTEXT.md 「축 단위 카드」). 「2025년 · 2026년」처럼 열이 축이고 행 목록이 같은 입력 표에서,
 * 행 카드(행마다 열을 되풀이)보다 한 축을 끝까지 채우고 다음 축으로 넘어가는 편이 읽기 쉽다.
 *
 * 보기 소스 표의 축 단위 카드(보기 그룹 = 축)와 얼굴은 같고 재료만 다르다 — 여기는 축이 열이다.
 * 묶음 규칙은 이 투영 하나이고 컴포넌트는 그리기만 한다.
 *
 * 저작자가 거는 두 가지(2026-11-13, PRD `.scratch/axis-card-choice-rows/PRD.md`):
 * - 글자 셀을 「바로 표시」로 두면 행 제목이 아니라 행 제목 아래 **설명**이 된다(「항목 | 판단 예시 | 체크」).
 * - 같은 행 보기 칸만으로 열리는 입력 칸은 그 **보기 타일 아래**에 딸린다(「⑭ 기타」 체크 → 기타 내용).
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
  /**
   * 이 칸이 열어 주는 같은 행의 상세 입력 칸 — 제 열 카드가 아니라 이 칸 바로 아래에 그린다.
   * 둘 중 하나다: 게이팅 컨트롤러가 이 응답 칸 하나뿐인 칸(「9) 기타비용」 금액을 적으면 그 아래 기타 내용 칸),
   * 또는 컨트롤러가 전부 같은 행의 보기 그룹 칸인 칸(「⑭ 기타」를 체크하면 그 타일 아래 기타 내용 칸 —
   * 컨트롤러 보기 칸마다 딸리므로 두 열 카드에 같은 칸이 놓일 수 있다. 그리는 쪽이 고른 타일 아래에만 그린다).
   */
  details: TableCell[];
  /**
   * 행 설명 — 행 제목 구역의 글자 셀 중 모바일 카드 표시가 「바로 표시」(`mobileDisplay: 'inline'`)인 셀들.
   * 행 제목·상위 구분이 되지 않고 행 제목 바로 아래 작은 글씨로 선다(「항목 | 판단 예시 | 체크」 표의 예시).
   */
  descriptionCells: TableCell[];
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

/** 보기 그룹에 속한 보이는 보기 칸 — 표 유형 문항의 보기 그룹 표 */
function isGroupChoiceCell(cell: TableCell): boolean {
  return isVisible(cell) && cell.type === 'choice_opt' && Boolean(cell.choiceGroupId);
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

/** 설명 셀 — 「바로 표시」로 둔 글자 셀. 행 제목 후보에서 빠지고 행 제목 아래 설명이 된다 */
const isDescriptionText = (cell: TableCell): boolean =>
  isLabelText(cell) && cell.mobileDisplay === 'inline';

/**
 * 행 제목 — 첫 응답 칸 앞의 글자 셀 중 마지막(저작자가 모바일에서 숨긴 셀은 제외). 그보다 앞의 글자
 * 셀은 상위 구분이다. 상위 구분은 세로 병합으로 위 행에서 내려온 셀도 센다 — 아래 행이 제 구분을
 * 잃지 않는다. 행 제목은 그 행 자신의 셀만 된다(내려온 셀은 여러 행의 것이라 행을 구분하지 못한다).
 *
 * 「바로 표시」 글자 셀은 제목·구분이 아니라 설명이다. 다만 제목이 될 다른 글자 셀도 행 이름도 없으면
 * 종전대로 마지막 글자 셀이 제목이다(제목 없는 항목이 생기지 않게 — 그때는 설명을 내지 않는다).
 * `choiceDetailIds` = 보기 칸이 여는 상세 입력(타일 아래에 딸리는 칸)은 응답 칸으로 세지 않는다 —
 * 첫 열이 「기타 [입력]」인 행에서도 뒤의 글자 셀이 제목 구역에 든다.
 */
function rowLabel(
  row: TableRow,
  covered: ReadonlyArray<TableCell | undefined>,
  choiceDetailIds: ReadonlySet<string>,
): Pick<ColumnAxisCardItem, 'label' | 'labelCell' | 'groupCells' | 'descriptionCells'> {
  const firstAnswer = row.cells.findIndex(
    (cell) => isAnswerCell(cell) && !choiceDetailIds.has(cell.id),
  );
  const end = firstAnswer < 0 ? row.cells.length : firstAnswer;
  const zone = row.cells.slice(0, end);
  const ownDescriptions = zone.filter((cell) => isVisible(cell) && isDescriptionText(cell));
  const lastIndexOf = (accept: (cell: TableCell) => boolean): number => {
    for (let index = end - 1; index >= 0; index -= 1) {
      const cell = row.cells[index]!;
      if (isVisible(cell) && accept(cell)) return index;
    }
    return -1;
  };
  let labelIndex = lastIndexOf((cell) => isLabelText(cell) && !isDescriptionText(cell));
  let descriptionCells = ownDescriptions;
  if (labelIndex < 0 && ownDescriptions.length > 0 && (row.label ?? '').trim() === '') {
    labelIndex = lastIndexOf(isLabelText);
    descriptionCells = [];
  }
  const isDescription = (cell: TableCell) => descriptionCells.includes(cell);
  const groupCells: TableCell[] = [];
  for (let index = 0; index < (labelIndex < 0 ? end : labelIndex); index += 1) {
    const own = row.cells[index]!;
    // 자기 셀이 보이면 그 셀, 가려졌으면 위에서 내려온 세로 병합 셀(가로 병합에 덮인 자리는 자기 자신이 돌아온다)
    const cell = isVisible(own) ? own : covered[index];
    if (!cell || (cell === own && !isVisible(own))) continue;
    if (isLabelText(cell) && !isDescription(cell) && !groupCells.includes(cell)) groupCells.push(cell);
  }
  const labelCell = labelIndex < 0 ? undefined : row.cells[labelIndex];
  return labelCell
    ? { label: labelCell.content.trim(), labelCell, groupCells, descriptionCells }
    : { label: (row.label ?? '').trim(), labelCell: undefined, groupCells, descriptionCells };
}

/**
 * 행 안의 상세 입력 칸 → 그 칸을 여는 같은 행 응답 칸 id. 게이팅 컨트롤러가 하나뿐이고 그것이 같은 행의
 * 다른 응답 칸일 때만이다 — 다른 행 칸이 여는 칸이나 여러 칸이 함께 여는 칸은 종전대로 제 열 카드다.
 */
function detailControllerOf(row: TableRow): Map<string, string> {
  const answerIds = new Set(row.cells.filter(isAnswerCell).map((cell) => cell.id));
  const result = new Map<string, string>();
  for (const cell of row.cells) {
    if (!isAnswerCell(cell)) continue;
    const controllers = [...new Set(collectGateControllerIds(cell.enabledWhen))];
    const [controller] = controllers;
    if (controllers.length !== 1 || !controller || controller === cell.id || !answerIds.has(controller)) {
      continue;
    }
    result.set(cell.id, controller);
  }
  // 컨트롤러가 그 자신도 상세 칸이면(사슬) 묶지 않는다 — 어느 카드에도 안 그려지는 칸이 생기지 않게
  for (const [cellId, controller] of result) if (result.has(controller)) result.delete(cellId);
  return result;
}

/**
 * 보기 칸이 여는 상세 입력 칸 → 그 칸을 여는 같은 행 보기 그룹 칸 id 들. 게이팅 컨트롤러가 하나 이상이고
 * **전부** 같은 행의 보기 그룹 칸일 때만이다(「공급 ⑭ 기타 또는 활용 ⑭ 기타를 체크하면 열리는 기타 내용」).
 * 응답 칸이 섞였거나 다른 행 칸이 여는 칸은 종전대로 제 열 카드다.
 */
function choiceDetailControllersOf(row: TableRow): Map<string, string[]> {
  const choiceIds = new Set(row.cells.filter(isGroupChoiceCell).map((cell) => cell.id));
  const result = new Map<string, string[]>();
  if (choiceIds.size === 0) return result;
  for (const cell of row.cells) {
    if (!isAnswerCell(cell)) continue;
    const controllers = [...new Set(collectGateControllerIds(cell.enabledWhen))];
    if (controllers.length === 0 || !controllers.every((id) => choiceIds.has(id))) continue;
    result.set(cell.id, controllers);
  }
  return result;
}

/**
 * 열마다 카드를 만든다. `columns` 와 `displayRows` 의 셀은 인덱스가 맞아야 한다(표시 조건으로 걸러진
 * 뒤의 열·행). 응답 칸이 하나도 없는 열(구분·단위 열)은 카드가 되지 않는다. 같은 행 칸이 여는 상세 입력은
 * 그 칸의 `details` 로 간다(그 열에 다른 응답 칸이 없으면 그 열 카드도 없다). 가로 병합된 응답 칸은
 * 시작 열 카드에, 세로 병합된 칸은 시작 행에만 놓인다(가려진 자리는 isHidden 이라 건너뛴다).
 */
export function buildColumnAxisCards(input: {
  columns: readonly TableColumn[];
  headerGrid?: HeaderCell[][] | undefined;
  displayRows: TableRow[];
  /**
   * 보기 그룹 칸(그룹에 속한 choice_opt)도 카드 항목으로 넣는다 — 표 유형 문항에서 열마다 보기 그룹을
   * 둔 표(「알고 있음」 · 「이용한 적 있음」)의 축 카드용. 응답 화면 축 카드만 켠다. 표 아래 상세 기재
   * 투영(option-text-below-table)은 입력 칸 몫이라 끈 채로 둔다. 행 제목 판정은 그대로라 보기 칸 뒤의
   * 글자 셀(부서 이름)도 행 제목이 된다.
   */
  includeChoiceOptCells?: boolean | undefined;
}): ColumnAxisCard[] {
  const coverage = buildTableRowspanCoverage(input.displayRows);
  // 보기 칸이 여는 상세 입력은 보기 칸이 카드 항목일 때만 묶는다 — 아니면 딸릴 타일이 없어 어느 카드에도 안 그려진다
  const choiceDetailsByRow = new Map(
    input.displayRows.map((row) => [
      row.id,
      input.includeChoiceOptCells ? choiceDetailControllersOf(row) : new Map<string, string[]>(),
    ]),
  );
  const labels = new Map(
    input.displayRows.map((row) => [
      row.id,
      rowLabel(
        row,
        coverage.get(row.id) ?? row.cells,
        new Set(choiceDetailsByRow.get(row.id)!.keys()),
      ),
    ]),
  );
  const detailsByRow = new Map(input.displayRows.map((row) => [row.id, detailControllerOf(row)]));
  const cards: ColumnAxisCard[] = [];
  for (const [columnIndex, column] of input.columns.entries()) {
    const items: ColumnAxisCardItem[] = [];
    for (const row of input.displayRows) {
      const cell = row.cells[columnIndex];
      if (!cell) continue;
      const choiceDetailOf = choiceDetailsByRow.get(row.id)!;
      if (isGroupChoiceCell(cell)) {
        if (input.includeChoiceOptCells) {
          const details = row.cells.filter((other) => choiceDetailOf.get(other.id)?.includes(cell.id));
          items.push({ cell, row, ...labels.get(row.id)!, details });
        }
        continue;
      }
      if (!isAnswerCell(cell)) continue;
      if (choiceDetailOf.has(cell.id)) continue;
      const detailOf = detailsByRow.get(row.id)!;
      if (detailOf.has(cell.id)) continue;
      const details = row.cells.filter((other) => detailOf.get(other.id) === cell.id);
      items.push({ cell, row, ...labels.get(row.id)!, details });
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

const NO_CHOICE_DETAILS: ReadonlySet<string> = new Set();

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
    const rowTitle = normalize(rowLabel(row, coverage.get(row.id) ?? row.cells, NO_CHOICE_DETAILS).label);
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
