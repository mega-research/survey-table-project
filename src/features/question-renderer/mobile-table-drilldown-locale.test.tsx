/**
 * 모바일 표 드릴다운 — 다국어 설문의 현재 언어로 목차 안내·진행 줄·이동 버튼을 그린다.
 * 다국어가 아닌 설문의 글자는 기존 드릴다운 테스트가 지킨다.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { MobileTableDrilldown } from '@/features/question-renderer/mobile-table-drilldown';
import { SurveyLocaleProvider } from '@/features/question-renderer/survey-locale-context';
import type { TableCell, TableColumn, TableRow } from '@/types/survey';
import type { SurveyLocale } from '@/types/survey-locale';

vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => true,
  useMediaQuery: () => true,
}));

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

const columns: TableColumn[] = [
  { id: 'c1', label: 'Job', width: 140 },
  { id: 'c2', label: 'Note', width: 200 },
  { id: 'c3', label: 'Full', width: 80 },
  { id: 'c4', label: 'Part', width: 80 },
];

const text = (id: string, content: string, o: Partial<TableCell> = {}): TableCell => ({
  id,
  type: 'text',
  content,
  ...o,
});
const input = (id: string): TableCell => ({ id, type: 'input', inputType: 'number', content: '' });

const row = (key: string, title: string): TableRow => ({
  id: key,
  label: '',
  cells: [
    text(`${key}-title`, title),
    text(`${key}-desc`, `${title} note`, { mobileDisplay: 'collapsed' }),
    input(`${key}-a`),
    input(`${key}-b`),
  ],
});

const rows: TableRow[] = [row('r1', 'Manager'), row('r2', 'Engineer')];

function renderDrilldown(locale: SurveyLocale) {
  return render(
    <SurveyLocaleProvider locale={locale}>
      <MobileTableDrilldown
        questionId="q1"
        authoredRows={rows}
        displayRows={rows}
        authoredColumns={columns}
        visibleColumns={columns}
        currentResponse={{}}
        hideColumnLabels={false}
        hasDynamicRows={false}
        selectedRowIds={[]}
        groupConfigMap={new Map()}
        detailMode="legacy"
        omitLeadingAuthoredColumns={0}
        value={{}}
        onChange={vi.fn()}
      />
    </SurveyLocaleProvider>,
  );
}

describe('모바일 표 드릴다운 현재 언어', () => {
  it('中文 — 목차 안내와 진행 줄이 중국어다', () => {
    const { container } = renderDrilldown('zh');
    expect(screen.getByText('请选择要填写的项目')).toBeInTheDocument();
    expect(screen.getByText(/^全部/)).toHaveTextContent('全部 0 / 4格');
    expect(container.textContent ?? '').not.toMatch(/[가-힣]/);
  });

  it('English — 섹션에 들어가면 뒤로·다음 섹션 버튼이 영어다', () => {
    const { container } = renderDrilldown('en');
    fireEvent.click(screen.getByRole('button', { name: /Manager/ }));
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Next section/ })).toBeInTheDocument();
    expect(screen.getByText(/^Total/)).toHaveTextContent('Total 0 / 4 fields');
    expect(container.textContent ?? '').not.toMatch(/[가-힣]/);
  });
});
