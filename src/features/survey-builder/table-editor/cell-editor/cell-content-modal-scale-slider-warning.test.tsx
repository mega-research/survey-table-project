/**
 * 보기 그룹 「척도 슬라이더」 폴백 경고 — 셀 편집 모달이 이 셀의 편집 중 값(상세기재·그룹)을 반영한
 * 표로 진단해, 저장 전 토글도 곧바로 경고에 보인다. 척도 막대 경고와 같은 방식이다.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SCALE_SLIDER_FALLBACK_MESSAGES } from '@/features/survey-builder/lib/scale-slider-diagnostics';
import { useSurveyBuilderStore } from '@/features/survey-builder/stores/survey-store';
import { CellContentModal } from '@/features/survey-builder/table-editor/cell-editor/cell-content-modal';
import type { ChoiceGroup, Question, TableCell, TableColumn, TableRow } from '@/types/survey';

vi.mock('@/features/survey-builder/hooks/use-ensure-survey-in-db', () => ({
  useEnsureSurveyInDb: () => async () => {},
}));
vi.mock('@/features/survey-builder/hooks/use-survey-sync', () => ({
  useSurveySync: () => ({ saveSurvey: vi.fn() }),
}));
vi.mock('@/shared/lib/rpc', () => ({
  client: { surveyBuilder: { questions: { create: vi.fn(), update: vi.fn() } } },
}));

const SAT: ChoiceGroup = {
  id: 'g-sat',
  groupKey: 'rad1',
  type: 'radio',
  label: '만족도',
  scaleSlider: 'positive-right',
};

const scaleCells = (rowId: string): TableCell[] =>
  ['①', '②', '③', '④', '⑤'].map((content, n) => ({
    id: `${rowId}-c${n}`,
    type: 'choice_opt',
    content,
    choiceGroupId: 'g-sat',
  }));
const firstRowCells = scaleCells('r1');
const editedCell = firstRowCells[4]!;
const columns: TableColumn[] = Array.from({ length: 6 }, (_, n) => ({ id: `col${n}`, label: '' }));

const oneRow: TableRow[] = [
  {
    id: 'r1',
    label: '회의실 지원',
    cells: [{ id: 'r1-item', type: 'text', content: '회의실 지원' }, ...firstRowCells],
  },
];
const twoRows: TableRow[] = [
  ...oneRow,
  {
    id: 'r2',
    label: '교통비 지원',
    cells: [{ id: 'r2-item', type: 'text', content: '교통비 지원' }, ...scaleCells('r2')],
  },
];

function renderModal(rows: TableRow[], groups: ChoiceGroup[] = [SAT]) {
  const ownQuestion: Question = {
    id: 'q1',
    type: 'table',
    title: 'Q',
    required: false,
    order: 1,
    tableColumns: columns,
    tableRowsData: rows,
    choiceGroups: groups,
  };
  render(
    <CellContentModal
      isOpen
      onClose={vi.fn()}
      cell={editedCell}
      ownQuestion={ownQuestion}
      currentQuestionId="q1"
      choiceGroups={groups}
      getLatestRows={() => rows}
      getLatestColumns={() => columns}
      onChoiceGroupsChange={vi.fn()}
      onSave={vi.fn()}
    />,
  );
}

const turnOnTextInput = () => {
  const toggle = screen.getByText('선택 시 텍스트 입력 받기').parentElement!;
  fireEvent.click(within(toggle).getByRole('switch'));
};

describe('CellContentModal — 척도 슬라이더 폴백 경고', () => {
  beforeEach(() => {
    useSurveyBuilderStore.getState().resetSurvey();
  });
  afterEach(() => {
    cleanup();
  });

  it('슬라이더로 그려지는 묶음은 경고가 없다', () => {
    renderModal(twoRows);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('상세기재를 켜면 저장 전에 바로 이유와 행이 뜬다 — 다른 행은 그려지므로 화면은 바뀐다', () => {
    renderModal(twoRows);
    turnOnTextInput();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(SCALE_SLIDER_FALLBACK_MESSAGES['text-input']);
    expect(alert).toHaveTextContent('행: 회의실 지원');
    expect(alert).not.toHaveTextContent('교통비 지원');
    expect(alert).not.toHaveTextContent('화면은 바뀌지 않습니다');
  });

  it('하나뿐인 행이 폴백이면 화면이 바뀌지 않는다는 한 줄이 함께 뜬다', () => {
    renderModal(oneRow);
    turnOnTextInput();
    expect(screen.getByRole('alert')).toHaveTextContent('이 표의 화면은 바뀌지 않습니다');
  });

  it('보기 모양이 척도 슬라이더가 아니면 경고하지 않는다', () => {
    const { scaleSlider: _direction, ...tiles } = SAT;
    renderModal(oneRow, [tiles]);
    turnOnTextInput();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('다른 모양에서 척도 슬라이더로 바꾸면 그 자리에서 진단한다', () => {
    const { scaleSlider: _direction, ...tiles } = SAT;
    renderModal(oneRow, [tiles]);
    turnOnTextInput();
    fireEvent.click(screen.getByRole('button', { name: '척도 슬라이더' }));
    expect(screen.getByRole('alert')).toHaveTextContent(SCALE_SLIDER_FALLBACK_MESSAGES['text-input']);
  });
});
