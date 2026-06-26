import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Dispatch, SetStateAction } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createQuestionMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/survey-builder/question-basic-tab', () => {
  return {
    QuestionBasicTab: ({
      setFormData,
    }: {
      setFormData: Dispatch<SetStateAction<{ groupId?: string }>>;
    }) => (
      <button
        type="button"
        onClick={() => setFormData((prev) => ({ ...prev, groupId: 'g1' }))}
      >
        그룹 선택
      </button>
    ),
  };
});

vi.mock('@/components/survey-builder/question-condition-editor', () => ({
  QuestionConditionEditor: () => null,
}));
vi.mock('@/components/survey-builder/table-validation-editor', () => ({
  TableValidationEditor: () => null,
}));
vi.mock('@/hooks/use-ensure-survey-in-db', () => ({
  useEnsureSurveyInDb: () => async () => {},
}));
vi.mock('@/shared/lib/rpc', () => ({
  client: {
    surveyBuilder: {
      questions: {
        create: createQuestionMock,
        update: vi.fn(),
      },
    },
  },
}));
vi.mock('@/lib/image-extractor', () => ({ extractImageUrlsFromQuestion: () => [] }));
vi.mock('@/lib/image-utils', () => ({ deleteImagesFromR2: async () => {} }));

import { QuestionEditModal } from '@/components/survey-builder/question-edit-modal';
import { useSurveyBuilderStore } from '@/stores/survey-store';

function seedNewQuestion() {
  useSurveyBuilderStore.getState().setSurvey({
    id: 's1',
    title: 't',
    description: '',
    slug: '',
    privateToken: 'tok',
    groups: [{ id: 'g1', surveyId: 's1', name: '그룹 1', order: 0 }],
    questions: [
      {
        id: 'q1',
        type: 'radio',
        title: '새 질문',
        required: false,
        order: 1,
        options: [{ id: 'o1', label: '옵션1', value: '1' }],
      },
    ],
    lookups: [],
    settings: useSurveyBuilderStore.getState().currentSurvey.settings,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  useSurveyBuilderStore.setState((state) => ({
    ...state,
    questionChanges: {
      ...state.questionChanges,
      added: { q1: true },
    },
  }));
}

describe('QuestionEditModal 새 질문 그룹 저장', () => {
  beforeEach(() => {
    useSurveyBuilderStore.getState().resetSurvey();
    createQuestionMock.mockResolvedValue({ id: 'q1' });
    seedNewQuestion();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('새 질문 생성 RPC에 모달에서 선택한 groupId를 전달한다', async () => {
    render(<QuestionEditModal questionId="q1" isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '그룹 선택' }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(createQuestionMock).toHaveBeenCalled());
    expect(createQuestionMock).toHaveBeenCalledWith(expect.objectContaining({ groupId: 'g1' }));
  });
});
