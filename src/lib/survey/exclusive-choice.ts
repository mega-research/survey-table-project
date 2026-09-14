/**
 * 단독 선택 보기 (CONTEXT.md "단독 선택 보기") — 체크박스 그룹 안에서 그것 하나만 남는 보기.
 *
 * 규칙은 대칭이다. 단독 선택 보기를 고르면 같은 그룹의 나머지(다른 단독 선택 보기 포함)가
 * 풀리고, 일반 보기를 고르면 단독 선택 보기가 풀린다. 나중에 누른 쪽이 이긴다.
 *
 * 세 표면(일반 체크박스 문항 · 레거시 보기 소스 표 · 보기 그룹 표)이 이 함수 하나를 쓴다 —
 * 값 모양이 달라서(문자열 · 기타 상세기재 객체 · 셀 id) 판정은 호출부가 함수로 넘긴다.
 * 해제(체크 풀기)는 규칙이 없으므로 여기서 다루지 않는다.
 */

import type { TableCell, TableRow } from '@/types/survey';
import { collectChoiceOptCells } from '@/utils/choice-source';

/** 이 보기 셀이 단독 선택 보기인가 — choice_opt 셀의 exclusiveChoice 플래그 하나로 판정한다 */
export function isExclusiveChoiceCell(cell: TableCell): boolean {
  return cell.type === 'choice_opt' && cell.exclusiveChoice === true;
}

/**
 * 셀 목록에서 단독 선택 보기 셀 id 집합. `groupId` 를 주면 그 그룹 소속만 — 보기 그룹 표는
 * 그룹이 단위이고, 그룹 없는 레거시 표는 문항 전체가 한 그룹이라 전부 모은다.
 */
export function collectExclusiveChoiceCellIds(
  cells: readonly TableCell[],
  groupId?: string,
): Set<string> {
  const ids = new Set<string>();
  for (const cell of cells) {
    if (!isExclusiveChoiceCell(cell)) continue;
    if (groupId !== undefined && cell.choiceGroupId !== groupId) continue;
    ids.add(cell.id);
  }
  return ids;
}

/** 표 행 데이터에서 — 숨은 셀은 고를 수 없으니 보기 셀 수집기가 거른 것만 본다 */
export function collectExclusiveChoiceCellIdsFromRows(
  tableRowsData: TableRow[] | undefined,
): Set<string> {
  return collectExclusiveChoiceCellIds(collectChoiceOptCells(tableRowsData));
}

/**
 * 체크박스 응답값 하나에서 보기 키를 꺼낸다 — 옵션 value(일반 문항) 또는 보기 셀 id(보기 소스 표).
 * 기타 상세기재는 `{selectedValue}` 객체라 그 안의 값이 키다.
 */
export function choiceValueKey(val: unknown): string | undefined {
  const key =
    typeof val === 'object' && val !== null && 'selectedValue' in val
      ? (val as { selectedValue: unknown }).selectedValue
      : val;
  return typeof key === 'string' ? key : undefined;
}

export interface ExclusiveSelectionResult<T> {
  /** 다음 선택 집합 (고른 항목은 배열 끝) */
  next: T[];
  /** 이번 선택으로 풀린 항목들. 지금은 소비자가 없다 — "풀릴 때 알리지 않는다"가 결정이고,
   *  나중에 안내를 붙일 때 규칙 함수를 다시 열지 않도록 돌려 두는 것이 합의 사항이다. */
  released: T[];
}

export function applyExclusiveSelection<T>(
  current: readonly T[],
  picked: T,
  isExclusive: (item: T) => boolean,
): ExclusiveSelectionResult<T> {
  if (isExclusive(picked)) {
    return { next: [picked], released: current.filter((item) => item !== picked) };
  }
  const released = current.filter((item) => isExclusive(item));
  const kept = current.filter((item) => !isExclusive(item));
  return { next: [...kept, picked], released };
}

/**
 * 최소 선택 수 판정 — 단독 선택 보기 하나가 들어 있으면 완결된 답으로 보아 충족이다.
 * 「없음」에 "2개 이상 고르세요"를 들이대면 응답자가 빠져나갈 길이 없다.
 */
export function satisfiesMinSelections<T>(
  selected: readonly T[],
  minSelections: number | undefined,
  isExclusive: (item: T) => boolean,
): boolean {
  if (minSelections === undefined || minSelections <= 0) return true;
  if (selected.some((item) => isExclusive(item))) return true;
  return selected.length >= minSelections;
}

/** 범위가 표 전체인 단독 선택 보기 셀 id — 어느 그룹에서 고르든 이 표의 모든 그룹을 비운다 */
export function collectTableExclusiveChoiceCellIds(cells: readonly TableCell[]): Set<string> {
  const ids = new Set<string>();
  for (const cell of cells) {
    if (isExclusiveChoiceCell(cell) && cell.exclusiveScope === 'table') ids.add(cell.id);
  }
  return ids;
}

/** 그룹 선택 맵 — 레거시 그룹 문항의 응답 자체, 보기 그룹 표의 `__choiceGroups` 값 */
export type GroupSelectionMap = Record<string, string | string[]>;

function selectionIncludes(sel: string | string[] | undefined, id: string): boolean {
  return Array.isArray(sel) ? sel.includes(id) : sel === id;
}

/**
 * 표 전체 범위 단독 선택을 그룹 선택 맵에 적용한다 — 한 그룹의 선택이 바뀐 **뒤** 호출한다.
 * 고른 것이 표 전체 단독 보기면 그 그룹만 남기고 나머지 그룹을 전부 비운다. 일반 보기면 다른
 * 그룹에 들어 있던 표 전체 단독 보기를 뺀다(라디오 그룹이면 키 삭제). 그룹 범위 단독 보기는
 * 여기서 다루지 않는다 — 그건 그룹 배열 안에서 applyExclusiveSelection 이 끝낸다.
 */
export function applyTableExclusiveToGroups(
  map: GroupSelectionMap,
  pickedGroupKey: string,
  pickedId: string,
  tableExclusiveIds: ReadonlySet<string>,
): GroupSelectionMap {
  if (tableExclusiveIds.size === 0) return map;
  if (tableExclusiveIds.has(pickedId)) {
    const own = map[pickedGroupKey];
    return own === undefined ? {} : { [pickedGroupKey]: own };
  }
  const next: GroupSelectionMap = {};
  for (const [key, sel] of Object.entries(map)) {
    if (key === pickedGroupKey) {
      next[key] = sel;
      continue;
    }
    if (Array.isArray(sel)) {
      const kept = sel.filter((id) => !tableExclusiveIds.has(id));
      if (kept.length > 0) next[key] = kept;
    } else if (!tableExclusiveIds.has(sel)) {
      next[key] = sel;
    }
  }
  return next;
}

/** 선택 맵 어딘가에 표 전체 단독 보기가 골라져 있는가 — 그러면 이 표의 그룹 전부를 충족으로 본다 */
export function hasTableExclusiveSelected(
  map: Record<string, unknown>,
  tableExclusiveIds: ReadonlySet<string>,
): boolean {
  if (tableExclusiveIds.size === 0) return false;
  for (const id of tableExclusiveIds) {
    for (const sel of Object.values(map)) {
      if (selectionIncludes(sel as string | string[] | undefined, id)) return true;
    }
  }
  return false;
}
