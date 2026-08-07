import { describe, expect, it } from 'vitest';
import { remapConditionGroupValues, remapGatingValues } from '@/utils/option-value-remap';
import type { QuestionConditionGroup, TableRow } from '@/types/survey';

const rows = (): TableRow[] => [
  {
    id: 'r1', label: '', cells: [
      { id: 'ctrl', type: 'radio', content: '', radioOptions: [{ id: 'a', label: '', value: 'option-2' }] },
      { id: 'gated', type: 'input', content: '', enabledWhen: { kind: 'option', controllerCellId: 'ctrl', values: ['option-2'] } },
      { id: 'other', type: 'input', content: '', enabledWhen: { kind: 'option', controllerCellId: 'elsewhere', values: ['option-2'] } },
    ],
  },
] as TableRow[];

describe('remapGatingValues', () => {
  it('해당 컨트롤러를 참조하는 게이팅 값만 리매핑한다', () => {
    const out = remapGatingValues(rows(), 'ctrl', 'option-2', '5');
    const cells = out[0]!.cells;
    expect(cells[1]!.enabledWhen).toMatchObject({ values: ['5'] });
    expect(cells[2]!.enabledWhen).toMatchObject({ values: ['option-2'] });
  });

  it('참조가 없으면 원본 배열 참조를 그대로 반환한다', () => {
    const src = rows();
    expect(remapGatingValues(src, 'nobody', 'x', 'y')).toBe(src);
  });
});

const conditionGroup = (): QuestionConditionGroup => ({
  logicType: 'AND',
  conditions: [
    {
      id: 'c1',
      sourceQuestionId: 'q1',
      conditionType: 'value-match',
      requiredValues: ['option-2', 'option-3'],
      logicType: 'AND',
    },
    {
      id: 'c2',
      sourceQuestionId: 'q1',
      conditionType: 'table-cell-check',
      tableConditions: { rowIds: ['r1'], checkType: 'any', expectedValues: ['option-2'] },
      additionalConditions: { cellColumnIndex: 0, checkType: 'checkbox', expectedValues: ['option-2'] },
      logicType: 'AND',
    },
    {
      id: 'c3',
      sourceQuestionId: 'other-question',
      conditionType: 'value-match',
      requiredValues: ['option-2'],
      logicType: 'AND',
    },
  ],
});

describe('remapConditionGroupValues', () => {
  it('해당 questionId를 참조하는 조건의 값만 리매핑한다', () => {
    const out = remapConditionGroupValues(conditionGroup(), 'q1', 'option-2', '5');
    expect(out.conditions[0]!.requiredValues).toEqual(['5', 'option-3']);
    expect(out.conditions[1]!.tableConditions).toMatchObject({ expectedValues: ['5'] });
    expect(out.conditions[1]!.additionalConditions).toMatchObject({ expectedValues: ['5'] });
    expect(out.conditions[2]!.requiredValues).toEqual(['option-2']);
  });

  it('참조가 없으면 원본 참조를 그대로 반환한다', () => {
    const src = conditionGroup();
    expect(remapConditionGroupValues(src, 'nobody', 'x', 'y')).toBe(src);
  });
});
