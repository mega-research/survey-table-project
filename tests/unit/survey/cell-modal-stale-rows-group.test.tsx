/**
 * 회귀: 셀 모달이 DB 저장/그룹 prune 의 베이스로 store.tableRowsData(편집 중 stale)를
 * 쓰면, 보기 옵션을 만들며 구조를 바꾸는 사이 그룹 멤버를 놓쳐 그룹이 풀린다.
 * getLatestRows(에디터 권위 행)를 우선 사용하면 그룹이 보존돼야 한다.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const updateQuestionMock = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/use-ensure-survey-in-db', () => ({
  useEnsureSurveyInDb: () => async () => {},
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
import type { TableCell, TableRow } from '@/types/survey';

const RAD1 = { id: 'grp-rad1', groupKey: 'rad1', type: 'radio' as const, label: '만족도' };

// 편집 중인 셀(그룹 없음 보기 옵션)
const editedCell: TableCell = {
  id: 'cellC',
  type: 'choice_opt',
  content: '1시간 미만',
  choiceLabel: '1시간 미만',
};

// 에디터의 권위 있는 최신 행: rad1 멤버 cellA/cellB + 편집 셀 cellC
const latestRows: TableRow[] = [
  {
    id: 'r1',
    label: '',
    cells: [
      { id: 'cellA', type: 'choice_opt', content: 'A', choiceLabel: 'A', choiceGroupId: 'grp-rad1' },
      { id: 'cellB', type: 'choice_opt', content: 'B', choiceLabel: 'B', choiceGroupId: 'grp-rad1' },
      editedCell,
    ],
  },
];

function seedStaleStore() {
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
        type: 'radio',
        title: 'Q',
        required: false,
        order: 1,
        // store 의 tableRowsData 는 stale — rad1 멤버 cellA/cellB 가 없다(구조 편집이 formData 에만 반영된 상태)
        tableRowsData: [{ id: 'r1', label: '', cells: [editedCell] }],
        choiceGroups: [RAD1],
      },
    ],
    lookups: [],
    settings: useSurveyBuilderStore.getState().currentSurvey.settings,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
}

describe('CellContentModal stale store rows 그룹 보존', () => {
  beforeEach(() => {
    useSurveyBuilderStore.getState().resetSurvey();
    updateQuestionMock.mockResolvedValue({ id: 'q1' });
    seedStaleStore();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('getLatestRows 기준으로 prune 해 rad1 그룹을 풀지 않고 저장한다', async () => {
    render(
      <CellContentModal
        isOpen
        onClose={vi.fn()}
        cell={editedCell}
        currentQuestionId="q1"
        choiceGroups={[RAD1]}
        getLatestRows={() => latestRows}
        onChoiceGroupsChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(updateQuestionMock).toHaveBeenCalled());
    expect(updateQuestionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          choiceGroups: expect.arrayContaining([
            expect.objectContaining({ groupKey: 'rad1' }),
          ]),
        }),
      }),
    );
  });
});
