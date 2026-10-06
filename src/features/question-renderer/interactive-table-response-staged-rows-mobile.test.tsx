import { useState } from 'react';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { StagedRowsConfig, TableCell, TableColumn, TableRow } from '@/types/survey';

import { InteractiveTableResponse } from './interactive-table-response';

/**
 * 행 차례로 열기 — 모바일. 「항목 단위 카드」에서는 버튼이 묶음의 마지막 카드 아래에 서고,
 * 블록 단위로 세운 표는 블록마다 선다(2025년 블록을 채우다 2026년 블록 끝까지 내려가지 않게).
 * 그 밖의 모바일 표시 방식은 행만 가리고 버튼은 표 아래에 한 번 둔다.
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

/** Q17-1 의 모양 — 구분 | 2025 국가 | 2025 비중 | 2026 국가 | 2026 비중 */
const columns: TableColumn[] = [
  { id: 'c0', label: '구분', width: 160 },
  { id: 'c1', label: '2025년', width: 160 },
  { id: 'c2', label: '2025년 비중', width: 100 },
  { id: 'c3', label: '2026년', width: 160 },
  { id: 'c4', label: '2026년 비중', width: 100 },
];

function input(id: string): TableCell {
  return { id, content: '', type: 'input' };
}

function countryRow(n: number, first: boolean): TableRow {
  const label: TableCell = first
    ? { id: 'label', content: '수출 국가 및 비중', type: 'text', rowspan: 4 }
    : { id: `label-${n}`, content: '', type: 'text', isHidden: true };
  return {
    id: `s${n}`,
    label: `국가 ${n}`,
    cells: [label, input(`s${n}-25c`), input(`s${n}-25p`), input(`s${n}-26c`), input(`s${n}-26p`)],
  };
}

const rows: TableRow[] = [
  countryRow(1, true),
  countryRow(2, false),
  countryRow(3, false),
  countryRow(4, false),
  {
    id: 'tail',
    label: '참고',
    cells: [
      { id: 'tail-label', content: '참고 수치', type: 'text' },
      input('tail-25c'),
      input('tail-25p'),
      input('tail-26c'),
      input('tail-26p'),
    ],
  },
];

const config: StagedRowsConfig = {
  enabled: true,
  rowIds: ['s1', 's2', 's3', 's4'],
  initialVisibleCount: 2,
  addLabel: '국가 추가',
};

function Harness({
  mode,
  blocks,
}: {
  mode: 'item-cards' | 'row-cards';
  blocks?: number[];
}) {
  const [value, setValue] = useState<Record<string, unknown>>({});
  return (
    <InteractiveTableResponse
      questionId="q1"
      columns={columns}
      rows={rows}
      stagedRowsConfig={config}
      mobileTableDisplayMode={mode}
      mobileItemCardBlockColumns={blocks}
      value={value}
      onChange={setValue}
    />
  );
}

function inputCount(): number {
  return screen.getAllByRole('textbox').length;
}

describe('행 차례로 열기 — 모바일 항목 단위 카드', () => {
  it('블록이 없으면 묶음의 마지막 카드 아래에 버튼이 한 번 선다', async () => {
    const user = userEvent.setup();
    render(<Harness mode="item-cards" />);

    expect(inputCount()).toBe(12);
    const buttons = screen.getAllByRole('button', { name: '국가 추가' });
    expect(buttons).toHaveLength(1);

    // 보이는 마지막 묶음 행(s2)의 입력 칸 뒤, 묶음 다음 행(참고)의 입력 칸 앞에 온다.
    const lastInput = document.querySelector('[data-cell-id="s2-26p"]')!;
    const tailInput = document.querySelector('[data-cell-id="tail-25c"]')!;
    expect(
      lastInput.compareDocumentPosition(buttons[0]!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      buttons[0]!.compareDocumentPosition(tailInput) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(buttons[0]!);
    expect(inputCount()).toBe(16);
  });

  it('블록 단위로 세운 표는 블록마다 버튼이 서고, 어느 블록에서 눌러도 같은 행이 열린다', async () => {
    const user = userEvent.setup();
    render(<Harness mode="item-cards" blocks={[1, 2, 4]} />);

    expect(inputCount()).toBe(12);
    const buttons = screen.getAllByRole('button', { name: '국가 추가' });
    expect(buttons).toHaveLength(2);

    // 2025년 블록의 버튼은 2026년 블록의 첫 입력 칸보다 앞에 있다.
    const firstOf2026 = document.querySelector('[data-cell-id="s1-26c"]')!;
    expect(
      buttons[0]!.compareDocumentPosition(firstOf2026) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(buttons[0]!);
    expect(inputCount()).toBe(16);
    expect(document.querySelector('[data-cell-id="s3-26c"]')).toBeInTheDocument();
  });
});

describe('행 차례로 열기 — 그 밖의 모바일 표시 방식', () => {
  it('행은 가리고 버튼은 한 번만 둔다', () => {
    render(<Harness mode="row-cards" />);
    expect(screen.getAllByRole('button', { name: '국가 추가' })).toHaveLength(1);
    expect(document.querySelector('[data-cell-id="s3-25c"]')).not.toBeInTheDocument();
  });
});
