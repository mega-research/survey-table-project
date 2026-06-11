import { describe, it, expect } from 'vitest';
import type { Question, QuestionCondition } from '@/types/survey';
import { shouldDisplayQuestion } from '@/utils/branch-logic';

/**
 * 회귀 테스트: 메인 checkType='none' + additionalConditions 조합
 *
 * 메인 조건이 'none'(지정 행 중 어디에도 메인 열이 체크되지 않음)으로 satisfied 일 때,
 * 메인 조건이 만족된 행 집합(checkedRowsInTarget)은 정의상 비어 있다.
 * 과거 코드는 additional 조건 평가 직전 `rowsToCheckForAdditional.length === 0` 가드에서
 * 무조건 false 를 반환해, 응답자가 메인('none')과 additional 을 모두 충족해도 표시조건이
 * 절대 매칭되지 않았다.
 *
 * 빌더 UI(additional-conditions-editor)는 additional 조건의 행 범위를
 * tableConditions.rowIds(메인이 검사하는 행)로 잡는다. 따라서 'none' 케이스에서도
 * additional 은 그 행들에 대해 평가되어야 한다.
 */

// 두 개 열(col-a = 메인, col-b = additional)을 가진 2행 테이블 소스 질문
function makeSourceQuestion(): Question {
  return {
    id: 'q-source',
    surveyId: 's1',
    type: 'table',
    title: '소스 표',
    required: false,
    order: 0,
    tableColumns: [
      { id: 'col-label', label: '항목' },
      { id: 'col-a', label: 'A' },
      { id: 'col-b', label: 'B' },
    ],
    tableRowsData: [
      {
        id: 'row-1',
        label: '행1',
        cells: [
          { id: 'lbl-1', content: '행1', type: 'text' as const },
          {
            id: 'r1-a',
            content: '',
            type: 'checkbox' as const,
            checkboxOptions: [{ id: 'opt-a1', label: 'A체크', value: 'a' }],
          },
          {
            id: 'r1-b',
            content: '',
            type: 'checkbox' as const,
            checkboxOptions: [{ id: 'opt-b1', label: 'B체크', value: 'b' }],
          },
        ],
      },
      {
        id: 'row-2',
        label: '행2',
        cells: [
          { id: 'lbl-2', content: '행2', type: 'text' as const },
          {
            id: 'r2-a',
            content: '',
            type: 'checkbox' as const,
            checkboxOptions: [{ id: 'opt-a2', label: 'A체크', value: 'a' }],
          },
          {
            id: 'r2-b',
            content: '',
            type: 'checkbox' as const,
            checkboxOptions: [{ id: 'opt-b2', label: 'B체크', value: 'b' }],
          },
        ],
      },
    ],
  } as unknown as Question;
}

// 메인: col-a(인덱스 1) checkType, additional: col-b(인덱스 2) 체크 여부
function makeTargetQuestion(
  mainCheckType: 'any' | 'all' | 'none',
  withAdditional: boolean,
): Question {
  const condition: QuestionCondition = {
    id: 'cond-1',
    sourceQuestionId: 'q-source',
    conditionType: 'table-cell-check',
    logicType: 'AND',
    tableConditions: {
      rowIds: ['row-1', 'row-2'],
      cellColumnIndex: 1, // col-a
      checkType: mainCheckType,
    },
    ...(withAdditional
      ? {
          additionalConditions: {
            cellColumnIndex: 2, // col-b
            checkType: 'checkbox' as const,
          },
        }
      : {}),
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

function evalDisplay(
  mainCheckType: 'any' | 'all' | 'none',
  withAdditional: boolean,
  responses: Record<string, unknown>,
): boolean {
  const sourceQuestion = makeSourceQuestion();
  const targetQuestion = makeTargetQuestion(mainCheckType, withAdditional);
  return shouldDisplayQuestion(targetQuestion, responses, [sourceQuestion, targetQuestion]);
}

describe('branch-logic — checkType none + additionalConditions', () => {
  it("메인 'none' 만족 + additional(col-b) 충족 → 표시(true)", () => {
    // col-a 는 두 행 모두 미체크('none' 만족), col-b 는 row-1 체크 → additional 충족
    const responses: Record<string, unknown> = {
      'q-source': {
        'r1-b': [{ optionId: 'opt-b1' }],
      },
    };
    expect(evalDisplay('none', true, responses)).toBe(true);
  });

  it("메인 'none' 만족 + additional(col-b) 미충족 → 숨김(false)", () => {
    // col-a 미체크('none' 만족), col-b 도 미체크 → additional 미충족
    const responses: Record<string, unknown> = {
      'q-source': {},
    };
    expect(evalDisplay('none', true, responses)).toBe(false);
  });

  it("메인 'none' 위반(col-a 체크됨) → additional 충족이어도 숨김(false)", () => {
    // col-a row-1 체크 → 'none' 위반(mainConditionResult=false)
    const responses: Record<string, unknown> = {
      'q-source': {
        'r1-a': [{ optionId: 'opt-a1' }],
        'r1-b': [{ optionId: 'opt-b1' }],
      },
    };
    expect(evalDisplay('none', true, responses)).toBe(false);
  });

  // 기존 동작 보존 회귀: any/all 케이스는 영향 없어야 함
  it("기존 보존: 메인 'any' + additional 같은 행 충족 → 표시(true)", () => {
    // row-1 의 col-a, col-b 모두 체크 → 같은 행에서 메인+additional 충족
    const responses: Record<string, unknown> = {
      'q-source': {
        'r1-a': [{ optionId: 'opt-a1' }],
        'r1-b': [{ optionId: 'opt-b1' }],
      },
    };
    expect(evalDisplay('any', true, responses)).toBe(true);
  });

  it("기존 보존: 메인 'any' + additional 이 다른 행에만 충족 → 숨김(false)", () => {
    // row-1 의 col-a 체크(메인 통과 행=row-1), 하지만 col-b 는 row-2 에만 체크
    // → 같은 행(row-1)에서 additional 미충족 → false
    const responses: Record<string, unknown> = {
      'q-source': {
        'r1-a': [{ optionId: 'opt-a1' }],
        'r2-b': [{ optionId: 'opt-b2' }],
      },
    };
    expect(evalDisplay('any', true, responses)).toBe(false);
  });
});
