import { render } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import type { TableColumn, TableRow } from '@/types/survey';

import { InteractiveTableResponse } from './interactive-table-response';

beforeAll(() => {
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

const columns: TableColumn[] = [
  { id: 'c1', label: '항목', width: 200 },
  { id: 'c2', label: '년', width: 130 },
  { id: 'c3', label: '월', width: 770 },
];

const rows: TableRow[] = [
  {
    id: 'r1',
    label: '설립연도',
    cells: [
      { id: 'lbl', content: '(3) 설립연도', type: 'text' },
      { id: 'year', content: '년', type: 'input', textPosition: 'right', hideRightBorder: true },
      { id: 'month', content: '월', type: 'input', textPosition: 'right' },
    ],
  },
];

/** 오른쪽 세로선 숨김 — 년 칸과 월 칸이 한 칸처럼 이어 보이도록 년 셀의 border-r 만 뺀다 */
describe('표 셀 — 오른쪽 세로선 숨김', () => {
  it('켠 셀만 오른쪽 선이 없고 나머지 셀은 그대로다', () => {
    const { container } = render(
      <InteractiveTableResponse
        questionId="q1"
        columns={columns}
        rows={rows}
        value={{}}
        onChange={() => {}}
        enableSticky={false}
      />,
    );
    const year = container.querySelector('[data-cell-id="year"]') as HTMLElement;
    const month = container.querySelector('[data-cell-id="month"]') as HTMLElement;
    expect(year.className).not.toContain('border-r');
    expect(month.className).toContain('border-r');
  });
});
