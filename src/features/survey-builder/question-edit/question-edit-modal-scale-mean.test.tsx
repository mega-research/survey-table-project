import type { Dispatch, SetStateAction } from 'react';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createQuestionMock = vi.hoisted(() => vi.fn());
const updateQuestionMock = vi.hoisted(() => vi.fn());

/**
 * QuestionBasicTab 을 formData 조작 버튼으로 대체한다 — 보려는 것은 토글 UI 가 아니라
 * "formData 에 실린 평균 산출·평균에서 제외가 저장 페이로드까지 도달하는가" 다(formData ↔ store
 * 이중 상태가 설정을 조용히 잃던 전례가 있다).
 */
vi.mock('@/features/survey-builder/question-edit/question-basic-tab', () => ({
  QuestionBasicTab: ({
    formData,
    setFormData,
  }: {
    formData: Partial<Question>;
    setFormData: Dispatch<SetStateAction<Partial<Question>>>;
  }) => (
    <div>
      <button
        type="button"
        onClick={() => setFormData((prev) => ({ ...prev, scaleMeanEnabled: true }))}
      >
        척도 평균 켜기
      </button>
      <button
        type="button"
        onClick={() =>
          setFormData((prev) => ({
            ...prev,
            options: (prev.options ?? []).map((option) =>
              option.id === 'o8' ? { ...option, excludeFromMean: true } : option,
            ),
          }))
        }
      >
        모름 제외
      </button>
      <span data-testid="scale-mean">{String(formData.scaleMeanEnabled ?? '')}</span>
    </div>
  ),
}));

vi.mock('@/features/survey-builder/condition/question-condition-editor', () => ({
  QuestionConditionEditor: () => null,
}));
vi.mock('@/features/survey-builder/question-edit/table-validation-editor', () => ({
  TableValidationEditor: () => null,
}));
vi.mock('@/features/survey-builder/hooks/use-ensure-survey-in-db', () => ({
  useEnsureSurveyInDb: () => async () => {},
}));
// 옵션 value 리매핑이 있을 때만 호출되는 설문 저장 플로우 — 이 테스트는 렌더/저장 경로만 보므로 stub.
vi.mock('@/features/survey-builder/hooks/use-survey-sync', () => ({
  useSurveySync: () => ({ saveSurvey: vi.fn() }),
}));
vi.mock('@/shared/lib/rpc', () => ({
  client: {
    surveyBuilder: {
      questions: {
        create: createQuestionMock,
        update: updateQuestionMock,
      },
    },
  },
}));
vi.mock('@/lib/image-extractor', () => ({ extractImageUrlsFromQuestion: () => [] }));
vi.mock('@/shared/lib/image-utils', () => ({ deleteImagesFromR2: async () => {} }));

import { QuestionEditModal } from '@/features/survey-builder/question-edit/question-edit-modal';
import { useSurveyBuilderStore } from '@/features/survey-builder/stores/survey-store';
import type { Question } from '@/types/survey';

function radioQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    type: 'radio',
    title: '만족하십니까',
    required: false,
    order: 1,
    options: [
      { id: 'o1', label: '불만족', value: '1' },
      { id: 'o2', label: '만족', value: '2' },
      { id: 'o8', label: '모름', value: '8' },
    ],
    ...overrides,
  } as unknown as Question;
}

function seed(question: Question, opts: { added: boolean }) {
  useSurveyBuilderStore.getState().setSurvey({
    id: 's1',
    title: 't',
    description: '',
    slug: '',
    privateToken: 'tok',
    groups: [],
    questions: [question],
    lookups: [],
    settings: useSurveyBuilderStore.getState().currentSurvey.settings,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  if (opts.added) {
    useSurveyBuilderStore.setState((state) => ({
      ...state,
      questionChanges: { ...state.questionChanges, added: { q1: true } },
    }));
  }
}

function storeQuestion(): Question | undefined {
  return useSurveyBuilderStore.getState().currentSurvey.questions.find((q) => q.id === 'q1');
}

describe('QuestionEditModal 평균 산출 저장 왕복', () => {
  beforeEach(() => {
    useSurveyBuilderStore.getState().resetSurvey();
    createQuestionMock.mockResolvedValue({ id: 'q1' });
    updateQuestionMock.mockResolvedValue({ id: 'q1' });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('신규 질문 CREATE 에 평균 산출과 보기의 평균에서 제외가 실린다', async () => {
    seed(radioQuestion(), { added: true });
    render(<QuestionEditModal questionId="q1" isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '척도 평균 켜기' }));
    fireEvent.click(screen.getByRole('button', { name: '모름 제외' }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(createQuestionMock).toHaveBeenCalled());
    expect(createQuestionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scaleMeanEnabled: true,
        options: expect.arrayContaining([
          expect.objectContaining({ id: 'o8', excludeFromMean: true }),
        ]),
      }),
    );
    expect(storeQuestion()?.scaleMeanEnabled).toBe(true);
  });

  it('기존 질문 UPDATE data 에 평균 산출과 보기의 평균에서 제외가 실린다', async () => {
    seed(radioQuestion(), { added: false });
    render(<QuestionEditModal questionId="q1" isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '척도 평균 켜기' }));
    fireEvent.click(screen.getByRole('button', { name: '모름 제외' }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(updateQuestionMock).toHaveBeenCalled());
    expect(updateQuestionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scaleMeanEnabled: true,
          options: expect.arrayContaining([
            expect.objectContaining({ id: 'o8', excludeFromMean: true }),
          ]),
        }),
      }),
    );
  });

  it('이미 켠 문항을 다시 열어 다른 것을 고치지 않고 저장해도 켜진 채로 간다', async () => {
    seed(radioQuestion({ scaleMeanEnabled: true }), { added: false });
    render(<QuestionEditModal questionId="q1" isOpen onClose={vi.fn()} />);

    expect(screen.getByTestId('scale-mean').textContent).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(updateQuestionMock).toHaveBeenCalled());
    expect(updateQuestionMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scaleMeanEnabled: true }) }),
    );
  });
});
