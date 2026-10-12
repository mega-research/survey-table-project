import { describe, expect, it } from 'vitest';

import type { CellEnableCondition } from '@/types/survey';

import {
  collectGateControllerIds,
  collectGateLeaves,
  hasEmptyGateGroup,
  mapGateLeaves,
  resolveGateLeaves,
} from './cell-gate-tree';

const filled = (id: string): CellEnableCondition => ({ kind: 'filled', controllerCellId: id });
const nested: CellEnableCondition = {
  kind: 'group',
  op: 'AND',
  terms: [
    filled('a'),
    { kind: 'group', op: 'OR', terms: [filled('b'), filled('a'), filled('c')] },
  ],
};

describe('cell-gate-tree', () => {
  it('잎 조건은 자기 자신 하나를 잎으로 돌려준다', () => {
    expect(collectGateLeaves(filled('a'))).toEqual([filled('a')]);
    expect(collectGateLeaves(undefined)).toEqual([]);
  });

  it('중첩 묶음의 잎을 적힌 순서로 모으고 컨트롤러 id 는 중복을 뺀다', () => {
    expect(collectGateLeaves(nested).map((l) => l.controllerCellId)).toEqual(['a', 'b', 'a', 'c']);
    expect(collectGateControllerIds(nested)).toEqual(['a', 'b', 'c']);
  });

  it('조건 0개 묶음은 깊은 곳에 있어도 찾는다', () => {
    expect(hasEmptyGateGroup(nested)).toBe(false);
    expect(hasEmptyGateGroup({ kind: 'group', op: 'OR', terms: [] })).toBe(true);
    expect(
      hasEmptyGateGroup({
        kind: 'group',
        op: 'AND',
        terms: [filled('a'), { kind: 'group', op: 'NOT', terms: [] }],
      }),
    ).toBe(true);
    expect(hasEmptyGateGroup(filled('a'))).toBe(false);
  });

  it('mapGateLeaves 는 바뀐 잎이 없으면 원본 참조를 돌려준다', () => {
    expect(mapGateLeaves(nested, (leaf) => leaf)).toBe(nested);
  });

  it('mapGateLeaves 는 깊은 잎의 컨트롤러를 바꾸고 구조는 보존한다', () => {
    const next = mapGateLeaves(nested, (leaf) =>
      leaf.controllerCellId === 'a' ? { ...leaf, controllerCellId: 'A' } : leaf,
    );
    expect(collectGateLeaves(next).map((l) => l.controllerCellId)).toEqual(['A', 'b', 'A', 'c']);
    expect(next).toMatchObject({ kind: 'group', op: 'AND' });
    expect(collectGateLeaves(nested).map((l) => l.controllerCellId)).toEqual(['a', 'b', 'a', 'c']);
  });

  it('resolveGateLeaves 는 잎 하나라도 해석에 실패하면 조건 전체를 버린다', () => {
    expect(resolveGateLeaves(nested, (leaf) => (leaf.controllerCellId === 'c' ? undefined : leaf))).toBeUndefined();
    expect(resolveGateLeaves(nested, (leaf) => leaf)).toBe(nested);
    expect(resolveGateLeaves(filled('a'), () => undefined)).toBeUndefined();
  });
});
