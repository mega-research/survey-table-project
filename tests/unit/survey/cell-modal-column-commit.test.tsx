/**
 * 회귀: 셀 저장이 tableRowsData 만 DB/스토어에 커밋하고 tableColumns 를 빠뜨리면,
 * 편집 세션 중 열 구조 변경(formData 에만 반영) 후 셀을 저장하고 질문 모달을 취소했을 때
 * 스토어/DB 가 "columns N개 + 행당 셀 N+1개" 혼합 상태가 된다. 재진입 시 편집 그리드가
 * 행마다 한 칸씩 밀리는 스크램블로 나타난다 (2026-08-19 실사고).
 * 셀 저장은 rows 와 함께 에디터 최신 columns(+headerGrid)를 짝으로 커밋해야 한다.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const updateQuestionMock = vi.hoisted(() => vi.fn());

vi.mock('@/features/survey-builder/hooks/use-ensure-survey-in-db', () => ({
  useEnsureSurveyInDb: () => async () => {},
}));
vi.mock('@/features/survey-builder/hooks/use-survey-sync', () => ({
  useSurveySync: () => ({ saveSurvey: vi.fn() }),
}));
vi.mock('@/shared/lib/rpc', () => ({
  client: {
    surveyBuilder: {
      questions: { create: vi.fn(), update: updateQuestionMock },
    },
  },
}));

import { CellContentModal } from '@/features/survey-builder/table-editor/cell-editor/cell-content-modal';
import { useSurveyBuilderStore } from '@/features/survey-builder/stores/survey-store';
import type { HeaderCell, Question, TableCell, TableColumn, TableRow } from '@/types/survey';

const editedCell: TableCell = { id: 'c13', type: 'text', content: '셋째 열 셀' };

// 에디터의 권위 있는 최신 구조: 열 3개 + 행당 셀 3개 (열 추가가 formData 에만 반영된 상태)
const latestColumns: TableColumn[] = [
  { id: 'col-1', label: '열1', width: 150 },
  { id: 'col-2', label: '열2', width: 150 },
  { id: 'col-3', label: '열3', width: 150 },
];
const latestRows: TableRow[] = [
  {
    id: 'r1',
    label: '행1',
    cells: [
      { id: 'c11', type: 'text', content: '' },
      { id: 'c12', type: 'text', content: '' },
      editedCell,
    ],
  },
];
const latestHeaderGrid: HeaderCell[][] = [
  [
    { id: 'h1', label: '헤더', colspan: 3 },
  ],
] as HeaderCell[][];

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
        type: 'table',
        title: '표',
        required: false,
        order: 1,
        // store 는 stale — 열 2개 + 행당 셀 2개 (열 추가 전 상태)
        tableColumns: [
          { id: 'col-1', label: '열1', width: 150 },
          { id: 'col-2', label: '열2', width: 150 },
        ],
        tableRowsData: [
          {
            id: 'r1',
            label: '행1',
            cells: [
              { id: 'c11', type: 'text', content: '' },
              { id: 'c12', type: 'text', content: '' },
            ],
          },
        ],
      },
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
  title: '표',
  required: false,
  order: 1,
  tableRowsData: latestRows,
};

describe('CellContentModal 셀 저장 시 columns/headerGrid 동반 커밋', () => {
  beforeEach(() => {
    useSurveyBuilderStore.getState().resetSurvey();
    updateQuestionMock.mockResolvedValue({ id: 'q1' });
    seedStaleStore();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('에디터 최신 columns 와 headerGrid 를 rows 와 짝으로 DB/스토어에 커밋한다', async () => {
    render(
      <CellContentModal
        isOpen
        onClose={vi.fn()}
        cell={editedCell}
        ownQuestion={stubOwnQuestion}
        currentQuestionId="q1"
        getLatestRows={() => latestRows}
        getLatestColumns={() => latestColumns}
        getLatestHeaderGrid={() => latestHeaderGrid}
        onSave={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(updateQuestionMock).toHaveBeenCalled());
    expect(updateQuestionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tableColumns: latestColumns,
          tableHeaderGrid: latestHeaderGrid,
        }),
      }),
    );

    // 스토어도 같은 짝으로 동기화 — columns 2개 + 셀 3개 혼합 상태가 남으면 안 된다
    const stored = useSurveyBuilderStore
      .getState()
      .currentSurvey.questions.find((q) => q.id === 'q1');
    expect(stored?.tableColumns).toHaveLength(3);
    expect(stored?.tableRowsData?.[0]?.cells).toHaveLength(3);
    expect(stored?.tableHeaderGrid).toEqual(latestHeaderGrid);
  });

  it('신규 질문(create 분기)도 최신 구조를 DB 와 스토어에 함께 반영한다', async () => {
    // 미영속 질문 마킹 — create 분기 진입 조건
    const createMock = vi.fn().mockResolvedValue({ id: 'q1' });
    const { client } = await import('@/shared/lib/rpc');
    (client.surveyBuilder.questions as { create: unknown }).create = createMock;
    useSurveyBuilderStore.setState((state) => ({
      questionChanges: { ...state.questionChanges, added: { q1: true } },
    }));

    render(
      <CellContentModal
        isOpen
        onClose={vi.fn()}
        cell={editedCell}
        ownQuestion={stubOwnQuestion}
        currentQuestionId="q1"
        getLatestRows={() => latestRows}
        getLatestColumns={() => latestColumns}
        getLatestHeaderGrid={() => latestHeaderGrid}
        onSave={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    // DB create 페이로드에 최신 columns/headerGrid + 3셀 행이 실린다
    // (rows 는 셀 코드 재생성 필드가 덧붙어 깊은 비교 대신 구조로 확인)
    const payload = createMock.mock.calls[0]?.[0] as {
      tableColumns: unknown;
      tableHeaderGrid: unknown;
      tableRowsData: { cells: unknown[] }[];
    };
    expect(payload.tableColumns).toEqual(latestColumns);
    expect(payload.tableHeaderGrid).toEqual(latestHeaderGrid);
    expect(payload.tableRowsData[0]?.cells).toHaveLength(3);

    // 스토어도 같은 짝으로 동기화 — 안 하면 취소 후 재진입 시 DB(신 구조)와
    // 스토어(구 구조)가 갈라져 stale 구조가 표시되고 이후 저장이 DB 를 되덮는다
    await waitFor(() => {
      const stored = useSurveyBuilderStore
        .getState()
        .currentSurvey.questions.find((q) => q.id === 'q1');
      expect(stored?.tableColumns).toHaveLength(3);
      expect(stored?.tableRowsData?.[0]?.cells).toHaveLength(3);
      expect(stored?.tableHeaderGrid).toEqual(latestHeaderGrid);
    });
    // create 완료 후 added 해제 — 다음 저장은 UPDATE 경로
    expect(useSurveyBuilderStore.getState().questionChanges.added['q1']).toBeUndefined();
  });

  it('getLatestColumns 미배선(구 호출부)이면 columns 키를 싣지 않는다 — 미변경 규약', async () => {
    render(
      <CellContentModal
        isOpen
        onClose={vi.fn()}
        cell={editedCell}
        ownQuestion={stubOwnQuestion}
        currentQuestionId="q1"
        getLatestRows={() => latestRows}
        onSave={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(updateQuestionMock).toHaveBeenCalled());
    const payload = updateQuestionMock.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect('tableColumns' in payload.data).toBe(false);
    expect('tableHeaderGrid' in payload.data).toBe(false);
  });
});
