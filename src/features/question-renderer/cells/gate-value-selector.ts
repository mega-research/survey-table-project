import { CHOICE_GROUPS_KEY } from '@/lib/survey/choice-selection';
import type { CellEnableCondition, TableCell } from '@/types/survey';
import { collectGateLeaves } from '@/utils/cell-gate-tree';

/**
 * 게이팅 평가에 필요한 응답 값만 뽑아 구독하는 선택자 (InteractiveCell 전용).
 *
 * 조건 묶음은 컨트롤러가 여럿이라 스칼라 하나를 구독할 수 없다. 필요한 키만 담은 객체를
 * 돌려주되, **값이 전부 그대로면 직전에 준 객체를 다시 준다** — useSyncExternalStore 는
 * 스냅샷을 Object.is 로 비교하므로 매번 새 객체를 주면 다른 셀의 입력마다 재렌더되고,
 * 스냅샷이 렌더 사이에 달라지면 무한 루프가 된다. 캐시는 선택자 클로저가 쥐므로 셀마다
 * (정확히는 조건 객체마다) 선택자를 하나씩 만든다 — 호출부가 useMemo 로 고정한다.
 */

const NO_VALUES: Record<string, unknown> = Object.freeze({});

/** 게이팅이 없는 셀(대다수)용 — 항상 같은 빈 객체. */
export function selectNoGateValues(): Record<string, unknown> {
  return NO_VALUES;
}

/** 조건 트리 어딘가에 보기 선택(choice-selected) 조건이 있는가. */
export function gateWantsChoiceSelection(condition: CellEnableCondition | undefined): boolean {
  return collectGateLeaves(condition).some((leaf) => leaf.kind === 'choice-selected');
}

/**
 * 조건이 읽는 응답 키 — 잎마다 컨트롤러 셀 id, 보기 선택 조건은 표 응답 안 예약 키
 * (그룹 선택 맵) 하나. 중복은 뺀다.
 *
 * 컨트롤러가 그 자신도 게이팅 셀이면 **그 컨트롤러의 컨트롤러까지** 따라간다. 평가기는
 * 비활성 컨트롤러의 잔존값을 없는 것으로 보는데(cell-gating 의 effectiveControllerValue),
 * 그 판정에는 상류 값이 필요하다 — 구독이 직접 컨트롤러에서 멈추면 상류가 바뀌어도 이 셀이
 * 다시 판정되지 않는다. tableCells 가 없으면 직접 컨트롤러만 구독한다(종전 동작).
 */
export function gateSubscriptionKeys(
  condition: CellEnableCondition,
  tableCells?: readonly TableCell[],
): string[] {
  const keys = new Set<string>();
  const seenControllers = new Set<string>();
  const walk = (current: CellEnableCondition) => {
    for (const leaf of collectGateLeaves(current)) {
      if (leaf.kind === 'choice-selected') {
        keys.add(CHOICE_GROUPS_KEY);
        continue;
      }
      keys.add(leaf.controllerCellId);
      if (seenControllers.has(leaf.controllerCellId)) continue;
      seenControllers.add(leaf.controllerCellId);
      const upstream = tableCells?.find((c) => c.id === leaf.controllerCellId)?.enabledWhen;
      if (upstream) walk(upstream);
    }
  };
  walk(condition);
  return [...keys];
}

export function createGateValueSelector(
  condition: CellEnableCondition,
  tableCells?: readonly TableCell[],
): (questionResponse: unknown) => Record<string, unknown> {
  const keys = gateSubscriptionKeys(condition, tableCells);
  if (keys.length === 0) return selectNoGateValues;
  let previous: Record<string, unknown> | undefined;
  return (questionResponse) => {
    const response =
      typeof questionResponse === 'object' && questionResponse !== null
        ? (questionResponse as Record<string, unknown>)
        : NO_VALUES;
    const cached = previous;
    if (cached && keys.every((key) => Object.is(cached[key], response[key]))) return cached;
    const next: Record<string, unknown> = {};
    for (const key of keys) next[key] = response[key];
    previous = next;
    return next;
  };
}
