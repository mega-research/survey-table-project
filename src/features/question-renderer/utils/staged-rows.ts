/**
 * 행 차례로 열기 — 가시성 순수 로직.
 *
 * 저작자가 만든 연속된 행 묶음을 처음 몇 행만 보이고 응답자가 `+` 로 한 행씩 연다.
 * 행 반복과 달리 구조를 건드리지 않는다 — 묶음의 행은 평범한 행이고, 설정의 행 id 목록만이
 * 묶음을 정한다(CONTEXT.md "행 차례로 열기", ADR 0028).
 */
import { GATABLE_CELL_TYPES, collectTableCells, isCellEnabled } from '@/lib/survey/cell-gating';
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

/**
 * 응답자가 넣은 값이 있고 그 칸이 지금 열려 있는가.
 *
 * - **응답 칸만 센다**(input · radio · checkbox · select · ranking). 계산 칸은 저장 경계가 값을
 *   주입하므로(빈 행도 '0') 응답으로 세면 저장 전에는 닫혀 있던 행이 재진입 때 열리고, 그 행의
 *   필수 칸이 「다음」을 막는다 — 저장 전후로 열린 수가 달라지면 안 된다.
 * - 게이팅으로 닫힌 칸의 잔존값은 없는 것으로 본다.
 */
function hasLiveValue(
  cell: TableCell,
  cellValues: Record<string, unknown>,
  tableCells: readonly TableCell[],
): boolean {
  return (
    GATABLE_CELL_TYPES.has(cell.type) &&
    isCellValuePresent(cellValues[cell.id]) &&
    isCellEnabled(cell, cellValues, tableCells)
  );
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
  const active = rows ? resolveStagedRows(rows, config) : null;
  if (!rows || !active) return ids;
  const open = deriveOpenStagedCount(rows, active, values);
  for (const row of stagedRowsOf(rows, active).slice(open)) {
    for (const cell of row.cells) ids.add(cell.id);
  }
  return ids;
}

// ── 묶음 지정 가능성 검증 (빌더) ────────────────────────────────────

export type StagedRowsViolationKind =
  | 'empty'
  | 'unknown-row'
  | 'not-contiguous'
  | 'initial-count'
  | 'row-repeat'
  | 'dynamic-row'
  | 'display-condition'
  | 'choice-cell';

/**
 * 묶음 행에 둘 수 없는 칸 — 선택이 「행의 칸 값」이 아닌 곳에 저장되는 유형.
 * 보기 옵션 칸의 선택은 표 응답 안 예약 키(보기 그룹 맵)에, 순위 옵션 칸은 문항 응답에 산다.
 * 열린 수 파생·닫을 때 값 비우기·필수 범위가 전부 칸 값을 보므로, 이런 행을 묶으면 닫아도
 * 선택이 남아 제출되고 안 열린 행의 필수 보기 그룹이 「다음」을 막는다.
 */
const NON_STAGEABLE_CELL_TYPES = new Set<TableCell['type']>(['choice_opt', 'ranking_opt']);

export interface StagedRowsViolation {
  kind: StagedRowsViolationKind;
  message: string;
  /** 문제가 된 행 id (해당되는 경우) */
  rowIds?: string[];
}

/** 묶음 행의 표 안 위치 — 하나라도 없으면 null. */
function stagedRowIndices(rows: TableRow[], rowIds: readonly string[]): number[] | null {
  const indexById = new Map(rows.map((row, index) => [row.id, index]));
  const indices: number[] = [];
  for (const id of rowIds) {
    const index = indexById.get(id);
    if (index === undefined) return null;
    indices.push(index);
  }
  return indices.sort((a, b) => a - b);
}

function isContiguous(indices: readonly number[]): boolean {
  return indices.every((index, i) => i === 0 || index === indices[i - 1]! + 1);
}

/**
 * 묶음으로 지정해도 되는지 검사한다 — 빌더가 지정을 막는 데 쓴다.
 *
 * 행 반복 행·동적 행 그룹 행·표시 조건이 걸린 행은 저마다 다른 이유로 숨는다. 한 행에
 * 숨는 이유가 둘이면 "열린 행 수"가 화면과 어긋나고 버튼 줄의 자리가 흔들리므로 뺀다.
 * 선택 칸·합계 제약이 참조하는 행은 막지 않는다 — 묶음의 행은 평범한 행이다(행 반복과 다르다).
 */
