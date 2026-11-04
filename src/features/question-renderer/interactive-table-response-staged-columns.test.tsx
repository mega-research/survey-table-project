import { useState } from 'react';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it } from 'vitest';

import type { HeaderCell, TableColumn, TableRow } from '@/types/survey';

import { InteractiveTableResponse } from './interactive-table-response';

/**
 * 열 차례로 열기 응답 화면 — 「기타1」만 보이고 `+` 를 누를 때마다 다음 기타 열 묶음이 열린다.
 * 열린 단계는 값에서 파생하고, `−` 는 마지막 단계의 값을 비우고 닫는다.
 */
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
  { id: 'milk', label: '원유', width: 100 },
  { id: 'n1', label: '원료명', width: 100, revealStep: 1 },
  { id: 'q1', label: '투입량', width: 100, revealStep: 1 },
  { id: 'n2', label: '원료명', width: 100, revealStep: 2, revealAddLabel: '기타 원료 추가' },
  { id: 'q2', label: '투입량', width: 100, revealStep: 2 },
  { id: 'n3', label: '원료명', width: 100, revealStep: 3 },
  { id: 'q3', label: '투입량', width: 100, revealStep: 3 },
];
const headerGrid: HeaderCell[][] = [
  [
    { id: 'h-milk', label: '원유', colspan: 1, rowspan: 2 },
    { id: 'h-e1', label: '기타1', colspan: 2, rowspan: 1 },
    { id: 'h-e2', label: '기타2', colspan: 2, rowspan: 1 },
    { id: 'h-e3', label: '기타3', colspan: 2, rowspan: 1 },
  ],
  [1, 2, 3].flatMap((k) => [
    { id: `h-n${k}`, label: '원료명', colspan: 1, rowspan: 1 },
    { id: `h-q${k}`, label: '투입량', colspan: 1, rowspan: 1 },
  ]),
];
const rows: TableRow[] = [
  { id: 'r1', label: '국내산', cells: columns.map((c) => ({ id: `r1-${c.id}`, type: 'input' as const, content: '' })) },
];

function Harness({ initial = {} }: { initial?: Record<string, unknown> }) {
  const [value, setValue] = useState<Record<string, unknown>>(initial);
  return (
    <>
      <InteractiveTableResponse
        questionId="q1"
        columns={columns}
        rows={rows}
        tableHeaderGrid={headerGrid}
        value={value}
        onChange={setValue}
        enableSticky={false}
      />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

const inputCount = () => screen.getAllByRole('textbox').length;

describe('열 차례로 열기 — 응답 화면', () => {
  it('처음엔 1단계(기타1)까지만 보인다 — 머리도 함께 줄어든다', () => {
    render(<Harness />);
    expect(inputCount()).toBe(3);
    expect(screen.getByText('기타1')).toBeInTheDocument();
    expect(screen.queryByText('기타2')).not.toBeInTheDocument();
  });

  it('+ 를 누를 때마다 다음 기타 묶음이 열리고 끝에서 비활성이 된다', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: '기타 원료 추가' }));
    expect(inputCount()).toBe(5);
    expect(screen.getByText('기타2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '기타 원료 추가' }));
    expect(inputCount()).toBe(7);
    expect(screen.getByRole('button', { name: '기타 원료 추가' })).toBeDisabled();
  });

  it('값이 있는 마지막 단계까지 처음부터 열려 있다', () => {
    render(<Harness initial={{ 'r1-q3': '5' }} />);
    expect(inputCount()).toBe(7);
  });

  it('− 는 마지막 단계의 값을 비우고 닫는다', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ 'r1-n1': '연유', 'r1-n2': '유단백' }} />);
    expect(inputCount()).toBe(5);
    await user.click(screen.getByRole('button', { name: /마지막 열 삭제/ }));
    expect(inputCount()).toBe(3);
    const value = JSON.parse(screen.getByTestId('value').textContent ?? '{}');
    expect(value['r1-n2']).toBe('');
    expect(value['r1-n1']).toBe('연유');
  });
});
