import { describe, it, expect } from 'vitest';
import type { Question, QuestionCondition } from '@/types/survey';
import { shouldDisplayQuestion } from '@/utils/branch-logic';

// 숫자 입력 셀이 있는 테이블 소스 질문 생성
function makeSourceQuestion(rowId: string, cellId: string): Question {
  return {
    id: 'q-source',
    surveyId: 's1',
    type: 'table',
    title: '비용 표',
    required: false,
    order: 0,
    tableColumns: [
      { id: 'col-label', label: '항목' },
      { id: 'col-amount', label: '금액' },
    ],
    tableRowsData: [
      {
        id: rowId,
        label: '출장비',
        cells: [
          { id: 'lbl', content: '출장비', type: 'text' as const },
          {
            id: cellId,
            content: '',
            type: 'input' as const,
            inputType: 'number' as const,
          },
        ],
      },
    ],
  } as unknown as Question;
}

// 숫자 비교 조건을 가진 더미 타겟 질문 생성
// shouldDisplayQuestion(targetQ, responses, allQuestions) 호출 시
// targetQ.displayCondition 을 통해 조건을 평가함
function makeTargetQuestion(
  operator: '==' | '!=' | '>' | '<' | '>=' | '<=',
  comparandValue: number,
  rowId: string,
): Question {
  const condition: QuestionCondition = {
    id: 'cond-1',
    sourceQuestionId: 'q-source',
    conditionType: 'table-cell-check',
    logicType: 'AND',
    tableConditions: {
      rowIds: [rowId],
      cellColumnIndex: 1,
      checkType: 'any',
      numericComparison: {
        operator,
        comparand: { kind: 'literal', value: comparandValue },
      },
    },
  };

  return {
    id: 'q-target',
    surveyId: 's1',
    type: 'text',
    title: '대상 질문',
    required: false,
    order: 1,
    displayCondition: {
      conditions: [condition],
      logicType: 'AND',
    },
  } as unknown as Question;
}

describe('branch-logic — numericComparison on input(number) cell', () => {
  const rowId = 'row-1';
  const cellId = 'cell-amount';

  function evalWith(
    cellValue: string,
    operator: '==' | '!=' | '>' | '<' | '>=' | '<=',
    comparandValue: number,
  ): boolean {
    const sourceQuestion = makeSourceQuestion(rowId, cellId);
    const targetQuestion = makeTargetQuestion(operator, comparandValue, rowId);
    const responses: Record<string, unknown> = {
      'q-source': { [cellId]: cellValue },
    };
    const allQuestions = [sourceQuestion, targetQuestion];
    return shouldDisplayQuestion(targetQuestion, responses, allQuestions);
  }

  it('== 0 matches "0"', () => { expect(evalWith('0', '==', 0)).toBe(true); });
  it('== 0 does not match "1"', () => { expect(evalWith('1', '==', 0)).toBe(false); });
  it('!= 0 matches "1"', () => { expect(evalWith('1', '!=', 0)).toBe(true); });
  it('!= 0 does not match "0"', () => { expect(evalWith('0', '!=', 0)).toBe(false); });
  it('>= 1 matches "1"', () => { expect(evalWith('1', '>=', 1)).toBe(true); });
  it('>= 1 matches "10"', () => { expect(evalWith('10', '>=', 1)).toBe(true); });
  it('>= 1 does not match "0"', () => { expect(evalWith('0', '>=', 1)).toBe(false); });
  it('> 0 does not match "0"', () => { expect(evalWith('0', '>', 0)).toBe(false); });
  it('< 1000 matches "999"', () => { expect(evalWith('999', '<', 1000)).toBe(true); });
  it('<= 1000 matches "1000"', () => { expect(evalWith('1000', '<=', 1000)).toBe(true); });
  it('supports negative values (== -5)', () => { expect(evalWith('-5', '==', -5)).toBe(true); });
  it('supports decimals (>= 1.5)', () => {
    expect(evalWith('1.5', '>=', 1.5)).toBe(true);
    expect(evalWith('1.4', '>=', 1.5)).toBe(false);
  });
  it('non-numeric value → fail-safe SHOW (true)', () => {
    // T16 fail-safe 시맨틱: 좌변 셀이 숫자로 파싱되지 않으면 비교 자체가 불가능하므로
    // HIDE 가 아닌 SHOW 로 동작한다. 응답자가 잘못된 값을 적었더라도 후속 질문이 사라지지 않도록.
    expect(evalWith('abc', '==', 0)).toBe(true);
    expect(evalWith('abc', '!=', 0)).toBe(true);
    expect(evalWith('abc', '>=', 0)).toBe(true);
  });
  it('empty cell → false (조건 평가 자체가 일어나지 않음 → HIDE)', () => {
    // checkTableCellCondition 의 input 가드 (`cellValue.trim() !== ''`) 가 빈 셀을 차단해서
    // numeric 비교 자체가 실행되지 않는다. 행이 체크되지 않으므로 SHOW 안 됨.
    expect(evalWith('', '==', 0)).toBe(false);
  });
});
