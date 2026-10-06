/**
 * 중복 불가 묶음 — 같은 묶음 이름을 가진 표의 선택(select) 칸끼리는 같은 보기를 두 번 고를 수 없다.
 *
 * 화면의 회색 비활성과 차단형 검증이 이 모듈 하나의 판정을 쓴다 — 갈리면 "회색인데 검증은 통과"
 * 하거나 "고를 수 있었는데 다음에서 막힘"이 생긴다 (CONTEXT.md "중복 불가 묶음").
 */
import { isCellEnabled } from '@/lib/survey/cell-gating';
import type { TableCell } from '@/types/survey';
import { collectGateLeaves } from '@/utils/cell-gate-tree';
import { findOptionByStored, unwrapOptionId } from '@/utils/table-cell-semantics';

/**
 * 이 칸의 묶음 이름 — 묶음 구성원이 아니면 null.
 * 선택 칸만 구성원이고, 병합에 가려진 칸은 뺀다(병합 저장이 덮인 칸에 내용을 통째 복사해
 * 이름까지 따라간다 — 보이지 않는 칸이 보기를 차지하면 안 된다).
 */
export function distinctGroupOf(cell: TableCell): string | null {
  if (cell.type !== 'select' || cell.isHidden) return null;
  const name = cell.distinctGroup?.trim();
  return name ? name : null;
}

/** 이 칸이 지금 고른 보기 값 — 없거나, 게이팅으로 닫힌 칸이면 null. */
function liveSelection(
  cell: TableCell,
  cellValues: Record<string, unknown>,
  tableCells: readonly TableCell[],
): string | null {
  const stored = unwrapOptionId(cellValues[cell.id]);
  if (!stored) return null;
  // 선택 칸이 목록에서 쓰는 키와 같아야 한다(`option.value ?? option.id`). 목록에 없는 낡은 값은
  // 고른 것으로 치지 않는다 — 화면에 보이지 않는 값이 보기를 차지하면 응답자가 풀 수 없다.
  const option = findOptionByStored(cell.selectOptions ?? [], stored);
  if (!option) return null;
  return isCellEnabled(cell, cellValues, tableCells) ? (option.value ?? option.id) : null;
}

/** 같은 묶음의 다른 칸들 (자기 제외). 묶음 이름이 없으면 빈 목록. */
export function distinctGroupPeers(cell: TableCell, tableCells: readonly TableCell[]): TableCell[] {
  const group = distinctGroupOf(cell);
  if (group === null) return [];
  return tableCells.filter((other) => other.id !== cell.id && distinctGroupOf(other) === group);
}

/**
 * 이 칸의 목록에서 비활성으로 보일 보기 값 — 같은 묶음의 다른 칸이 고른 것.
 * 자기가 고른 보기는 들지 않는다(고른 값이 보이고 바꿀 수 있어야 한다).
 */
export function takenDistinctValues(
  cell: TableCell,
  tableCells: readonly TableCell[],
  cellValues: Record<string, unknown>,
): Set<string> {
  const taken = new Set<string>();
  for (const peer of distinctGroupPeers(cell, tableCells)) {
    const selected = liveSelection(peer, cellValues, tableCells);
    if (selected !== null) taken.add(selected);
  }
  return taken;
}

/** 같은 묶음에 같은 보기를 고른 칸이 둘 이상이면 그 칸 id 전부. */
export function findDistinctViolations(
  tableCells: readonly TableCell[],
  cellValues: Record<string, unknown>,
): string[] {
  const cellIdsByChoice = new Map<string, string[]>();
  for (const cell of tableCells) {
    const group = distinctGroupOf(cell);
    if (group === null) continue;
    const selected = liveSelection(cell, cellValues, tableCells);
    if (selected === null) continue;
    const key = JSON.stringify([group, selected]);
    cellIdsByChoice.set(key, [...(cellIdsByChoice.get(key) ?? []), cell.id]);
  }
  return [...cellIdsByChoice.values()].filter((ids) => ids.length > 1).flat();
}

/**
 * 비활성 보기 계산이 읽는 응답 키 — 같은 묶음 다른 칸들의 값과, 그 칸들이 게이팅 칸이면
 * 직접 컨트롤러의 값(닫힌 칸의 선택을 빼는 데 쓴다). 묶음 구성원이 아니면 빈 목록.
 */
export function distinctSubscriptionKeys(
  cell: TableCell,
  tableCells: readonly TableCell[],
): string[] {
  const keys = new Set<string>();
  for (const peer of distinctGroupPeers(cell, tableCells)) {
    keys.add(peer.id);
    for (const leaf of collectGateLeaves(peer.enabledWhen)) {
      if (leaf.kind !== 'choice-selected') keys.add(leaf.controllerCellId);
    }
  }
  return [...keys];
}
