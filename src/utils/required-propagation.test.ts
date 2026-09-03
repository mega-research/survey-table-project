import { describe, expect, it } from 'vitest';

import type { ChoiceGroup, TableRow } from '@/types/survey';
import {
  propagateRequiredToTableRows,
  stripChoiceGroupRequiredOverrides,
} from '@/utils/required-propagation';

/**
 * 필수 마스터 전파 (ADR 0021) — 질문 "필수 질문" 토글 조작 시점의 일괄 복사.
 * - 인터랙티브 셀(input/radio/checkbox/select/ranking)만 대상
 * - 게이팅(enabledWhen) 셀은 "활성일 때 필수"(requiredWhenEnabled)로 켠다
 * - 셀별 안내 문구는 보존
 * - 그룹은 명시 오버라이드 제거로 상속 복귀 (문구 보존)
 */

function rows(): TableRow[] {
  return [
    {
      id: 'r1',
      label: '',
      cells: [
        { id: 'c-text', type: 'text', content: '라벨' },
        { id: 'c-input', type: 'input', content: '', requiredMessage: '금액을 입력해주세요.' },
        {
          id: 'c-gated',
          type: 'input',
          content: '',
          enabledWhen: { kind: 'filled', controllerCellId: 'c-radio' },
        },
        { id: 'c-radio', type: 'radio', content: '', radioOptions: [{ id: 'o1', label: 'A' }] },
        { id: 'c-calc', type: 'calc', content: '' },
        { id: 'c-opt', type: 'choice_opt', content: '', choiceGroupId: 'g1' },
      ],
    },
  ] as unknown as TableRow[];
}

describe('propagateRequiredToTableRows', () => {
  it('ON: 인터랙티브 셀에 필수를 켜고, 게이팅 셀은 활성일 때 필수로 켠다', () => {
    const out = propagateRequiredToTableRows(rows(), true);
    const cells = Object.fromEntries(out[0]!.cells.map((c) => [c.id, c]));
    expect(cells['c-input']!.required).toBe(true);
    expect(cells['c-radio']!.required).toBe(true);
    // 게이팅 셀 — 도메인 수렴식대로 requiredWhenEnabled, 평범한 required 는 켜지 않는다
    expect(cells['c-gated']!.requiredWhenEnabled).toBe(true);
    expect(cells['c-gated']!.required).not.toBe(true);
  });

  it('OFF: 대칭으로 전부 해제한다', () => {
    const on = propagateRequiredToTableRows(rows(), true);
    const off = propagateRequiredToTableRows(on, false);
    const cells = Object.fromEntries(off[0]!.cells.map((c) => [c.id, c]));
    expect(cells['c-input']!.required).toBe(false);
    expect(cells['c-radio']!.required).toBe(false);
    expect(cells['c-gated']!.requiredWhenEnabled).toBe(false);
  });

  it('비인터랙티브 셀(text/calc/choice_opt)은 건드리지 않는다', () => {
    const out = propagateRequiredToTableRows(rows(), true);
    const cells = Object.fromEntries(out[0]!.cells.map((c) => [c.id, c]));
    expect(cells['c-text']!.required).toBeUndefined();
    expect(cells['c-calc']!.required).toBeUndefined();
    expect(cells['c-opt']!.required).toBeUndefined();
  });

  it('셀별 안내 문구는 보존한다', () => {
    const out = propagateRequiredToTableRows(rows(), true);
    const input = out[0]!.cells.find((c) => c.id === 'c-input')!;
    expect(input.requiredMessage).toBe('금액을 입력해주세요.');
  });
});

describe('stripChoiceGroupRequiredOverrides', () => {
  it('required 오버라이드만 제거하고 문구·나머지 속성은 보존한다', () => {
    const groups: ChoiceGroup[] = [
      { id: 'g1', groupKey: 'rad1', type: 'radio', label: '12월', required: false },
      {
        id: 'g2',
        groupKey: 'rad2',
        type: 'radio',
        label: '현재',
        required: true,
        requiredMessage: '현재 상태를 선택해주세요.',
      },
      { id: 'g3', groupKey: 'cb1', type: 'checkbox', label: '기타', minSelections: 2 },
    ];
    const out = stripChoiceGroupRequiredOverrides(groups);
    expect(out.every((g) => g.required === undefined)).toBe(true);
    expect(out[1]!.requiredMessage).toBe('현재 상태를 선택해주세요.');
    expect(out[2]!.minSelections).toBe(2);
    expect(out.map((g) => g.groupKey)).toEqual(['rad1', 'rad2', 'cb1']);
  });
});
