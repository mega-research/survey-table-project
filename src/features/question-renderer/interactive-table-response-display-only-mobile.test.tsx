import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { MobileTableDisplayMode } from '@/types/mobile-table-display';
import type { TableColumn, TableRow } from '@/types/survey';

import { InteractiveTableResponse } from './interactive-table-response';

/**
 * 응답 칸이 하나도 없는 표(전시회 정보처럼 글자만 있는 안내 표)는 모바일 카드 계열이 세울 카드가
 * 없다 — 행 카드는 표시 설정 없는 글자 셀을 숨기고, 항목 카드·축 카드는 입력 칸이 있어야 카드를
 * 연다. 그대로 두면 문항 제목만 남고 표가 통째로 사라지므로 어떤 표시 방식이든 원본 표로 그린다.
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
  { id: 'c1', label: '', width: 150 },
  { id: 'c2', label: '', width: 399 },
  { id: 'c3', label: '', width: 150 },
  { id: 'c4', label: '', width: 399 },
];

const rows: TableRow[] = [
  {
    id: 'r1',
    label: '',
    cells: [
      { id: 'a', type: 'text', content: 'Domestic Exhibition Name' },
      { id: 'b', type: 'text', content: 'Seoul Expo' },
      { id: 'c', type: 'text', content: 'Exhibition Period' },
      { id: 'd', type: 'text', content: 'Oct 1-3' },
    ],
  },
  {
    id: 'r2',
    label: '',
    cells: [
      { id: 'e', type: 'text', content: 'Organizer' },
      { id: 'f', type: 'text', content: 'AKEI' },
      { id: 'g', type: 'text', content: 'Exhibition Venue' },
      { id: 'h', type: 'text', content: 'COEX' },
    ],
  },
];

const MODES: MobileTableDisplayMode[] = [
  'auto',
  'row-cards',
  'item-cards',
  'axis-cards',
  'drilldown-original-row',
  'row-wise-original',
  'original',
];

describe('응답 칸 없는 표 — 모바일', () => {
  it.each(MODES)('%s 표시 방식에서도 표 글자가 모두 보인다', (mode) => {
    render(
      <InteractiveTableResponse
        questionId="q1"
        columns={columns}
        rows={rows}
        hideColumnLabels
        mobileTableDisplayMode={mode}
        value={{}}
        onChange={() => {}}
      />,
    );
    for (const text of [
      'Domestic Exhibition Name',
      'Seoul Expo',
      'Exhibition Period',
      'Oct 1-3',
      'Organizer',
      'AKEI',
      'Exhibition Venue',
      'COEX',
    ]) {
      expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    }
  });

  // 저작자가 글자 셀에 「바로 표시」를 지정하면 행 카드 계열은 그것을 카드로 그린다 — 그대로 둔다.
  // 원본 표로 바꾸는 것은 고른 방식이 아무것도 그리지 못할 때뿐이다.
  const inlineRows: TableRow[] = rows.map((row) => ({
    ...row,
    cells: row.cells.map((cell) => ({ ...cell, mobileDisplay: 'inline' as const })),
  }));

  it.each(['auto', 'row-cards', 'row-group-cards'] as const)(
    '%s 는 바로 표시 셀이 있으면 원본 표가 아니라 카드로 그린다',
    (mode) => {
      const { container } = render(
        <InteractiveTableResponse
          questionId="q1"
          columns={columns}
          rows={inlineRows}
          hideColumnLabels
          mobileTableDisplayMode={mode}
          value={{}}
          onChange={() => {}}
        />,
      );
      expect(container.querySelector('.mobile-row-card')).not.toBeNull();
      expect(container.querySelector('table, [role="grid"], [data-row-index]')).toBeNull();
      expect(screen.getAllByText('Domestic Exhibition Name').length).toBeGreaterThan(0);
    },
  );

  it('axis-cards 는 바로 표시 셀이 있어도 그릴 카드가 없어 원본 표로 그린다', () => {
    render(
      <InteractiveTableResponse
        questionId="q1"
        columns={columns}
        rows={inlineRows}
        hideColumnLabels
        mobileTableDisplayMode="axis-cards"
        value={{}}
        onChange={() => {}}
      />,
    );
    expect(screen.getAllByText('COEX').length).toBeGreaterThan(0);
  });

  it('item-cards 는 값 칸이 바로 표시면 라벨마다 표시 전용 카드를 세운다', () => {
    // 라벨 칸은 그대로(제목), 값 칸만 바로 표시 — 전시회 정보 표의 모바일 설정
    const valueInlineRows: TableRow[] = rows.map((row) => ({
      ...row,
      cells: row.cells.map((cell, index) =>
        index % 2 === 1 ? { ...cell, mobileDisplay: 'inline' as const } : cell,
      ),
    }));
    render(
      <InteractiveTableResponse
        questionId="q1"
        columns={columns}
        rows={valueInlineRows}
        hideColumnLabels
        mobileTableDisplayMode="item-cards"
        value={{}}
        onChange={() => {}}
      />,
    );
    const headers = screen.getAllByTestId('item-card-header').map((el) => el.textContent);
    expect(headers).toEqual([
      'Domestic Exhibition Name',
      'Exhibition Period',
      'Organizer',
      'Exhibition Venue',
    ]);
    expect(screen.getByText('COEX')).toBeTruthy();
  });
});
