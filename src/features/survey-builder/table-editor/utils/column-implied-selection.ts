import { buildCellPositionLabels } from '@/features/question-renderer/utils/column-axis-cards';
import {
  type ImpliedSelectionScope,
  canImplySelection,
  isImpliedSelectionTarget,
} from '@/features/question-renderer/utils/implied-selection';
import type { HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';

/**
 * 따라 선택의 빌더 쪽 (CONTEXT.md "따라 선택") — 함께 고를 칸 후보, 죽은 짝 정리, 열 일괄 적용.
 *
 * 자격 판정은 응답 화면과 같은 함수(question-renderer/utils/implied-selection)를 쓴다 —
 * 빌더가 걸 수 있게 해 준 짝을 응답 화면이 무시하는 일이 없어야 한다. 그래서 문항의 그룹 정의와
 * 그룹 없는 칸의 선택 방식(`ImpliedSelectionScope`)을 함께 받는다.
 *
 * 열 일괄 적용은 「같은 위치 관계」로 옮긴다: 기준 칸에서 대상까지의 (행 차이, 열 차이)를 같은 열의
 * 다른 칸에 그대로 적용한다. 수혜 ①칸에 「왼쪽 한 칸」을 걸고 일괄 적용하면 ②~⑥도 각자 왼쪽 한 칸이다
 * (열 일괄 지정 선례: column-distinct-group). 저장 확정(commit-cell-edit)이 칸마다 걸 짝을 미리 계산한
 * 계획(`CellSaveOptions.columnImpliedSelection`)을 에디터와 DB 에 같이 보낸다.
 *
 * 칸을 복사하는 길마다 짝이 남의 칸을 가리키지 않게 한다 — 새 복사 경로를 만들면 이 넷 중 어느 규칙인지 정할 것.
 * - 문항 복제: `remapCellRefs` 가 사본 안의 칸으로 옮긴다.
 * - 행 복제(use-table-editor `duplicateRow`): 같은 행을 가리키던 짝은 복제 행의 칸으로, 행 밖 참조는 그대로.
 * - 영역 붙여넣기: 영역 안을 가리키던 짝만 같은 위치로 옮기고 나머지는 뺀다(`resolvePastedImpliedCellIds` —
 *   게이팅의 「같은 표에 있으면 유지」와 다르다. 짝은 대개 같은 행의 옆 칸이라 유지하면 2행에 붙인 칸이 1행을 체크한다).
 * - 칸 하나 붙여넣기: 짝을 싣지 않는다. 설문 복제는 칸 id 를 그대로 두므로 짝도 그대로다. 보관함에는 싣지 않는다.
 */

type Position = { row: number; column: number };

function locate(rows: readonly TableRow[], cellId: string): Position | null {
  for (const [row, tableRow] of rows.entries()) {
    const column = tableRow.cells.findIndex((cell) => cell.id === cellId);
    if (column !== -1) return { row, column };
  }
  return null;
}

/** 병합에 가려진 자리는 칸이 아니다 — 출발도 대상도 될 수 없다 */
function isLiveCell(cell: TableCell | undefined): cell is TableCell {
  return !!cell && !cell.isHidden && !cell._isContinuation;
}

/**
 * 칸마다 빌더에 보일 이름 — 「행 제목 · 열 제목」(이미지 크게 보기 머리 줄과 같은 규칙). 행 제목도 열 제목도
 * 없는 칸은 위치로 부른다 — 이름 없는 칩은 무엇을 가리키는지 알 수 없다.
 */
export function labelImpliedSelectionCells(input: {
  rows: TableRow[];
  columns: readonly TableColumn[];
  headerGrid?: HeaderCell[][] | undefined;
}): Map<string, string> {
  const positionLabels = buildCellPositionLabels({
    columns: input.columns,
    headerGrid: input.headerGrid,
    displayRows: input.rows,
  });
  const labels = new Map<string, string>();
  for (const [rowIndex, row] of input.rows.entries()) {
    for (const [columnIndex, cell] of row.cells.entries()) {
      labels.set(cell.id, positionLabels.get(cell.id) || `${rowIndex + 1}행 ${columnIndex + 1}열`);
    }
  }
  return labels;
}

/** 함께 고를 칸 후보의 id — 표 순서(위에서 아래, 왼쪽에서 오른쪽). 자기 자신은 뺀다. */
export function listImpliedSelectionCandidates(
  rows: readonly TableRow[],
  ownCellId: string,
  scope: ImpliedSelectionScope,
): string[] {
  return rows
    .flatMap((row) => row.cells)
    .filter(
      (cell) => cell.id !== ownCellId && isLiveCell(cell) && isImpliedSelectionTarget(cell, scope),
    )
    .map((cell) => cell.id);
}

/**
 * 짝 목록에서 죽은 것을 걷어낸다 — 지워진 칸, 자격을 잃은 칸(유형 변경·단독 선택 보기·라디오 그룹),
 * 자기 자신, 중복. 모달이 열릴 때와 저장할 때 둘 다 거쳐 죽은 짝이 다시 저장되지 않게 한다.
 */
export function pruneImpliedCellIds(
  impliedCellIds: readonly string[],
  context: ImpliedSelectionScope & { rows: readonly TableRow[]; ownCellId: string },
): string[] {
  const candidates = new Set(
    listImpliedSelectionCandidates(context.rows, context.ownCellId, context),
  );
  return [...new Set(impliedCellIds)].filter((id) => candidates.has(id));
}

function isColumnSource(
  cell: TableCell | undefined,
  anchorCellId: string,
  scope: ImpliedSelectionScope,
): cell is TableCell {
  return isLiveCell(cell) && cell.id !== anchorCellId && canImplySelection(cell, scope);
}

/** 일괄 적용이 바꿀 칸 수 — 기준 칸과 같은 열의 다른 출발 자격 칸. */
export function countColumnImpliedSelectionTargets(
  rows: readonly TableRow[],
  anchorCellId: string,
  scope: ImpliedSelectionScope,
): number {
  const anchor = locate(rows, anchorCellId);
  if (!anchor) return 0;
  return rows.filter((row) => isColumnSource(row.cells[anchor.column], anchorCellId, scope))
    .length;
}

/** 칸 id → 그 칸에 걸 짝 목록. 빈 배열은 「짝을 지운다」다. */
export type ImpliedSelectionPlan = Record<string, string[]>;

/**
 * 기준 칸의 짝을 같은 열의 다른 출발 자격 칸에 같은 위치 관계로 옮긴 계획. 기준 칸 자신은 담지 않는다
 * (모달 저장이 쓴다). 옮긴 자리가 표 밖이거나 대상 자격이 없으면 그 짝만 뺀다.
 */
export function planColumnImpliedSelection(
  rows: readonly TableRow[],
  anchorCellId: string,
  anchorImpliedCellIds: readonly string[],
  scope: ImpliedSelectionScope,
): ImpliedSelectionPlan {
  const anchor = locate(rows, anchorCellId);
  if (!anchor) return {};
  const offsets = anchorImpliedCellIds
    .map((id) => locate(rows, id))
    .filter((position): position is Position => position !== null)
    .map((position) => ({
      row: position.row - anchor.row,
      column: position.column - anchor.column,
    }));

  const plan: ImpliedSelectionPlan = {};
  for (const [rowIndex, row] of rows.entries()) {
    const source = row.cells[anchor.column];
    if (!isColumnSource(source, anchorCellId, scope)) continue;
    const targets: string[] = [];
    for (const offset of offsets) {
      const target = rows[rowIndex + offset.row]?.cells[anchor.column + offset.column];
      if (!isLiveCell(target) || target.id === source.id) continue;
      if (!isImpliedSelectionTarget(target, scope)) continue;
      if (!targets.includes(target.id)) targets.push(target.id);
    }
    plan[source.id] = targets;
  }
  return plan;
}

/** 계획을 행에 적용한다 — 계획에 없는 칸과 바뀔 것이 없는 행은 원본 참조 그대로다. */
export function applyImpliedSelectionPlan(rows: TableRow[], plan: ImpliedSelectionPlan): TableRow[] {
  return rows.map((row) => {
    if (!row.cells.some((cell) => plan[cell.id] !== undefined)) return row;
    return {
      ...row,
      cells: row.cells.map((cell) => {
        const targets = plan[cell.id];
        if (targets === undefined) return cell;
        const { impliedCellIds: _previous, ...rest } = cell;
        return targets.length > 0 ? { ...rest, impliedCellIds: targets } : rest;
      }),
    };
  });
}