export function validateStagedRows(
  rows: TableRow[],
  draft: Pick<StagedRowsConfig, 'rowIds' | 'initialVisibleCount'>,
): StagedRowsViolation[] {
  if (draft.rowIds.length === 0) {
    return [{ kind: 'empty', message: '묶을 행을 하나 이상 지정해야 합니다.' }];
  }
  const indices = stagedRowIndices(rows, draft.rowIds);
  if (indices === null) {
    const known = new Set(rows.map((row) => row.id));
    return [
      {
        kind: 'unknown-row',
        message: '표에 없는 행이 지정되었습니다.',
        rowIds: draft.rowIds.filter((id) => !known.has(id)),
      },
    ];
  }
  if (!isContiguous(indices)) {
    return [
      {
        kind: 'not-contiguous',
        message: '묶음은 붙어 있는 행이어야 합니다.',
        rowIds: [...draft.rowIds],
      },
    ];
  }

  const violations: StagedRowsViolation[] = [];
  const count = draft.initialVisibleCount;
  if (!Number.isInteger(count) || count < 1 || count >= indices.length) {
    violations.push({
      kind: 'initial-count',
      message: `처음 보이는 행 수는 1 이상 ${indices.length - 1} 이하여야 합니다 — 묶음 행 수보다 작아야 열 행이 남습니다.`,
    });
  }

  const staged = indices.map((index) => rows[index]!);
  const repeatRows = staged.filter((row) => row.repeatIndex !== undefined);
  if (repeatRows.length > 0) {
    violations.push({
      kind: 'row-repeat',
      message: '행 반복 블록의 행은 묶음에 넣을 수 없습니다.',
      rowIds: repeatRows.map((row) => row.id),
    });
  }
  const dynamicRows = staged.filter((row) => row.dynamicGroupId || row.showWhenDynamicGroupId);
  if (dynamicRows.length > 0) {
    violations.push({
      kind: 'dynamic-row',
      message: '동적 행 그룹에 속한 행은 묶음에 넣을 수 없습니다.',
      rowIds: dynamicRows.map((row) => row.id),
    });
  }
  const conditionRows = staged.filter((row) => row.displayCondition);
  if (conditionRows.length > 0) {
    violations.push({
      kind: 'display-condition',
      message: '표시 조건이 걸린 행은 묶음에 넣을 수 없습니다.',
      rowIds: conditionRows.map((row) => row.id),
    });
  }
  const choiceRows = staged.filter((row) =>
    row.cells.some((cell) => !cell.isHidden && NON_STAGEABLE_CELL_TYPES.has(cell.type)),
  );
  if (choiceRows.length > 0) {
    violations.push({
      kind: 'choice-cell',
      message: '보기 옵션·순위 옵션 셀이 든 행은 묶음에 넣을 수 없습니다.',
      rowIds: choiceRows.map((row) => row.id),
    });
  }
  return violations;
}

/** 표가 바뀌어 생길 수 있는 위반 — 처음 보이는 행 수는 표 편집으로 어긋나지 않는다. */
const STRUCTURAL_VIOLATIONS = new Set<StagedRowsViolationKind>([
  'unknown-row',
  'not-contiguous',
  'row-repeat',
  'dynamic-row',
  'display-condition',
  'choice-cell',
]);

/**
 * 구조가 설정과 아직 맞는가 — 묶음 행이 전부 살아 있고 서로 붙어 있으며, 그 행에 다른 숨김
 * 장치(행 반복·동적 행 그룹·표시 조건)가 붙지 않았는가.
 *
 * 설정은 행 id 로 묶음을 가리키는데 편집 화면은 그 행을 지우거나 옮기고, 나중에 행 반복을
 * 켜거나 행 조건을 걸 수 있다. 깨진 설정을 남겨 두면 묶음이 조용히 줄어들거나 버튼 줄이
 * 엉뚱한 행 아래에 선다 — 호출부가 설정을 끈다.
 */
export function isStagedRowsIntact(
  rows: TableRow[],
  config: StagedRowsConfig | null | undefined,
): boolean {
  if (!isStagedRowsActive(config)) return true;
  return !validateStagedRows(rows, config).some((v) => STRUCTURAL_VIOLATIONS.has(v.kind));
}

/**
 * 실제로 동작시킬 설정 — 켜져 있고 구조가 성립할 때만 그 설정, 아니면 null.
 *
 * 빌더는 깨진 설정을 저장 전에 끄지만(isStagedRowsIntact), 발행 스냅샷·스크립트로 들어온 설정까지
 * 믿을 수는 없다. 구조가 깨진 채 가리면 값이 든 행이 숨거나 채울 수 없는 필수가 생기므로, 응답
 * 화면과 검증은 이 함수로 **전부 보이는 쪽**으로 물러난다(가리는 것보다 보이는 것이 안전하다).
 */
export function resolveStagedRows(
  rows: TableRow[],
  config: StagedRowsConfig | null | undefined,
): StagedRowsConfig | null {
  return isStagedRowsActive(config) && isStagedRowsIntact(rows, config) ? config : null;
}

/**
 * 행 id 가 통째로 새로 발번되는 경로(질문 복제)에서 묶음의 행 id 를 함께 옮긴다.
 * 옮기지 않으면 복제본의 설정이 원본 질문의 행을 가리켜 묶음이 통째로 비어 버린다.
 */
export function remapStagedRowIds(
  config: StagedRowsConfig | null | undefined,
  rowIdMap: ReadonlyMap<string, string>,
): StagedRowsConfig | null {
  if (!isStagedRowsActive(config)) return null;
  return { ...config, rowIds: config.rowIds.map((id) => rowIdMap.get(id) ?? id) };
}
