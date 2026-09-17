import type { Dispatch, SetStateAction } from 'react';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createQuestionMock = vi.hoisted(() => vi.fn());
const updateQuestionMock = vi.hoisted(() => vi.fn());

/**
 * 제목 편집기를 로컬 상태 조작 버튼으로 대체한다 — 실제 탭처럼 localTitle/localTitleHtml 만 바꾸고
 * formData 에는 쓰지 않는다. 그래야 "debounce 가 끝나기 전에 저장해도 평문·서식본이 함께 실린다"
 * 는 저장 직전 flush 경로를 본다. 둘이 따로 가면 한쪽만 옛 값으로 남는다.
 */
vi.mock('@/features/survey-builder/question-edit/question-basic-tab', () => ({
  QuestionBasicTab: ({
    localTitle,
    localTitleHtml,
    setLocalTitle,
    setLocalTitleHtml,
  }: {
    localTitle: string;
    localTitleHtml: string;
    setLocalTitle: Dispatch<SetStateAction<string>>;
    setLocalTitleHtml: Dispatch<SetStateAction<string>>;
  }) => (
    <div>
      <button
        type="button"
        onClick={() => {
          setLocalTitle('A4. 공급처');
          setLocalTitleHtml('<p>A4. <strong>공급처</strong></p>');
        }}
      >
        굵게 적용
      </button>
      <button
        type="button"
        onClick={() => {
          setLocalTitle('A4. 공급처');
          setLocalTitleHtml('<p>A4. 공급처</p>');
        }}
      >
        서식 지우기
      </button>
      <span data-testid="local-title">{localTitle}</span>
      <span data-testid="local-title-html">{localTitleHtml}</span>
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

function textQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    type: 'text',
    title: 'A4. 공급처',
    required: false,
    order: 1,
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

describe('QuestionEditModal 제목 서식 저장 왕복', () => {
  beforeEach(() => {
    useSurveyBuilderStore.getState().resetSurvey();
    createQuestionMock.mockResolvedValue({ id: 'q1' });
    updateQuestionMock.mockResolvedValue({ id: 'q1' });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('신규 질문 CREATE 에 평문 제목과 서식본이 함께 실린다', async () => {
    seed(textQuestion(), { added: true });
    render(<QuestionEditModal questionId="q1" isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '굵게 적용' }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(createQuestionMock).toHaveBeenCalled());
    expect(createQuestionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'A4. 공급처',
        titleHtml: '<p>A4. <strong>공급처</strong></p>',
      }),
    );
  });

  it('기존 질문 UPDATE 에도 함께 실리고 스토어에 반영된다', async () => {
    seed(textQuestion(), { added: false });
    render(<QuestionEditModal questionId="q1" isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '굵게 적용' }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(updateQuestionMock).toHaveBeenCalled());
    expect(updateQuestionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'A4. 공급처',
          titleHtml: '<p>A4. <strong>공급처</strong></p>',
        }),
      }),
    );
    expect(storeQuestion()?.titleHtml).toBe('<p>A4. <strong>공급처</strong></p>');
  });

  it('서식을 모두 지우면 서식본을 null 로 저장한다', async () => {
    seed(textQuestion({ titleHtml: '<p>A4. <strong>공급처</strong></p>' }), { added: false });
    render(<QuestionEditModal questionId="q1" isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '서식 지우기' }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(updateQuestionMock).toHaveBeenCalled());
    expect(updateQuestionMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ titleHtml: null }) }),
    );
  });

  it('저장된 서식본을 hydrate 해, 손대지 않고 다시 저장해도 살아남는다', async () => {
    seed(textQuestion({ titleHtml: '<p>A4. <u>공급처</u></p>' }), { added: false });
    render(<QuestionEditModal questionId="q1" isOpen onClose={vi.fn()} />);

    expect(screen.getByTestId('local-title-html')).toHaveTextContent('<p>A4. <u>공급처</u></p>');
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(updateQuestionMock).toHaveBeenCalled());
    expect(updateQuestionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ titleHtml: '<p>A4. <u>공급처</u></p>' }),
      }),
    );
  });

  it('평문과 어긋난 옛 서식본은 불러오지 않고, 저장하면 지운다', async () => {
    seed(textQuestion({ titleHtml: '<p><strong>바뀌기 전 제목</strong></p>' }), { added: false });
    render(<QuestionEditModal questionId="q1" isOpen onClose={vi.fn()} />);

    expect(screen.getByTestId('local-title-html')).toHaveTextContent('');
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(updateQuestionMock).toHaveBeenCalled());
    expect(updateQuestionMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ titleHtml: null }) }),
    );
  });
});
