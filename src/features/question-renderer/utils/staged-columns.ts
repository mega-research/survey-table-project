/**
 * 열 차례로 열기 — 단계(`TableColumn.revealStep`)를 적은 열을 처음엔 1단계까지만 보이고 응답자가
 * `+` 로 한 단계씩 연다(CONTEXT.md 「열 차례로 열기」). 「기타1 원료명 · 기타1 투입량」처럼
 * 같은 단계의 열이 함께 열린다.
 *
 * 행 차례로 열기(`staged-rows`)와 같은 결이다 — 구조를 펼치지 않고 가시성만 정하며, 열린 단계는
 * 저장하지 않고 **값에서 파생**한다(값이 있는 마지막 단계). `−` 는 마지막 단계의 값을 비우고
 * 닫는다. 필수 판정은 열리지 않은 단계의 칸을 뺀다 — 화면에 없는 칸이 「다음」을 막으면 안 된다.
 * 내보내기는 이 기능을 모른다(넉넉히 만든 열을 줄이려면 「안 쓰면 내보내기에서 빼기」를 함께 켠다).
 *
 * 값의 판정은 행 차례로 열기와 같다 — 응답 칸만 세고(계산 칸은 저장 경계가 값을 넣는다) 게이팅으로
 * 닫힌 칸의 잔존값은 없는 것으로 본다(`hasLiveValue`). 보기·순위 옵션 칸이 든 열은 단계를 무시한다
 * (`stageableColumns`) — 선택이 칸 값이 아닌 곳에 살아 열린 단계 파생·닫을 때 비우기가 보지 못한다.
 */
import { collectTableCells } from '@/lib/survey/cell-gating';
import { collectTableChoiceSelection } from '@/lib/survey/choice-selection';
import type { TableColumn, TableRow } from '@/types/survey';

import { NON_STAGEABLE_CELL_TYPES, hasLiveValue } from './staged-rows';

const stepOf = (column: TableColumn): number =>
  typeof column.revealStep === 'number' && column.revealStep >= 1 ? Math.floor(column.revealStep) : 1;

/** 가장 큰 단계 — 단계 열이 없으면 1(기능 꺼짐). */
export function maxColumnStep(columns: readonly TableColumn[]): number {
  return columns.reduce((max, column) => Math.max(max, stepOf(column)), 1);
}

/** 단계가 2 이상인 열이 있는가 */
export function isStagedColumnsActive(columns: readonly TableColumn[] | null | undefined): boolean {
  return maxColumnStep(columns ?? []) >= 2;
}

/**
 * 이 열에 단계를 걸 수 있는가 — 보기·순위 옵션 칸이 하나라도 있으면 아니다(빌더 차단·런타임 무시 공용).
 * 그 칸의 선택은 표 응답 안 보기 그룹 맵이나 문항 응답에 살아, 칸 값만 보는 열린 단계 파생이 선택을
 * 못 보고(재진입 때 접힘) 닫을 때 비우기도 선택을 지우지 못한다(화면에서 사라진 선택이 제출된다).
 */
export function isColumnStageable(rows: readonly TableRow[], colIdx: number): boolean {
  return !rows.some((row) => {
    const cell = row.cells[colIdx];
    return cell !== undefined && NON_STAGEABLE_CELL_TYPES.has(cell.type);
  });
}

/**
 * 단계를 걸 수 없는 열의 단계를 뗀 열 목록 — 바꿀 것이 없으면 원본 참조 그대로.
 * 빌더가 막지만 스크립트·옛 구조로 들어온 설정이 응답 화면에서 같은 사고를 내지 않게 런타임에서도 무시한다.
 */
export function stageableColumns(
  columns: readonly TableColumn[],
  rows: readonly TableRow[],
): readonly TableColumn[] {
  if (!isStagedColumnsActive(columns)) return columns;
  let changed = false;
  const out = columns.map((column, colIdx) => {
    if (stepOf(column) < 2 || isColumnStageable(rows, colIdx)) return column;
    changed = true;
    const { revealStep: _step, ...rest } = column;
    return rest;
  });
  return changed ? out : columns;
}

/** 열 index 별 단계 — 행의 칸은 열 index 로 맞춘다 */
function cellIdsByStep(columns: readonly TableColumn[], rows: readonly TableRow[]): Map<number, string[]> {
  const byStep = new Map<number, string[]>();
  columns.forEach((column, colIdx) => {
    const step = stepOf(column);
    if (step < 2) return;
    const ids = byStep.get(step) ?? [];
    for (const row of rows) {
      const cell = row.cells[colIdx];
      if (cell && !cell.isHidden) ids.push(cell.id);
    }
    byStep.set(step, ids);
  });
  return byStep;
}

