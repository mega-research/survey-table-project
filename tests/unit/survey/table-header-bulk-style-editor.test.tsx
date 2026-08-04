import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/stores/survey-store', () => ({
  useSurveyBuilderStore: <T,>(selector: (state: {
    currentSurvey: { questions: never[] };
    silentUpdateQuestion: () => void;
  }) => T) => selector({
    currentSurvey: { questions: [] },
    silentUpdateQuestion: () => {},
  }),
}));

vi.mock('@/stores/ui-store', () => ({
  useSurveyUIStore: <T,>(selector: (state: { editingQuestionId: string | null }) => T) =>
    selector({ editingQuestionId: null }),
}));

import { DynamicTableEditor } from '@/components/survey-builder/dynamic-table-editor';
import { HeaderBulkStyleButton } from '@/components/survey-builder/header-bulk-style-button';
import { useTableEditor } from '@/components/survey-builder/hooks/use-table-editor';
import type { HeaderCell, TableColumn, TableRow } from '@/types/survey';

const columns: TableColumn[] = [
  { id: 'col-1', label: '첫째 열', width: 150 },
  { id: 'col-2', label: '둘째 열', width: 150 },
];

const rows: TableRow[] = [{
  id: 'row-1',
  label: '첫째 행',
  cells: [
    { id: 'cell-1-1', content: '', type: 'text' },
    { id: 'cell-1-2', content: '', type: 'text' },
  ],
}];

const mergedHeaderGrid: HeaderCell[][] = [
  [{ id: 'header-1', label: '상위 헤더', colspan: 2, rowspan: 1 }],
  [
    { id: 'header-2', label: '첫째 하위 헤더', colspan: 1, rowspan: 1 },
    { id: 'header-3', label: '둘째 하위 헤더', colspan: 1, rowspan: 1 },
  ],
];

async function applyBoldBlueHeaderStyle(user = userEvent.setup()) {
  await user.click(screen.getByRole('button', { name: '헤더 일괄 스타일' }));
  await user.click(screen.getByRole('switch', { name: '텍스트 굵게' }));
  await user.clear(screen.getByRole('textbox', { name: '배경색 HEX' }));
  await user.type(screen.getByRole('textbox', { name: '배경색 HEX' }), '#ddeeff');
  await user.click(screen.getByRole('button', { name: '전체 헤더에 적용' }));
}

function renderEditor(editor: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{editor}</QueryClientProvider>);
}

function TableEditorHarness({
  onTableChange,
}: {
  onTableChange: (data: {
    tableTitle: string;
    tableColumns: TableColumn[];
    tableRowsData: TableRow[];
    tableHeaderGrid: HeaderCell[][] | null;
  }) => void;
}) {
  const { state, actions } = useTableEditor({ columns, rows, onTableChange });

  return (
    <>
      <output data-testid="current-row-label">{state.currentRows[0]?.label}</output>
      <button type="button" onClick={() => actions.updateTitle('새 제목')}>
        제목 변경
      </button>
      <button type="button" onClick={() => actions.updateRowLabel(0, '변경된 행 라벨')}>
        행 라벨 변경
      </button>
      <button
        type="button"
        onClick={() => actions.applyHeaderStyle({ textBold: true, backgroundColor: '#DDEEFF', textColor: '' })}
      >
        헤더 스타일 적용
      </button>
    </>
  );
}

describe('DynamicTableEditor 전체 헤더 스타일', () => {
  afterEach(() => {
    cleanup();
    if (vi.isFakeTimers()) {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
    vi.clearAllMocks();
  });

  it('기본 헤더와 병합된 다단계 헤더 모두에 스타일을 저장한다', async () => {
    const onTableChange = vi.fn();
    renderEditor(
      <DynamicTableEditor
        columns={columns}
        rows={rows}
        tableHeaderGrid={mergedHeaderGrid}
        onTableChange={onTableChange}
      />,
    );

    await applyBoldBlueHeaderStyle();

    expect(onTableChange).toHaveBeenLastCalledWith(expect.objectContaining({
      tableColumns: expect.arrayContaining([
        expect.objectContaining({ textBold: true, backgroundColor: '#DDEEFF' }),
      ]),
      tableHeaderGrid: expect.arrayContaining([
        expect.arrayContaining([
          expect.objectContaining({ textBold: true, backgroundColor: '#DDEEFF' }),
        ]),
      ]),
    }));
  });

  it('다단계 헤더가 없으면 기본 열만 스타일을 저장한다', async () => {
    const onTableChange = vi.fn();
    renderEditor(
      <DynamicTableEditor columns={columns} rows={rows} onTableChange={onTableChange} />,
    );

    await applyBoldBlueHeaderStyle();

    expect(onTableChange).toHaveBeenLastCalledWith(expect.objectContaining({
      tableColumns: expect.arrayContaining([
        expect.objectContaining({ textBold: true, backgroundColor: '#DDEEFF' }),
      ]),
    }));
    // 다단계 헤더 없음은 키 생략이 아니라 명시적 null 이다 — 키를 빼면 상위
    // 저장 경로가 "미변경"으로 읽어 해제가 유실된다.
    expect(onTableChange.mock.calls.at(-1)?.[0].tableHeaderGrid).toBeNull();
  });

  it('열이 없으면 전체 헤더 스타일 버튼을 비활성화한다', () => {
    render(<HeaderBulkStyleButton columnCount={0} onOpen={() => {}} />);

    expect(screen.getByRole('button', { name: '헤더 일괄 스타일' })).toBeDisabled();
  });

  it('보류된 제목 debounce가 스타일 저장을 이전 열 스냅샷으로 덮어쓰지 않는다', () => {
    vi.useFakeTimers();
    const onTableChange = vi.fn();
    render(<TableEditorHarness onTableChange={onTableChange} />);

    fireEvent.click(screen.getByRole('button', { name: '제목 변경' }));
    expect(onTableChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '헤더 스타일 적용' }));
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(onTableChange).toHaveBeenCalledTimes(1);
    expect(onTableChange).toHaveBeenLastCalledWith(expect.objectContaining({
      tableTitle: '새 제목',
      tableColumns: expect.arrayContaining([
        expect.objectContaining({ textBold: true, backgroundColor: '#DDEEFF' }),
      ]),
    }));
  });

  it('보류된 행 라벨 편집을 flush해 화면 state와 스타일 저장 payload를 최신화한다', () => {
    const onTableChange = vi.fn();
    render(<TableEditorHarness onTableChange={onTableChange} />);

    fireEvent.click(screen.getByRole('button', { name: '행 라벨 변경' }));
    fireEvent.click(screen.getByRole('button', { name: '헤더 스타일 적용' }));

    expect(screen.getByTestId('current-row-label')).toHaveTextContent('변경된 행 라벨');
    expect(onTableChange).toHaveBeenCalledTimes(1);
    expect(onTableChange).toHaveBeenLastCalledWith(expect.objectContaining({
      tableRowsData: [expect.objectContaining({ label: '변경된 행 라벨' })],
      tableColumns: expect.arrayContaining([
        expect.objectContaining({ textBold: true, backgroundColor: '#DDEEFF' }),
      ]),
    }));
  });

});
