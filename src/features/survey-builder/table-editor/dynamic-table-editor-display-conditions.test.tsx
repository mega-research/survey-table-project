import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DynamicTableEditor } from '@/features/survey-builder/table-editor/dynamic-table-editor';
import type { TableColumn, TableRow } from '@/types/survey';

vi.mock('@/features/survey-builder/stores/survey-store', () => ({
  useSurveyBuilderStore: <T,>(
    selector: (state: {
      currentSurvey: { questions: { id: string }[] };
      silentUpdateQuestion: () => void;
    }) => T,
  ) =>
    selector({
      // 조건부 표시 메뉴는 설문에 문항이 있을 때만 나온다
      currentSurvey: { questions: [{ id: 'other' }] },
      silentUpdateQuestion: () => {},
    }),
}));

vi.mock('@/features/survey-builder/stores/ui-store', () => ({
  useSurveyUIStore: <T,>(selector: (state: { editingQuestionId: string | null }) => T) =>
    selector({ editingQuestionId: null }),
}));

// 순위형 내장 표 — 순위 응답 화면은 행·열 표시조건과 동적 행을 읽지 않는다. 빌더가 설정을 받으면
// 화면에는 아무 일도 없는데 저작자는 걸려 있다고 믿는다. 그래서 설정 입구를 내지 않는다.

const columns: TableColumn[] = [
  { id: 'col-1', label: '항목', width: 150 },
  { id: 'col-2', label: '보기', width: 150 },
];
const rows: TableRow[] = [
  {
    id: 'row-1',
    label: '첫째 행',
    cells: [
      { id: 'c11', content: '항목', type: 'text' },
      { id: 'c12', content: '', type: 'ranking_opt' },
    ],
  },
];

function renderEditor(props: Partial<Parameters<typeof DynamicTableEditor>[0]>) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <DynamicTableEditor columns={columns} rows={rows} onTableChange={() => {}} {...props} />
    </QueryClientProvider>,
  );
}

describe('DynamicTableEditor — 표시조건·동적 행 입구', () => {
  it('기본은 행·열 조건부 표시와 동적 행 그룹을 낸다', () => {
    renderEditor({ onDynamicRowConfigsChange: () => {} });
    fireEvent.click(screen.getByTitle('행 설정'));
    expect(screen.getByRole('button', { name: /조건부 표시/ })).toBeInTheDocument();
    expect(screen.getByText('동적 행 그룹')).toBeInTheDocument();
  });

  it('표시조건을 막으면 행 메뉴에 조건부 표시가 없다', () => {
    renderEditor({ allowDisplayConditions: false });
    fireEvent.click(screen.getByTitle('행 설정'));
    expect(screen.queryByRole('button', { name: /조건부 표시/ })).toBeNull();
  });

  it('표시조건을 막으면 열 메뉴에 조건부 표시가 없다', () => {
    renderEditor({ allowDisplayConditions: false });
    fireEvent.click(screen.getAllByTitle('열 설정')[0]!);
    expect(screen.queryByRole('button', { name: /조건부 표시/ })).toBeNull();
  });

  it('동적 행 핸들러를 주지 않으면 동적 행 그룹 카드를 그리지 않는다', () => {
    renderEditor({});
    expect(screen.queryByText('동적 행 그룹')).toBeNull();
  });
});