/** 값에서 파생하는 열린 단계 — `max(1, 값이 있는 마지막 단계)` */
export function deriveOpenColumnStep(
  columns: readonly TableColumn[],
  rows: readonly TableRow[],
  values: Record<string, unknown> | undefined,
): number {
  const cellValues = values ?? {};
  const tableCells = collectTableCells(rows);
  const cellById = new Map(tableCells.map((cell) => [cell.id, cell]));
  const choiceSelection = collectTableChoiceSelection(cellValues);
  let open = 1;
  for (const [step, ids] of cellIdsByStep(columns, rows)) {
    if (step <= open) continue;
    const live = ids.some((id) => {
      const cell = cellById.get(id);
      return cell !== undefined && hasLiveValue(cell, cellValues, tableCells, choiceSelection);
    });
    if (live) open = step;
  }
  return open;
}

/** 열린 단계보다 뒤에 있는 열 id — 렌더가 이 열을 빼고 그린다 */
export function hiddenStagedColumnIds(columns: readonly TableColumn[], openStep: number): Set<string> {
  return new Set(columns.filter((column) => stepOf(column) > openStep).map((column) => column.id));
}

/** 닫을 때 비울 칸 — 지정 단계보다 뒤 열의 모든 행 칸 */
export function cellIdsOfColumnStepsBeyond(
  columns: readonly TableColumn[],
  rows: readonly TableRow[],
  openStep: number,
): string[] {
  const out: string[] = [];
  for (const [step, ids] of cellIdsByStep(columns, rows)) if (step > openStep) out.push(...ids);
  return out;
}

/** 화면에 없는 칸 — 값에서 파생한 열린 단계보다 뒤 열의 칸. 모든 차단 검증이 이 칸을 뺀다 */
export function stagedColumnOptionalCellIds(
  columns: readonly TableColumn[] | null | undefined,
  rows: readonly TableRow[] | null | undefined,
  values: Record<string, unknown> | undefined,
): Set<string> {
  const tableRows = rows ?? [];
  const cols = stageableColumns(columns ?? [], tableRows);
  if (!isStagedColumnsActive(cols)) return new Set();
  return new Set(cellIdsOfColumnStepsBeyond(cols, tableRows, deriveOpenColumnStep(cols, tableRows, values)));
}

/** 버튼 문구 — 단계 열 중 처음 적힌 것. 없으면 null(호출부가 기본 문구) */
export function stagedColumnAddLabel(columns: readonly TableColumn[]): string | null {
  for (const column of columns) {
    const label = column.revealAddLabel?.trim();
    if (label) return label;
  }
  return null;
}

/** 그 단계의 열 id — 단계 2 이상만(1단계는 처음부터 보인다). `+` 로 막 연 열을 찾는 데 쓴다 */
export function columnIdsOfStep(columns: readonly TableColumn[], step: number): Set<string> {
  if (step < 2) return new Set();
  return new Set(columns.filter((column) => stepOf(column) === step).map((column) => column.id));
}

/**
 * `+` 로 연 열이 화면 오른쪽 밖에 생기면 「눌렀는데 아무 일도 없다」가 된다 — 그 열이 보이도록 민
 * 가로 스크롤 위치. 새 열의 오른쪽 끝이 보이게 밀되, 새 열이 뷰보다 넓으면 왼쪽 끝을 좌측 고정 열
 * 바로 옆에 맞춘다. 이미 보이면(또는 더 오른쪽에 있으면) 움직이지 않는다(null) — 왼쪽으로 되돌리지 않는다.
 * `columnStops` 는 보이는 열의 왼쪽 경계 누적 px(0 시작, 마지막 = 전체 폭).
 */
export function stagedColumnRevealScrollLeft(input: {
  visibleColumns: readonly TableColumn[];
  columnStops: readonly number[];
  targetColumnIds: ReadonlySet<string>;
  viewportWidth: number;
  currentScrollLeft: number;
  stickyWidth: number;
}): number | null {
  const { visibleColumns, columnStops, targetColumnIds, viewportWidth, currentScrollLeft, stickyWidth } = input;
  let first = -1;
  let last = -1;
  visibleColumns.forEach((column, index) => {
    if (!targetColumnIds.has(column.id)) return;
    if (first < 0) first = index;
    last = index;
  });
  if (first < 0) return null;
  const start = columnStops[first] ?? 0;
  const end = columnStops[last + 1] ?? start;
  const left = Math.max(0, Math.min(end - viewportWidth, start - stickyWidth));
  return left > currentScrollLeft ? left : null;
}
