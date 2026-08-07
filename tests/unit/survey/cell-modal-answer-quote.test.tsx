/**
 * 셀 모달의 셀 단위 응답 인용 컨트롤.
 *
 * 표 질문에서는 인용 이름을 셀이 소유하므로, 토글이 옵션 관리 헤더(조건부 분기 옆)에 있어야 하고
 * 저장 왕복에서 토글·이름이 살아남아야 한다. 표-소스 선택형 질문(호스트가 radio/checkbox)의
 * 셀들은 응답 페이지에서 inert 라 토글을 노출하지 않는다.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const updateQuestionMock = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/use-ensure-survey-in-db', () => ({
  useEnsureSurveyInDb: () => async () => {},
}));
// 옵션 value 리매핑이 있을 때만 호출되는 설문 저장 플로우 — 이 테스트는 셀 저장 경로만 보므로 stub.
vi.mock('@/hooks/use-survey-sync', () => ({
  useSurveySync: () => ({ saveSurvey: vi.fn() }),
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
import type { Question, QuestionType, TableCell } from '@/types/survey';

function radioCell(overrides: Partial<TableCell> = {}): TableCell {
  return {
    id: 'cellR',
    type: 'radio',
    content: '주로 쓰는 마케팅',
    radioOptions: [
      { id: 'o1', label: '디지털', value: '1', answerQuoteText: '디지털마케팅' },
      { id: 'o2', label: '오프라인', value: '2', answerQuoteText: '오프라인마케팅' },
    ],
    ...overrides,
  };
}

/** 호스트 질문 하나만 든 스토어를 만든다. type 으로 표/표-소스 선택형을 갈아 끼운다. */
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

/** calc 탭 FormulaExprEditor 용 최소 스텁 — 이 테스트들은 계산 탭을 다루지 않는다. */
const stubOwnQuestion: Question = {
  id: 'q1',
  type: 'table',
  title: 'Q',
  required: false,
  order: 1,
  tableRowsData: [],
};

function renderModal(cell: TableCell, onSave: (c: TableCell) => void) {
  return render(
    <CellContentModal
      isOpen
      onClose={vi.fn()}
      cell={cell}
      ownQuestion={stubOwnQuestion}
      currentQuestionId="q1"
      onSave={onSave}
    />,
  );
}

