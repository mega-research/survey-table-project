import type { Dispatch, SetStateAction } from 'react';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createQuestionMock = vi.hoisted(() => vi.fn());
const updateQuestionMock = vi.hoisted(() => vi.fn());

/**
 * QuestionBasicTab 을 formData 조작 버튼으로 대체한다.
 * 실제 탭은 TipTap/표 에디터를 품어 무겁고, 여기서 검증하려는 건 UI 가 아니라
 * "formData 에 실린 응답 인용 값이 저장 페이로드까지 도달하는가" 이기 때문이다.
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
            answerQuoteEnabled: true,
            answerQuoteName: '마케팅유형',
          }))
        }
      >
        인용 켜기
      </button>
      <button
        type="button"
        onClick={() => setFormData((prev) => ({ ...prev, answerQuoteEnabled: false }))}
      >
        인용 끄기
      </button>
      <button
        type="button"
        onClick={() =>
          setFormData((prev) => ({
            ...prev,
            options: (prev.options ?? []).map((option, index) =>
              index === 0 ? { ...option, answerQuoteText: '전기차를' } : option,
            ),
          }))
        }
      >
        옵션 문구 입력
      </button>
      <span data-testid="quote-enabled">{String(formData.answerQuoteEnabled ?? '')}</span>
      <span data-testid="quote-name">{formData.answerQuoteName ?? ''}</span>
      <span data-testid="option-quote">{formData.options?.[0]?.answerQuoteText ?? ''}</span>
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
vi.mock('@/lib/image-utils', () => ({ deleteImagesFromR2: async () => {} }));

import { QuestionEditModal } from '@/features/survey-builder/question-edit/question-edit-modal';
import { useSurveyBuilderStore } from '@/features/survey-builder/stores/survey-store';
import type { Question } from '@/types/survey';

function radioQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    type: 'radio',
    title: '어떤 차를 타십니까',
    required: false,
    order: 1,
    options: [
      { id: 'o1', label: '전기차', value: '1' },
      { id: 'o2', label: '내연기관차', value: '2' },
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

describe('QuestionEditModal 응답 인용 저장 왕복', () => {
  beforeEach(() => {
    useSurveyBuilderStore.getState().resetSurvey();
    createQuestionMock.mockResolvedValue({ id: 'q1' });
    updateQuestionMock.mockResolvedValue({ id: 'q1' });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('신규 질문 CREATE 페이로드에 인용 토글·이름·옵션 문구를 전달한다', async () => {
    seed(radioQuestion(), { added: true });
    render(<QuestionEditModal questionId="q1" isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '인용 켜기' }));
    fireEvent.click(screen.getByRole('button', { name: '옵션 문구 입력' }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(createQuestionMock).toHaveBeenCalled());
    expect(createQuestionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        answerQuoteEnabled: true,
        answerQuoteName: '마케팅유형',
        options: expect.arrayContaining([
          expect.objectContaining({ id: 'o1', answerQuoteText: '전기차를' }),
        ]),
      }),
    );
  });

  it('기존 질문 UPDATE 페이로드 data 에 인용 토글·이름·옵션 문구를 전달한다', async () => {
    seed(radioQuestion(), { added: false });
    render(<QuestionEditModal questionId="q1" isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '인용 켜기' }));
    fireEvent.click(screen.getByRole('button', { name: '옵션 문구 입력' }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(updateQuestionMock).toHaveBeenCalled());
    expect(updateQuestionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          answerQuoteEnabled: true,
          answerQuoteName: '마케팅유형',
          options: expect.arrayContaining([
            expect.objectContaining({ id: 'o1', answerQuoteText: '전기차를' }),
          ]),
        }),
      }),
    );
    // 스토어에도 반영되어야 설문 일괄 저장(survey-save)이 같은 값을 싣는다.
    expect(storeQuestion()?.answerQuoteEnabled).toBe(true);
    expect(storeQuestion()?.answerQuoteName).toBe('마케팅유형');
  });

  it('저장된 값을 hydrate 해, 인용을 건드리지 않고 다시 저장해도 값이 살아남는다', async () => {
    // formData hydrate 누락 시 UPDATE data 에서 키가 통째로 빠져 "화면엔 보이는데
    // 새로고침하면 사라지는" silent drop 이 된다 — 그 회귀를 잠그는 테스트.
    seed(
      radioQuestion({
        answerQuoteEnabled: true,
        answerQuoteName: '마케팅유형',
        options: [
          { id: 'o1', label: '전기차', value: '1', answerQuoteText: '전기차를' },
          { id: 'o2', label: '내연기관차', value: '2' },
        ],
      } as Partial<Question>),
      { added: false },
    );
    render(<QuestionEditModal questionId="q1" isOpen onClose={vi.fn()} />);

    expect(screen.getByTestId('quote-enabled')).toHaveTextContent('true');
    expect(screen.getByTestId('quote-name')).toHaveTextContent('마케팅유형');
    expect(screen.getByTestId('option-quote')).toHaveTextContent('전기차를');

    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(updateQuestionMock).toHaveBeenCalled());
    expect(updateQuestionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          answerQuoteEnabled: true,
          answerQuoteName: '마케팅유형',
          options: expect.arrayContaining([
            expect.objectContaining({ id: 'o1', answerQuoteText: '전기차를' }),
          ]),
        }),
      }),
    );
  });

  it('토글을 꺼도 옵션별 인용 문구는 지워지지 않는다', async () => {
    seed(
      radioQuestion({
        answerQuoteEnabled: true,
        answerQuoteName: '마케팅유형',
        options: [
          { id: 'o1', label: '전기차', value: '1', answerQuoteText: '전기차를' },
          { id: 'o2', label: '내연기관차', value: '2' },
        ],
      } as Partial<Question>),
      { added: false },
    );
    render(<QuestionEditModal questionId="q1" isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '인용 끄기' }));
    expect(screen.getByTestId('option-quote')).toHaveTextContent('전기차를');

    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(updateQuestionMock).toHaveBeenCalled());
    expect(updateQuestionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          answerQuoteEnabled: false,
          answerQuoteName: '마케팅유형',
          options: expect.arrayContaining([
            expect.objectContaining({ id: 'o1', answerQuoteText: '전기차를' }),
          ]),
        }),
      }),
    );
  });
});
