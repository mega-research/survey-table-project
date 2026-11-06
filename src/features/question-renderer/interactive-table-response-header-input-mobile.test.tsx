import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { HeaderCell, TableColumn, TableRow } from '@/types/survey';

import { InteractiveTableResponse } from './interactive-table-response';

/**
 * 머리글 입력칸 — 머리글이 없는 모바일 카드 화면은 이름 줄을 그대로 그린다(「기타 원료명」 카드).
 * 머리글을 그리는 모바일 「원본」 표는 데스크톱처럼 올린다.
 */
vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => true,
  useMediaQuery: () => true,
}));
vi.mock('@/features/question-renderer/contact-attrs-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/question-renderer/contact-attrs-context')>()),
  useContactAttrs: () => ({}),
  useAnswerQuotes: () => ({}),
}));

beforeAll(() => {
  if (!HTMLElement.prototype.scrollTo) HTMLElement.prototype.scrollTo = () => {};
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
  { id: 'c-origin', label: '구분', width: 100 },
  { id: 'c-raw', label: '원유', width: 100 },
  { id: 'c-e1', label: '기타1', width: 100 },
];
const rows: TableRow[] = [
  {
    id: 'r-name',
    label: '기타 원료명',
    cells: [
      { id: 'n-label', type: 'text', content: '기타 원료명', colspan: 2 },
      { id: 'n-hidden', type: 'text', content: '', isHidden: true },
      { id: 'name1', type: 'input', content: '', placeholder: '원료명(직접작성)', mobileLabel: '기타1 원료명' },
    ],
  },
  {
    id: 'r-dom',
    label: '국내산',
    cells: [
      { id: 'd-label', type: 'text', content: '국내산' },
      { id: 'd-raw', type: 'input', content: '', inputType: 'number', mobileLabel: '원유' },
      { id: 'd-e1', type: 'input', content: '', inputType: 'number', mobileLabel: '기타1' },
    ],
  },
];
const headerGrid: HeaderCell[][] = [
  [
    { id: 'h-origin', label: '구분', colspan: 1, rowspan: 2 },
    { id: 'h-all', label: '원료 투입량', colspan: 2, rowspan: 1 },
  ],
  [
    { id: 'h-raw', label: '원유', colspan: 1, rowspan: 1 },
    { id: 'h-e1', label: '기타1', colspan: 1, rowspan: 1, inputCellId: 'name1' },
  ],
];

function renderTable(mobileTableDisplayMode: 'item-cards' | 'original') {
  return render(
    <InteractiveTableResponse
      questionId="q1"
      columns={columns}
      rows={rows}
      tableHeaderGrid={headerGrid}
      value={{}}
      onChange={() => {}}
      enableSticky={false}
      mobileTableDisplayMode={mobileTableDisplayMode}
    />,
  );
}

describe('머리글 입력칸 — 모바일', () => {
  it('항목 단위 카드는 이름 줄을 「기타 원료명」 카드로 그린다', () => {
    renderTable('item-cards');
    expect(screen.getByText('기타 원료명')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('원료명(직접작성)')).toBeInTheDocument();
  });

  it('원본 표는 데스크톱처럼 머리글에 올리고 이름 줄을 뺀다', () => {
    renderTable('original');
    expect(screen.queryByText('기타 원료명')).not.toBeInTheDocument();
    const header = document.querySelector('[role="columnheader"][data-cell-id="name1"]');
    expect(header?.querySelector('input')).not.toBeNull();
  });
});
