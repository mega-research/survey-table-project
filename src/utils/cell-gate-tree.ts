import type {
  CellEnableCondition,
  CellEnableGroupCondition,
  CellEnableLeafCondition,
} from '@/types/survey';

/**
 * 셀 게이팅 조건 트리 순회 (CONTEXT.md "셀 게이팅" — 조건 묶음).
 *
 * 활성 조건은 잎(컨트롤러 셀 하나 + 판정 하나) 또는 묶음(연산자 + 조건 N개, 중첩 가능)이다.
 * 컨트롤러 참조를 읽거나 고치는 자리 — 평가·진단·복제 재배선·보기 값 리맵·응답 화면 구독 —
 * 는 전부 이 모듈을 거친다. `enabledWhen.controllerCellId` 를 직접 읽으면 묶음에서 조용히
 * undefined 가 된다. 타입만 import 하는 잎 모듈이라 utils·lib·features 어디서든 쓸 수 있다.
 */

export function isGateGroup(condition: CellEnableCondition): condition is CellEnableGroupCondition {
  return condition.kind === 'group';
}

/** 트리의 모든 잎 조건 (깊이 우선, 적힌 순서). */
export function collectGateLeaves(
  condition: CellEnableCondition | undefined,
): CellEnableLeafCondition[] {
  if (!condition) return [];
  if (!isGateGroup(condition)) return [condition];
  return condition.terms.flatMap((term) => collectGateLeaves(term));
}

/** 조건이 참조하는 컨트롤러 셀 id (중복 제거, 처음 나온 순서). */
export function collectGateControllerIds(condition: CellEnableCondition | undefined): string[] {
  return [...new Set(collectGateLeaves(condition).map((leaf) => leaf.controllerCellId))];
}

/** 조건 0개짜리 묶음이 트리 어딘가에 있는가 — "조건 없음 = 충족" 이라 저작 실수일 가능성이 높다. */
export function hasEmptyGateGroup(condition: CellEnableCondition | undefined): boolean {
  if (!condition || !isGateGroup(condition)) return false;
  return condition.terms.length === 0 || condition.terms.some((term) => hasEmptyGateGroup(term));
}

/**
 * 모든 잎을 바꾼다. 바뀐 잎이 없으면 **원본 참조를 그대로** 돌려준다(리렌더·더티 판정 최소화).
 */
export function mapGateLeaves(
  condition: CellEnableCondition,
  map: (leaf: CellEnableLeafCondition) => CellEnableLeafCondition,
): CellEnableCondition {
  if (!isGateGroup(condition)) return map(condition);
  const terms = condition.terms.map((term) => mapGateLeaves(term, map));
  return terms.every((term, i) => term === condition.terms[i]) ? condition : { ...condition, terms };
}

/**
 * 모든 잎을 다시 해석한다. **잎 하나라도 해석에 실패(undefined)하면 조건 전체가 undefined** 다.
 * 일부만 빼면 뜻이 바뀐다 — AND 에서 조건이 빠지면 느슨해지고 NOT 에서 빠지면 항상 참에
 * 가까워진다. 죽은 참조가 섞인 조건은 통째로 걷어내는 것이 단일 조건 시절의 동작과도 같다.
 */
export function resolveGateLeaves(
  condition: CellEnableCondition,
  resolve: (leaf: CellEnableLeafCondition) => CellEnableLeafCondition | undefined,
): CellEnableCondition | undefined {
  if (!isGateGroup(condition)) return resolve(condition);
  const terms: CellEnableCondition[] = [];
  for (const term of condition.terms) {
    const next = resolveGateLeaves(term, resolve);
    if (!next) return undefined;
    terms.push(next);
  }
  return terms.every((term, i) => term === condition.terms[i]) ? condition : { ...condition, terms };
}