describe('셀 모달 — 셀 단위 응답 인용', () => {
  beforeEach(() => {
    useSurveyBuilderStore.getState().resetSurvey();
    updateQuestionMock.mockResolvedValue({ id: 'q1' });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('표 질문의 라디오 셀에서는 조건부 분기 옆에 응답 인용 토글이 있다', () => {
    const cell = radioCell();
    seedStore('table', cell);
    renderModal(cell, vi.fn());

    expect(screen.getByLabelText('조건부 분기')).toBeInTheDocument();
    expect(screen.getByLabelText('응답 인용')).toBeInTheDocument();
    // 꺼진 상태에서는 이름 입력칸이 없다
    expect(screen.queryByLabelText('인용 이름')).not.toBeInTheDocument();
  });

  it('표-소스 선택형 질문(호스트 radio)의 셀에는 토글을 노출하지 않는다', () => {
    const cell = radioCell();
    seedStore('radio', cell);
    renderModal(cell, vi.fn());

    expect(screen.getByLabelText('조건부 분기')).toBeInTheDocument();
    expect(screen.queryByLabelText('응답 인용')).not.toBeInTheDocument();
  });

  it('토글을 켜고 이름을 입력해 저장하면 셀에 두 필드가 남는다', async () => {
    const cell = radioCell();
    seedStore('table', cell);
    const onSave = vi.fn();
    renderModal(cell, onSave);

    fireEvent.click(screen.getByLabelText('응답 인용'));
    fireEvent.change(screen.getByLabelText('인용 이름'), { target: { value: '마케팅유형' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]![0]).toMatchObject({
      id: 'cellR',
      type: 'radio',
      answerQuoteEnabled: true,
      answerQuoteName: '마케팅유형',
    });
  });

  it('토글을 켜면 옵션별 인용 문구 입력칸이 등장하고, 껐다 켜도 문구는 그대로다', async () => {
    const cell = radioCell();
    seedStore('table', cell);
    const onSave = vi.fn();
    renderModal(cell, onSave);

    fireEvent.click(screen.getByLabelText('응답 인용'));
    const texts = screen.getAllByLabelText('인용 문구') as HTMLInputElement[];
    expect(texts.map((t) => t.value)).toEqual(['디지털마케팅', '오프라인마케팅']);

    // 껐다 켜도 옵션 문구는 폼에 그대로 살아 있어야 한다
    fireEvent.click(screen.getByLabelText('응답 인용'));
    expect(screen.queryAllByLabelText('인용 문구')).toHaveLength(0);
    fireEvent.click(screen.getByLabelText('응답 인용'));
    expect(
      (screen.getAllByLabelText('인용 문구') as HTMLInputElement[]).map((t) => t.value),
    ).toEqual(['디지털마케팅', '오프라인마케팅']);

    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]![0].radioOptions.map((o: { answerQuoteText?: string }) => o.answerQuoteText)).toEqual([
      '디지털마케팅',
      '오프라인마케팅',
    ]);
  });

  it('이름을 지우고 저장하면 이전 이름이 되살아나지 않는다', async () => {
    const cell = radioCell({ answerQuoteEnabled: true, answerQuoteName: '옛이름' });
    seedStore('table', cell);
    const onSave = vi.fn();
    renderModal(cell, onSave);

    const nameInput = screen.getByLabelText('인용 이름') as HTMLInputElement;
    expect(nameInput.value).toBe('옛이름');
    fireEvent.change(nameInput, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]![0]).not.toHaveProperty('answerQuoteName');
  });

  it('input 셀에서는 토글·이름과 함께 셀 인용 문구 입력칸이 나온다', async () => {
    const cell: TableCell = { id: 'cellI', type: 'input', content: '인원' };
    seedStore('table', cell);
    const onSave = vi.fn();
    renderModal(cell, onSave);

    fireEvent.click(screen.getByLabelText('응답 인용'));
    fireEvent.change(screen.getByLabelText('인용 이름'), { target: { value: '인력' } });
    fireEvent.change(screen.getByLabelText('인용 문구'), { target: { value: '{{입력}}명' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]![0]).toMatchObject({
      type: 'input',
      answerQuoteEnabled: true,
      answerQuoteName: '인력',
      answerQuoteText: '{{입력}}명',
    });
  });

  it('질문 노릇을 하는 셀 타입 전부에 토글이 붙는다 (radio/checkbox/select/input/ranking)', () => {
    const cells: TableCell[] = [
      radioCell(),
      { id: 'cellC', type: 'checkbox', content: '', checkboxOptions: [{ id: 'o1', label: 'A', value: '1' }] },
      { id: 'cellS', type: 'select', content: '', selectOptions: [{ id: 'o1', label: 'A', value: '1' }] },
      { id: 'cellI', type: 'input', content: '' },
      { id: 'cellK', type: 'ranking', content: '', rankingOptions: [{ id: 'o1', label: 'A', value: '1' }] },
    ];
    for (const cell of cells) {
      seedStore('table', cell);
      renderModal(cell, vi.fn());
      expect(screen.getByLabelText('응답 인용')).toBeInTheDocument();
      cleanup();
    }
  });

  it('표시 셀(text)에는 토글이 붙지 않는다', () => {
    const cell: TableCell = { id: 'cellT', type: 'text', content: '안내' };
    seedStore('table', cell);
    renderModal(cell, vi.fn());
    expect(screen.queryByLabelText('응답 인용')).not.toBeInTheDocument();
  });

  it('input 셀에서 토글을 켜면 셀 문맥 안내(이 셀에 응답이 있을 때만)가 뜬다', () => {
    const cell: TableCell = { id: 'cellI', type: 'input', content: '인원' };
    seedStore('table', cell);
    renderModal(cell, vi.fn());

    fireEvent.click(screen.getByLabelText('응답 인용'));
    expect(screen.getByText(/이 셀에 응답이 있을 때만 표시/)).toBeInTheDocument();
    // 표 전체 응답 조건은 이 셀 값이 있다는 보장이 아니므로 "이 질문" 문구는 나오면 안 된다
    expect(screen.queryByText(/이 질문에 응답이 있을 때만 표시/)).not.toBeInTheDocument();
  });

  it('라디오 셀에서 토글을 켜면 셀 문맥 안내가 뜬다 (이전에는 안내 자체가 없었다)', () => {
    const cell = radioCell();
    seedStore('table', cell);
    renderModal(cell, vi.fn());

    fireEvent.click(screen.getByLabelText('응답 인용'));
    expect(screen.getByText(/이 셀에 응답이 있을 때만 표시/)).toBeInTheDocument();
  });

  it('순위형 셀에서 토글을 켜면 셀 문맥 안내가 뜬다', () => {
    const cell: TableCell = {
      id: 'cellK',
      type: 'ranking',
      content: '',
      rankingOptions: [{ id: 'o1', label: 'A', value: '1' }],
    };
    seedStore('table', cell);
    renderModal(cell, vi.fn());

    fireEvent.click(screen.getByLabelText('응답 인용'));
    expect(screen.getByText(/이 셀에 응답이 있을 때만 표시/)).toBeInTheDocument();
  });

  it('질문 노릇을 하는 셀 타입 전부에서 토글을 켜면 셀 문맥 안내가 뜬다 (radio/checkbox/select/input/ranking)', () => {
    const cells: TableCell[] = [
      radioCell(),
      { id: 'cellC', type: 'checkbox', content: '', checkboxOptions: [{ id: 'o1', label: 'A', value: '1' }] },
      { id: 'cellS', type: 'select', content: '', selectOptions: [{ id: 'o1', label: 'A', value: '1' }] },
      { id: 'cellI2', type: 'input', content: '' },
      { id: 'cellK2', type: 'ranking', content: '', rankingOptions: [{ id: 'o1', label: 'A', value: '1' }] },
    ];
    for (const cell of cells) {
      seedStore('table', cell);
      renderModal(cell, vi.fn());
      fireEvent.click(screen.getByLabelText('응답 인용'));
      expect(screen.getByText(/이 셀에 응답이 있을 때만 표시/)).toBeInTheDocument();
      cleanup();
    }
  });

  it('인용 이름에 중괄호를 입력해도 토큰이 깨지지 않게 걸러진다', () => {
    const cell = radioCell();
    seedStore('table', cell);
    renderModal(cell, vi.fn());

    fireEvent.click(screen.getByLabelText('응답 인용'));
    const nameInput = screen.getByLabelText('인용 이름') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '{{{마케팅}}}' } });
    expect(nameInput.value).toBe('마케팅');
    expect(screen.getByText('{{{마케팅}}}')).toBeInTheDocument();
  });
});
