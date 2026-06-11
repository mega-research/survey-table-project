import { beforeEach, describe, expect, it } from 'vitest';

import { useSurveyBuilderStore } from '@/stores/survey-store';
import type { QuestionGroup, Survey } from '@/types/survey';

// addGroup 이 형제 그룹의 실제 order 값(개수 아님)을 기준으로 새 order 를 계산하는지 검증한다.
// deleteGroup 은 형제 order 를 재정렬하지 않으므로 삭제 후에는 order 공백이 생긴다.
// 개수 기반 계산은 이 공백에서 기존 그룹과 order 가 충돌하는 회귀 버그를 일으켰다.

const SURVEY_ID = 'survey-test';

function makeGroup(id: string, order: number, parentGroupId?: string): QuestionGroup {
  return {
    id,
    surveyId: SURVEY_ID,
    name: id,
    order,
    ...(parentGroupId !== undefined ? { parentGroupId } : {}),
  };
}

function makeSurvey(groups: QuestionGroup[]): Survey {
  return {
    id: SURVEY_ID,
    title: 'test',
    description: '',
    slug: '',
    privateToken: 'token',
    groups,
    questions: [],
    lookups: [],
    settings: useSurveyBuilderStore.getState().currentSurvey.settings,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('survey-store addGroup order 계산', () => {
  beforeEach(() => {
    useSurveyBuilderStore.getState().resetSurvey();
  });

  it('중간 형제 삭제로 생긴 order 공백에서 충돌 없이 마지막 뒤에 배치한다', () => {
    // parent 하위에 order [0, 2] — 중간(order 1) 형제가 삭제된 상태
    const parentId = 'parent';
    useSurveyBuilderStore.getState().setSurvey(
      makeSurvey([
        makeGroup(parentId, 0),
        makeGroup('child-a', 0, parentId),
        makeGroup('child-c', 2, parentId),
      ]),
    );

    useSurveyBuilderStore.getState().addGroup('child-new', undefined, parentId);

    const groups = useSurveyBuilderStore.getState().currentSurvey.groups ?? [];
    const newGroup = groups.find((g) => g.name === 'child-new');
    expect(newGroup).toBeDefined();
    // 기존 최대 order(2)보다 커야 충돌하지 않는다. 개수 기반 버그라면 2가 되어 child-c 와 충돌.
    expect(newGroup?.order).toBe(3);

    // 같은 부모 내 order 가 유일해야 한다 (충돌 없음).
    const siblingOrders = groups
      .filter((g) => g.parentGroupId === parentId)
      .map((g) => g.order);
    expect(new Set(siblingOrders).size).toBe(siblingOrders.length);
  });

  it('공백 없는 연속 order 에서는 기존 동작과 동일하게 length 기반 결과를 유지한다', () => {
    const parentId = 'parent';
    useSurveyBuilderStore.getState().setSurvey(
      makeSurvey([
        makeGroup(parentId, 0),
        makeGroup('child-a', 0, parentId),
        makeGroup('child-b', 1, parentId),
      ]),
    );

    useSurveyBuilderStore.getState().addGroup('child-new', undefined, parentId);

    const newGroup = (useSurveyBuilderStore.getState().currentSurvey.groups ?? []).find(
      (g) => g.name === 'child-new',
    );
    expect(newGroup?.order).toBe(2);
  });

  it('형제 그룹이 없으면 order 는 0 이다', () => {
    const parentId = 'parent';
    useSurveyBuilderStore.getState().setSurvey(makeSurvey([makeGroup(parentId, 0)]));

    useSurveyBuilderStore.getState().addGroup('child-new', undefined, parentId);

    const newGroup = (useSurveyBuilderStore.getState().currentSurvey.groups ?? []).find(
      (g) => g.name === 'child-new',
    );
    expect(newGroup?.order).toBe(0);
  });

  it('최상위 그룹 추가 시 기존 최상위 그룹의 최대 order 뒤에 배치한다', () => {
    useSurveyBuilderStore.getState().setSurvey(
      makeSurvey([makeGroup('top-a', 0), makeGroup('top-c', 2)]),
    );

    useSurveyBuilderStore.getState().addGroup('top-new');

    const groups = useSurveyBuilderStore.getState().currentSurvey.groups ?? [];
    const newGroup = groups.find((g) => g.name === 'top-new');
    expect(newGroup?.order).toBe(3);
    const topOrders = groups.filter((g) => !g.parentGroupId).map((g) => g.order);
    expect(new Set(topOrders).size).toBe(topOrders.length);
  });
});
