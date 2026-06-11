import { beforeEach, describe, expect, it } from 'vitest';

import { useSurveyBuilderStore } from '@/stores/survey-store';
import type { QuestionGroup, Survey } from '@/types/survey';

// 그룹을 최상위로 이동하면 parentGroupId 가 로컬 store 에서도 해제돼야 한다(회귀 M47).
// 과거 group-manager 는 최상위 이동 시 parentGroupId 키를 누락한 채 updateGroup 만 호출했고,
// updateGroup 의 Object.assign 은 옛 parentGroupId 를 덮지 못해 로컬 트리만 중첩 상태로 남아
// DB(top-level)와 desync 됐다. clearGroupParent 가 이 해제를 책임진다.

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

describe('survey-store clearGroupParent', () => {
  beforeEach(() => {
    useSurveyBuilderStore.getState().resetSurvey();
  });

  it('중첩 그룹의 parentGroupId 를 해제해 최상위로 만든다', () => {
    const parentId = 'parent';
    useSurveyBuilderStore.getState().setSurvey(
      makeSurvey([makeGroup(parentId, 0), makeGroup('child', 0, parentId)]),
    );

    useSurveyBuilderStore.getState().clearGroupParent('child');

    const child = (useSurveyBuilderStore.getState().currentSurvey.groups ?? []).find(
      (g) => g.id === 'child',
    );
    expect(child).toBeDefined();
    // parentGroupId 가 남아있으면 최상위 필터(!g.parentGroupId)에서 누락된다.
    expect(child?.parentGroupId).toBeUndefined();
    expect('parentGroupId' in (child ?? {})).toBe(false);
    // 최상위 그룹 필터에 포함돼야 한다.
    const topLevel = (useSurveyBuilderStore.getState().currentSurvey.groups ?? []).filter(
      (g) => !g.parentGroupId,
    );
    expect(topLevel.map((g) => g.id)).toContain('child');
  });

  it('updateGroup 으로 parentGroupId 키를 누락하면 기존 값이 유지된다(버그 대조군)', () => {
    const parentId = 'parent';
    useSurveyBuilderStore.getState().setSurvey(
      makeSurvey([makeGroup(parentId, 0), makeGroup('child', 0, parentId)]),
    );

    // 키 누락: Object.assign 이 옛 값을 덮지 못한다 → 과거 desync 버그의 원인.
    useSurveyBuilderStore.getState().updateGroup('child', { name: 'child', order: 1 });

    const child = (useSurveyBuilderStore.getState().currentSurvey.groups ?? []).find(
      (g) => g.id === 'child',
    );
    expect(child?.parentGroupId).toBe(parentId);
  });

  it('존재하지 않는 그룹 id 는 무시한다', () => {
    useSurveyBuilderStore.getState().setSurvey(makeSurvey([makeGroup('top', 0)]));
    expect(() => useSurveyBuilderStore.getState().clearGroupParent('missing')).not.toThrow();
    const groups = useSurveyBuilderStore.getState().currentSurvey.groups ?? [];
    expect(groups).toHaveLength(1);
  });
});
