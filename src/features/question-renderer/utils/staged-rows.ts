/**
 * 행 차례로 열기 — 가시성 순수 로직.
 *
 * 저작자가 만든 연속된 행 묶음을 처음 몇 행만 보이고 응답자가 `+` 로 한 행씩 연다.
 * 행 반복과 달리 구조를 건드리지 않는다 — 묶음의 행은 평범한 행이고, 설정의 행 id 목록만이
 * 묶음을 정한다(CONTEXT.md "행 차례로 열기", ADR 0028).
 */
import { collectTableCells, isCellEnabled } from '@/lib/survey/cell-gating';
import type { StagedRowsConfig, TableCell, TableRow } from '@/types/survey';
import { isCellValuePresent } from '@/utils/table-cell-semantics';

/** 묶음의 행 — 표에 실제로 있는 것만, 표의 행 순서대로. */
export function stagedRowsOf(rows: TableRow[], config: StagedRowsConfig): TableRow[] {
  const ids = new Set(config.rowIds);
  return rows.filter((row) => ids.has(row.id));
}

/**
 * 값에서 파생하는 열린 행 수 — `max(처음 보이는 행 수, 값이 있는 마지막 묶음 행의 순번)`.
 *
 * 열린 행 수는 저장하지 않는다(행 반복의 열린 벌 수와 같은 결정). 화면·재진입·관리자 수정·
 * 필수 판정이 전부 이 함수 하나로 같은 답을 낸다.
 */
export function deriveOpenStagedCount(
  rows: TableRow[],
  config: StagedRowsConfig,
  values: Record<string, unknown> | undefined,
): number {
  const cellValues = values ?? {};
  const staged = stagedRowsOf(rows, config);
  const tableCells = collectTableCells(rows);
  let open = clampInitialVisibleCount(config.initialVisibleCount, staged.length);
  staged.forEach((row, index) => {
    if (index < open) return;
    if (row.cells.some((cell) => hasLiveValue(cell, cellValues, tableCells))) open = index + 1;
  });
  return open;
}

function clampInitialVisibleCount(value: number, stagedLength: number): number {
  const count = Number.isFinite(value) ? Math.trunc(value) : 1;
  return Math.min(stagedLength, Math.max(1, count));
}

/** 값이 있고 그 칸이 지금 열려 있는가 — 게이팅으로 닫힌 칸의 잔존값은 없는 것으로 본다. */
function hasLiveValue(
  cell: TableCell,
  cellValues: Record<string, unknown>,
  tableCells: readonly TableCell[],
): boolean {
  return isCellValuePresent(cellValues[cell.id]) && isCellEnabled(cell, cellValues, tableCells);
}

/** 추가 버튼 기본 문구 */
export const DEFAULT_STAGED_ROWS_ADD_LABEL = '행 추가';

export function isStagedRowsActive(
  config: StagedRowsConfig | null | undefined,
): config is StagedRowsConfig {
  return Boolean(config?.enabled) && (config?.rowIds?.length ?? 0) > 0;
}

/** 묶음 행 수 — 표에 실제로 있는 행만 센다(열 수 있는 최대). */
export function stagedRowCount(rows: TableRow[], config: StagedRowsConfig): number {
  return stagedRowsOf(rows, config).length;
}

/** 열린 수보다 뒤에 있는 묶음 행 id — 렌더 파이프라인이 이 집합을 빼고 그린다. */
export function hiddenStagedRowIds(
  rows: TableRow[],
  config: StagedRowsConfig,
  openCount: number,
): Set<string> {
  return new Set(
    stagedRowsOf(rows, config)
      .slice(Math.max(0, openCount))
      .map((row) => row.id),
  );
}

/** 닫을 때 비울 칸 — 순번(1부터)의 묶음 행에 든 모든 칸. */
export function cellIdsOfStagedRowAt(
  rows: TableRow[],
  config: StagedRowsConfig,
  position: number,
): string[] {
  const row = stagedRowsOf(rows, config)[position - 1];
  return row ? row.cells.map((cell) => cell.id) : [];
}

/**
 * 필수 판정에서 빼는 칸 — 값에서 파생한 열린 수 뒤에 있는 묶음 행의 칸.
 *
 * 「처음 보이는 행」과 「값이 있는 마지막 행」까지는 평범한 행이고, 그 뒤는 열려 있어도
 * 없는 행이다. 세션에서 `+` 로 연 수는 보지 않는다 — 값만으로 판정해야 응답 화면·재진입·
 * 관리자 수정이 같은 답을 낸다. 열린 수 파생과 같은 함수를 쓰므로 화면과 검증이 갈리지 않는다.
 */
export function stagedOptionalCellIds(
  rows: TableRow[] | null | undefined,
  config: StagedRowsConfig | null | undefined,
  values: Record<string, unknown> | undefined,
): Set<string> {
  const ids = new Set<string>();
  if (!rows || !isStagedRowsActive(config)) return ids;
  const open = deriveOpenStagedCount(rows, config, values);
  for (const row of stagedRowsOf(rows, config).slice(open)) {
    for (const cell of row.cells) ids.add(cell.id);
  }
  return ids;
}
