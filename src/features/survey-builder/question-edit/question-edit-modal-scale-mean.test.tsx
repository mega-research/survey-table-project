import type { Dispatch, SetStateAction } from 'react';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QuestionEditModal } from '@/features/survey-builder/question-edit/question-edit-modal';
import { useSurveyBuilderStore } from '@/features/survey-builder/stores/survey-store';
import type { Question } from '@/types/survey';

const createQuestionMock = vi.hoisted(() => vi.fn());
const updateQuestionMock = vi.hoisted(() => vi.fn());

/**
 * QuestionBasicTab 을 formData 조작 버튼으로 대체한다. 보려는 것은 둘이다.
 * - 보기의 「평균에서 제외」는 빌더 소유라 저장 페이로드까지 도달해야 한다(formData ↔ store
 *   이중 상태가 설정을 조용히 잃던 전례가 있다).
 * - 「평균 산출」(scaleMeanEnabled)은 콘솔 「척도 평균」 화면 소유라 빌더 저장이 싣지 않는다 —
 *   열어 둔 옛 빌더 탭이 저장하며 콘솔에서 바꾼 값을 되돌리면 안 된다.
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

describe('QuestionEditModal 척도 평균 저장 경계', () => {
  beforeEach(() => {
    useSurveyBuilderStore.getState().resetSurvey();
    createQuestionMock.mockResolvedValue({ id: 'q1' });
    updateQuestionMock.mockResolvedValue({ id: 'q1' });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('신규 질문 CREATE 에 보기의 평균에서 제외가 실리고 평균 산출은 싣지 않는다', async () => {
    seed(radioQuestion(), { added: true });
    render(<QuestionEditModal questionId="q1" isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '모름 제외' }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(createQuestionMock).toHaveBeenCalled());
    const payload = createQuestionMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload['options']).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'o8', excludeFromMean: true })]),
    );
    expect(payload).not.toHaveProperty('scaleMeanEnabled');
  });

  it('기존 질문 UPDATE data 에 보기의 평균에서 제외가 실리고 평균 산출은 싣지 않는다', async () => {
    seed(radioQuestion({ scaleMeanEnabled: true }), { added: false });
    render(<QuestionEditModal questionId="q1" isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '모름 제외' }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(updateQuestionMock).toHaveBeenCalled());
    const { data } = updateQuestionMock.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(data['options']).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'o8', excludeFromMean: true })]),
    );
    expect(data).not.toHaveProperty('scaleMeanEnabled');
  });

  it('저장 뒤에도 빌더 스토어는 불러온 평균 산출 값을 그대로 들고 있다 — 보기 체크 표시 판정용', async () => {
    seed(radioQuestion({ scaleMeanEnabled: true }), { added: false });
    render(<QuestionEditModal questionId="q1" isOpen onClose={vi.fn()} />);

    expect(screen.getByTestId('scale-mean').textContent).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(updateQuestionMock).toHaveBeenCalled());
    expect(storeQuestion()?.scaleMeanEnabled).toBe(true);
  });
});
