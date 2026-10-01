import { describe, expect, it } from 'vitest';

import { CHOICE_GROUPS_KEY } from '@/lib/survey/choice-selection';
import type { CellEnableCondition, TableCell } from '@/types/survey';

import {
  createGateValueSelector,
  gateSubscriptionKeys,
  gateWantsChoiceSelection,
  selectNoGateValues,
} from './gate-value-selector';

const or: CellEnableCondition = {
  kind: 'group',
  op: 'OR',
  terms: [
    { kind: 'numeric', controllerCellId: 'now', op: '>=', value: 1 },
    { kind: 'numeric', controllerCellId: 'want', op: '>=', value: 1 },
  ],
};

describe('gate-value-selector', () => {
  it('묶음 조건이면 컨트롤러 전부를 구독 키로 삼는다', () => {
    expect(gateSubscriptionKeys(or)).toEqual(['now', 'want']);
  });

  it('보기 선택 조건은 컨트롤러 id 대신 그룹 선택 맵 키 하나를 구독한다', () => {
    const condition: CellEnableCondition = {
      kind: 'group',
      op: 'OR',
      terms: [
        { kind: 'choice-selected', controllerCellId: 'opt1' },
        { kind: 'choice-selected', controllerCellId: 'opt2' },
        { kind: 'filled', controllerCellId: 'memo' },
      ],
    };
    expect(gateSubscriptionKeys(condition)).toEqual([CHOICE_GROUPS_KEY, 'memo']);
    expect(gateWantsChoiceSelection(condition)).toBe(true);
    expect(gateWantsChoiceSelection(or)).toBe(false);
    expect(gateWantsChoiceSelection(undefined)).toBe(false);
  });

  it('필요한 키만 뽑고, 컨트롤러 값이 그대로면 같은 객체를 돌려준다', () => {
    const select = createGateValueSelector(or);
    const first = select({ now: '1', want: '', other: 'a' });
    expect(first).toEqual({ now: '1', want: '' });
    // 다른 셀만 바뀐 새 응답 객체 — 스냅샷은 그대로여야 재렌더가 없다
    expect(select({ now: '1', want: '', other: 'b' })).toBe(first);
    const changed = select({ now: '1', want: '2', other: 'b' });
    expect(changed).not.toBe(first);
    expect(changed).toEqual({ now: '1', want: '2' });
  });

  it('미응답(undefined)이어도 안정된 객체를 돌려준다', () => {
    const select = createGateValueSelector(or);
    const first = select(undefined);
    expect(first).toEqual({ now: undefined, want: undefined });
    expect(select(undefined)).toBe(first);
  });

  it('게이팅 없는 셀의 선택자는 항상 같은 빈 객체다', () => {
    expect(selectNoGateValues()).toBe(selectNoGateValues());
    expect(createGateValueSelector({ kind: 'group', op: 'AND', terms: [] })).toBe(selectNoGateValues);
  });

  it('컨트롤러가 게이팅 셀이면 그 상류 컨트롤러까지 구독한다 — 순환이어도 멈춘다', () => {
    const cells = [
      { id: 'x', type: 'input', content: '' },
      { id: 'a', type: 'input', content: '', enabledWhen: { kind: 'filled', controllerCellId: 'x' } },
      { id: 'p', type: 'input', content: '', enabledWhen: { kind: 'filled', controllerCellId: 'r' } },
      { id: 'r', type: 'input', content: '', enabledWhen: { kind: 'filled', controllerCellId: 'p' } },
    ] as TableCell[];
    const onA: CellEnableCondition = { kind: 'filled', controllerCellId: 'a' };
    expect(gateSubscriptionKeys(onA, cells)).toEqual(['a', 'x']);
    expect(gateSubscriptionKeys(onA)).toEqual(['a']);
    expect(gateSubscriptionKeys({ kind: 'filled', controllerCellId: 'p' }, cells)).toEqual(['p', 'r']);
  });
});
