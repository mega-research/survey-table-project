import { describe, it, expect } from 'vitest';
import type { BranchRule, Question } from '@/types/survey';
import { getBranchRuleForResponse, shouldDisplayQuestion } from '@/utils/branch-logic';

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

describe('value-match 표시 조건 — 보기 그룹 표 (table + __choiceGroups)', () => {
  const tableSource = {
    ...makeGroupedSourceQuestion(),
    type: 'table',
  } as Question;
  const target = makeTargetQuestion([TARGET_CELL]);
  const allQuestions = [tableSource, target];

  it('표 응답 안 예약 키의 선택이 requiredValues 와 일치하면 표시한다', () => {
    const responses = { [SOURCE_ID]: { amount: '1', __choiceGroups: { rad2: TARGET_CELL } } };
    expect(shouldDisplayQuestion(target, responses, allQuestions)).toBe(true);
  });

  it('다른 보기를 골랐거나 예약 키가 없으면 숨긴다 — 셀 값 키는 보기 선택이 아니다', () => {
    expect(
      shouldDisplayQuestion(target, { [SOURCE_ID]: { __choiceGroups: { rad2: OTHER_CELL } } }, allQuestions),
    ).toBe(false);
    expect(
      shouldDisplayQuestion(target, { [SOURCE_ID]: { [TARGET_CELL]: '값' } }, allQuestions),
    ).toBe(false);
  });

  it('checkbox 그룹의 배열 선택도 매칭한다', () => {
    const checkboxTable = {
      ...tableSource,
      choiceGroups: [{ id: 'g2', type: 'checkbox' as const, label: '현재', groupKey: 'chk1' }],
    } as Question;
    const responses = { [SOURCE_ID]: { __choiceGroups: { chk1: [OTHER_CELL, TARGET_CELL] } } };
    expect(shouldDisplayQuestion(target, responses, [checkboxTable, target])).toBe(true);
  });
});

/**
 * 정본 리더 위임 고정 — 문항 레벨 그룹 맵을 읽는 자리 셋이 같은 판정을 내는가.
 *
 * 읽는 자리는 표시 조건의 checkValueMatch 와 분기 규칙의 getBranchRuleForRadio·
 * getBranchRuleForCheckbox 셋이고, 셋 다 lib/survey/choice-selection.ts 의
 * collectSelectedChoiceCellIds 를 부른다. 전에는 세 곳이 같은 flatMap 을 각자 갖고 있었다.
 *
 * 아래 세 모양은 옛 인라인 flatMap 과 정본이 갈리던 자리다 — 인라인은 (1) 배열 속 빈
 * 문자열을 선택으로 세고 (2) 중첩 배열을 버리고 (3) `{selectedValue}` 래핑을 버렸다.
 * 셋 중 어느 자리든 사본으로 되돌리면 여기서 걸린다.
 *
 * 저장 경로가 실제로 만드는 모양은 아니다 — 그룹 맵을 쓰는 곳(그룹 렌더러의 toggle,
 * Raw 양식 이월 임포트의 invertChoiceGroups)은 빈 문자열이 아닌 cell.id 와 그 배열만 넣는다.
 * 이 블록의 목적은 세 자리가 갈리지 않게 붙들어 두는 것이다.
 */
