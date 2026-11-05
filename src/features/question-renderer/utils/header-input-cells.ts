/**
 * 머리글 입력칸 — 머리글 칸(`HeaderCell.inputCellId`)이 가리키는 같은 표 본문 입력칸을 머리글 자리에 그린다
 * (「기타(원료명 직접 작성)」, CONTEXT.md 「머리글 입력칸」). 값은 본문 칸 키에 그대로 살아 저장·검증·내보내기는
 * 이 기능을 모른다 — 판정은 화면 배치만이다.
 *
 * - **유효한 연결**: 대상이 보이는 `input` 칸(병합 없음)이고, 머리글 칸이 덮는 열이 정확히 그 칸의 열 하나이며,
 *   그 칸의 행이 아래 「올린 행」이 될 수 있을 때. 같은 칸을 두 머리글이 가리키면 앞의 것만. 그 밖은 무시하고
 *   머리글을 글자로 그린다(화면이 깨지지 않게 — 빌더가 끊김을 따로 알린다).
 * - **올린 행**: 연결된 칸이 하나 이상이고 나머지 보이는 칸이 전부 글자 칸이며, 반복·동적·차례로 열기·표시 조건
 *   행이 아니고 세로 병합이 걸리지 않은 행. 머리글을 그리는 화면은 이 행을 본문에서 뺀다. 연결되지 않은 입력칸이
 *   남는 행은 올리지 않고 그 행의 연결도 전부 무효다 — 머리글과 본문에 같은 칸이 두 번 그려지면 안 된다.
 */
import type { HeaderCell, StagedRowsConfig, TableCell, TableRow } from '@/types/survey';

import { expandHeaderGrid } from './expand-header-grid';

export interface HeaderInputCells {
  /** 머리글 칸 id → 그 자리에 그릴 본문 칸 */
  cellByHeaderId: Map<string, TableCell>;
  /** 머리글로 올려 본문에서 뺄 행 id */
  hoistedRowIds: Set<string>;
}

const EMPTY: HeaderInputCells = { cellByHeaderId: new Map(), hoistedRowIds: new Set() };

function isPlainRow(row: TableRow, stagedRowIds: ReadonlySet<string>): boolean {
  return (
    row.repeatIndex === undefined &&
    !row.repeatSourceRowId &&
    !row.dynamicGroupId &&
    !row.showWhenDynamicGroupId &&
    !row.displayCondition &&
    !stagedRowIds.has(row.id)
  );
}

/** 위 행의 세로 병합이 내려오는 행 index */
function rowsCoveredFromAbove(rows: readonly TableRow[]): Set<number> {
  const covered = new Set<number>();
  rows.forEach((row, rowIdx) => {
    for (const cell of row.cells) {
      if (cell.isHidden) continue;
      const span = cell.rowspan ?? 1;
      for (let r = rowIdx + 1; r < rowIdx + span; r++) covered.add(r);
    }
  });
  return covered;
}

