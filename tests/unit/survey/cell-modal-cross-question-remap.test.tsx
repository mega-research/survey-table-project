/**
 * 셀 옵션 value 변경의 cross-question 표시조건 리매핑 회귀 테스트.
 *
 * 셀 저장(cell-content-modal handleSave)은 questions.update 로 새 옵션 value 가 담긴
 * tableRowsData 를 DB 에 즉시 커밋한다 — 여기가 비가역 지점이다. 따라서 이 표 질문을
 * sourceQuestionId 로 참조하는 다른 질문/그룹/행/열의 표시조건
 * (table-cell-check 의 expectedValues 는 셀 옵션 value 공간) 리매핑을 질문 편집 모달의
 * 저장까지 미루면, "셀 저장 → 질문 모달 취소" 경로에서 DB 에 신 value + 구 조건이
 * 영구 잔류하고 old→new 매핑도 소실된다(질문 모달의 취소 롤백은 tableRowsData 를
 * 되돌리지 않는다). 그래서 리매핑과 그 영속(saveSurvey)은 셀 저장 커밋 지점에서 끝낸다.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const updateQuestionMock = vi.hoisted(() => vi.fn());
const saveSurveyMock = vi.hoisted(() => vi.fn());

const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock('sonner', () => ({
  toast: { error: toastErrorMock, success: vi.fn(), info: vi.fn() },
}));

vi.mock('@/hooks/use-ensure-survey-in-db', () => ({
  useEnsureSurveyInDb: () => async () => {},
}));
vi.mock('@/hooks/use-survey-sync', () => ({
  useSurveySync: () => ({ saveSurveyScoped: saveSurveyMock }),
}));
vi.mock('@/shared/lib/rpc', () => ({
  client: {
    surveyBuilder: {
      questions: { create: vi.fn(), update: updateQuestionMock },
    },
  },
}));

import { CellContentModal } from '@/components/survey-builder/cell-content-modal';
import { useSurveyBuilderStore } from '@/stores/survey-store';
import type { Question, TableCell } from '@/types/survey';

const TABLE_QUESTION_ID = 'q-table';

function radioCell(): TableCell {
  return {
    id: 'cellR',
    type: 'radio',
    content: '',
    radioOptions: [
      { id: 'o1', label: 'A', value: 'option-1', optionCode: '1', isCustomOptionCode: true },
      { id: 'o2', label: 'B', value: 'option-2' },
    ],
  };
}

const tableQuestion: Question = {
  id: TABLE_QUESTION_ID,
  type: 'table',
  title: '표 질문',
  required: false,
  order: 0,
  tableRowsData: [{ id: 'r1', label: '', cells: [radioCell()] }],
};

function seedStore() {
  const otherQuestion: Question = {
    id: 'q-other',
    type: 'radio',
    title: '참조 질문',
    required: false,
    order: 1,
    displayCondition: {
      logicType: 'AND',
      conditions: [
        {
          id: 'cond-1',
          sourceQuestionId: TABLE_QUESTION_ID,
          conditionType: 'table-cell-check',
          tableConditions: {
            rowIds: ['r1'],
            cellColumnIndex: 0,
            checkType: 'any',
            expectedValues: ['option-2'],
          },
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
    questions: [tableQuestion, otherQuestion],
    lookups: [],
    settings: useSurveyBuilderStore.getState().currentSurvey.settings,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

function expectedValuesOfOther(): string[] | undefined {
  return useSurveyBuilderStore
    .getState()
    .currentSurvey.questions.find((q) => q.id === 'q-other')?.displayCondition?.conditions[0]
    ?.tableConditions?.expectedValues;
}

function renderCellModal() {
  return render(
    <CellContentModal
      isOpen
      onClose={vi.fn()}
      cell={radioCell()}
      ownQuestion={tableQuestion}
      currentQuestionId={TABLE_QUESTION_ID}
      onSave={vi.fn()}
    />,
  );
}

/** 변수번호(optionCode) Input 을 blur 로 커밋한다. index 는 radioOptions 배열 순서. */
function commitCode(index: number, code: string) {
  const input = screen.getAllByPlaceholderText('코드')[index]!;
  fireEvent.change(input, { target: { value: code } });
  fireEvent.blur(input);
}

describe('셀 모달 — 셀 저장 시점의 cross-question 표시조건 리매핑', () => {
  beforeEach(() => {
    useSurveyBuilderStore.getState().resetSurvey();
    updateQuestionMock.mockResolvedValue({ id: TABLE_QUESTION_ID });
    saveSurveyMock.mockResolvedValue({ surveyId: 's1' });
    seedStore();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('셀 저장만으로 타 질문의 table-cell-check expectedValues 가 리매핑된다 (질문 모달 저장 불필요)', async () => {
    renderCellModal();

    commitCode(1, '5'); // o2: option-2 -> 5
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    // tableRowsData 가 DB 에 커밋되는 바로 그 흐름에서 조건도 함께 옮겨간다
    await waitFor(() => expect(updateQuestionMock).toHaveBeenCalled());
    await waitFor(() => expect(expectedValuesOfOther()).toEqual(['5']));
  });

  it('셀 저장 시 리매핑이 있으면 설문 저장 플로우까지 트리거해 타 질문 변경을 영속시킨다', async () => {
    renderCellModal();

    commitCode(1, '5');
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(saveSurveyMock).toHaveBeenCalledTimes(1));
    // 스코프 저장: 리매핑된 질문만 대상, 그룹 미변경이면 메타데이터 미포함
    expect(saveSurveyMock).toHaveBeenCalledWith({
      questionIds: ['q-other'],
      includeMetadata: false,
    });
  });

  it('리매핑 저장 실패 시 토스트로 사용자에게 알린다 (무음 실패 금지)', async () => {
    toastErrorMock.mockClear();
    saveSurveyMock.mockRejectedValueOnce(new Error('network'));
    renderCellModal();

    commitCode(1, '5');
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(saveSurveyMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        '조건 리매핑 저장에 실패했습니다. 설문 저장 버튼으로 다시 저장해 주세요.',
      ),
    );
  });

  it('value 변경이 없는 셀 저장은 리매핑도 설문 저장도 트리거하지 않는다', async () => {
    renderCellModal();

    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(updateQuestionMock).toHaveBeenCalled());
    expect(saveSurveyMock).not.toHaveBeenCalled();
    expect(expectedValuesOfOther()).toEqual(['option-2']);
  });

  it('충돌로 value 동기화가 보류된 코드 입력은 리매핑을 일으키지 않는다', async () => {
    renderCellModal();

    commitCode(1, '1'); // o1 의 optionCode 와 충돌 -> valueChange 없음
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(updateQuestionMock).toHaveBeenCalled());
    expect(saveSurveyMock).not.toHaveBeenCalled();
    expect(expectedValuesOfOther()).toEqual(['option-2']);
  });
});
