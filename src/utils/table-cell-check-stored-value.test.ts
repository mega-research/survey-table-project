import { describe, expect, it } from 'vitest';

import type { Question, QuestionCondition, TableCell } from '@/types/survey';
import { shouldDisplayQuestion } from '@/utils/branch-logic';
import { resolveSelectedValue, resolveSelectedValues } from '@/utils/table-cell-semantics';

/**
 * 회귀 테스트: 표시조건 table-cell-check 의 "현재 저장 형태" 응답값 매칭.
 *
 * 인터랙티브 셀(radio/select/checkbox-cell.tsx)은 응답값으로 flat string
 * `option.value ?? option.id` 를 저장한다. table-cell-semantics 의 옵션 역참조가
 * `opt.id` 로만 찾으면, 옵션에 발번 value 가 있는 셀(응답값 코드 지정)은
 * 선택해도 selectedValues 가 [] 가 되어 expectedValues 조건이 영원히 미충족
 * → 조건부 질문이 응답 후에도 표시되지 않는다.
 * (characterization 스위트는 legacy { optionId } 저장 형태만 핀 고정하고 있어
 * 이 파일이 flat value 저장 형태를 커버한다.)
 */

function makeSourceQuestion(): Question {
  return {
    id: 'q-table',
    surveyId: 's1',
    type: 'table',
    title: 'B1',
    required: false,
    order: 0,
    tableColumns: [
      { id: 'col-0', label: '' },
      { id: 'col-1', label: '보기' },
      { id: 'col-2', label: '복수' },
    ],
    tableRowsData: [
      {
        id: 'row-1',
        label: '현재 학년',
        cells: [
          { id: 'r1-label', content: '현재 학년', type: 'text' as const },
          {
            id: 'r1-radio',
            content: '',
            type: 'radio' as const,
            radioOptions: [
              { id: 'uuid-3', label: '3학년', value: '3' },
              { id: 'uuid-4', label: '졸업예정자', value: '4' },
              { id: 'uuid-5', label: '졸업자', value: '5' },
            ],
          },
          {
            id: 'r1-check',
            content: '',
            type: 'checkbox' as const,
            checkboxOptions: [
              { id: 'uuid-a', label: 'A', value: 'A' },
              { id: 'uuid-b', label: 'B', value: 'B' },
            ],
          },
        ],
      },
    ],
  } as unknown as Question;
}

function makeTargetQuestion(
  tableConditions: NonNullable<QuestionCondition['tableConditions']>,
): Question {
  const condition = {
    id: 'cond-1',
    sourceQuestionId: 'q-table',
    conditionType: 'table-cell-check',
    logicType: 'AND',
    tableConditions,
  } as QuestionCondition;
  return {
    id: 'q-target',
    surveyId: 's1',
    type: 'text',
    title: 'B2',
    required: false,
    order: 1,
    displayCondition: { conditions: [condition], logicType: 'AND' },
  } as unknown as Question;
}

function evalDisplay(
  responses: Record<string, unknown>,
  tableConditions: NonNullable<QuestionCondition['tableConditions']>,
): boolean {
  const source = makeSourceQuestion();
  const target = makeTargetQuestion(tableConditions);
  return shouldDisplayQuestion(target, { 'q-table': responses }, [source, target]);
}

const radioCondition = {
  rowIds: ['row-1'],
  cellColumnIndex: 1,
  checkType: 'any' as const,
  expectedValues: ['4', '5'],
};

describe('표시조건 table-cell-check — flat value 저장 형태 매칭', () => {
  it('radio: 발번 value("5" = 졸업자) 저장 응답이 expectedValues 와 매칭돼 표시된다', () => {
    expect(evalDisplay({ 'r1-radio': '5' }, radioCondition)).toBe(true);
  });

  it('radio: expectedValues 밖의 value("3") 는 미표시', () => {
    expect(evalDisplay({ 'r1-radio': '3' }, radioCondition)).toBe(false);
  });

  it('checkbox: flat value 배열 저장 응답도 매칭된다', () => {
    const tc = {
      rowIds: ['row-1'],
      cellColumnIndex: 2,
      checkType: 'any' as const,
      expectedValues: ['B'],
    };
    expect(evalDisplay({ 'r1-check': ['B'] }, tc)).toBe(true);
    expect(evalDisplay({ 'r1-check': ['A'] }, tc)).toBe(false);
  });

  it('legacy: { optionId } 객체·flat optionId 저장도 계속 매칭된다', () => {
    expect(evalDisplay({ 'r1-radio': { optionId: 'uuid-5' } }, radioCondition)).toBe(true);
    expect(evalDisplay({ 'r1-radio': 'uuid-5' }, radioCondition)).toBe(true);
  });

  it('stale: 옵션 목록에 없는 저장값은 매칭되지 않는다', () => {
    expect(evalDisplay({ 'r1-radio': 'ghost' }, radioCondition)).toBe(false);
  });
});

describe('resolveSelectedValue(s) — flat value 저장 형태 해석', () => {
  const question = makeSourceQuestion();
  const radioCell = question.tableRowsData![0]!.cells[1] as TableCell;
  const checkCell = question.tableRowsData![0]!.cells[2] as TableCell;

  it('radio: flat value 저장을 대표 선택값으로 해석한다 (분기값 추출 경로)', () => {
    expect(resolveSelectedValue(radioCell, '5')).toBe('5');
    expect(resolveSelectedValues(radioCell, '5')).toEqual(['5']);
  });

  it('checkbox: flat value 배열 저장을 선택값 목록으로 해석한다', () => {
    expect(resolveSelectedValues(checkCell, ['A', 'B'])).toEqual(['A', 'B']);
    expect(resolveSelectedValue(checkCell, ['B'])).toBe('B');
  });
});
