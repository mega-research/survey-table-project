import { describe, expect, it } from 'vitest';

import { OPT_TEXTS_KEY } from '@/lib/option-text-read';
import { CHOICE_GROUPS_KEY } from '@/lib/survey/choice-selection';
import { stripHiddenQuestionValues } from '@/lib/survey/question-visibility';
import type { Question, QuestionConditionGroup, TableRow } from '@/types/survey';
import { DYNAMIC_ROW_SELECTIONS_KEY } from '@/utils/dynamic-row-selection-sidecar';

// 보기를 표로 그리는 문항 — 행·열 표시조건이나 고르지 않은 동적 행으로 숨은 칸의 선택은 답이 아니다.
// 표 문항의 행 조건만 지우던 것을 보기 소스 표(radio·checkbox)와 열 조건·동적 행까지 넓혔다.
// (실응답 사고: Q18 에서 18-1 행 보기를 고른 뒤 앞 답을 바꿔 행이 사라졌는데 선택이 남아 「다음」이
//  통과했고 제출에서도 지워지지 않았다.)

const showWhen = (source: string, values: string[]): QuestionConditionGroup => ({
  logicType: 'AND',
  conditions: [
    {
      id: `c-${source}-${values.join('-')}`,
      enabled: true,
      logicType: 'AND',
      conditionType: 'value-match',
      sourceQuestionId: source,
      requiredValues: values,
    },
  ],
});

const source: Question = {
  id: 'q17',
  type: 'radio',
  title: '앞 문항',
  required: true,
  order: 0,
  options: [
    { id: 'o1', label: '예', value: '1' },
    { id: 'o2', label: '아니오', value: '2' },
  ],
};

function choiceRow(rowId: string, extra: Partial<TableRow> = {}, groupId?: string): TableRow {
  return {
    id: rowId,
    label: rowId,
    ...extra,
    cells: [
      { id: `${rowId}-label`, type: 'text', content: rowId },
      {
        id: `${rowId}-a`,
        type: 'choice_opt',
        content: '①',
        allowTextInput: true,
        ...(groupId ? { choiceGroupId: groupId } : {}),
      },
      {
        id: `${rowId}-b`,
        type: 'choice_opt',
        content: '②',
        ...(groupId ? { choiceGroupId: groupId } : {}),
      },
      { id: `${rowId}-memo`, type: 'input', content: '' },
    ],
  };
}

const columns = [
  { id: 'col-label', label: '항목' },
  { id: 'col-a', label: '①' },
  { id: 'col-b', label: '②' },
  { id: 'col-memo', label: '메모' },
];

function choiceTable(
  type: 'radio' | 'checkbox',
  rows: TableRow[],
  extra: Partial<Question> = {},
): Question {
  return {
    id: 'q18',
    type,
    title: '보기 소스 표',
    required: true,
    order: 1,
    optionsSource: 'table',
    tableColumns: columns,
    tableRowsData: rows,
    ...extra,
  } as Question;
}

describe('stripHiddenQuestionValues — 보기 소스 표의 숨은 행', () => {
  const radio = choiceTable('radio', [
    choiceRow('r18-1', { displayCondition: showWhen('q17', ['1']) }),
    choiceRow('r18-2'),
  ]);

  it('비그룹 radio — 숨은 행의 보기를 골랐으면 문항 값을 지운다', () => {
    const out = stripHiddenQuestionValues([source, radio], { q17: '2', q18: 'r18-1-a' });
    expect(out).not.toHaveProperty('q18');
  });

  it('보이는 행의 선택은 남긴다', () => {
    const responses = { q17: '2', q18: 'r18-2-b' };
    expect(stripHiddenQuestionValues([source, radio], responses)).toBe(responses);
  });

  it('숨은 행의 상세기재·입력칸 사이드카를 지우고 보이는 행 것은 남긴다', () => {
    const out = stripHiddenQuestionValues([source, radio], {
      q17: '2',
      q18: 'r18-1-a',
      [OPT_TEXTS_KEY]: { q18: { 'r18-1-a': '상세', 'r18-1-memo': '메모', 'r18-2-memo': '남김' } },
    });
    expect(out[OPT_TEXTS_KEY]).toEqual({ q18: { 'r18-2-memo': '남김' } });
  });

  it('비그룹 checkbox — 숨은 행의 선택만 빼고, 다 빠지면 문항 값을 지운다', () => {
    const checkbox = { ...radio, type: 'checkbox' } as Question;
    const partial = stripHiddenQuestionValues([source, checkbox], {
      q17: '2',
      q18: ['r18-1-a', 'r18-2-b'],
    });
    expect(partial['q18']).toEqual(['r18-2-b']);
    const all = stripHiddenQuestionValues([source, checkbox], { q17: '2', q18: ['r18-1-a'] });
    expect(all).not.toHaveProperty('q18');
  });

  it('지운 뒤 앞 답을 되돌려도 살아나지 않는다', () => {
    const hidden = stripHiddenQuestionValues([source, radio], { q17: '2', q18: 'r18-1-a' });
    const back = stripHiddenQuestionValues([source, radio], { ...hidden, q17: '1' });
    expect(back).not.toHaveProperty('q18');
  });
});

