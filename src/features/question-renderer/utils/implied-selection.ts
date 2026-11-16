/**
 * 따라 선택 (CONTEXT.md "따라 선택") — 보기 칸을 고르면 저작자가 그 칸에 건 다른 보기 칸도 함께 골라진다.
 *
 * 한 방향이고 고를 때만 따라간다. 풀 때는 규칙이 없어 여기서 다루지 않는다(누른 칸 하나만 풀린다).
 * 사슬은 끝까지 따라간다 — 수혜 → 지원, 지원 → 알고 이면 수혜 하나로 셋이 골라진다.
 *
 * 응답 화면의 쓰기 셋(보기 그룹 표의 use-choice-opt-toggle · 보기 소스 표의 그룹 선택 · 그룹 없는
 * 체크박스 문항의 선택 목록)과 빌더의 후보·정리(survey-builder)가 같은 자격 판정을 쓴다.
 * 쓰기는 직접 고른 쓰기 뒤 같은 쓰기 안에서 부르고, 서버는 다시 적용하지 않는다(입력 편의이지 검증이 아니다).
 *
 * 최대 선택 수와 만날 때: 그룹 없는 체크박스 문항의 `maxSelections` 만 지금 동작한다 — 함께 골라질 보기까지
 * 넣으면 넘을 때는 누른 보기도 받지 않고 안내한다(`choice.impliedOverMax`). 그룹 최대 선택 수
 * (`ChoiceGroup.maxSelections`)는 아직 어디서도 읽지 않는다. 살릴 때는 같은 규칙을 그룹마다 건다
 * (2026-11-12 결정, `.scratch/implied-selection/PRD.md`).
 */
import type { ChoiceGroup, TableCell } from '@/types/survey';
import { resolveChoiceCellGroup } from '@/utils/choice-group-helpers';

import {
  type GroupSelectionMap,
  applyExclusiveSelection,
  applyTableExclusiveToGroups,
  collectTableExclusiveChoiceCellIds,
  isExclusiveChoiceCell,
} from './exclusive-choice';

/** 보기 칸이 어느 선택 묶음에 드는지 정하는 재료 — 문항의 그룹 정의와, 그룹 없는 칸의 선택 방식 */
export interface ImpliedSelectionScope {
  groups: readonly ChoiceGroup[];
  /**
   * 그룹 없는 보기 칸의 선택 방식 (`resolveUngroupedSelectionType(문항 유형)`). 체크박스·라디오 문항의
   * 내장 표는 문항 유형이고, 테이블 유형은 null — 그룹 없는 보기 칸은 답할 수 없는 글자 칸이다.
   * 미지정은 null 과 같다.
   */
  ungroupedSelectionType?: 'radio' | 'checkbox' | null | undefined;
}

/**
 * 이 칸이 속한 **체크박스** 묶음의 응답 키 — 체크박스로 고르는 보기 칸이 아니면 null.
 * 묶음 판정은 화면이 읽고 쓰는 것과 같은 함수(resolveChoiceCellGroup)다 — 따로 판정하면 따라 골라진
 * 값이 화면이 보지 않는 키에 남는다(순위 그룹을 가리키는 칸에서 실제로 갈렸다).
 */
function checkboxGroupKeyOf(cell: TableCell, scope: ImpliedSelectionScope): string | null {
  if (cell.type !== 'choice_opt') return null;
  const { groupKey, type } = resolveChoiceCellGroup(
    cell,
    scope.groups,
    scope.ungroupedSelectionType ?? null,
  );
  return type === 'checkbox' ? groupKey : null;
}

/**
 * 따라 선택을 일으킬 수 있는 칸인가 — 체크박스로 고르는 보기 칸이고 단독 선택 보기가 아니다.
 * 단독 선택 보기는 「그것 하나만 남는다」가 뜻이라 다른 칸을 함께 고르는 것과 어긋난다.
 */
export function canImplySelection(cell: TableCell, scope: ImpliedSelectionScope): boolean {
  return checkboxGroupKeyOf(cell, scope) !== null && !isExclusiveChoiceCell(cell);
}

