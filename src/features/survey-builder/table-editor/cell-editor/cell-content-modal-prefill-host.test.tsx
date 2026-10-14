/**
 * 셀 모달의 prefill 설정은 호스트 문항 유형을 탄다.
 *
 * prefill 은 테이블 유형 문항의 input 셀에만 깔린다. 보기·순위 문항의 내장 표는 input 셀을
 * 사이드카 입력칸으로 그려 템플릿을 깔지 않으므로, 거기에 설정을 내놓으면 켜도 아무 일이 없는
 * 죽은 설정이 된다(셀 단위 응답 인용 토글과 같은 규칙). 이미 적힌 템플릿은 지울 수 있어야 한다.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSurveyBuilderStore } from '@/features/survey-builder/stores/survey-store';
import { CellContentModal } from '@/features/survey-builder/table-editor/cell-editor/cell-content-modal';
import type { Question, QuestionType, TableCell } from '@/types/survey';

vi.mock('@/features/survey-builder/hooks/use-ensure-survey-in-db', () => ({
  useEnsureSurveyInDb: () => async () => {},
}));
vi.mock('@/features/survey-builder/hooks/use-survey-sync', () => ({
  useSurveySync: () => ({ saveSurvey: vi.fn() }),
}));
vi.mock('@/shared/lib/rpc', () => ({
  client: { surveyBuilder: { questions: { create: vi.fn(), update: vi.fn() } } },
}));

function inputCell(overrides: Partial<TableCell> = {}): TableCell {
  return { id: 'cellI', type: 'input', content: '', ...overrides } as TableCell;
}

/** 호스트 질문 하나만 든 스토어 — type 으로 표/보기 소스 표를 갈아 끼운다. */
function seedStore(hostType: QuestionType, cell: TableCell) {
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
        type: hostType,
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

/** 표 편집기가 넘기는 ownQuestion 은 호스트와 무관하게 type 이 늘 'table' 이다. */
const stubOwnQuestion: Question = {
  id: 'q1',
  type: 'table',
  title: 'Q',
  required: false,
  order: 1,
  tableRowsData: [],
};

function renderModal(hostType: QuestionType, cell: TableCell) {
  seedStore(hostType, cell);
  return render(
    <CellContentModal
      isOpen
      onClose={vi.fn()}
      cell={cell}
      ownQuestion={stubOwnQuestion}
      currentQuestionId="q1"
      onSave={vi.fn()}
    />,
  );
}

describe('셀 모달 — prefill 설정과 호스트 문항 유형', () => {
  beforeEach(() => {
    useSurveyBuilderStore.getState().resetSurvey();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('테이블 유형 문항에서는 prefill 칸과 「응답자가 고칠 수 있게」가 나온다', () => {
    renderModal('table', inputCell({ defaultValueTemplate: '{{회사}}' }));

    expect(screen.getByLabelText(/응답값 prefill/)).toHaveValue('{{회사}}');
    expect(screen.getByLabelText('응답자가 고칠 수 있게')).toBeInTheDocument();
  });

  it('보기 문항의 내장 표에서는 prefill 설정을 내놓지 않는다', () => {
    renderModal('radio', inputCell());

    expect(screen.queryByLabelText(/응답값 prefill/)).toBeNull();
    expect(screen.queryByLabelText('응답자가 고칠 수 있게')).toBeNull();
  });

  it('보기 문항의 내장 표에 이미 적힌 템플릿은 지울 수 있게 칸과 경고만 보인다', () => {
    renderModal('checkbox', inputCell({ defaultValueTemplate: '{{회사}}', prefillEditable: true }));

    expect(screen.getByLabelText(/응답값 prefill/)).toHaveValue('{{회사}}');
    expect(
      screen.getByText(/보기·순위 문항의 표에서는 prefill 이 채워지지 않습니다/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('응답자가 고칠 수 있게')).toBeNull();
  });
});
