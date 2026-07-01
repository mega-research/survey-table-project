import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createQuestionMock = vi.hoisted(() => vi.fn());
const updateQuestionMock = vi.hoisted(() => vi.fn());

// QuestionBasicTab 는 표/셀 편집기를 품지만, 보기 옵션 그룹(choiceGroups)은 formData 가 아니라
// 셀 모달의 silentUpdateQuestion 경로로 스토어에 반영된다. 그 경로를 버튼으로 모사한다.
vi.mock('@/components/survey-builder/question-basic-tab', () => {
  return {
    QuestionBasicTab: () => (
      <button
        type="button"
        onClick={() =>
          useSurveyBuilderStore.getState().silentUpdateQuestion('q1', {
            choiceGroups: [
              { id: 'grp-rad1', groupKey: 'rad1', type: 'radio', label: '만족도' },
            ],
          })
        }
      >
        보기 옵션 그룹 지정
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

// 보기 옵션(choice_opt) 셀 1개를 가진 table-source 라디오 질문.
function radioWithChoiceCell(): Question {
  return {
    id: 'q1',
    type: 'radio',
    title: '새 질문',
    required: false,
    order: 1,
    options: [],
    tableTitle: '',
    tableColumns: [{ id: 'c1', label: '①', columnCode: 'c1' }],
    tableRowsData: [
      {
        id: 'r1',
        label: '',
        rowCode: 'r1',
        cells: [
          {
            id: 'cell-1',
            type: 'choice_opt',
            content: '매우 나쁨',
            choiceLabel: '매우 나쁨',
            choiceGroupId: 'grp-rad1',
          },
        ],
      },
    ],
  } as unknown as Question;
}

function seedQuestion(opts: { added: boolean }) {
  useSurveyBuilderStore.getState().setSurvey({
    id: 's1',
    title: 't',
    description: '',
    slug: '',
    privateToken: 'tok',
    groups: [],
    questions: [radioWithChoiceCell()],
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

describe('QuestionEditModal 보기 옵션 그룹(choiceGroups) 저장', () => {
  beforeEach(() => {
    useSurveyBuilderStore.getState().resetSurvey();
    createQuestionMock.mockResolvedValue({ id: 'q1' });
    updateQuestionMock.mockResolvedValue({ id: 'q1' });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('신규 질문 CREATE RPC 페이로드에 choiceGroups 를 전달한다', async () => {
    seedQuestion({ added: true });
    render(<QuestionEditModal questionId="q1" isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '보기 옵션 그룹 지정' }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(createQuestionMock).toHaveBeenCalled());
    expect(createQuestionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        choiceGroups: expect.arrayContaining([
          expect.objectContaining({ groupKey: 'rad1', label: '만족도' }),
        ]),
      }),
    );
  });

  it('신규 질문 CREATE RPC 페이로드에 store-only hideColumnLabels 를 전달한다', async () => {
    seedQuestion({ added: true });
    // "열 라벨 숨기기" 토글은 silentUpdateQuestion 으로 store 에만 쓴다(formData 우회).
    useSurveyBuilderStore.getState().silentUpdateQuestion('q1', { hideColumnLabels: true });
    render(<QuestionEditModal questionId="q1" isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(createQuestionMock).toHaveBeenCalled());
    expect(createQuestionMock).toHaveBeenCalledWith(
      expect.objectContaining({ hideColumnLabels: true }),
    );
  });

  it('기존 질문 UPDATE RPC 페이로드 data 에 choiceGroups 를 전달한다', async () => {
    seedQuestion({ added: false });
    render(<QuestionEditModal questionId="q1" isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '보기 옵션 그룹 지정' }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(updateQuestionMock).toHaveBeenCalled());
    expect(updateQuestionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          choiceGroups: expect.arrayContaining([
            expect.objectContaining({ groupKey: 'rad1', label: '만족도' }),
          ]),
        }),
      }),
    );
  });
});
