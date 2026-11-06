import { describe, expect, it } from 'vitest';

import {
  hiddenSelectOptionValues,
  selectOptionGateCondition,
  stripDisabledCellValues,
} from '@/lib/survey/cell-gating';
import type { Question, TableCell } from '@/types/survey';
import { remapCellRefs } from '@/utils/table-cell-refs';

/**
 * 표 드롭다운 보기별 표시 조건 (2026-11-06, .scratch/select-option-conditions/PRD.md).
 * 유가공업 문3 — 「설비구분」에 따라 「주요 설비명」 목록이 바뀐다. 「기타(직접입력)」은 조건이 없어 늘 보인다.
 */
const category: TableCell = {
  id: 'cat',
  content: '',
  type: 'select',
  selectOptions: [
    { id: 'c1', label: '원유 수취·저장', value: '1' },
    { id: 'c3', label: '살균·멸균', value: '3' },
  ],
};
const name: TableCell = {
  id: 'name',
  content: '',
  type: 'select',
  selectOptions: [
    { id: 'n11', label: '원유 수취탱크', value: '11', enabledWhen: { kind: 'option', controllerCellId: 'cat', values: ['1'] } },
    { id: 'n31', label: 'HTST 살균기', value: '31', enabledWhen: { kind: 'option', controllerCellId: 'cat', values: ['3'] } },
    { id: 'n99', label: '기타(직접입력)', value: '99' },
  ],
};
const cells = [category, name];
const question = (): Question =>
  ({
    id: 'q3', type: 'table', title: '문3', required: false, order: 1,
    tableRowsData: [{ id: 'r1', label: '설비', cells }],
  }) as Question;

describe('hiddenSelectOptionValues', () => {
  it('컨트롤러 값에 맞지 않는 보기를 숨기고, 조건 없는 보기는 늘 보인다', () => {
    expect([...hiddenSelectOptionValues(name, { cat: '3' }, cells)].sort()).toEqual(['11']);
    expect([...hiddenSelectOptionValues(name, { cat: '1' }, cells)].sort()).toEqual(['31']);
  });

  it('컨트롤러를 아직 안 골랐으면 조건 있는 보기는 전부 숨는다', () => {
    expect([...hiddenSelectOptionValues(name, {}, cells)].sort()).toEqual(['11', '31']);
  });

  it('보기 조건이 없는 셀은 빈 집합이고 구독 조건도 없다', () => {
    expect(hiddenSelectOptionValues(category, { cat: '3' }, cells).size).toBe(0);
    expect(selectOptionGateCondition(category)).toBeUndefined();
  });

  it('구독 조건은 보기 조건들의 묶음이다 — 컨트롤러 값만 구독하면 된다', () => {
    const condition = selectOptionGateCondition(name);
    expect(condition).toMatchObject({ kind: 'group', op: 'OR' });
  });
});

describe('stripDisabledCellValues — 보기 조건', () => {
  it('고른 보기의 조건이 거짓이면 그 값을 지운다 — 구분을 바꾼 뒤 남은 설비명', () => {
    const out = stripDisabledCellValues([question()], { q3: { cat: '1', name: '31' } });
    expect(out['q3']).toEqual({ cat: '1' });
  });

  it('조건이 참인 보기와 조건 없는 보기는 남긴다', () => {
    const kept = { q3: { cat: '3', name: '31' } };
    expect(stripDisabledCellValues([question()], kept)).toBe(kept);
    const other = { q3: { cat: '1', name: '99' } };
    expect(stripDisabledCellValues([question()], other)).toBe(other);
  });
});

describe('remapCellRefs — 보기 조건의 컨트롤러', () => {
  it('행 반복 벌·복사본은 자기 벌의 컨트롤러를 본다', () => {
    const moved = remapCellRefs(name, new Map([['cat', 'cat-r2']]));
    expect(moved.selectOptions?.map((o) => o.enabledWhen)).toEqual([
      { kind: 'option', controllerCellId: 'cat-r2', values: ['1'] },
      { kind: 'option', controllerCellId: 'cat-r2', values: ['3'] },
      undefined,
    ]);
  });

  it('옮길 것이 없으면 원본 참조를 돌려준다', () => {
    expect(remapCellRefs(name, new Map([['other', 'x']]))).toBe(name);
  });
});
