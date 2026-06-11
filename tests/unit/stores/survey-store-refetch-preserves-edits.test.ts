import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Question, Survey, SurveyLookup } from '@/types/survey';

// refetchSurvey 는 server 의 withDetails 를 호출해 외부에서 바뀐 JSONB 필드(lookups 등)를
// 가져온다. client 를 모킹해 반환 스냅샷을 테스트별로 제어한다.
const withDetails = vi.fn();
vi.mock('@/shared/lib/rpc', () => ({
  client: {
    surveyBuilder: {
      read: {
        withDetails: (...args: unknown[]) => withDetails(...args),
      },
    },
  },
}));

// 모킹 등록 후 import (hoist 된 vi.mock 이 먼저 적용되도록).
import { useSurveyBuilderStore } from '@/stores/survey-store';

const SURVEY_ID = 'survey-refetch';

function makeQuestion(id: string, title: string): Question {
  return {
    id,
    type: 'radio',
    title,
    required: false,
    order: 1,
  };
}

function makeSurvey(questionTitle: string, lookups: SurveyLookup[]): Survey {
  return {
    id: SURVEY_ID,
    title: 'test',
    description: '',
    slug: '',
    privateToken: 'token',
    groups: [],
    questions: [makeQuestion('q1', questionTitle)],
    lookups,
    settings: useSurveyBuilderStore.getState().currentSurvey.settings,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('survey-store refetchSurvey 미저장 편집 보존 (M42)', () => {
  beforeEach(() => {
    withDetails.mockReset();
    useSurveyBuilderStore.getState().resetSurvey();
  });

  it('미저장 질문 편집을 유지한 채 외부 변경된 lookups 만 갱신한다', async () => {
    // 초기 로드: 질문 제목 "원본", lookups 비어 있음.
    useSurveyBuilderStore.getState().setSurvey(makeSurvey('원본', []));

    // 사용자가 질문을 in-memory 로 편집 → questionChanges.updated[q1] = true, isDirty.
    useSurveyBuilderStore.getState().updateQuestion('q1', { title: '편집본' });
    expect(useSurveyBuilderStore.getState().isDirty).toBe(true);
    expect(useSurveyBuilderStore.getState().questionChanges.updated['q1']).toBe(true);

    // 서버 스냅샷: 질문은 아직 "원본"(편집 미반영), 외부에서 새 LUT 가 추가됨.
    const serverLookups: SurveyLookup[] = [
      { id: 'lut-new', name: '새 LUT', columns: [], rows: [] },
    ];
    withDetails.mockResolvedValue(makeSurvey('원본', serverLookups));

    await useSurveyBuilderStore.getState().refetchSurvey();

    const state = useSurveyBuilderStore.getState();
    // 외부 변경된 lookups 는 서버 값으로 갱신되어야 한다.
    expect(state.currentSurvey.lookups).toEqual(serverLookups);
    // 핵심 회귀: 미저장 질문 편집("편집본")이 서버 스냅샷("원본")으로 덮어써지면 안 된다.
    expect(state.currentSurvey.questions[0]?.title).toBe('편집본');
    // dirty 플래그/changeset 은 그대로 유지된다.
    expect(state.isDirty).toBe(true);
    expect(state.questionChanges.updated['q1']).toBe(true);
  });
});