export function resolveHeaderInputCells(
  headerGrid: readonly HeaderCell[][] | null | undefined,
  rows: readonly TableRow[],
  stagedRowsConfig?: StagedRowsConfig | null,
): HeaderInputCells {
  if (!headerGrid?.some((line) => line.some((cell) => cell.inputCellId))) return EMPTY;

  // 칸 id → (행 index, 열 index)
  const position = new Map<string, { rowIdx: number; colIdx: number }>();
  rows.forEach((row, rowIdx) => row.cells.forEach((cell, colIdx) => position.set(cell.id, { rowIdx, colIdx })));

  // 1단계: 칸 단위로 맞는 연결만 고른다
  const candidates = new Map<string, TableCell>();
  const claimed = new Set<string>();
  for (const placed of expandHeaderGrid(headerGrid as HeaderCell[][])) {
    const target = placed.cell.inputCellId;
    if (!target || placed.colSpan !== 1 || claimed.has(target)) continue;
    const at = position.get(target);
    if (!at || at.colIdx + 1 !== placed.startCol) continue;
    const cell = rows[at.rowIdx]!.cells[at.colIdx]!;
    if (cell.type !== 'input' || cell.isHidden || (cell.colspan ?? 1) !== 1 || (cell.rowspan ?? 1) !== 1) continue;
    candidates.set(placed.cell.id, cell);
    claimed.add(target);
  }
  if (candidates.size === 0) return EMPTY;

  // 2단계: 올릴 수 있는 행만 남기고, 못 올리는 행의 연결은 버린다
  const stagedRowIds = new Set(stagedRowsConfig?.enabled ? stagedRowsConfig.rowIds : []);
  const covered = rowsCoveredFromAbove(rows);
  const hoistedRowIds = new Set<string>();
  const rejectedRowIds = new Set<string>();
  for (const cellId of claimed) {
    const { rowIdx } = position.get(cellId)!;
    const row = rows[rowIdx]!;
    if (hoistedRowIds.has(row.id) || rejectedRowIds.has(row.id)) continue;
    const hoistable =
      isPlainRow(row, stagedRowIds) &&
      !covered.has(rowIdx) &&
      row.cells.every((cell) => {
        if (cell.isHidden) return true;
        if ((cell.rowspan ?? 1) > 1) return false;
        return claimed.has(cell.id) || cell.type === 'text';
      });
    (hoistable ? hoistedRowIds : rejectedRowIds).add(row.id);
  }

  const cellByHeaderId = new Map<string, TableCell>();
  for (const [headerId, cell] of candidates) {
    if (hoistedRowIds.has(rows[position.get(cell.id)!.rowIdx]!.id)) cellByHeaderId.set(headerId, cell);
  }
  return cellByHeaderId.size > 0 ? { cellByHeaderId, hoistedRowIds } : EMPTY;
}

export interface HeaderInputCandidate {
  cellId: string;
  /** 빌더 목록 글자 — 엑셀 라벨 → 모바일 라벨 → 행 이름 */
  label: string;
}

/**
 * 빌더 「입력칸 넣기」 후보 — 그 열(0-based)의 칸 중 칸 단위 규칙과 행 규칙(반복·동적·차례·조건 아님, 세로 병합
 * 없음)을 통과하는 입력칸. 같은 행의 다른 입력칸까지 연결해야 실제로 올라가므로 최종 유효 여부는
 * `resolveHeaderInputCells` 로 다시 본다(빌더가 「연결 끊김」으로 알린다).
 */
export function listHeaderInputCandidates(
  rows: readonly TableRow[],
  colIdx: number,
  stagedRowsConfig?: StagedRowsConfig | null,
): HeaderInputCandidate[] {
  const stagedRowIds = new Set(stagedRowsConfig?.enabled ? stagedRowsConfig.rowIds : []);
  const covered = rowsCoveredFromAbove(rows);
  const out: HeaderInputCandidate[] = [];
  rows.forEach((row, rowIdx) => {
    const cell = row.cells[colIdx];
    if (!cell || cell.type !== 'input' || cell.isHidden) return;
    if ((cell.colspan ?? 1) !== 1 || (cell.rowspan ?? 1) !== 1) return;
    if (!isPlainRow(row, stagedRowIds) || covered.has(rowIdx)) return;
    if (row.cells.some((c) => !c.isHidden && (c.rowspan ?? 1) > 1)) return;
    out.push({ cellId: cell.id, label: cell.exportLabel || cell.mobileLabel || row.label || cell.id });
  });
  return out;
}

/** 열 차례로 열기 버튼을 둘 머리글 칸 — 지정한 첫 칸, 없으면 null */
export function findColumnRevealHostId(headerGrid: readonly HeaderCell[][] | null | undefined): string | null {
  for (const line of headerGrid ?? []) {
    for (const cell of line) if (cell.hostsColumnReveal) return cell.id;
  }
  return null;
}
