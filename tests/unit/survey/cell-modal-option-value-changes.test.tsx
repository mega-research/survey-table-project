/**
 * 셀 모달의 pendingOptionValueChangesRef 누적/리셋 회귀 테스트 (Task 3 코드리뷰 Important 대응).
 *
 * 위험 지점: CellChoiceEditor 의 blur 커밋(onOptionValueChange)이 cell-content-modal 의
 * ref 에 여러 번 쌓이고, 저장 시 onSave 의 두 번째 인자로 그대로 실려나가야 한다. 또한 이
 * ref 는 [isOpen, cell?.id] 이펙트로만 리셋되므로(모달 컴포넌트 자체는 isOpen 토글에도
 * 언마운트되지 않는다 — 부모가 selectedCellContext 로 감싸 유지), 모달을 닫았다 다시 열면
 * 이전 세션의 pending 이 새 세션으로 새면 안 된다.
 *
 * CellChoiceEditor 쪽 끝(blur → onOptionValueChange)과 updateCell 쪽 끝(remapGatingValues)은
 * 이미 각각 단위/통합 테스트가 있다 — 여기서는 그 사이를 잇는 cell-content-modal 의 글루
 * 코드(ref 누적 + 리셋 타이밍)를 실제 컴포넌트 렌더로 검증한다.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/use-ensure-survey-in-db', () => ({
  useEnsureSurveyInDb: () => async () => {},
}));
vi.mock('@/shared/lib/rpc', () => ({
  client: {
    surveyBuilder: {
      questions: { create: vi.fn(), update: vi.fn().mockResolvedValue({ id: 'q1' }) },
    },
  },
}));

import { CellContentModal } from '@/components/survey-builder/cell-content-modal';
import { useSurveyBuilderStore } from '@/stores/survey-store';
import type { Question, TableCell } from '@/types/survey';

function radioCell(overrides: Partial<TableCell> = {}): TableCell {
  return {
    id: 'cellR',
    type: 'radio',
    content: '',
    radioOptions: [
      { id: 'o1', label: 'A', value: 'option-1', optionCode: '1', isCustomOptionCode: true },
      { id: 'o2', label: 'B', value: 'option-2' },
      { id: 'o3', label: 'C', value: 'option-3' },
    ],
    ...overrides,
  };
}

function seedStore(cell: TableCell) {
  useSurveyBuilderStore.getState().setSurvey({
    id: 's1',
    title: 't',
    description: '',
    slug: '',
    privateToken: 'tok',
    groups: [],
    questions: [
      {
        id: 'q1',
        type: 'table',
        title: 'Q',
        required: false,
        order: 1,
        tableRowsData: [{ id: 'r1', label: '', cells: [cell] }],
      } as unknown as Question,
    ],
    lookups: [],
    settings: useSurveyBuilderStore.getState().currentSurvey.settings,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
}

const stubOwnQuestion: Question = {
  id: 'q1',
  type: 'table',
  title: 'Q',
  required: false,
  order: 1,
  tableRowsData: [],
};

/** 변수번호(optionCode) Input 을 blur 로 커밋한다. index 는 radioOptions 배열 순서. */
function commitCode(index: number, code: string) {
  const input = screen.getAllByPlaceholderText('코드')[index]!;
  fireEvent.change(input, { target: { value: code } });
  fireEvent.blur(input);
}

describe('셀 모달 — 옵션 value 변경 누적(pendingOptionValueChangesRef)', () => {
  beforeEach(() => {
    useSurveyBuilderStore.getState().resetSurvey();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('서로 다른 옵션을 두 번 blur 커밋하면 onSave 에 두 변경 쌍이 순서대로 전달된다', async () => {
    const cell = radioCell();
    seedStore(cell);
    const onSave = vi.fn();
    render(
      <CellContentModal
        isOpen
        onClose={vi.fn()}
        cell={cell}
        ownQuestion={stubOwnQuestion}
        currentQuestionId="q1"
        onSave={onSave}
      />,
    );

    commitCode(1, '5'); // o2: option-2 -> 5
    commitCode(2, '9'); // o3: option-3 -> 9
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]![1]).toEqual([
      { oldValue: 'option-2', newValue: '5' },
      { oldValue: 'option-3', newValue: '9' },
    ]);
  });

  it('같은 옵션을 연속으로 두 번 수정하면 순차 변경 쌍이 그대로 누적된다', async () => {
    const cell = radioCell();
    seedStore(cell);
    const onSave = vi.fn();
    render(
      <CellContentModal
        isOpen
        onClose={vi.fn()}
        cell={cell}
        ownQuestion={stubOwnQuestion}
        currentQuestionId="q1"
        onSave={onSave}
      />,
    );

    commitCode(1, '5'); // o2: option-2 -> 5
    commitCode(1, '9'); // o2(같은 옵션): 5 -> 9 (직전 커밋 결과가 base)
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]![1]).toEqual([
      { oldValue: 'option-2', newValue: '5' },
      { oldValue: '5', newValue: '9' },
    ]);
  });

  it('충돌로 valueChange 가 없는 커밋은 누적되지 않는다', async () => {
    const cell = radioCell();
    seedStore(cell);
    const onSave = vi.fn();
    render(
      <CellContentModal
        isOpen
        onClose={vi.fn()}
        cell={cell}
        ownQuestion={stubOwnQuestion}
        currentQuestionId="q1"
        onSave={onSave}
      />,
    );

    commitCode(1, '1'); // o2 코드를 o1 의 optionCode('1')와 충돌시킴 -> valueChange null
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]![1]).toBeUndefined();
  });

  it('모달을 닫았다 같은 셀로 다시 열면 이전 세션의 pending 이 새 세션으로 새지 않는다', async () => {
    const cell = radioCell();
    seedStore(cell);
    const onSave = vi.fn();
    const { rerender } = render(
      <CellContentModal
        isOpen
        onClose={vi.fn()}
        cell={cell}
        ownQuestion={stubOwnQuestion}
        currentQuestionId="q1"
        onSave={onSave}
      />,
    );

    commitCode(1, '5'); // o2: option-2 -> 5 (저장 전 pending 에 쌓임)

    // 저장하지 않고 모달을 닫는다 — 부모(dynamic-table-editor)는 CellContentModal 을
    // 언마운트하지 않고 isOpen 만 false 로 내린다(selectedCellContext 는 유지).
    rerender(
      <CellContentModal
        isOpen={false}
        onClose={vi.fn()}
        cell={cell}
        ownQuestion={stubOwnQuestion}
        currentQuestionId="q1"
        onSave={onSave}
      />,
    );
    // 다시 같은 셀로 연다 — hydrate 도 다시 일어나 옵션 코드가 원래 상태로 돌아온다.
    rerender(
      <CellContentModal
        isOpen
        onClose={vi.fn()}
        cell={cell}
        ownQuestion={stubOwnQuestion}
        currentQuestionId="q1"
        onSave={onSave}
      />,
    );

    // 새 세션에서 추가 편집 없이 바로 저장 — 이전 세션의 pending 이 남아있다면
    // onSave 두 번째 인자에 {oldValue:'option-2', newValue:'5'} 가 실려나갈 것이다.
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]![1]).toBeUndefined();
  });
});
