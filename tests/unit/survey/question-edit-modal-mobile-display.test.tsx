import { useState } from 'react';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { deleteImagesFromR2Mock, extractImageUrlsFromQuestionMock } = vi.hoisted(() => ({
  deleteImagesFromR2Mock: vi.fn(),
  extractImageUrlsFromQuestionMock: vi.fn(),
}));

vi.mock('@/components/survey-builder/question-basic-tab', () => ({
  QuestionBasicTab: () => null,
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
vi.mock('@/shared/lib/rpc', () => ({ client: {} }));
vi.mock('@/lib/image-extractor', () => ({
  extractImageUrlsFromQuestion: extractImageUrlsFromQuestionMock,
}));
vi.mock('@/lib/image-utils', () => ({ deleteImagesFromR2: deleteImagesFromR2Mock }));

import { QuestionEditModal } from '@/components/survey-builder/question-edit-modal';
import { useSurveyBuilderStore } from '@/stores/survey-store';

function seedSurvey() {
  useSurveyBuilderStore.getState().setSurvey({
    id: 's1',
    title: 't',
    description: '',
    slug: '',
    privateToken: 'tok',
    groups: [],
    questions: [{
      id: 'q1',
      surveyId: 's1',
      type: 'table',
      title: '표 질문',
      required: false,
      order: 0,
      tableColumns: [],
      tableRowsData: [],
      mobileTableDisplayMode: 'original',
    }],
    lookups: [],
    settings: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
}

function getQuestion() {
  return useSurveyBuilderStore.getState().currentSurvey.questions.find((question) => question.id === 'q1');
}

function ModalHarness() {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <QuestionEditModal
      questionId={isOpen ? 'q1' : null}
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
    />
  );
}

describe('QuestionEditModal 모바일 표시 설정 롤백', () => {
  beforeEach(() => {
    seedSurvey();
    extractImageUrlsFromQuestionMock.mockReturnValue([]);
    deleteImagesFromR2Mock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('편집기에서 변경한 값을 취소하면 undefined를 포함한 원래값을 정확히 복원한다', () => {
    render(<ModalHarness />);

    const originalQuestion = getQuestion();
    expect(originalQuestion?.mobileTableDisplayMode).toBe('original');
    expect(originalQuestion?.mobileDrilldownOmitLeadingColumns).toBeUndefined();
    expect(Object.hasOwn(originalQuestion ?? {}, 'mobileDrilldownOmitLeadingColumns')).toBe(false);

    // DynamicTableEditor가 두 필드를 store에 즉시 쓰는 경로를 재현한다.
    act(() => {
      useSurveyBuilderStore.getState().silentUpdateQuestion('q1', {
        mobileTableDisplayMode: 'drilldown-original-row',
        mobileDrilldownOmitLeadingColumns: 2,
      });
    });

    expect(getQuestion()?.mobileTableDisplayMode).toBe('drilldown-original-row');
    expect(getQuestion()?.mobileDrilldownOmitLeadingColumns).toBe(2);

    fireEvent.click(screen.getByRole('button', { name: '취소' }));

    const restoredQuestion = getQuestion();
    expect(restoredQuestion?.mobileTableDisplayMode).toBe('original');
    expect(restoredQuestion?.mobileDrilldownOmitLeadingColumns).toBeUndefined();
    expect(Object.hasOwn(restoredQuestion ?? {}, 'mobileDrilldownOmitLeadingColumns')).toBe(false);
  });

  it('외부 비동기 저장이 실패한 뒤 취소해도 모바일 설정을 원래값으로 복원한다', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    extractImageUrlsFromQuestionMock
      .mockReturnValueOnce([])
      .mockReturnValueOnce(['/old-image.png']);
    deleteImagesFromR2Mock.mockRejectedValueOnce(new Error('이미지 삭제 실패'));
    render(<ModalHarness />);

    act(() => {
      useSurveyBuilderStore.getState().silentUpdateQuestion('q1', {
        mobileTableDisplayMode: 'drilldown-original-row',
        mobileDrilldownOmitLeadingColumns: 2,
      });
    });

    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => {
      expect(deleteImagesFromR2Mock).toHaveBeenCalledWith(['/old-image.png']);
      expect(screen.getByRole('button', { name: '취소' })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole('button', { name: '취소' }));

    const restoredQuestion = getQuestion();
    expect(restoredQuestion?.mobileTableDisplayMode).toBe('original');
    expect(restoredQuestion?.mobileDrilldownOmitLeadingColumns).toBeUndefined();
    expect(Object.hasOwn(restoredQuestion ?? {}, 'mobileDrilldownOmitLeadingColumns')).toBe(false);
    expect(consoleError).toHaveBeenCalledWith('저장 중 오류가 발생했습니다:', expect.any(Error));
  });
});