describe('그룹 맵 판독 — 세 자리(표시 조건 · radio 분기 · checkbox 분기) 일치', () => {
  const BRANCH_RULE: BranchRule = {
    id: 'br-target',
    value: TARGET_CELL,
    action: 'goto',
    targetQuestionId: 'q-after',
  };

  /** TARGET_CELL 셀에만 분기 규칙을 붙인다 — 분기가 나오면 그 셀이 선택으로 읽혔다는 뜻 */
  function withTargetBranchRule(question: Question): Question {
    return {
      ...question,
      tableRowsData: (question.tableRowsData ?? []).map((row) => ({
        ...row,
        cells: row.cells.map((cell) =>
          cell.id === TARGET_CELL ? { ...cell, branchRule: BRANCH_RULE } : cell,
        ),
      })),
    } as Question;
  }

  /** 같은 응답을 세 자리에 흘려 넣은 결과 */
  function readAtThreeSites(response: unknown) {
    const radio = withTargetBranchRule(makeGroupedSourceQuestion());
    const checkbox = { ...radio, type: 'checkbox' } as Question;
    const target = makeTargetQuestion([TARGET_CELL]);
    return {
      displayRadio: shouldDisplayQuestion(target, { [SOURCE_ID]: response }, [radio, target]),
      displayCheckbox: shouldDisplayQuestion(target, { [SOURCE_ID]: response }, [checkbox, target]),
      radioRule: getBranchRuleForResponse(radio, response),
      checkboxRule: getBranchRuleForResponse(checkbox, response),
    };
  }

  it('기준선 — 정상 모양은 세 자리 모두 TARGET_CELL 을 선택으로 읽는다', () => {
    expect(readAtThreeSites({ rad2: TARGET_CELL })).toEqual({
      displayRadio: true,
      displayCheckbox: true,
      radioRule: BRANCH_RULE,
      checkboxRule: BRANCH_RULE,
    });
  });

  it('기준선 — 다른 보기를 고르면 세 자리 모두 미선택이다', () => {
    expect(readAtThreeSites({ rad2: OTHER_CELL })).toEqual({
      displayRadio: false,
      displayCheckbox: false,
      radioRule: null,
      checkboxRule: null,
    });
  });

  it('중첩 배열은 펴서 읽는다 — 세 자리 모두', () => {
    expect(readAtThreeSites({ rad2: [[TARGET_CELL]] })).toEqual({
      displayRadio: true,
      displayCheckbox: true,
      radioRule: BRANCH_RULE,
      checkboxRule: BRANCH_RULE,
    });
  });

  it('`{selectedValue}` 래핑은 풀어서 읽는다 — 세 자리 모두', () => {
    expect(readAtThreeSites({ rad2: { selectedValue: TARGET_CELL } })).toEqual({
      displayRadio: true,
      displayCheckbox: true,
      radioRule: BRANCH_RULE,
      checkboxRule: BRANCH_RULE,
    });
  });

  /**
   * 빈 문자열은 선택이 아니다.
   *
   * 보기 값이 cell.id 라 정상 구조에서는 빈 값이 후보가 될 수 없다 — 규칙을 세 자리에서
   * 관찰하려면 빈 id 를 가진 보기 셀이 있어야 해서 이 케이스만 퇴화 구조를 쓴다.
   * 저장 경로가 만드는 모양이 아니라, "빈 문자열을 선택으로 세지 않는다" 를 못박는 자리다.
   */
  const EMPTY_ID_RULE: BranchRule = {
    id: 'br-empty',
    value: '',
    action: 'goto',
    targetQuestionId: 'q-after',
  };

  function makeEmptyIdSource(type: 'radio' | 'checkbox'): Question {
    return {
      id: SOURCE_ID,
      surveyId: 's1',
      type,
      title: 'AQ2. 빈 id 보기',
      required: false,
      order: 0,
      options: [],
      choiceGroups: [
        { id: 'g2', type: type === 'checkbox' ? 'checkbox' : 'radio', label: '현재', groupKey: 'rad2' },
      ],
      tableColumns: [
        { id: 'col-label', label: '내용' },
        { id: 'col-now', label: '현재' },
      ],
      tableRowsData: [
        {
          id: 'row-1',
          label: '① 재학/휴학',
          cells: [
            { id: 'cell-label-1', content: '① 재학/휴학', type: 'text' as const },
            {
              id: '',
              content: '',
              type: 'choice_opt' as const,
              choiceGroupId: 'g2',
              branchRule: EMPTY_ID_RULE,
            },
          ],
        },
      ],
    } as Question;
  }

  it('배열 속 빈 문자열은 선택이 아니다 — 세 자리 모두', () => {
    const response = { rad2: [''] };
    const radio = makeEmptyIdSource('radio');
    const checkbox = makeEmptyIdSource('checkbox');
    const target = makeTargetQuestion(['']);

    expect(shouldDisplayQuestion(target, { [SOURCE_ID]: response }, [radio, target])).toBe(false);
    expect(getBranchRuleForResponse(radio, response)).toBeNull();
    expect(getBranchRuleForResponse(checkbox, response)).toBeNull();
  });
});
