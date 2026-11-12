/**
 * 따라 선택 (CONTEXT.md "따라 선택") — 보기 칸을 고르면 저작자가 그 칸에 건 다른 보기 칸도 함께 골라진다.
 *
 * 한 방향이고 고를 때만 따라간다. 풀 때는 규칙이 없어 여기서 다루지 않는다(누른 칸 하나만 풀린다).
 * 사슬은 끝까지 따라간다 — 수혜 → 지원, 지원 → 알고 이면 수혜 하나로 셋이 골라진다.
 *
 * 응답 화면의 쓰기(use-choice-opt-toggle)와 빌더의 후보·정리(survey-builder)가 같은 자격 판정을 쓴다.
 * 테이블 유형 문항의 체크박스 보기 그룹 전용이다 — 보기 소스 표는 쓰기 경로가 달라 대상이 아니다.
 */
import type { ChoiceGroup, TableCell } from '@/types/survey';

import {
  type GroupSelectionMap,
  applyExclusiveSelection,
  applyTableExclusiveToGroups,
  collectExclusiveChoiceCellIds,
  collectTableExclusiveChoiceCellIds,
  isExclusiveChoiceCell,
} from './exclusive-choice';

type GroupsById = ReadonlyMap<string, ChoiceGroup>;

function checkboxGroupOf(cell: TableCell, groupsById: GroupsById): ChoiceGroup | undefined {
  if (cell.type !== 'choice_opt' || cell.choiceGroupId === undefined) return undefined;
  const group = groupsById.get(cell.choiceGroupId);
  return group?.type === 'checkbox' ? group : undefined;
}

/**
 * 따라 선택을 일으킬 수 있는 칸인가 — 체크박스 그룹의 보기 칸이고 단독 선택 보기가 아니다.
 * 단독 선택 보기는 「그것 하나만 남는다」가 뜻이라 다른 칸을 함께 고르는 것과 어긋난다.
 */
export function canImplySelection(cell: TableCell, groupsById: GroupsById): boolean {
  return checkboxGroupOf(cell, groupsById) !== undefined && !isExclusiveChoiceCell(cell);
}

/**
 * 따라 골라질 수 있는 칸인가 — 출발 자격에 더해 병합에 가려지지 않아야 한다.
 * 단독 선택 보기를 대상으로 두면 일반 보기를 눌렀는데 「없음」이 따라 골라져 그 그룹이 통째로 빈다.
 * 「지금 그려지는가」는 응답 화면만 아는 것이라 여기서 보지 않는다(resolveImpliedCells 가 본다).
 */
export function isImpliedSelectionTarget(cell: TableCell, groupsById: GroupsById): boolean {
  return canImplySelection(cell, groupsById) && !cell.isHidden;
}

/** 이 표에 따라 선택 짝이 하나라도 걸려 있는가 — 없는 표(대다수)는 아무 준비도 하지 않는다 */
export function hasImpliedSelection(cells: readonly TableCell[]): boolean {
  return cells.some((cell) => (cell.impliedCellIds?.length ?? 0) > 0);
}

export interface ImpliedSelectionContext {
  /** 표 전체 셀 정의 — 대상은 다른 행에 있을 수 있다 */
  tableCells: readonly TableCell[];
  groups: readonly ChoiceGroup[];
  /**
   * 지금 그려지는 칸 — 행·열 표시 조건과 동적 행 선택을 거쳐 남은 칸. 주어지면 그 밖의 칸은
   * 따라 고르지 않는다(응답자가 풀 수 없는 값을 만들지 않는다). null·미지정이면 표 전체가 보이는 것으로 본다.
   */
  visibleCellIds?: ReadonlySet<string> | null | undefined;
}

/**
 * 고른 칸에서 따라 골라질 칸 — 사슬 순서(가까운 것부터), 고른 칸 자신은 뺀다.
 * 자격 없는 대상·없어진 칸은 건너뛰고 그 칸의 짝도 따라가지 않는다(골라지지 않은 칸은 사슬을 잇지 않는다).
 */
export function resolveImpliedCells(picked: TableCell, context: ImpliedSelectionContext): TableCell[] {
  if (!picked.impliedCellIds?.length) return [];
  const groupsById = new Map(context.groups.map((group) => [group.id, group]));
  if (!canImplySelection(picked, groupsById)) return [];

  const cellsById = new Map(context.tableCells.map((cell) => [cell.id, cell]));
  const visibleCellIds = context.visibleCellIds ?? null;
  const visited = new Set<string>([picked.id]);
  const resolved: TableCell[] = [];
  const queue: TableCell[] = [picked];
  for (let source = queue.shift(); source !== undefined; source = queue.shift()) {
    for (const targetId of source.impliedCellIds ?? []) {
      if (visited.has(targetId)) continue;
      visited.add(targetId);
      const target = cellsById.get(targetId);
      if (!target || !isImpliedSelectionTarget(target, groupsById)) continue;
      if (visibleCellIds !== null && !visibleCellIds.has(targetId)) continue;
      resolved.push(target);
      queue.push(target);
    }
  }
  return resolved;
}

/**
 * 따라 선택을 그룹 선택 맵에 적용한다 — 고른 칸의 쓰기가 끝난 **뒤** 호출한다.
 *
 * 따라 골라진 칸은 직접 고른 것과 같은 보기다: 그 그룹의 단독 선택 보기를 풀고, 다른 그룹에 들어 있던
 * 표 전체 단독 선택 보기를 뺀다. 이미 골라진 칸은 그대로 둔다. 바뀔 것이 없으면 받은 맵을 그대로 돌려준다.
 */
export function applyImpliedSelection(
  map: GroupSelectionMap,
  picked: TableCell,
  context: ImpliedSelectionContext,
): GroupSelectionMap {
  const implied = resolveImpliedCells(picked, context);
  if (implied.length === 0) return map;

  const groupsById = new Map(context.groups.map((group) => [group.id, group]));
  const tableExclusiveIds = collectTableExclusiveChoiceCellIds(context.tableCells);
  let next = map;
  for (const cell of implied) {
    const group = checkboxGroupOf(cell, groupsById);
    if (!group) continue;
    const selection = next[group.groupKey];
    const current = Array.isArray(selection) ? selection : [];
    if (current.includes(cell.id)) continue;
    const groupExclusiveIds = collectExclusiveChoiceCellIds(context.tableCells, group.id);
    const selected = applyExclusiveSelection(current, cell.id, (id) =>
      groupExclusiveIds.has(id),
    ).next;
    next = applyTableExclusiveToGroups(
      { ...next, [group.groupKey]: selected },
      group.groupKey,
      cell.id,
      tableExclusiveIds,
    );
  }
  return next;
}
