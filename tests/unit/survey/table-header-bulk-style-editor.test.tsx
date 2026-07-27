import { cleanup, render, screen } from '@testing-library/react';
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

async function applyBoldBlueHeaderStyle() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '헤더 일괄 스타일' }));
  await user.click(screen.getByRole('switch', { name: '텍스트 굵게' }));
  await user.clear(screen.getByRole('textbox', { name: 'HEX 색상' }));
  await user.type(screen.getByRole('textbox', { name: 'HEX 색상' }), '#ddeeff');
  await user.click(screen.getByRole('button', { name: '전체 헤더에 적용' }));
}

function renderEditor(editor: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{editor}</QueryClientProvider>);
}

describe('DynamicTableEditor 전체 헤더 스타일', () => {
  afterEach(() => {
    cleanup();
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
    expect(onTableChange.mock.calls.at(-1)?.[0]).not.toHaveProperty('tableHeaderGrid');
  });

});
