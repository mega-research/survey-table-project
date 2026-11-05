import { useState } from 'react';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it } from 'vitest';

import type { HeaderCell, TableColumn, TableRow } from '@/types/survey';

import { InteractiveTableResponse } from './interactive-table-response';

/**
 * 머리글 입력칸 — 머리글 칸이 가리키는 본문 칸(기타 원료명)을 머리글 자리에 그리고, 그 칸만 있던 본문 행을
 * 데스크톱 표에서 뺀다. 값은 본문 칸 키에 그대로 쓴다. 판정 규칙은 utils/header-input-cells.test.ts 가 지킨다.
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

const headerInputColumns: TableColumn[] = [
  { id: 'c-origin', label: '구분', width: 100 },
  { id: 'c-raw', label: '원유', width: 100 },
  { id: 'c-e1', label: '기타1', width: 100, revealStep: 1 },
  { id: 'c-e2', label: '기타2', width: 100, revealStep: 2, revealAddLabel: '기타 원료 추가' },
];
const headerInputRows: TableRow[] = [
  {
    id: 'r-name',
    label: '기타 원료명',
    cells: [
      { id: 'n-label', type: 'text', content: '기타 원료명', colspan: 2 },
      { id: 'n-hidden', type: 'text', content: '', isHidden: true },
      { id: 'name1', type: 'input', content: '', placeholder: '원료명(직접작성)', mobileLabel: '기타1 원료명' },
      { id: 'name2', type: 'input', content: '', placeholder: '원료명(직접작성)', mobileLabel: '기타2 원료명' },
    ],
  },
  {
    id: 'r-dom',
    label: '국내산',
    cells: [
      { id: 'd-label', type: 'text', content: '국내산' },
      { id: 'd-raw', type: 'input', content: '', inputType: 'number' },
      { id: 'd-e1', type: 'input', content: '', inputType: 'number', enabledWhen: { kind: 'filled', controllerCellId: 'name1' } },
      { id: 'd-e2', type: 'input', content: '', inputType: 'number', enabledWhen: { kind: 'filled', controllerCellId: 'name2' } },
    ],
  },
];
function headerInputGrid(linked = true): HeaderCell[][] {
  return [
    [
      { id: 'h-origin', label: '구분', colspan: 1, rowspan: 2 },
      { id: 'h-all', label: '원료 투입량', colspan: 3, rowspan: 1, ...(linked ? { hostsColumnReveal: true } : {}) },
    ],
    [
      { id: 'h-raw', label: '원유', colspan: 1, rowspan: 1 },
      { id: 'h-e1', label: '기타1', colspan: 1, rowspan: 1, ...(linked ? { inputCellId: 'name1' } : {}) },
      { id: 'h-e2', label: '기타2', colspan: 1, rowspan: 1, ...(linked ? { inputCellId: 'name2' } : {}) },
    ],
  ];
}

function Harness({ linked = true, errorCellIds }: { linked?: boolean; errorCellIds?: Set<string> }) {
  const [value, setValue] = useState<Record<string, unknown>>({});
  return (
    <>
      <InteractiveTableResponse
        questionId="q1"
        columns={headerInputColumns}
        rows={headerInputRows}
        tableHeaderGrid={headerInputGrid(linked)}
        value={value}
        onChange={setValue}
        enableSticky={false}
        errorCellIds={errorCellIds}
      />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

const headerOf = (name: RegExp | string) => screen.getByRole('columnheader', { name });

describe('머리글 입력칸 — 데스크톱 표', () => {
  it('기타1 머리글 자리에 원료명 입력칸이 서고, 이름 줄은 본문에서 빠진다', () => {
    render(<Harness />);
    const header = screen.getAllByRole('columnheader').find((el) => el.getAttribute('data-cell-id') === 'name1')!;
    expect(within(header).getByPlaceholderText('원료명(직접작성)')).toBeInTheDocument();
    expect(screen.queryByText('기타 원료명')).not.toBeInTheDocument();
    expect(screen.queryByText('기타1')).not.toBeInTheDocument(); // 글자 라벨 대신 입력칸
  });

  it('머리글 입력칸에 적은 값은 본문 칸 키로 저장되고 아래 투입량 칸을 연다', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const nameInput = screen.getByPlaceholderText('원료명(직접작성)');
    await user.type(nameInput, '버터');
    expect(JSON.parse(screen.getByTestId('value').textContent!)).toMatchObject({ name1: '버터' });
    const dE1 = document.querySelector('[data-cell-id="d-e1"]')!;
    expect(within(dE1 as HTMLElement).getByRole('textbox')).toBeEnabled();
  });

  it('열 추가 버튼이 「원료 투입량」 머리글 안에 서고, 누르면 기타2 머리글 입력칸이 열린다', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const host = headerOf(/원료 투입량/);
    await user.click(within(host).getByRole('button', { name: '기타 원료 추가' }));
    expect(screen.getAllByPlaceholderText('원료명(직접작성)')).toHaveLength(2);
    // 표 위 버튼 줄은 그리지 않는다 — 버튼은 하나뿐
    expect(screen.getAllByRole('button', { name: '기타 원료 추가' })).toHaveLength(1);
  });

  it('필수 미응답이면 머리글 칸에 오류 링이 선다', () => {
    render(<Harness errorCellIds={new Set(['name1'])} />);
    const header = document.querySelector('[role="columnheader"][data-cell-id="name1"]')!;
    expect(header.className).toContain('ring-red-300');
  });

  it('연결이 없는 표는 종전 그대로 — 이름 줄이 본문에, 버튼은 표 위', () => {
    render(<Harness linked={false} />);
    expect(screen.getByText('기타 원료명')).toBeInTheDocument();
    expect(screen.getByText('기타1')).toBeInTheDocument();
    expect(within(headerOf(/원료 투입량/)).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '기타 원료 추가' })).toBeInTheDocument();
  });
});
