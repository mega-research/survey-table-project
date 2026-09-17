import { beforeEach, describe, expect, it } from 'vitest';

import { useSurveyBuilderStore } from '@/features/survey-builder/stores/survey-store';
import type {
  Question,
  QuestionConditionGroup,
  QuestionGroup,
  Survey,
  TableColumn,
  TableRow,
} from '@/types/survey';

// 질문 레벨 옵션의 optionCode 편집으로 value 가 바뀌면, 그 질문을 sourceQuestionId 로
// 참조하는 다른 질문/그룹/행/열의 displayCondition 도 함께 리매핑돼야 한다(회귀 방지).
// remapOptionValueInConditions 는 저장(스토어 커밋) 시점에만 호출되는 액션 — 이 테스트는
// 액션 자체가 트리에 실제로 반영하는지만 검증한다(호출 시점 원자성은 컴포넌트 레벨 배선의 몫).

const SURVEY_ID = 'survey-test';
const SOURCE_QUESTION_ID = 'q-source';

function makeConditionGroup(): QuestionConditionGroup {
  return {
    logicType: 'AND',
    conditions: [
      {
        id: 'cond-1',
        sourceQuestionId: SOURCE_QUESTION_ID,
        conditionType: 'value-match',
        requiredValues: ['old-value'],
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

describe('survey-store remapOptionValueInConditions', () => {
  beforeEach(() => {
    useSurveyBuilderStore.getState().resetSurvey();
  });

  it('다른 질문의 displayCondition 을 oldValue → newValue 로 리매핑한다', () => {
    const targetQuestion = makeQuestion({
      id: 'q-target',
      displayCondition: makeConditionGroup(),
    });
    useSurveyBuilderStore
      .getState()
      .setSurvey(makeSurvey({ questions: [targetQuestion] }));

    useSurveyBuilderStore
      .getState()
      .remapOptionValueInConditions(SOURCE_QUESTION_ID, 'old-value', 'new-value');

    const question = useSurveyBuilderStore
      .getState()
      .currentSurvey.questions.find((q) => q.id === 'q-target');
    expect(question?.displayCondition?.conditions[0]?.requiredValues).toEqual(['new-value']);
  });

  it('리매핑된 다른 질문은 questionChanges.updated 에 표시돼 저장 diff 에 포함된다', () => {
    const targetQuestion = makeQuestion({
      id: 'q-target',
      displayCondition: makeConditionGroup(),
    });
    useSurveyBuilderStore
      .getState()
      .setSurvey(makeSurvey({ questions: [targetQuestion] }));
    useSurveyBuilderStore.getState().markClean();

    useSurveyBuilderStore
      .getState()
      .remapOptionValueInConditions(SOURCE_QUESTION_ID, 'old-value', 'new-value');

    expect(useSurveyBuilderStore.getState().questionChanges.updated['q-target']).toBe(true);
    expect(useSurveyBuilderStore.getState().isDirty).toBe(true);
  });

  it('질문 그룹의 displayCondition 도 리매핑하고 그룹 id 를 스코프로 반환한다', () => {
    // 그룹 영속은 호출측의 groups.update RPC 담당 — 전역 isMetadataDirty 를 세우면
    // 미저장 제목 변경·그룹 삭제까지 스코프 저장에 동반 커밋되므로 세우지 않는다
    const group: QuestionGroup = {
      id: 'g-target',
      surveyId: SURVEY_ID,
      name: 'g-target',
      order: 0,
      displayCondition: makeConditionGroup(),
    };
    useSurveyBuilderStore.getState().setSurvey(makeSurvey({ groups: [group] }));
    useSurveyBuilderStore.getState().markClean();

    const scope = useSurveyBuilderStore
      .getState()
      .remapOptionValueInConditions(SOURCE_QUESTION_ID, 'old-value', 'new-value');

    const updatedGroup = (useSurveyBuilderStore.getState().currentSurvey.groups ?? []).find(
      (g) => g.id === 'g-target',
    );
    expect(updatedGroup?.displayCondition?.conditions[0]?.requiredValues).toEqual(['new-value']);
    expect(scope.groupIds).toEqual(['g-target']);
    expect(useSurveyBuilderStore.getState().isMetadataDirty).toBe(false);
  });

  it('테이블 행(tableRowsData)과 열(tableColumns)의 displayCondition 도 리매핑한다', () => {
    const row: TableRow = {
      id: 'row-1',
      label: 'row',
      cells: [],
      displayCondition: makeConditionGroup(),
    };
    const column: TableColumn = {
      id: 'col-1',
      label: 'col',
      displayCondition: makeConditionGroup(),
    };
    const targetQuestion = makeQuestion({
      id: 'q-table',
      type: 'table',
      tableRowsData: [row],
      tableColumns: [column],
    });
    useSurveyBuilderStore
      .getState()
      .setSurvey(makeSurvey({ questions: [targetQuestion] }));

    useSurveyBuilderStore
      .getState()
      .remapOptionValueInConditions(SOURCE_QUESTION_ID, 'old-value', 'new-value');

    const question = useSurveyBuilderStore
      .getState()
      .currentSurvey.questions.find((q) => q.id === 'q-table');
    expect(
      question?.tableRowsData?.[0]?.displayCondition?.conditions[0]?.requiredValues,
    ).toEqual(['new-value']);
    expect(
      question?.tableColumns?.[0]?.displayCondition?.conditions[0]?.requiredValues,
    ).toEqual(['new-value']);
  });

  it('sourceQuestionId 가 일치하지 않으면 변경하지 않고 dirty 도 세우지 않는다', () => {
    const targetQuestion = makeQuestion({
      id: 'q-target',
      displayCondition: {
        logicType: 'AND',
        conditions: [
          {
            id: 'cond-1',
            sourceQuestionId: 'other-question',
            conditionType: 'value-match',
            requiredValues: ['old-value'],
            logicType: 'AND',
          },
        ],
      },
    });
    useSurveyBuilderStore
      .getState()
      .setSurvey(makeSurvey({ questions: [targetQuestion] }));
    useSurveyBuilderStore.getState().markClean();

    useSurveyBuilderStore
      .getState()
      .remapOptionValueInConditions(SOURCE_QUESTION_ID, 'old-value', 'new-value');

    const question = useSurveyBuilderStore
      .getState()
      .currentSurvey.questions.find((q) => q.id === 'q-target');
    expect(question?.displayCondition?.conditions[0]?.requiredValues).toEqual(['old-value']);
    expect(useSurveyBuilderStore.getState().isDirty).toBe(false);
    expect(useSurveyBuilderStore.getState().questionChanges.updated['q-target']).toBeUndefined();
  });
});
