/**
 * 보기 그룹 「척도 막대」 폴백 경고 — 셀 편집 모달이 이 셀의 편집 중 값(상세기재·그룹)을 반영한
 * 표로 진단해, 저장 전 토글도 곧바로 경고에 보인다.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SCALE_BAR_FALLBACK_MESSAGES } from '@/features/survey-builder/lib/scale-bar-diagnostics';
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
  mobileScaleBar: true,
};

const scale = ['①', '②', '③', '④', '⑤', '⑥', '⑦'].map((content, n): TableCell => ({
  id: `c${n}`,
  type: 'choice_opt',
  content,
  choiceGroupId: 'g-sat',
}));
const editedCell = scale[6]!;
const rows: TableRow[] = [
  {
    id: 'r1',
    label: '회의실 지원',
    cells: [{ id: 'item', type: 'text', content: '회의실 지원' }, ...scale],
  },
];
const columns: TableColumn[] = Array.from({ length: 8 }, (_, n) => ({ id: `col${n}`, label: '' }));
const ownQuestion: Question = {
  id: 'q1',
  type: 'table',
  title: 'Q',
  required: false,
  order: 1,
  tableColumns: columns,
  tableRowsData: rows,
  choiceGroups: [SAT],
};

function renderModal(groups: ChoiceGroup[] = [SAT]) {
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

describe('CellContentModal — 척도 막대 폴백 경고', () => {
  beforeEach(() => {
    useSurveyBuilderStore.getState().resetSurvey();
  });
  afterEach(() => {
    cleanup();
  });

  it('막대로 그려지는 그룹은 경고가 없다', () => {
    renderModal();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('상세기재를 켜면 저장 전에 바로 이유와 행이 뜬다', () => {
    renderModal();
    const toggle = screen.getByText('선택 시 텍스트 입력 받기').parentElement!;
    fireEvent.click(within(toggle).getByRole('switch'));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(SCALE_BAR_FALLBACK_MESSAGES['text-input']);
    expect(alert).toHaveTextContent('회의실 지원');
  });

  it('보기 모양이 척도 막대가 아니면 경고하지 않는다', () => {
    const { mobileScaleBar: _bar, ...tiles } = SAT;
    renderModal([{ ...tiles, type: 'checkbox' }]);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('복수 선택 그룹에 척도 막대를 고르면 경고한다', () => {
    renderModal([{ ...SAT, type: 'checkbox' }]);
    expect(screen.getByRole('alert')).toHaveTextContent(
      SCALE_BAR_FALLBACK_MESSAGES['not-single-choice'],
    );
  });
});
