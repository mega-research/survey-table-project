import { describe, expect, it } from 'vitest';

import {
  collectUnfilledChoiceGroupCellIds,
  collectUnfilledChoiceGroupIssues,
  isQuestionAnswered,
  resolveGroupedRequiredMessage,
} from '@/features/survey-response/lib/answer-validation';
import { resolveChoiceGroupVisibleCellIds } from '@/features/survey-response/lib/numeric-validation';
import { CHOICE_GROUPS_KEY } from '@/lib/survey/choice-selection';
import type { Question, QuestionConditionGroup } from '@/types/survey';

// 행 표시조건이 걸린 보기 그룹 표 — 숨은 행의 필수 그룹은 필수 판정에서 빠져야 한다.
// (2026 해운물류 멘토 조사 C8: B3 에서 고른 전공 구성에 맞는 행만 보이는데, 숨은 행의 필수
//  그룹이 남아 「다음」이 영영 막혔다.)

const showWhen = (values: string[]): QuestionConditionGroup => ({
  logicType: 'AND',
  conditions: [
    {
      id: `c-${values.join('-')}`,
      enabled: true,
      logicType: 'AND',
      conditionType: 'value-match',
      sourceQuestionId: 'b3',
      requiredValues: values,
    },
  ],
});

const source: Question = {
  id: 'b3',
  type: 'checkbox',
  title: '팀 전공 구성',
  required: true,
  order: 0,
  options: [
    { id: 'o1', label: '모두 ICT', value: '01' },
    { id: 'o2', label: '모두 해운물류', value: '02' },
  ],
};

function choiceRow(rowId: string, groupId: string, condition?: QuestionConditionGroup) {
  return {
    id: rowId,
    label: rowId,
    ...(condition ? { displayCondition: condition } : {}),
    cells: [
      { id: `${rowId}-label`, type: 'text' as const, content: rowId },
      { id: `${rowId}-a`, type: 'choice_opt' as const, content: '①', choiceGroupId: groupId },
      { id: `${rowId}-b`, type: 'choice_opt' as const, content: '②', choiceGroupId: groupId },
    ],
  };
}

const table: Question = {
  id: 'c8',
  type: 'table',
  title: '전공별 지식수준',
  required: true,
  order: 1,
  tableColumns: [
    { id: 'col-label', label: '항목' },
    { id: 'col-a', label: '①' },
    { id: 'col-b', label: '②' },
  ],
  tableRowsData: [
    choiceRow('r-ict', 'g-ict', showWhen(['01'])),
    choiceRow('r-sea', 'g-sea', showWhen(['02'])),
  ],
  choiceGroups: [
    { id: 'g-ict', type: 'radio', label: 'ICT', groupKey: 'rad1', required: true, requiredMessage: 'ICT 행을 고르세요' },
    { id: 'g-sea', type: 'radio', label: '해운물류', groupKey: 'rad2', required: true, requiredMessage: '해운물류 행을 고르세요' },
  ],
};

const questions = [source, table];
const answer = (groups: Record<string, string>) => ({ [CHOICE_GROUPS_KEY]: groups });

function visibleFor(b3: string[], response: unknown) {
  return resolveChoiceGroupVisibleCellIds(table, response, {
    allResponses: { b3, c8: response },
    allQuestions: questions,
  });
}

describe('보기 그룹 표 — 행 표시조건으로 숨은 필수 그룹', () => {
  it('보이는 행의 그룹만 채우면 응답으로 본다', () => {
    const response = answer({ rad1: 'r-ict-a' });
    const visibleCellIds = visibleFor(['01'], response);
    expect(isQuestionAnswered(table, response, { visibleCellIds })).toBe(true);
  });

  it('보이는 행의 그룹이 비면 여전히 미응답이다', () => {
    const response = answer({});
    const visibleCellIds = visibleFor(['01'], response);
    expect(isQuestionAnswered(table, response, { visibleCellIds })).toBe(false);
  });

  it('두 행이 다 보이면 두 그룹 모두 필요하다', () => {
    const response = answer({ rad1: 'r-ict-a' });
    const visibleCellIds = visibleFor(['01', '02'], response);
    expect(isQuestionAnswered(table, response, { visibleCellIds })).toBe(false);
  });

  it('보이는 셀 집합을 넘기지 않으면 종전대로 모든 그룹을 본다', () => {
    expect(isQuestionAnswered(table, answer({ rad1: 'r-ict-a' }))).toBe(false);
  });

  it('필수 그룹이 전부 숨으면 응답 전이라도 막지 않는다', () => {
    const visibleCellIds = visibleFor([], undefined);
    expect(isQuestionAnswered(table, undefined, { visibleCellIds })).toBe(true);
  });

  it('붉은 외곽선·배너·문구도 숨은 그룹을 가리키지 않는다', () => {
    const response = answer({});
    const visibleCellIds = visibleFor(['02'], response);
    expect([...collectUnfilledChoiceGroupCellIds(table, response, { visibleCellIds })]).toEqual([
      'r-sea-a',
      'r-sea-b',
    ]);
    expect(collectUnfilledChoiceGroupIssues(table, response, { visibleCellIds })).toEqual([
      { message: '해운물류 행을 고르세요', cellIds: ['r-sea-a', 'r-sea-b'] },
    ]);
    expect(resolveGroupedRequiredMessage(table, response, { visibleCellIds })).toBe(
      '해운물류 행을 고르세요',
    );
  });

  it('보이는 셀 집합은 보기 그룹 표에만 만든다', () => {
    expect(
      resolveChoiceGroupVisibleCellIds(source, ['01'], {
        allResponses: { b3: ['01'] },
        allQuestions: questions,
      }),
    ).toBeUndefined();
  });
});
