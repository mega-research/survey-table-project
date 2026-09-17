import { describe, expect, it } from 'vitest';
import { remapConditionGroupValues, remapGatingValues } from '@/features/survey-builder/utils/option-value-remap';
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

// ── 셀 스코프 리매핑 — 같은 표의 다른 셀이 같은 옵션 value 를 쓰는 것이 일상이라,
// 셀 편집에서 온 value 변경은 그 셀을 실제로 참조하는 조건만 바꿔야 한다 ──

const tableCheckGroup = (
  tableConditions: NonNullable<QuestionConditionGroup['conditions'][number]['tableConditions']>,
  additionalConditions?: QuestionConditionGroup['conditions'][number]['additionalConditions'],
): QuestionConditionGroup => ({
  logicType: 'AND',
  conditions: [
    {
      id: 'c1',
      sourceQuestionId: 'q1',
      conditionType: 'table-cell-check',
      tableConditions,
      ...(additionalConditions !== undefined ? { additionalConditions } : {}),
      logicType: 'AND',
    },
  ],
});

describe('remapConditionGroupValues cellScope', () => {
  const scope = { rowId: 'r1', columnIndex: 0, cellId: 'cell-a' };

  it('다른 행을 겨냥한 tableConditions 는 건드리지 않는다', () => {
    const src = tableCheckGroup({ rowIds: ['r2'], cellColumnIndex: 0, checkType: 'any', expectedValues: ['option-2'] });
    expect(remapConditionGroupValues(src, 'q1', 'option-2', '5', scope)).toBe(src);
  });

  it('다른 열을 겨냥한 tableConditions 는 건드리지 않는다', () => {
    const src = tableCheckGroup({ rowIds: ['r1'], cellColumnIndex: 2, checkType: 'any', expectedValues: ['option-2'] });
    expect(remapConditionGroupValues(src, 'q1', 'option-2', '5', scope)).toBe(src);
  });

  it('행·열이 일치하는 tableConditions 만 리매핑한다', () => {
    const src = tableCheckGroup({ rowIds: ['r1', 'r9'], cellColumnIndex: 0, checkType: 'any', expectedValues: ['option-2'] });
    const out = remapConditionGroupValues(src, 'q1', 'option-2', '5', scope);
    expect(out.conditions[0]!.tableConditions).toMatchObject({ expectedValues: ['5'] });
  });

  it('cellColumnIndex 가 없는 조건(모든 열)은 행만 일치하면 리매핑한다', () => {
    const src = tableCheckGroup({ rowIds: ['r1'], checkType: 'any', expectedValues: ['option-2'] });
    const out = remapConditionGroupValues(src, 'q1', 'option-2', '5', scope);
    expect(out.conditions[0]!.tableConditions).toMatchObject({ expectedValues: ['5'] });
  });

  it('cellScope 가 있으면 requiredValues(질문 레벨 값 공간)는 리매핑하지 않는다', () => {
    const src = conditionGroup();
    const out = remapConditionGroupValues(src, 'q1', 'option-2', '5', { rowId: 'r9', columnIndex: 3, cellId: 'cell-x' });
    expect(out).toBe(src);
  });

  it('additionalConditions 는 열이 일치할 때만 리매핑한다 (행 범위는 메인 조건 폴백)', () => {
    const mismatch = tableCheckGroup(
      { rowIds: ['r1'], cellColumnIndex: 0, checkType: 'any' },
      { cellColumnIndex: 2, checkType: 'checkbox', expectedValues: ['option-2'] },
    );
    expect(remapConditionGroupValues(mismatch, 'q1', 'option-2', '5', scope)).toBe(mismatch);

    const match = tableCheckGroup(
      { rowIds: ['r1'], cellColumnIndex: 2, checkType: 'any' },
      { cellColumnIndex: 0, checkType: 'checkbox', expectedValues: ['option-2'] },
    );
    const out = remapConditionGroupValues(match, 'q1', 'option-2', '5', scope);
    expect(out.conditions[0]!.additionalConditions).toMatchObject({ expectedValues: ['5'] });
    expect(out.conditions[0]!.tableConditions).toMatchObject({ rowIds: ['r1'] });
  });
});

// ── expression 조건 literal 리매핑 — 옵션 value 변경 시 question(q) == "old" 형태의
// 비교 literal 도 함께 바꿔야 조건이 영구 불일치로 남지 않는다 ──

