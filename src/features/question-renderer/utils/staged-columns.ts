/**
 * 열 차례로 열기 — 단계(`TableColumn.revealStep`)를 적은 열을 처음엔 1단계까지만 보이고 응답자가
 * `+` 로 한 단계씩 연다(CONTEXT.md 「열 차례로 열기」). 「기타1 원료명 · 기타1 투입량」처럼
 * 같은 단계의 열이 함께 열린다.
 *
 * 행 차례로 열기(`staged-rows`)와 같은 결이다 — 구조를 펼치지 않고 가시성만 정하며, 열린 단계는
 * 저장하지 않고 **값에서 파생**한다(값이 있는 마지막 단계). `−` 는 마지막 단계의 값을 비우고
 * 닫는다. 필수 판정은 열리지 않은 단계의 칸을 뺀다 — 화면에 없는 칸이 「다음」을 막으면 안 된다.
 * 내보내기는 이 기능을 모른다(넉넉히 만든 열을 줄이려면 「안 쓰면 내보내기에서 빼기」를 함께 켠다).
 */
import type { TableColumn, TableRow } from '@/types/survey';
import { isCellValuePresent } from '@/utils/table-cell-semantics';

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
  let open = 1;
  for (const [step, ids] of cellIdsByStep(columns, rows)) {
    if (step > open && ids.some((id) => isCellValuePresent(cellValues[id]))) open = step;
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

/** 필수에서 뺄 칸 — 값에서 파생한 열린 단계보다 뒤 열의 칸 */
export function stagedColumnOptionalCellIds(
  columns: readonly TableColumn[] | null | undefined,
  rows: readonly TableRow[] | null | undefined,
  values: Record<string, unknown> | undefined,
): Set<string> {
  const cols = columns ?? [];
  const tableRows = rows ?? [];
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
