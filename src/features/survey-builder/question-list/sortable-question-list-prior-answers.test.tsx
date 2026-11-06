/**
 * 빌더(설문 편집) 미리보기도 첫 번째 조사 대상의 이월 응답을 응답 화면처럼 깐다(2026-11-04).
 * 서버 샘플(`testSample.get`)이 이월 응답을 실어 오면 값이 없는 문항의 테스트 응답으로 들어가고,
 * 「이월값 불러오기」를 끈 문항·이미 값이 있는 문항은 건드리지 않는다.
 */
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getSample = vi.hoisted(() => vi.fn());
vi.mock('@/features/survey-builder/hooks/use-survey-sync', () => ({
  useSurveySync: () => ({ saveSurvey: vi.fn() }),
}));
vi.mock('@/shared/lib/rpc', () => ({
  client: { surveyBuilder: { testSample: { get: (...a: unknown[]) => getSample(...a) } } },
}));

import { SortableQuestionList } from '@/features/survey-builder/question-list/sortable-question-list';
import { useSurveyBuilderStore } from '@/features/survey-builder/stores/survey-store';
import { useTestResponseStore } from '@/features/survey-builder/stores/test-response-store';
import { useSurveyResponseStore } from '@/features/survey-response/stores/survey-response-store';
import type { Question } from '@/types/survey';

const questions = [
  { id: 'q1', type: 'text', title: '작년 매출', required: false, order: 0 },
  { id: 'q2', type: 'text', title: '인원', required: false, order: 1, priorAnswerDisabled: true },
  { id: 'q3', type: 'text', title: '지역', required: false, order: 2 },
] as unknown as Question[];

function seedSurvey() {
  useSurveyBuilderStore.getState().setSurvey({
    id: 's1',
    title: 't',
    description: '',
    slug: '',
    privateToken: 'tok',
    groups: [],
    questions,
    lookups: [],
    settings: useSurveyBuilderStore.getState().currentSurvey.settings,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe('SortableQuestionList — 미리보기 이월 값', () => {
  beforeEach(() => {
    useSurveyBuilderStore.getState().resetSurvey();
    useTestResponseStore.getState().clearTestResponses();
    useSurveyResponseStore.getState().resetResponseState();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('첫 대상의 이월 응답을 값이 없는 문항에 깐다 — 끈 문항·이미 적은 문항은 그대로', async () => {
    useTestResponseStore.getState().updateTestResponse('q3', '서울');
    getSample.mockResolvedValue({
      attrs: {},
      resid: 1,
      priorAnswers: { q1: '1200', q2: '5', q3: '부산' },
    });
    seedSurvey();
    render(<SortableQuestionList selectedQuestionId={null} />);

    await waitFor(() => expect(useTestResponseStore.getState().testResponses['q1']).toBe('1200'));
    const responses = useTestResponseStore.getState().testResponses;
    expect(responses['q2']).toBeUndefined();
    expect(responses['q3']).toBe('서울');
  });

  it('이월 응답이 없으면 아무것도 깔지 않는다', async () => {
    getSample.mockResolvedValue({ attrs: {}, resid: 1, priorAnswers: null });
    seedSurvey();
    render(<SortableQuestionList selectedQuestionId={null} />);
    await waitFor(() => expect(getSample).toHaveBeenCalled());
    expect(useTestResponseStore.getState().testResponses).toEqual({});
  });
});