/**
 * 따라 골라질 수 있는 칸인가 — 출발 자격에 더해 병합에 가려지지 않아야 한다.
 * 단독 선택 보기를 대상으로 두면 일반 보기를 눌렀는데 「없음」이 따라 골라져 그 그룹이 통째로 빈다.
 * 「지금 그려지는가」는 응답 화면만 아는 것이라 여기서 보지 않는다(resolveImpliedCells 가 본다).
 */
export function isImpliedSelectionTarget(cell: TableCell, scope: ImpliedSelectionScope): boolean {
  return canImplySelection(cell, scope) && !cell.isHidden;
}

/** 이 표에 따라 선택 짝이 하나라도 걸려 있는가 — 없는 표(대다수)는 아무 준비도 하지 않는다 */
export function hasImpliedSelection(cells: readonly TableCell[]): boolean {
  return cells.some((cell) => (cell.impliedCellIds?.length ?? 0) > 0);
}

export interface ImpliedSelectionContext extends ImpliedSelectionScope {
  /** 표 전체 셀 정의 — 대상은 다른 행에 있을 수 있다 */
  tableCells: readonly TableCell[];
  /**
   * 응답자가 볼 수 있는 칸 — 행·열 표시 조건과 동적 행 선택을 거쳐 남은 칸. 주어지면 그 밖의 칸은
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
  if (!canImplySelection(picked, context)) return [];

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
      if (!target || !isImpliedSelectionTarget(target, context)) continue;
      if (visibleCellIds !== null && !visibleCellIds.has(targetId)) continue;
      resolved.push(target);
      queue.push(target);
    }
  }
  return resolved;
}

/** 같은 체크박스 묶음에 든 단독 선택 보기 칸 id — 따라 골라진 칸이 직접 고른 것처럼 이들을 푼다 */
function exclusiveIdsInGroup(groupKey: string, context: ImpliedSelectionContext): Set<string> {
  const ids = new Set<string>();
  for (const cell of context.tableCells) {
    if (isExclusiveChoiceCell(cell) && checkboxGroupKeyOf(cell, context) === groupKey) {
      ids.add(cell.id);
    }
  }
  return ids;
}

/**
 * 따라 선택을 그룹 선택 맵에 적용한다 — 고른 칸의 쓰기가 끝난 **뒤** 호출한다.
 * 보기 그룹 표의 `__choiceGroups` 와 보기 소스 표 그룹 문항의 응답이 이 모양이다.
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

  const tableExclusiveIds = collectTableExclusiveChoiceCellIds(context.tableCells);
  let next = map;
  for (const cell of implied) {
    const groupKey = checkboxGroupKeyOf(cell, context);
    if (groupKey === null) continue;
    const selection = next[groupKey];
    const current = Array.isArray(selection) ? selection : [];
    if (current.includes(cell.id)) continue;
    const groupExclusiveIds = exclusiveIdsInGroup(groupKey, context);
    const selected = applyExclusiveSelection(current, cell.id, (id) =>
      groupExclusiveIds.has(id),
    ).next;
    next = applyTableExclusiveToGroups(
      { ...next, [groupKey]: selected },
      groupKey,
      cell.id,
      tableExclusiveIds,
    );
  }
  return next;
}

/**
 * 따라 선택을 선택 목록에 적용한다 — 그룹 없는 체크박스 문항의 내장 표는 문항 전체가 한 묶음이라
 * 응답이 보기 칸 id 배열 하나다. 고른 칸의 쓰기가 끝난 **뒤** 호출한다. 바뀔 것이 없으면 받은 목록 그대로다.
 */
export function applyImpliedSelectionToList(
  current: readonly string[],
  picked: TableCell,
  context: ImpliedSelectionContext,
): readonly string[] {
  const implied = resolveImpliedCells(picked, context);
  if (implied.length === 0) return current;

  // 목록 하나가 문항 전체의 선택이라 묶음 키를 가리지 않는다 — 체크박스로 고르는 단독 선택 보기 전부
  const exclusiveIds = new Set(
    context.tableCells
      .filter((cell) => isExclusiveChoiceCell(cell) && checkboxGroupKeyOf(cell, context) !== null)
      .map((cell) => cell.id),
  );
  let next: readonly string[] = current;
  for (const cell of implied) {
    if (next.includes(cell.id)) continue;
    next = applyExclusiveSelection(next, cell.id, (id) => exclusiveIds.has(id)).next;
  }
  return next;
}