const expressionGroup = (
  comparisons: Array<{
    left: { kind: 'question'; questionId: string } | { kind: 'cell'; questionId: string; cellId: string } | { kind: 'literal'; value: number | string };
    right: { kind: 'question'; questionId: string } | { kind: 'cell'; questionId: string; cellId: string } | { kind: 'literal'; value: number | string };
  }>,
): QuestionConditionGroup => ({
  logicType: 'AND',
  conditions: [
    {
      id: 'c1',
      // expression 은 피연산자가 참조 질문을 지정하므로 sourceQuestionId 와 무관하게 동작해야 한다
      sourceQuestionId: 'primary-question',
      conditionType: 'expression',
      expressionConfig: {
        clauses: comparisons.map((c) => ({ kind: 'comparison' as const, comparison: { ...c, op: '==' as const } })),
        joinOps: comparisons.slice(1).map(() => 'AND' as const),
      },
      logicType: 'AND',
    },
  ],
});

describe('remapConditionGroupValues expression literal', () => {
  it('대상 질문 피연산자와 비교되는 literal 을 리매핑한다 (sourceQuestionId 무관)', () => {
    const src = expressionGroup([
      { left: { kind: 'question', questionId: 'q1' }, right: { kind: 'literal', value: 'option-2' } },
    ]);
    const out = remapConditionGroupValues(src, 'q1', 'option-2', '5');
    const clause = out.conditions[0]!.expressionConfig!.clauses[0]!;
    expect(clause).toMatchObject({ comparison: { right: { kind: 'literal', value: '5' } } });
  });

  it('literal 이 좌변인 방향도 리매핑한다', () => {
    const src = expressionGroup([
      { left: { kind: 'literal', value: 'option-2' }, right: { kind: 'question', questionId: 'q1' } },
    ]);
    const out = remapConditionGroupValues(src, 'q1', 'option-2', '5');
    const clause = out.conditions[0]!.expressionConfig!.clauses[0]!;
    expect(clause).toMatchObject({ comparison: { left: { kind: 'literal', value: '5' } } });
  });

  it('다른 질문 피연산자의 literal 은 건드리지 않는다', () => {
    const src = expressionGroup([
      { left: { kind: 'question', questionId: 'q9' }, right: { kind: 'literal', value: 'option-2' } },
    ]);
    expect(remapConditionGroupValues(src, 'q1', 'option-2', '5')).toBe(src);
  });

  it('cellScope 가 있으면 해당 cellId 피연산자의 비교만 리매핑한다', () => {
    const src = expressionGroup([
      { left: { kind: 'cell', questionId: 'q1', cellId: 'cell-a' }, right: { kind: 'literal', value: 'option-2' } },
      { left: { kind: 'cell', questionId: 'q1', cellId: 'cell-b' }, right: { kind: 'literal', value: 'option-2' } },
    ]);
    const out = remapConditionGroupValues(src, 'q1', 'option-2', '5', { rowId: 'r1', columnIndex: 0, cellId: 'cell-a' });
    const clauses = out.conditions[0]!.expressionConfig!.clauses;
    expect(clauses[0]).toMatchObject({ comparison: { right: { kind: 'literal', value: '5' } } });
    expect(clauses[1]).toMatchObject({ comparison: { right: { kind: 'literal', value: 'option-2' } } });
  });

  it('중첩 그룹 안의 비교도 리매핑한다', () => {
    const inner = expressionGroup([
      { left: { kind: 'question', questionId: 'q1' }, right: { kind: 'literal', value: 'option-2' } },
    ]).conditions[0]!.expressionConfig!;
    const src: QuestionConditionGroup = {
      logicType: 'AND',
      conditions: [
        {
          id: 'c1',
          sourceQuestionId: 'primary-question',
          conditionType: 'expression',
          expressionConfig: { clauses: [{ kind: 'group', group: inner }], joinOps: [] },
          logicType: 'AND',
        },
      ],
    };
    const out = remapConditionGroupValues(src, 'q1', 'option-2', '5');
    const clause = out.conditions[0]!.expressionConfig!.clauses[0]!;
    expect(clause).toMatchObject({
      group: { clauses: [{ comparison: { right: { kind: 'literal', value: '5' } } }] },
    });
  });
});
