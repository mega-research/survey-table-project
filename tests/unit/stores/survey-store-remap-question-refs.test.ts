import { beforeEach, describe, expect, it } from 'vitest';

import { useSurveyBuilderStore } from '@/stores/survey-store';
import type {
  Question,
  QuestionConditionGroup,
  QuestionGroup,
  Survey,
} from '@/types/survey';

// 질문 생성 직후 temp id → DB id 스왑 시, 그 질문을 참조하는 조건들이 함께 리매핑되는지
// 검증한다. 대상: sourceQuestionId, expression 피연산자(question/cell/binop),
// branchRule.targetQuestionId(goto 분기 대상). 리매핑하지 않으면 참조가 temp id 로
// 영구히 끊긴다(기존 스왑 로직의 구멍 — 최종 리뷰 out-of-scope 지적).

const SURVEY_ID = 'survey-test';
const OLD_ID = 'q-temp';
const NEW_ID = 'q-db';

function makeConditionGroup(sourceQuestionId: string): QuestionConditionGroup {
  return {
    logicType: 'AND',
    conditions: [
      {
        id: 'cond-1',
        sourceQuestionId,
        conditionType: 'value-match',
        requiredValues: ['1'],
        logicType: 'AND',
      },
    ],
  };
}

function makeSurvey(overrides: Partial<Survey>): Survey {
  return {
    id: SURVEY_ID,
    title: 'test',
    description: '',
    slug: '',
    privateToken: 'token',
    groups: [],
    questions: [],
    lookups: [],
    settings: useSurveyBuilderStore.getState().currentSurvey.settings,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeQuestion(overrides: Partial<Question>): Question {
  return {
    id: 'q-target',
    type: 'radio',
    title: 'target',
    required: false,
    order: 1,
    ...overrides,
  };
}

describe('survey-store remapQuestionRefs', () => {
  beforeEach(() => {
    useSurveyBuilderStore.getState().resetSurvey();
  });

  it('타 질문 displayCondition 의 sourceQuestionId 를 새 id 로 리매핑하고 스코프를 반환한다', () => {
    const target = makeQuestion({ id: 'q-target', displayCondition: makeConditionGroup(OLD_ID) });
    const unrelated = makeQuestion({
      id: 'q-unrelated',
      displayCondition: makeConditionGroup('q-someone-else'),
    });
    useSurveyBuilderStore.getState().setSurvey(makeSurvey({ questions: [target, unrelated] }));

    const scope = useSurveyBuilderStore.getState().remapQuestionRefs(OLD_ID, NEW_ID);

    const questions = useSurveyBuilderStore.getState().currentSurvey.questions;
    expect(questions[0]!.displayCondition!.conditions[0]!.sourceQuestionId).toBe(NEW_ID);
    expect(questions[1]!.displayCondition!.conditions[0]!.sourceQuestionId).toBe('q-someone-else');
    expect(scope).toEqual({ questionIds: ['q-target'], groupsChanged: false });
    // dirty 추적: 리매핑된 질문만 updated 등재
    expect(useSurveyBuilderStore.getState().questionChanges.updated['q-target']).toBe(true);
    expect(useSurveyBuilderStore.getState().questionChanges.updated['q-unrelated']).toBeUndefined();
  });

  it('expression 피연산자(question/cell, binop 중첩 포함)의 questionId 를 리매핑한다', () => {
    const target = makeQuestion({
      id: 'q-expr',
      displayCondition: {
        logicType: 'AND',
        conditions: [
          {
            id: 'cond-expr',
            sourceQuestionId: 'q-someone-else',
            conditionType: 'expression',
            logicType: 'AND',
            expressionConfig: {
              joinOps: [],
              clauses: [
                {
                  kind: 'comparison',
                  comparison: {
                    left: {
                      kind: 'binop',
                      op: '+',
                      left: { kind: 'question', questionId: OLD_ID },
                      right: { kind: 'cell', questionId: OLD_ID, cellId: 'cell-1' },
                    },
                    op: '>',
                    right: { kind: 'literal', value: 3 },
                  },
                },
              ],
            },
          },
        ],
      },
    });
    useSurveyBuilderStore.getState().setSurvey(makeSurvey({ questions: [target] }));

    const scope = useSurveyBuilderStore.getState().remapQuestionRefs(OLD_ID, NEW_ID);

    const config =
      useSurveyBuilderStore.getState().currentSurvey.questions[0]!.displayCondition!
        .conditions[0]!.expressionConfig!;
    const clause = config.clauses[0]!;
    if (clause.kind !== 'comparison') throw new Error('unexpected clause kind');
    const left = clause.comparison.left;
    if (left.kind !== 'binop') throw new Error('unexpected operand kind');
    expect(left.left).toEqual({ kind: 'question', questionId: NEW_ID });
    expect(left.right).toEqual({ kind: 'cell', questionId: NEW_ID, cellId: 'cell-1' });
    expect(scope.questionIds).toEqual(['q-expr']);
  });

  it('옵션 branchRule.targetQuestionId(goto 분기 대상)를 질문/셀 옵션 양쪽에서 리매핑한다', () => {
    const withBranch = makeQuestion({
      id: 'q-branch',
      options: [
        {
          id: 'opt-1',
          label: '보기',
          value: '1',
          branchRule: { id: 'br-1', value: '1', action: 'goto', targetQuestionId: OLD_ID },
        },
      ],
      tableRowsData: [
        {
          id: 'row-1',
          label: '행',
          cells: [
            {
              id: 'cell-1',
              type: 'radio',
              content: '',
              radioOptions: [
                {
                  id: 'ro-1',
                  label: '보기',
                  value: '1',
                  branchRule: { id: 'br-2', value: '1', action: 'goto', targetQuestionId: OLD_ID },
                },
              ],
            },
          ],
        },
      ],
    });
    useSurveyBuilderStore.getState().setSurvey(makeSurvey({ questions: [withBranch] }));

    const scope = useSurveyBuilderStore.getState().remapQuestionRefs(OLD_ID, NEW_ID);

    const q = useSurveyBuilderStore.getState().currentSurvey.questions[0]!;
    expect(q.options![0]!.branchRule!.targetQuestionId).toBe(NEW_ID);
    expect(q.tableRowsData![0]!.cells[0]!.radioOptions![0]!.branchRule!.targetQuestionId).toBe(
      NEW_ID,
    );
    expect(scope.questionIds).toEqual(['q-branch']);
  });

  it('그룹 displayCondition 리매핑 시 groupsChanged 와 isMetadataDirty 를 세운다', () => {
    const group: QuestionGroup = {
      id: 'g-1',
      name: '그룹',
      order: 1,
      displayCondition: makeConditionGroup(OLD_ID),
    };
    useSurveyBuilderStore.getState().setSurvey(makeSurvey({ groups: [group] }));

    const scope = useSurveyBuilderStore.getState().remapQuestionRefs(OLD_ID, NEW_ID);

    expect(
      useSurveyBuilderStore.getState().currentSurvey.groups![0]!.displayCondition!.conditions[0]!
        .sourceQuestionId,
    ).toBe(NEW_ID);
    expect(scope).toEqual({ questionIds: [], groupsChanged: true });
    expect(useSurveyBuilderStore.getState().isMetadataDirty).toBe(true);
  });

  it('참조가 전혀 없으면 아무것도 바꾸지 않고 빈 스코프를 반환한다', () => {
    const unrelated = makeQuestion({ id: 'q-clean' });
    useSurveyBuilderStore.getState().setSurvey(makeSurvey({ questions: [unrelated] }));

    const scope = useSurveyBuilderStore.getState().remapQuestionRefs(OLD_ID, NEW_ID);

    expect(scope).toEqual({ questionIds: [], groupsChanged: false });
    expect(useSurveyBuilderStore.getState().isDirty).toBe(false);
  });
});
