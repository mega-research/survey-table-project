import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createQuestionMock = vi.hoisted(() => vi.fn());
const updateQuestionMock = vi.hoisted(() => vi.fn());

// 문항 사이의 중복 불가 묶음(distinctGroup)은 편집 칸이 없어 formData 가 소유하지 않는다 — 스크립트로 적은 값이
// 모달을 열어 저장하는 것만으로 지워지면 안 된다. 탭 본문은 이 테스트와 무관해 비운다.
vi.mock('@/features/survey-builder/question-edit/question-basic-tab', () => ({
  QuestionBasicTab: () => null,
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

const leaveQuestion = {
  id: 'q1',
  type: 'radio',
  title: '문 3-10. 만족스러운 휴가제도',
  required: true,
  order: 1,
  options: [
    { id: 'o1', label: '1. 특별휴가', value: '1' },
    { id: 'o2', label: '2. 병가', value: '2' },
  ],
  distinctGroup: 'leave',
} as unknown as Question;

function seed(opts: { added: boolean }) {
  useSurveyBuilderStore.getState().setSurvey({
    id: 's1',
    title: 't',
    description: '',
    slug: '',
    privateToken: 'tok',
    groups: [],
    questions: [leaveQuestion],
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

const storeGroup = () =>
  useSurveyBuilderStore.getState().currentSurvey.questions.find((q) => q.id === 'q1')
    ?.distinctGroup;

describe('QuestionEditModal — 문항 사이의 중복 불가 묶음 보존', () => {
  beforeEach(() => {
    useSurveyBuilderStore.getState().resetSurvey();
    createQuestionMock.mockResolvedValue({ id: 'q1' });
    updateQuestionMock.mockResolvedValue({ id: 'q1' });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('기존 문항을 열어 저장해도 묶음 이름을 지우는 값이 실리지 않고 스토어에 남는다', async () => {
    seed({ added: false });
    render(<QuestionEditModal questionId="q1" isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(updateQuestionMock).toHaveBeenCalled());
    const data = updateQuestionMock.mock.calls[0]![0].data as Partial<Question>;
    // 부분 수정이라 싣지 않으면 서버가 그대로 둔다 — null·빈 글자가 실리면 지워진다
    expect(data.distinctGroup === undefined || data.distinctGroup === 'leave').toBe(true);
    expect(storeGroup()).toBe('leave');
  });

  it('아직 저장되지 않은 문항(복제본)을 열어 저장하면 CREATE 에 묶음 이름이 실린다', async () => {
    seed({ added: true });
    render(<QuestionEditModal questionId="q1" isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(createQuestionMock).toHaveBeenCalled());
    expect(createQuestionMock).toHaveBeenCalledWith(
      expect.objectContaining({ distinctGroup: 'leave' }),
    );
    expect(storeGroup()).toBe('leave');
  });
});
