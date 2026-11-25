import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import type { HeaderCell, TableColumn, TableRow } from '@/types/survey';

import { InteractiveTableResponse } from './interactive-table-response';
import { TablePreview } from './table-preview';

/**
 * 머리글 글자의 공백 — 줄바꿈과 연속 공백을 적은 그대로 그린다(「•     •     •」). 본문 글자 칸과 같은 규칙이고,
 * 응답 화면과 미리보기가 같은 값이어야 편집 화면에서 본 간격이 그대로 나온다. jsdom 은 배치를 계산하지 않으므로
 * 글자가 DOM 에 그대로 실리는지와 공백을 살리는 클래스를 본다.
 */
beforeAll(() => {
  if (!HTMLElement.prototype.scrollTo) HTMLElement.prototype.scrollTo = () => {};
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

const DOTS = '•     •     •';
const columns: TableColumn[] = [
  { id: 'c0', label: '전혀 만족하지 않음', width: 120 },
  { id: 'c1', label: DOTS, width: 240 },
  { id: 'c2', label: '매우\n만족함', width: 120 },
];
const rows: TableRow[] = [
  { id: 'r1', label: '', cells: columns.map((_, n) => ({ id: `r1-c${n}`, type: 'text', content: String(n + 1) })) },
];
const grid: HeaderCell[][] = [columns.map((column, n) => ({ id: `h${n}`, label: column.label, colspan: 1, rowspan: 1 }))];

const surfaces = [
  {
    name: '응답 화면',
    draw: (headerGrid?: HeaderCell[][]) =>
      render(
        <InteractiveTableResponse
          questionId="q1"
          columns={columns}
          rows={rows}
          tableHeaderGrid={headerGrid}
          value={{}}
          onChange={() => {}}
          enableSticky={false}
        />,
      ),
  },
  {
    name: '미리보기',
    draw: (headerGrid?: HeaderCell[][]) =>
      render(<TablePreview columns={columns} rows={rows} tableHeaderGrid={headerGrid} />),
  },
];

describe.each(surfaces)('머리글 글자의 공백 — $name', ({ draw }) => {
  it.each([
    ['다단 헤더', grid],
    ['한 줄 머리글', undefined],
  ])('%s — 연속 공백과 줄바꿈을 적은 그대로 싣고 공백을 살려 그린다', (_name, headerGrid) => {
    draw(headerGrid);
    const headers = screen.getAllByRole('columnheader');
    expect(headers.map((el) => el.textContent)).toEqual(columns.map((column) => column.label));
    for (const header of headers) {
      expect(header).toHaveClass('whitespace-pre-wrap');
      expect(header).not.toHaveClass('whitespace-pre-line');
    }
  });
});