describe('stripHiddenQuestionValues — 보기 그룹 radio/checkbox', () => {
  const grouped = choiceTable(
    'radio',
    [
      choiceRow('r1', { displayCondition: showWhen('q17', ['1']) }, 'g1'),
      choiceRow('r2', {}, 'g2'),
    ],
    {
      choiceGroups: [
        { id: 'g1', type: 'radio', label: '1행', groupKey: 'rad1' },
        { id: 'g2', type: 'checkbox', label: '2행', groupKey: 'chk1' },
      ],
    },
  );

  it('숨은 행 그룹의 선택을 빼고 보이는 그룹은 남긴다', () => {
    const out = stripHiddenQuestionValues([source, grouped], {
      q17: '2',
      q18: { rad1: 'r1-a', chk1: ['r2-a'] },
    });
    expect(out['q18']).toEqual({ chk1: ['r2-a'] });
  });

  it('모든 선택이 빠지면 문항 값을 지운다', () => {
    const out = stripHiddenQuestionValues([source, grouped], { q17: '2', q18: { rad1: 'r1-b' } });
    expect(out).not.toHaveProperty('q18');
  });
});

describe('stripHiddenQuestionValues — 열 표시조건', () => {
  const byColumn = choiceTable('checkbox', [choiceRow('r1'), choiceRow('r2')], {
    tableColumns: columns.map((c) =>
      c.id === 'col-b' ? { ...c, displayCondition: showWhen('q17', ['1']) } : c,
    ),
  });

  it('보기 소스 표 — 숨은 열의 선택을 뺀다', () => {
    const out = stripHiddenQuestionValues([source, byColumn], {
      q17: '2',
      q18: ['r1-a', 'r1-b', 'r2-b'],
    });
    expect(out['q18']).toEqual(['r1-a']);
  });

  it('표 문항 — 숨은 열의 셀 값과 보기 그룹 선택을 뺀다', () => {
    const table: Question = {
      id: 't',
      type: 'table',
      title: '표',
      required: false,
      order: 1,
      tableColumns: byColumn.tableColumns!,
      tableRowsData: [choiceRow('r1', {}, 'g1')],
      choiceGroups: [{ id: 'g1', type: 'radio', label: '1행', groupKey: 'rad1' }],
    };
    const out = stripHiddenQuestionValues([source, table], {
      q17: '2',
      t: { 'r1-memo': '메모', [CHOICE_GROUPS_KEY]: { rad1: 'r1-b' } },
    });
    expect(out['t']).toEqual({ 'r1-memo': '메모', [CHOICE_GROUPS_KEY]: {} });
  });
});

describe('stripHiddenQuestionValues — 고르지 않은 동적 행', () => {
  const dynamicConfigs = [{ groupId: 'dg', enabled: true, label: '항목 선택' }];

  it('보기 소스 표 — 루트 사이드카에서 고르지 않은 동적 행의 선택을 뺀다', () => {
    const table = choiceTable(
      'checkbox',
      [
        choiceRow('d1', { dynamicGroupId: 'dg' }),
        choiceRow('d2', { dynamicGroupId: 'dg' }),
        choiceRow('r3'),
      ],
      { dynamicRowConfigs: dynamicConfigs },
    );
    const out = stripHiddenQuestionValues([source, table], {
      q17: '1',
      q18: ['d1-a', 'd2-a', 'r3-b'],
      [DYNAMIC_ROW_SELECTIONS_KEY]: { q18: ['d1'] },
      [OPT_TEXTS_KEY]: { q18: { 'd2-a': '상세', 'd1-a': '남김' } },
    });
    expect(out['q18']).toEqual(['d1-a', 'r3-b']);
    expect(out[OPT_TEXTS_KEY]).toEqual({ q18: { 'd1-a': '남김' } });
    expect(out[DYNAMIC_ROW_SELECTIONS_KEY]).toEqual({ q18: ['d1'] });
  });

  it('표 문항 — 고르지 않은 동적 행의 셀 값을 빼고 __selectedRowIds 는 둔다', () => {
    const table: Question = {
      id: 't',
      type: 'table',
      title: '표',
      required: false,
      order: 1,
      tableColumns: columns,
      tableRowsData: [
        choiceRow('d1', { dynamicGroupId: 'dg' }),
        choiceRow('d2', { dynamicGroupId: 'dg' }),
      ],
      dynamicRowConfigs: dynamicConfigs,
    };
    const out = stripHiddenQuestionValues([source, table], {
      q17: '1',
      t: { 'd1-memo': '고른 행', 'd2-memo': '풀린 행', __selectedRowIds: ['d1'] },
    });
    expect(out['t']).toEqual({ 'd1-memo': '고른 행', __selectedRowIds: ['d1'] });
  });

  it('꺼진 동적 그룹의 행은 평범한 행이다', () => {
    const table = choiceTable('checkbox', [choiceRow('d1', { dynamicGroupId: 'dg' })], {
      dynamicRowConfigs: [{ ...dynamicConfigs[0]!, enabled: false }],
    });
    const responses = { q17: '1', q18: ['d1-a'] };
    expect(stripHiddenQuestionValues([source, table], responses)).toBe(responses);
  });
});

describe('stripHiddenQuestionValues — 숨김이 없는 표', () => {
  it('조건도 동적 행도 없으면 입력 참조를 그대로 돌려준다', () => {
    const plain = choiceTable('radio', [choiceRow('r1'), choiceRow('r2')]);
    const responses = { q17: '2', q18: 'r1-a', [OPT_TEXTS_KEY]: { q18: { 'r1-a': 'x' } } };
    expect(stripHiddenQuestionValues([source, plain], responses)).toBe(responses);
  });
});
