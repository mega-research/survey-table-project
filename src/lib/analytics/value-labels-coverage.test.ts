import { describe, expect, it } from 'vitest';
import { VariableMeasure } from 'sav-writer';

import { generateSPSSColumns } from '@/lib/analytics/spss-excel-export';
import { buildValueLabels } from '@/lib/spss/sav-builder';
import { resolveMeasure } from '@/lib/spss/variable-meta';
import type { Question } from '@/types/survey';

// 빈 카테고리(0빈도 보기) 문제의 데이터 측 전제:
// categorical 변수는 응답 여부와 무관하게 모든 보기가 VALUE LABELS에 등록되어야
// SPSS CTABLES EMPTY=INCLUDE 가 0빈도 보기를 표에 살릴 수 있다.

function q(overrides: Record<string, unknown>): Question {
  return {
    id: 'q1',
    title: '질문',
    required: false,
    order: 1,
    questionCode: 'Q1',
    ...overrides,
  } as unknown as Question;
}

const radioManual = q({
  type: 'radio',
  options: [
    { id: 'o1', label: '보기1', value: 'o1', spssNumericCode: 1 },
    { id: 'o2', label: '보기2', value: 'o2', spssNumericCode: 2 },
  ],
});

const checkboxManual = q({
  id: 'q2',
  questionCode: 'Q2',
  type: 'checkbox',
  options: [
    { id: 'o1', label: '보기1', value: 'o1', spssNumericCode: 1 },
    { id: 'o2', label: '보기2', value: 'o2', spssNumericCode: 2 },
  ],
});

const radioGrouped = q({
  id: 'q4',
  questionCode: 'Q4',
  type: 'radio',
  choiceGroups: [
    { id: 'gg1', groupKey: 'rad1', type: 'radio', label: '그룹1' },
  ],
  tableRowsData: [
    {
      id: 'r1',
      label: '행1',
      cells: [
        { id: 'cg1', content: '보기A', type: 'choice_opt', choiceGroupId: 'gg1', spssNumericCode: 1 },
        { id: 'cg2', content: '보기B', type: 'choice_opt', choiceGroupId: 'gg1', spssNumericCode: 2 },
      ],
    },
  ],
});

// checkbox 그룹 픽스처
const checkboxGrouped = q({
  id: 'q5',
  questionCode: 'Q5',
  type: 'checkbox',
  choiceGroups: [
    { id: 'gc1', groupKey: 'cb1', type: 'checkbox', label: '구매처' },
  ],
  tableRowsData: [
    {
      id: 'r1',
      label: '행1',
      cells: [
        { id: 'cgc1', content: '온라인', type: 'choice_opt', choiceGroupId: 'gc1', spssNumericCode: 3 },
        { id: 'cgc2', content: '오프라인', type: 'choice_opt', choiceGroupId: 'gc1', spssNumericCode: 5 },
      ],
    },
  ],
});

const tableWithCells = q({
  id: 'q3',
  questionCode: 'Q3',
  type: 'table',
  tableColumns: [{ id: 'c1', label: '열1' }],
  tableRowsData: [
    {
      id: 'r1',
      label: '행1',
      cells: [
        {
          id: 'cellR',
          content: '',
          type: 'radio',
          cellCode: 'Q3_r1_c1',
          radioOptions: [
            { id: 'ro1', label: 'R보기1', value: 'ro1', spssNumericCode: 1 },
            { id: 'ro2', label: 'R보기2', value: 'ro2', spssNumericCode: 2 },
          ],
        },
      ],
    },
    {
      id: 'r2',
      label: '행2',
      cells: [
        {
          id: 'cellC',
          content: '',
          type: 'checkbox',
          cellCode: 'Q3_r2_c1',
          checkboxOptions: [
            { id: 'co1', label: 'C보기1', value: 'co1', spssNumericCode: 5 },
          ],
        },
      ],
    },
  ],
});

describe('categorical 변수 VALUE LABELS 전수 보장', () => {
  const questions = [radioManual, checkboxManual, tableWithCells, radioGrouped, checkboxGrouped];
  const questionMap = new Map(questions.map((question) => [question.id, question]));
  const columns = generateSPSSColumns(questions);

  const CATEGORICAL_TYPES = new Set(['single', 'checkbox-item', 'table-cell', 'choice-group', 'choice-group-item']);

  it('categorical 컬럼은 전부 value labels를 가진다 — 0빈도 보기 포함', () => {
    const categorical = columns.filter(
      (c) => CATEGORICAL_TYPES.has(c.type) && c.tableCellType !== 'input',
    );
    expect(categorical.length).toBeGreaterThanOrEqual(5);
    for (const col of categorical) {
      const labels = buildValueLabels(col, questionMap.get(col.questionId));
      expect(labels, `${col.spssVarName} value labels 누락`).toBeDefined();
      expect(labels!.length).toBeGreaterThan(0);
    }
  });

  it('radio 질문 value labels는 응답과 무관하게 전 보기를 담는다', () => {
    const single = columns.find((c) => c.type === 'single' && c.questionId === 'q1');
    const labels = buildValueLabels(single!, radioManual);
    expect(labels).toEqual([
      { value: 1, label: '보기1' },
      { value: 2, label: '보기2' },
    ]);
  });

  it('categorical 컬럼의 측정수준은 Nominal 또는 Ordinal이다', () => {
    for (const col of columns.filter((c) => CATEGORICAL_TYPES.has(c.type) && c.tableCellType !== 'input')) {
      const measure = resolveMeasure(col, questionMap.get(col.questionId));
      expect([VariableMeasure.Nominal, VariableMeasure.Ordinal]).toContain(measure);
    }
  });

  it('choice-group 변수는 buildValueLabels가 전 보기를 반환한다', () => {
    const groupCol = columns.find((c) => c.type === 'choice-group' && c.questionId === 'q4');
    expect(groupCol).toBeDefined();
    const labels = buildValueLabels(groupCol!, radioGrouped);
    expect(labels).toEqual([
      { value: 1, label: '보기A' },
      { value: 2, label: '보기B' },
    ]);
  });

  it('choice-group-item 변수는 buildValueLabels가 자체 counted 코드와 "선택" 라벨을 반환한다', () => {
    const cgiCols = columns.filter((c) => c.type === 'choice-group-item' && c.questionId === 'q5');
    expect(cgiCols.length).toBe(2);
    const labels0 = buildValueLabels(cgiCols[0]!, checkboxGrouped);
    const labels1 = buildValueLabels(cgiCols[1]!, checkboxGrouped);
    expect(labels0).toEqual([{ value: 3, label: '선택' }]);
    expect(labels1).toEqual([{ value: 5, label: '선택' }]);
  });
});
