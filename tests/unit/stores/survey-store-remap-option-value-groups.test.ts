import { beforeEach, describe, expect, it } from 'vitest';

import { useSurveyBuilderStore } from '@/stores/survey-store';
import type { Survey } from '@/types/survey';

/**
 * 그룹 표시조건 리매핑의 스코프 반환 검증.
 * 그룹 영속은 groups.update RPC(호출측)가 담당하므로, 리매핑은 전역
 * isMetadataDirty 를 세우지 않고 변경된 그룹 id 를 반환해야 한다 —
 * 전역 메타 dirty 소비가 미저장 제목 변경·그룹 삭제까지 동반 커밋하는 회귀 방지.
 */

function makeSurvey(): Survey {
  return {
    id: 's1',
    title: 't',
    description: '',
    slug: '',
    privateToken: 'tok',
    groups: [
      {
        id: 'g1',
        surveyId: 's1',
        name: '그룹',
        order: 0,
        displayCondition: {
          logicType: 'AND',
          conditions: [
            {
              id: 'c1',
              sourceQuestionId: 'q1',
              conditionType: 'value-match',
              requiredValues: ['option-2'],
              logicType: 'AND',
            },
          ],
        },
      },
    ],
    questions: [],
    lookups: [],
    settings: useSurveyBuilderStore.getState().currentSurvey.settings,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('remapOptionValueInConditions 그룹 스코프', () => {
  beforeEach(() => {
    useSurveyBuilderStore.getState().resetSurvey();
    useSurveyBuilderStore.getState().setSurvey(makeSurvey());
    useSurveyBuilderStore.setState({ isMetadataDirty: false });
  });

  it('변경된 그룹 id 를 반환하고 전역 isMetadataDirty 는 세우지 않는다', () => {
    const scope = useSurveyBuilderStore
      .getState()
      .remapOptionValueInConditions('q1', 'option-2', '5');

    expect(scope.groupIds).toEqual(['g1']);
    const state = useSurveyBuilderStore.getState();
    expect(state.isMetadataDirty).toBe(false);
    expect(
      state.currentSurvey.groups?.[0]?.displayCondition?.conditions[0]?.requiredValues,
    ).toEqual(['5']);
  });

  it('그룹 변경이 없으면 빈 groupIds 를 반환한다', () => {
    const scope = useSurveyBuilderStore
      .getState()
      .remapOptionValueInConditions('q1', '없는값', '5');

    expect(scope.groupIds).toEqual([]);
    expect(useSurveyBuilderStore.getState().isMetadataDirty).toBe(false);
  });
});
