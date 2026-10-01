import { describe, expect, it } from 'vitest';

import {
  collectNumericIssues,
  collectVisibleTableCells,
} from '@/features/survey-response/lib/numeric-validation';
import type { Question, QuestionConditionGroup, TableRow } from '@/types/survey';

/**
 * 숨은 행에서 시작한 세로 병합 셀 — 렌더러는 같은 id 로 첫 가시 행에 올려 그린다
 * (recalculateRowspansForVisibleRows). 검증의 "보이는 셀" 도 같은 투영을 써야 한다:
 * 화면에 있는 입력칸이 검증 대상에서 빠지면 필수가 조용히 꺼지고, 합계·입력된 칸 수는
 * 응답자가 채운 값을 세지 않아 「다음」을 막는다.
 */
const showWhen = (questionId: string, values: string[]): QuestionConditionGroup => ({
  logicType: 'AND',
  conditions: [
    {
      id: 'c',
      sourceQuestionId: questionId,
      conditionType: 'value-match',
      requiredValues: values,
      logicType: 'AND',
    },
  ],
});

const source = {
  id: 'src',
  type: 'radio',
  title: '원천',
  required: false,
  order: 0,
  options: [
    { id: 'o1', label: '예', value: 'y' },
    { id: 'o2', label: '아니오', value: 'n' },
  ],
} as Question;

/** r0(조건부) 에서 시작해 r1 까지 덮는 병합 입력칸 m + 행마다 일반 입력칸 */
function table(over: Partial<Question> = {}): Question {
  const rows = [
    {
      id: 'r0',
      label: '',
      displayCondition: showWhen('src', ['y']),
      cells: [
        { id: 'm', type: 'input', content: '', inputType: 'number', rowspan: 2 },
        { id: 'a', type: 'input', content: '', inputType: 'number' },
      ],
    },
    {
      id: 'r1',
      label: '',
      cells: [
        { id: 'm-covered', type: 'input', content: '', isHidden: true },
        { id: 'c', type: 'input', content: '', inputType: 'number' },
      ],
    },
  ] as TableRow[];
  return {
    id: 'q',
    type: 'table',
    title: '표',
    required: false,
    order: 1,
    tableColumns: [
      { id: 'c1', label: '1' },
      { id: 'c2', label: '2' },
    ],
    tableRowsData: rows,
    ...over,
  } as Question;
}

const ctxFor = (q: Question, tableValue: Record<string, unknown>, srcValue: string) => ({
  allResponses: { src: srcValue, [q.id]: tableValue },
  allQuestions: [source, q],
});

describe('숨은 행에서 시작한 병합 셀은 보이는 셀이다', () => {
  it('시작 행이 숨어도 병합 셀은 보이는 셀 목록에 남고, 그 행의 다른 칸은 빠진다', () => {
    const q = table();
    const ids = collectVisibleTableCells(q, {}, ctxFor(q, {}, 'n')).map((c) => c.id);
    expect(ids).toEqual(['m', 'c']);
  });

  it('시작 행이 보이면 종전과 같다', () => {
    const q = table();
    const ids = collectVisibleTableCells(q, {}, ctxFor(q, {}, 'y')).map((c) => c.id);
    expect(ids).toEqual(['m', 'a', 'c']);
  });

  it('입력된 칸 수 — 병합칸과 일반칸을 둘 다 채우면 "2칸 이상" 을 통과한다', () => {
    const q = table({
      sumConstraints: [{ id: 'k', aggregate: 'count', cellIds: ['m', 'c'], operator: 'gte', target: 2 }],
    });
    const value = { m: '1', c: '2' };
    expect(collectNumericIssues(q, value, ctxFor(q, value, 'n'))).toHaveLength(0);
  });

  it('입력된 칸 수 — 대상이 병합칸 하나뿐이어도 건너뛰지 않고 미입력을 막는다', () => {
    const q = table({
      sumConstraints: [{ id: 'k', aggregate: 'count', cellIds: ['m'], operator: 'gte', target: 1 }],
    });
    expect(collectNumericIssues(q, {}, ctxFor(q, {}, 'n'))).toHaveLength(1);
    expect(collectNumericIssues(q, { m: '3' }, ctxFor(q, { m: '3' }, 'n'))).toHaveLength(0);
  });

  it('합계 — 병합칸 값도 합에 들어간다', () => {
    const q = table({
      sumConstraints: [{ id: 's', cellIds: ['m', 'c'], operator: 'eq', target: 100 }],
    });
    const value = { m: '60', c: '40' };
    expect(collectNumericIssues(q, value, ctxFor(q, value, 'n'))).toHaveLength(0);
  });
});
