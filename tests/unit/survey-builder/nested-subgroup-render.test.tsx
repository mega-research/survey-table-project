import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SortableQuestionList } from '@/components/survey-builder/sortable-question-list';
import { useSurveyResponseStore } from '@/stores/survey-response-store';
import { useSurveyBuilderStore } from '@/stores/survey-store';
import { useTestResponseStore } from '@/stores/test-response-store';
import type { Question, QuestionGroup } from '@/types/survey';

/**
 * 빌더 편집 목록은 그룹 트리를 깊이에 상관없이 전부 그려야 한다.
 * 하위 그룹의 하위 그룹(3단계)이 있으면 그 그룹 머리와 안의 질문이 보여야 한다 —
 * 2단계에서 멈추면 운영자는 그룹이 있는지도 모르고 질문을 옮길 수도 없다.
 */

vi.mock('@/hooks/use-survey-sync', () => ({
  useSurveySync: () => ({ saveSurvey: vi.fn() }),
}));
vi.mock('@/shared/lib/rpc', () => ({
  client: { surveyBuilder: { testSample: { get: vi.fn().mockResolvedValue(null) } } },
}));

const groups: QuestionGroup[] = [
  { id: 'g1', surveyId: 's1', name: '최상위 그룹', order: 0 },
  { id: 'g2', surveyId: 's1', name: '하위 그룹', order: 0, parentGroupId: 'g1' },
  { id: 'g3', surveyId: 's1', name: '손자 그룹', order: 0, parentGroupId: 'g2' },
];

function textQuestion(id: string, title: string, groupId: string, order: number): Question {
  return { id, type: 'text', title, required: false, order, groupId } as unknown as Question;
}

function seedSurvey(questions: Question[]) {
  useSurveyBuilderStore.getState().setSurvey({
    id: 's1',
    title: 't',
    description: '',
    slug: '',
    privateToken: 'tok',
    groups,
    questions,
    lookups: [],
    settings: useSurveyBuilderStore.getState().currentSurvey.settings,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe('SortableQuestionList — 3단계 그룹 렌더', () => {
  beforeEach(() => {
    useSurveyBuilderStore.getState().resetSurvey();
    useTestResponseStore.getState().clearTestResponses();
    useSurveyResponseStore.getState().resetResponseState();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('하위 그룹의 하위 그룹 머리와 그 안의 질문이 그려진다', async () => {
    seedSurvey([
      textQuestion('q1', '하위 그룹 질문', 'g2', 0),
      textQuestion('q2', '손자 그룹 질문', 'g3', 1),
    ]);
    render(<SortableQuestionList selectedQuestionId={null} />);

    expect(
      await screen.findByRole('heading', { level: 4, name: '하위 그룹 질문' }),
    ).toBeInTheDocument();
    expect(screen.getByText('손자 그룹')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: '손자 그룹 질문' })).toBeInTheDocument();
  });
});
