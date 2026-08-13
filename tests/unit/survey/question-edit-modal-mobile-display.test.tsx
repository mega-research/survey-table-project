import { useState } from 'react';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  ensureSurveyMock,
  createQuestionMock,
  updateQuestionMock,
} = vi.hoisted(() => ({
  ensureSurveyMock: vi.fn(),
  createQuestionMock: vi.fn(),
  updateQuestionMock: vi.fn(),
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
  useEnsureSurveyInDb: () => ensureSurveyMock,
}));
// 옵션 value 리매핑이 있을 때만 호출되는 설문 저장 플로우 — 이 테스트는 렌더/저장 경로만 보므로 stub.
vi.mock('@/hooks/use-survey-sync', () => ({
  useSurveySync: () => ({ saveSurvey: vi.fn() }),
}));
vi.mock('@/shared/lib/rpc', () => ({
  client: {
    surveyBuilder: {
      questions: { create: createQuestionMock, update: updateQuestionMock },
    },
  },
}));
import { QuestionEditModal } from '@/components/survey-builder/question-edit-modal';
import { useSurveyBuilderStore } from '@/stores/survey-store';

function seedSurvey({ withMobileMode = true }: { withMobileMode?: boolean } = {}) {
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
      ...(withMobileMode ? { mobileTableDisplayMode: 'original' as const } : {}),
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
    ensureSurveyMock.mockResolvedValue(undefined);
    createQuestionMock.mockResolvedValue({ id: 'q1' });
    updateQuestionMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('편집기에서 변경한 값을 취소하면 undefined를 포함한 원래값을 정확히 복원한다', () => {
    render(<ModalHarness />);

    const originalQuestion = getQuestion();
    expect(originalQuestion?.mobileTableDisplayMode).toBe('original');
    expect(originalQuestion?.mobileDrilldownOmitLeadingColumns).toBeUndefined();
    expect(originalQuestion?.mobileDrilldownRepeatHeaderStartRow).toBeUndefined();
    expect(originalQuestion?.mobileDrilldownRepeatHeaderEndRow).toBeUndefined();
    expect(Object.hasOwn(originalQuestion ?? {}, 'mobileDrilldownOmitLeadingColumns')).toBe(false);

    // DynamicTableEditor가 두 필드를 store에 즉시 쓰는 경로를 재현한다.
    act(() => {
      useSurveyBuilderStore.getState().silentUpdateQuestion('q1', {
        mobileTableDisplayMode: 'row-wise-original',
        mobileDrilldownOmitLeadingColumns: 2,
        mobileDrilldownRepeatHeaderStartRow: 2,
        mobileDrilldownRepeatHeaderEndRow: 3,
      });
    });

    expect(getQuestion()?.mobileTableDisplayMode).toBe('row-wise-original');
    expect(getQuestion()?.mobileDrilldownOmitLeadingColumns).toBe(2);
    expect(getQuestion()?.mobileDrilldownRepeatHeaderStartRow).toBe(2);
    expect(getQuestion()?.mobileDrilldownRepeatHeaderEndRow).toBe(3);

    fireEvent.click(screen.getByRole('button', { name: '취소' }));

    const restoredQuestion = getQuestion();
    expect(restoredQuestion?.mobileTableDisplayMode).toBe('original');
    expect(restoredQuestion?.mobileDrilldownOmitLeadingColumns).toBeUndefined();
    expect(restoredQuestion?.mobileDrilldownRepeatHeaderStartRow).toBeUndefined();
    expect(restoredQuestion?.mobileDrilldownRepeatHeaderEndRow).toBeUndefined();
    expect(Object.hasOwn(restoredQuestion ?? {}, 'mobileDrilldownOmitLeadingColumns')).toBe(false);
  });

  // 참고: 기존에는 저장 시 previousImages/unusedImages diff 로 R2 이미지를 즉시
  // 삭제했고, 그 삭제 실패가 저장 실패→취소 롤백 경로의 트리거였다. R2 삭제 제거
  // (2026-07-27 orphan 감사)로 해당 트리거가 사라져 이 테스트 케이스를 제거했다.
  // 저장 실패→취소 롤백 자체는 아래 updateQuestion/createQuestion RPC 실패 테스트가 계속 커버한다.

  it('반복 헤더를 지운 null/null을 저장 payload와 store에 유지한다', async () => {
    render(<ModalHarness />);

    act(() => {
      useSurveyBuilderStore.getState().silentUpdateQuestion('q1', {
        mobileDrilldownRepeatHeaderStartRow: null,
        mobileDrilldownRepeatHeaderEndRow: null,
      });
    });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(updateQuestionMock).toHaveBeenCalled());
    expect(getQuestion()?.mobileDrilldownRepeatHeaderStartRow).toBeNull();
    expect(getQuestion()?.mobileDrilldownRepeatHeaderEndRow).toBeNull();
  });

  it('Ctrl/Cmd+S는 저장하지 않고 Escape는 모달을 닫지 않는다', () => {
    render(<ModalHarness />);
    expect(screen.queryByText('저장: Ctrl+S')).toBeNull();
    expect(screen.queryByText('닫기: ESC')).toBeNull();

    fireEvent.keyDown(document, { key: 's', ctrlKey: true });
    fireEvent.keyDown(document, { key: 's', metaKey: true });

    expect(ensureSurveyMock).not.toHaveBeenCalled();
    expect(updateQuestionMock).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('button', { name: '취소' })).toBeInTheDocument();
  });

  it('ensureSurvey 실패는 모달을 닫지 않고 취소 시 absent 모바일 필드를 정확히 복원한다', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    seedSurvey({ withMobileMode: false });
    ensureSurveyMock.mockRejectedValueOnce(new Error('설문 확보 실패'));
    render(<ModalHarness />);

    act(() => {
      useSurveyBuilderStore.getState().silentUpdateQuestion('q1', {
        mobileTableDisplayMode: 'drilldown-original-row',
        mobileDrilldownOmitLeadingColumns: 2,
      });
    });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => {
      expect(ensureSurveyMock).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: '취소' })).toBeEnabled();
    });
    expect(consoleError).toHaveBeenCalledWith('질문 저장/업데이트 실패:', expect.any(Error));

    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    const restored = getQuestion();
    expect(Object.hasOwn(restored ?? {}, 'mobileTableDisplayMode')).toBe(false);
    expect(Object.hasOwn(restored ?? {}, 'mobileDrilldownOmitLeadingColumns')).toBe(false);
  });

  it('기존 질문 update RPC 실패는 모달을 닫지 않고 취소 롤백을 허용한다', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    updateQuestionMock.mockRejectedValueOnce(new Error('질문 업데이트 실패'));
    render(<ModalHarness />);

    act(() => {
      useSurveyBuilderStore.getState().silentUpdateQuestion('q1', {
        mobileTableDisplayMode: 'drilldown-original-row',
        mobileDrilldownOmitLeadingColumns: 2,
      });
    });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => {
      expect(updateQuestionMock).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: '취소' })).toBeEnabled();
    });
    expect(consoleError).toHaveBeenCalledWith('질문 저장/업데이트 실패:', expect.any(Error));

    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(getQuestion()?.mobileTableDisplayMode).toBe('original');
    expect(Object.hasOwn(getQuestion() ?? {}, 'mobileDrilldownOmitLeadingColumns')).toBe(false);
  });

  it('새 질문 create RPC 실패는 모달을 닫지 않고 취소 롤백을 허용한다', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    createQuestionMock.mockRejectedValueOnce(new Error('질문 생성 실패'));
    useSurveyBuilderStore.setState((state) => ({
      questionChanges: {
        ...state.questionChanges,
        added: { ...state.questionChanges.added, q1: true },
      },
    }));
    render(<ModalHarness />);

    act(() => {
      useSurveyBuilderStore.getState().silentUpdateQuestion('q1', {
        mobileTableDisplayMode: 'drilldown-original-row',
        mobileDrilldownOmitLeadingColumns: 2,
      });
    });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => {
      expect(createQuestionMock).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: '취소' })).toBeEnabled();
    });
    expect(consoleError).toHaveBeenCalledWith('질문 저장/업데이트 실패:', expect.any(Error));

    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(getQuestion()?.mobileTableDisplayMode).toBe('original');
    expect(Object.hasOwn(getQuestion() ?? {}, 'mobileDrilldownOmitLeadingColumns')).toBe(false);
  });
});
