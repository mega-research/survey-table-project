import { useState } from 'react';

import { render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { TableCell, TableColumn, TableRow } from '@/types/survey';

import { InteractiveTableResponse } from './interactive-table-response';

/**
 * 블록 단위로 세우기 — 표 두 벌을 좌우로 붙인 표가 모바일에서 블록마다 차례로 선다. 가르는 규칙은
 * utils/item-card-blocks.test.ts 가 지키고, 여기는 응답 화면 배선(블록 순서·머리·열 헤더 라벨)을 본다.
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
  { id: 'c1', label: '학력별 인력 수', width: 180 },
  { id: 'c2', label: '현재 인력', width: 100 },
  { id: 'c3', label: '부족 인력', width: 100 },
  { id: 'c4', label: '경력별 인력 수', width: 180 },
  { id: 'c5', label: '현재 인력', width: 100 },
  { id: 'c6', label: '부족 인력', width: 100 },
];

const text = (id: string, content: string): TableCell => ({ id, type: 'text', content });
const input = (id: string): TableCell => ({ id, type: 'input', content: '' });
const calc = (id: string): TableCell => ({ id, type: 'calc', content: '' });

const rows: TableRow[] = [
  {
    id: 'total',
    label: '합계',
    cells: [
      text('e-total', '학력 합계'),
      calc('e-t1'),
      calc('e-t2'),
      text('c-total', '경력 합계'),
      calc('c-t1'),
      calc('c-t2'),
    ],
  },
  ...[1, 2].map(
    (n): TableRow => ({
      id: `r${n}`,
      label: `행 ${n}`,
      cells: [
        text(`e-l${n}`, `학력 ${n}`),
        input(`e-${n}-1`),
        input(`e-${n}-2`),
        text(`c-l${n}`, `경력 ${n}`),
        input(`c-${n}-1`),
        input(`c-${n}-2`),
      ],
    }),
  ),
];

function Harness({ blockColumns }: { blockColumns?: number[] }) {
  const [value, setValue] = useState<Record<string, unknown>>({});
  return (
    <InteractiveTableResponse
      questionId="q1"
      columns={columns}
      rows={rows}
      mobileTableDisplayMode="item-cards"
      mobileItemCardBlockColumns={blockColumns}
      value={value}
      onChange={setValue}
    />
  );
}

const cardTitles = () => screen.getAllByTestId('item-card-header').map((el) => el.textContent);

describe('블록 단위로 세우기 — 모바일', () => {
  it('블록 시작 열이 없으면 종전대로 행 순서로 번갈아 나온다', () => {
    render(<Harness />);
    expect(cardTitles()).toEqual(['학력 합계', '경력 합계', '학력 1', '경력 1', '학력 2', '경력 2']);
    expect(screen.queryByTestId('item-card-block-head')).not.toBeInTheDocument();
  });

  it('블록마다 항목을 끝까지 세우고 합계 행은 블록 머리로 올린다', () => {
    render(<Harness blockColumns={[1, 4]} />);
    expect(cardTitles()).toEqual(['학력 1', '학력 2', '경력 1', '경력 2']);
    const heads = screen.getAllByTestId('item-card-block-head');
    expect(heads).toHaveLength(2);
    expect(within(heads[0]!).getByText('학력별 인력 수')).toBeInTheDocument();
    expect(within(heads[0]!).getByText('학력 합계')).toBeInTheDocument();
    expect(within(heads[1]!).getByText('경력별 인력 수')).toBeInTheDocument();
    expect(heads[1]!.querySelector('[data-cell-id="c-t1"]')).not.toBeNull();
  });

  it('입력 칸 이름은 열 헤더를 쓴다', () => {
    render(<Harness blockColumns={[4]} />);
    const card = screen.getByTestId('item-card-c-1-1');
    expect(within(card).getByText('현재 인력')).toBeInTheDocument();
    expect(within(card).getByText('부족 인력')).toBeInTheDocument();
    expect(within(card).getAllByRole('textbox')).toHaveLength(2);
  });
});
