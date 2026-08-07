import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const updateQuestionMock = vi.hoisted(() => vi.fn());
const saveSurveyMock = vi.hoisted(() => vi.fn());

// QuestionBasicTab 자체(TipTap/DnD 등)는 별도 컴포넌트 테스트(question-basic-tab-option-code.test.tsx)로
// 이미 검증했다. 이 테스트는 저장(handleSave) 시점의 원자성 — blur 커밋이 store 에 즉시 반영되지
// 않고, Save 를 눌러야만 이 질문의 options 갱신 + 다른 질문의 displayCondition 리매핑이
// 함께 일어나는지 — 를 검증하는 게 목적이라 QuestionBasicTab 은 버튼으로 대체해 blur 커밋을 모사한다.
vi.mock('@/components/survey-builder/question-basic-tab', () => ({
  QuestionBasicTab: (props: {
    formData: { options?: { id: string; value: string; optionCode?: string; isCustomOptionCode?: boolean }[] };
    setFormData: (
      updater: (prev: typeof props.formData) => typeof props.formData,
    ) => void;
    onOptionValueChange?: (change: { oldValue: string; newValue: string }) => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        // 실제 commitOptionCodeAt 과 동일한 두 가지 부수효과: formData 갱신 + 상위 통보.
        props.setFormData((prev) => ({
          ...prev,
          options: (prev.options ?? []).map((o) =>
            o.id === 'o2'
              ? { ...o, value: 'new-value', optionCode: 'new-value', isCustomOptionCode: true }
              : o,
          ),
        }));
        props.onOptionValueChange?.({ oldValue: 'old-value', newValue: 'new-value' });
      }}
    >
      옵션코드 blur 커밋 시뮬레이션
    </button>
  ),
}));

vi.mock('@/components/survey-builder/question-condition-editor', () => ({
  QuestionConditionEditor: () => null,
}));
vi.mock('@/components/survey-builder/table-validation-editor', () => ({
  TableValidationEditor: () => null,
}));
vi.mock('@/hooks/use-ensure-survey-in-db', () => ({
  useEnsureSurveyInDb: () => async () => {},
}));
// 리매핑된 타 질문/그룹은 이 모달의 단일 질문 저장 밖이라, 설문 저장 플로우까지 함께 돌아야 한다.
vi.mock('@/hooks/use-survey-sync', () => ({
  useSurveySync: () => ({ saveSurvey: saveSurveyMock }),
}));
vi.mock('@/shared/lib/rpc', () => ({
  client: {
    surveyBuilder: {
      questions: {
        create: vi.fn(),
        update: updateQuestionMock,
      },
    },
  },
}));
vi.mock('@/lib/image-extractor', () => ({ extractImageUrlsFromQuestion: () => [] }));
vi.mock('@/lib/image-utils', () => ({ deleteImagesFromR2: async () => {} }));

import { QuestionEditModal } from '@/components/survey-builder/question-edit-modal';
import { useSurveyBuilderStore } from '@/stores/survey-store';
import type { Question } from '@/types/survey';

function seedSurvey() {
  const questionA: Question = {
    id: 'qA',
    type: 'radio',
    title: '소스 질문',
    required: false,
    order: 0,
    options: [
      { id: 'o1', label: '옵션1', value: '1', optionCode: '1', isCustomOptionCode: true },
      { id: 'o2', label: '옵션2', value: 'old-value' },
    ],
  };
  const questionB: Question = {
    id: 'qB',
    type: 'radio',
    title: '참조 질문',
    required: false,
    order: 1,
    options: [{ id: 'ob1', label: 'B옵션', value: 'b1' }],
    displayCondition: {
      logicType: 'AND',
      conditions: [
        {
          id: 'cond-1',
          sourceQuestionId: 'qA',
          conditionType: 'value-match',
          requiredValues: ['old-value'],
          logicType: 'AND',
        },
      ],
    },
  };

  useSurveyBuilderStore.getState().setSurvey({
    id: 's1',
    title: 't',
    description: '',
    slug: '',
    privateToken: 'tok',
    groups: [],
    questions: [questionA, questionB],
    lookups: [],
    settings: useSurveyBuilderStore.getState().currentSurvey.settings,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

function requiredValuesOfB(): string[] | undefined {
  return useSurveyBuilderStore
    .getState()
    .currentSurvey.questions.find((q) => q.id === 'qB')?.displayCondition?.conditions[0]
    ?.requiredValues;
}

function optionValueOf(questionId: string, optionId: string): string | undefined {
  return useSurveyBuilderStore
    .getState()
    .currentSurvey.questions.find((q) => q.id === questionId)
    ?.options?.find((o) => o.id === optionId)?.value;
}

describe('QuestionEditModal 옵션 value 변경 → 저장 시점 표시조건 리매핑', () => {
  beforeEach(() => {
    useSurveyBuilderStore.getState().resetSurvey();
    updateQuestionMock.mockResolvedValue({ id: 'qA' });
    saveSurveyMock.mockResolvedValue({ surveyId: 's1' });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('blur 커밋만으로는 store 가 바뀌지 않는다 — 다른 질문의 표시조건도 이 질문의 options 도 그대로', () => {
    seedSurvey();
    render(<QuestionEditModal questionId="qA" isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '옵션코드 blur 커밋 시뮬레이션' }));

    expect(optionValueOf('qA', 'o2')).toBe('old-value');
    expect(requiredValuesOfB()).toEqual(['old-value']);
  });

  it('저장(Save)을 누르면 이 질문의 options 와 다른 질문의 표시조건이 한 번에 반영된다', async () => {
    seedSurvey();
    render(<QuestionEditModal questionId="qA" isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '옵션코드 blur 커밋 시뮬레이션' }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(updateQuestionMock).toHaveBeenCalled());

    expect(optionValueOf('qA', 'o2')).toBe('new-value');
    expect(requiredValuesOfB()).toEqual(['new-value']);
  });

  it('리매핑이 발생하면 설문 저장 플로우까지 함께 트리거해 타 질문 변경을 DB 에 남긴다', async () => {
    seedSurvey();
    render(<QuestionEditModal questionId="qA" isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '옵션코드 blur 커밋 시뮬레이션' }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(saveSurveyMock).toHaveBeenCalledTimes(1));
  });

  it('리매핑이 없으면 설문 저장 플로우를 트리거하지 않는다', async () => {
    seedSurvey();
    render(<QuestionEditModal questionId="qA" isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(updateQuestionMock).toHaveBeenCalled());
    expect(saveSurveyMock).not.toHaveBeenCalled();
  });

  it('저장 없이 모달을 닫으면(취소) 다른 질문의 표시조건은 리매핑되지 않는다', () => {
    seedSurvey();
    const onClose = vi.fn();
    const { rerender } = render(<QuestionEditModal questionId="qA" isOpen onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: '옵션코드 blur 커밋 시뮬레이션' }));
    // 저장 없이 닫기
    rerender(<QuestionEditModal questionId={null} isOpen={false} onClose={onClose} />);

    expect(optionValueOf('qA', 'o2')).toBe('old-value');
    expect(requiredValuesOfB()).toEqual(['old-value']);
  });
});
