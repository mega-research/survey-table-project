import { describe, expect, it } from 'vitest';

import {
  collectUnfilledChoiceGroupCellIds,
  isQuestionAnswered,
} from '@/features/survey-response/lib/answer-validation';
import {
  type NumericValidationCtx,
  collectNumericIssues,
  resolveChoiceTableVisibleCellIds,
} from '@/features/survey-response/lib/numeric-validation';
import { collectRequiredOptionTextIssues } from '@/features/survey-response/lib/required-option-text-validation';
import { CHOICE_GROUPS_KEY } from '@/lib/survey/choice-selection';
import type { Question, QuestionConditionGroup, TableRow } from '@/types/survey';
import { DYNAMIC_ROW_SELECTIONS_KEY } from '@/utils/dynamic-row-selection-sidecar';

// 보기를 표로 그리는 문항 — 숨은 칸(행·열 조건, 고르지 않은 동적 행)을 가리키는 선택은 답이 아니다.
// 숨은 행에 남은 선택이 필수를 채워 빈 화면에서 「다음」이 통과하던 사고(Q18)의 검증 쪽 짝이다.

const showWhen = (values: string[]): QuestionConditionGroup => ({
  logicType: 'AND',
  conditions: [
    {
      id: `c-${values.join('-')}`,
      enabled: true,
      logicType: 'AND',
      conditionType: 'value-match',
      sourceQuestionId: 'q17',
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

function row(rowId: string, extra: Partial<TableRow> = {}, groupId?: string): TableRow {
  const group = groupId ? { choiceGroupId: groupId } : {};
  return {
    id: rowId,
    label: rowId,
    ...extra,
    cells: [
      { id: `${rowId}-label`, type: 'text', content: rowId },
      { id: `${rowId}-a`, type: 'choice_opt', content: '①', allowTextInput: true, ...group },
      { id: `${rowId}-b`, type: 'choice_opt', content: '없음', exclusiveChoice: true, ...group },
      { id: `${rowId}-memo`, type: 'input', content: '', required: true },
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

function ctxFor(questions: Question[], responses: Record<string, unknown>): NumericValidationCtx {
  return { allResponses: responses, allQuestions: questions };
}

function answered(question: Question, responses: Record<string, unknown>) {
  const response = responses[question.id];
  const visibleCellIds = resolveChoiceTableVisibleCellIds(
    question,
    response,
    ctxFor([source, question], responses),
  );
  return isQuestionAnswered(question, response, { visibleCellIds });
}

describe('보기 소스 표 — 숨은 행의 선택은 응답이 아니다', () => {
  const radio = choiceTable('radio', [
    row('r18-1', { displayCondition: showWhen(['1']) }),
    row('r18-2'),
  ]);

  it('비그룹 radio — 숨은 행 보기만 골라져 있으면 미응답이다', () => {
    expect(answered(radio, { q17: '2', q18: 'r18-1-a' })).toBe(false);
    expect(answered(radio, { q17: '1', q18: 'r18-1-a' })).toBe(true);
    expect(answered(radio, { q17: '2', q18: 'r18-2-a' })).toBe(true);
  });

  it('비그룹 checkbox — 최소 선택 수에 숨은 선택을 세지 않는다', () => {
    const checkbox = { ...radio, type: 'checkbox', minSelections: 2 } as Question;
    expect(answered(checkbox, { q17: '2', q18: ['r18-1-a', 'r18-2-a'] })).toBe(false);
    expect(answered(checkbox, { q17: '1', q18: ['r18-1-a', 'r18-2-a'] })).toBe(true);
  });

  it('비그룹 checkbox — 숨은 행의 단독 선택 보기는 최소 선택을 면제하지 않는다', () => {
    const checkbox = { ...radio, type: 'checkbox', minSelections: 2 } as Question;
    expect(answered(checkbox, { q17: '2', q18: ['r18-1-b'] })).toBe(false);
    expect(answered(checkbox, { q17: '2', q18: ['r18-2-b'] })).toBe(true);
  });

  it('보기 칸이 전부 숨으면 채울 것이 없어 막지 않는다', () => {
    const allHidden = choiceTable('radio', [row('r1', { displayCondition: showWhen(['1']) })]);
    expect(answered(allHidden, { q17: '2' })).toBe(true);
  });

  it('숨김이 없는 표는 보이는 칸 집합을 만들지 않는다(종전 판정)', () => {
    const plain = choiceTable('radio', [row('r1')]);
    expect(
      resolveChoiceTableVisibleCellIds(plain, 'r1-a', ctxFor([source, plain], {})),
    ).toBeUndefined();
  });
});

describe('보기 소스 표 — 보기 그룹', () => {
  const grouped = choiceTable(
    'checkbox',
    [row('r1', { displayCondition: showWhen(['1']) }, 'g1'), row('r2', {}, 'g2')],
    {
      choiceGroups: [
        { id: 'g1', type: 'radio', label: '1행', groupKey: 'rad1' },
        { id: 'g2', type: 'checkbox', label: '2행', groupKey: 'chk1' },
      ],
    },
  );

  it('보이는 그룹이 숨은 칸 선택만 갖고 있으면 미충족이다', () => {
    // 열 조건으로 2행의 ① 칸이 숨은 경우 — 그룹은 보이지만 고른 칸이 숨었다
    const byColumn: Question = {
      ...grouped,
      tableColumns: columns.map((c) =>
        c.id === 'col-a' ? { ...c, displayCondition: showWhen(['1']) } : c,
      ),
    };
    const responses = { q17: '2', q18: { chk1: ['r2-a'] } };
    expect(answered(byColumn, responses)).toBe(false);
    const visibleCellIds = resolveChoiceTableVisibleCellIds(
      byColumn,
      responses.q18,
      ctxFor([source, byColumn], responses),
    );
    expect([
      ...collectUnfilledChoiceGroupCellIds(byColumn, responses.q18, { visibleCellIds }),
    ]).toEqual(['r2-a', 'r2-b']);
  });

  it('숨은 행의 그룹은 필수 대상에서 빠지고 그 선택도 세지 않는다', () => {
    expect(answered(grouped, { q17: '2', q18: { rad1: 'r1-a', chk1: ['r2-b'] } })).toBe(true);
    expect(answered(grouped, { q17: '2', q18: { rad1: 'r1-a' } })).toBe(false);
  });

  it('보기 그룹이 전부 숨으면 응답 전이라도 막지 않는다', () => {
    const allHidden: Question = {
      ...grouped,
      tableRowsData: grouped.tableRowsData!.map((r) => ({
        ...r,
        displayCondition: showWhen(['1']),
      })),
    };
    expect(answered(allHidden, { q17: '2' })).toBe(true);
  });
});

describe('보기 소스 표 — 고르지 않은 동적 행', () => {
  const dynamic = choiceTable(
    'radio',
    [row('d1', { dynamicGroupId: 'dg' }), row('d2', { dynamicGroupId: 'dg' })],
    { dynamicRowConfigs: [{ groupId: 'dg', enabled: true, label: '항목 선택' }] },
  );

  it('고른 동적 행의 보기만 응답이다', () => {
    expect(answered(dynamic, { q18: 'd2-a', [DYNAMIC_ROW_SELECTIONS_KEY]: { q18: ['d1'] } })).toBe(
      false,
    );
    expect(answered(dynamic, { q18: 'd1-a', [DYNAMIC_ROW_SELECTIONS_KEY]: { q18: ['d1'] } })).toBe(
      true,
    );
  });

  it('고르지 않은 동적 행의 필수 입력칸은 막지 않는다', () => {
    const responses = { q18: 'd1-a', [DYNAMIC_ROW_SELECTIONS_KEY]: { q18: ['d1'] } };
    const issues = collectNumericIssues(dynamic, responses.q18, {
      ...ctxFor([source, dynamic], responses),
      optionTexts: { 'd1-a': '상세', 'd1-memo': '메모' },
    });
    expect(issues).toEqual([]);
  });
});

describe('보기 소스 표 — 차단 검증의 숨은 선택', () => {
  const checkbox = choiceTable(
    'checkbox',
    [row('r1', { displayCondition: showWhen(['1']) }), row('r2')],
    { maxSelectionsSource: { questionId: 'cnt' } },
  );
  const count: Question = { id: 'cnt', type: 'text', title: '수', required: false, order: 2 };

  it('최대 선택 수에 숨은 선택을 세지 않는다', () => {
    const responses = { q17: '2', cnt: '1', q18: ['r1-a', 'r2-a'] };
    const issues = collectNumericIssues(checkbox, responses.q18, {
      ...ctxFor([source, checkbox, count], responses),
      optionTexts: { 'r2-a': '상세', 'r2-memo': '메모' },
    });
    expect(issues.filter((i) => i.kind === 'selection-max')).toEqual([]);
  });

  it('숨은 선택의 상세기재는 필수가 아니다', () => {
    const responses = { q17: '2', q18: ['r1-a'] };
    const visibleCellIds = resolveChoiceTableVisibleCellIds(
      checkbox,
      responses.q18,
      ctxFor([source, checkbox], responses),
    );
    expect(
      collectRequiredOptionTextIssues(
        checkbox,
        responses.q18,
        {},
        visibleCellIds ? { visibleCellIds } : undefined,
      ).questionMissing,
    ).toBe(false);
    expect(collectRequiredOptionTextIssues(checkbox, responses.q18, {}).questionMissing).toBe(true);
  });
});

describe('표 문항 — 숨은 열 칸의 그룹 선택', () => {
  const table: Question = {
    id: 't',
    type: 'table',
    title: '표',
    required: true,
    order: 1,
    tableColumns: columns.map((c) =>
      c.id === 'col-a' ? { ...c, displayCondition: showWhen(['1']) } : c,
    ),
    tableRowsData: [row('r1', {}, 'g1')],
    choiceGroups: [{ id: 'g1', type: 'radio', label: '1행', groupKey: 'rad1' }],
  };

  it('숨은 열 칸의 선택은 그룹을 채우지 않는다', () => {
    const response = { [CHOICE_GROUPS_KEY]: { rad1: 'r1-a' } };
    const responses = { q17: '2', t: response };
    const visibleCellIds = resolveChoiceTableVisibleCellIds(
      table,
      response,
      ctxFor([source, table], responses),
    );
    expect(isQuestionAnswered(table, response, { visibleCellIds })).toBe(false);
    const shown = { q17: '1', t: response };
    const shownIds = resolveChoiceTableVisibleCellIds(
      table,
      response,
      ctxFor([source, table], shown),
    );
    expect(isQuestionAnswered(table, response, { visibleCellIds: shownIds })).toBe(true);
  });
});
