import { describe, it, expect } from 'vitest';
import type { Question } from '@/types/survey';
import { shouldDisplayQuestion } from '@/utils/branch-logic';

/**
 * 회귀 테스트: value-match 표시 조건 × 그룹형 choice 응답(GroupedChoiceAnswer)
 *
 * choiceGroups 가 있는 radio/checkbox 질문의 응답은 { groupKey: cellId | cellId[] }
 * 맵으로 저장된다. 분기 규칙 경로(getBranchRuleForRadio/Checkbox)는 이 맵을
 * flat 해서 매칭하지만, 표시 조건의 checkValueMatch 는 문자열·selectedValue/optionId
 * 객체·배열만 처리해 그룹 맵이 어느 분기에도 걸리지 않았다 → 조건 값이 올바르게
 * 설정돼 있어도 대상 질문이 영원히 표시되지 않는 버그.
 */

const SOURCE_ID = 'q-src';
const TARGET_CELL = 'cell-8c02db94-d488543e'; // 현재 열(rad2) ① 셀
const OTHER_CELL = 'cell-39762ed9-d488543e'; // 현재 열(rad2) ③ 셀

function makeGroupedSourceQuestion(): Question {
  return {
    id: SOURCE_ID,
    surveyId: 's1',
    type: 'radio',
    title: 'AQ1. 상태 선택',
    required: false,
    order: 0,
    options: [],
    choiceGroups: [
      { id: 'g1', type: 'radio', label: '2025년 12월 기준', groupKey: 'rad1' },
      { id: 'g2', type: 'radio', label: '현재', groupKey: 'rad2' },
    ],
    tableColumns: [
      { id: 'col-label', label: '내용' },
      { id: 'col-past', label: '2025년 12월 기준' },
      { id: 'col-now', label: '현재' },
    ],
    tableRowsData: [
      {
        id: 'row-1',
        label: '① 재학/휴학',
        cells: [
          { id: 'cell-label-1', content: '① 재학/휴학', type: 'text' as const },
          { id: 'cell-8c02db94-b020d07d', content: '', type: 'choice_opt' as const, choiceGroupId: 'g1' },
          { id: TARGET_CELL, content: '', type: 'choice_opt' as const, choiceGroupId: 'g2' },
        ],
      },
      {
        id: 'row-2',
        label: '③ 취업',
        cells: [
          { id: 'cell-label-2', content: '③ 취업', type: 'text' as const },
          { id: 'cell-39762ed9-b020d07d', content: '', type: 'choice_opt' as const, choiceGroupId: 'g1' },
          { id: OTHER_CELL, content: '', type: 'choice_opt' as const, choiceGroupId: 'g2' },
        ],
      },
    ],
  } as Question;
}

function makeTargetQuestion(requiredValues: string[]): Question {
  return {
    id: 'q-target',
    surveyId: 's1',
    type: 'radio',
    title: 'AQ1-1. 진로 계획',
    required: false,
    order: 1,
    options: [],
    displayCondition: {
      logicType: 'AND',
      conditions: [
        {
          id: 'c1',
          name: '조건 1',
          enabled: true,
          logicType: 'AND',
          conditionType: 'value-match',
          requiredValues,
          sourceQuestionId: SOURCE_ID,
        },
      ],
    },
  } as Question;
}

describe('value-match 표시 조건 — 그룹형 choice 응답 맵', () => {
  const source = makeGroupedSourceQuestion();
  const target = makeTargetQuestion([TARGET_CELL]);
  const allQuestions = [source, target];

  it('radio 그룹 맵에서 선택된 cellId 가 requiredValues 와 일치하면 표시한다', () => {
    const responses = { [SOURCE_ID]: { rad2: TARGET_CELL } };
    expect(shouldDisplayQuestion(target, responses, allQuestions)).toBe(true);
  });

  it('다른 그룹(rad1)에 조건 셀이 없어도 rad2 선택만으로 만족한다 (양쪽 응답)', () => {
    const responses = {
      [SOURCE_ID]: { rad1: 'cell-39762ed9-b020d07d', rad2: TARGET_CELL },
    };
    expect(shouldDisplayQuestion(target, responses, allQuestions)).toBe(true);
  });

  it('선택된 cellId 가 requiredValues 와 다르면 숨긴다', () => {
    const responses = { [SOURCE_ID]: { rad2: OTHER_CELL } };
    expect(shouldDisplayQuestion(target, responses, allQuestions)).toBe(false);
  });

  it('빈 맵(미응답)이면 숨긴다', () => {
    const responses = { [SOURCE_ID]: {} };
    expect(shouldDisplayQuestion(target, responses, allQuestions)).toBe(false);
  });

  it('checkbox 그룹 값(string[])도 flat 해서 매칭한다', () => {
    const checkboxSource = {
      ...makeGroupedSourceQuestion(),
      choiceGroups: [{ id: 'g2', type: 'checkbox' as const, label: '현재', groupKey: 'chk1' }],
    } as Question;
    const responses = { [SOURCE_ID]: { chk1: [OTHER_CELL, TARGET_CELL] } };
    expect(shouldDisplayQuestion(target, responses, [checkboxSource, target])).toBe(true);
  });

  it('비그룹 radio 의 문자열 응답 매칭은 기존대로 동작한다 (회귀 방지)', () => {
    const plainSource = {
      id: SOURCE_ID,
      surveyId: 's1',
      type: 'radio',
      title: 'AQ1. 상태 선택',
      required: false,
      order: 0,
      options: [{ id: 'opt-1', label: '예', value: 'opt-1' }],
    } as Question;
    const plainTarget = makeTargetQuestion(['opt-1']);
    expect(
      shouldDisplayQuestion(plainTarget, { [SOURCE_ID]: 'opt-1' }, [plainSource, plainTarget]),
    ).toBe(true);
    expect(
      shouldDisplayQuestion(plainTarget, { [SOURCE_ID]: 'opt-2' }, [plainSource, plainTarget]),
    ).toBe(false);
  });
});
