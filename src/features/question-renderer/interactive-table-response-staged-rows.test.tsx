import { useState } from 'react';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it } from 'vitest';

import type { StagedRowsConfig, TableCell, TableColumn, TableRow } from '@/types/survey';

import { InteractiveTableResponse } from './interactive-table-response';

/**
 * 행 차례로 열기 응답 화면 — 저작자가 만든 행 묶음을 처음 몇 행만 보이고
 * 응답자가 `+` 로 다음 행을 하나씩 연다. 구조는 그대로이고 화면이 정하는 것은
 * "몇 행을 보일까"뿐이다.
 */

beforeAll(() => {
  // jsdom 에는 matchMedia 가 없다 — 데스크톱 폭으로 고정한다.
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
  { id: 'c1', label: '국가', width: 200 },
  { id: 'c2', label: '비중', width: 120 },
];

function inputCell(id: string): TableCell {
  return { id, content: '', type: 'input' };
}

/** 머리 행(입력 2칸) + 묶음 4행(행당 2칸) + 꼬리 행(글자) */
const rows: TableRow[] = [
  { id: 'head', label: '수출액', cells: [inputCell('h1'), inputCell('h2')] },
  { id: 's1', label: '1', cells: [inputCell('s1a'), inputCell('s1b')] },
  { id: 's2', label: '2', cells: [inputCell('s2a'), inputCell('s2b')] },
  { id: 's3', label: '3', cells: [inputCell('s3a'), inputCell('s3b')] },
  { id: 's4', label: '4', cells: [inputCell('s4a'), inputCell('s4b')] },
  {
    id: 'tail',
    label: '합계',
    cells: [
      { id: 't1', content: '합계', type: 'text' },
      { id: 't2', content: '100%', type: 'text' },
    ],
  },
];

const config: StagedRowsConfig = {
  enabled: true,
  rowIds: ['s1', 's2', 's3', 's4'],
  initialVisibleCount: 2,
  addLabel: '국가 추가',
};

function Harness({ initial = {} }: { initial?: Record<string, unknown> }) {
  const [value, setValue] = useState<Record<string, unknown>>(initial);
  return (
    <>
      <InteractiveTableResponse
        questionId="q1"
        columns={columns}
        rows={rows}
        stagedRowsConfig={config}
        value={value}
        onChange={setValue}
        enableSticky={false}
      />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

function inputCount(): number {
  return screen.getAllByRole('textbox').length;
}

describe('행 차례로 열기 — 응답 화면', () => {
  it('값이 없으면 머리 행과 묶음의 처음 2행만 보인다 — 묶음 뒤의 행은 그대로 보인다', () => {
    render(<Harness />);
    expect(inputCount()).toBe(6);
    expect(screen.getByText('합계')).toBeInTheDocument();
  });

  it('+ 를 누르면 다음 행이 하나씩 열린다', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: '국가 추가' }));
    expect(inputCount()).toBe(8);

    await user.click(screen.getByRole('button', { name: '국가 추가' }));
    expect(inputCount()).toBe(10);
  });

  it('묶음 행을 다 열면 + 가 비활성이 된다', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: '국가 추가' }));
    await user.click(screen.getByRole('button', { name: '국가 추가' }));

    expect(screen.getByRole('button', { name: '국가 추가' })).toBeDisabled();
  });

  it('값이 들어 있는 마지막 묶음 행까지 처음부터 열려 있다', () => {
    render(<Harness initial={{ s3b: '30' }} />);
    expect(inputCount()).toBe(8);
  });

  it('− 는 마지막으로 연 행의 값을 비우고 닫는다 — 앞 행 값은 그대로다', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ s1a: '미국', s3a: '중국', s3b: '30' }} />);
    expect(inputCount()).toBe(8);

    await user.click(screen.getByRole('button', { name: '마지막 줄 삭제' }));

    expect(inputCount()).toBe(6);
    const value = JSON.parse(screen.getByTestId('value').textContent!);
    expect(value.s1a).toBe('미국');
    expect(value.s3a).toBe('');
    expect(value.s3b).toBe('');
  });

  it('처음 보이는 행 수에서는 − 가 없다 — 그 아래로는 닫히지 않는다', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ s2a: '일본' }} />);
    expect(screen.queryByRole('button', { name: '마지막 줄 삭제' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '국가 추가' }));
    await user.click(screen.getByRole('button', { name: '마지막 줄 삭제' }));

    expect(inputCount()).toBe(6);
    expect(screen.queryByRole('button', { name: '마지막 줄 삭제' })).not.toBeInTheDocument();
    expect(JSON.parse(screen.getByTestId('value').textContent!).s2a).toBe('일본');
  });

  it('설정이 꺼져 있으면 전부 보이고 버튼이 없다', () => {
    render(
      <InteractiveTableResponse
        questionId="q1"
        columns={columns}
        rows={rows}
        stagedRowsConfig={{ ...config, enabled: false }}
        value={{}}
        onChange={() => {}}
        enableSticky={false}
      />,
    );
    expect(inputCount()).toBe(10);
    expect(screen.queryByRole('button', { name: '국가 추가' })).not.toBeInTheDocument();
  });
});

/**
 * 버튼 줄의 자리 — 표 아래가 아니라 묶음 바로 아래다. 데스크톱 표는 CSS Grid 라
 * 자리는 grid-row / grid-column 으로 정해진다.
 */
describe('행 차례로 열기 — 묶음 바로 아래 버튼 줄', () => {
  function gridRowOf(rowId: string): number {
    const cell = document.querySelector<HTMLElement>(`[data-row-id="${rowId}"]`)!;
    return Number.parseInt(cell.style.gridRow, 10);
  }

  function controlRow(): HTMLElement {
    return screen.getByRole('group', { name: '행 추가·삭제' });
  }

  it('마지막으로 열린 묶음 행과 그 다음 행 사이에 선다', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(Number.parseInt(controlRow().style.gridRow, 10)).toBe(gridRowOf('s2') + 1);
    expect(gridRowOf('tail')).toBe(gridRowOf('s2') + 2);

    await user.click(screen.getByRole('button', { name: '국가 추가' }));

    expect(Number.parseInt(controlRow().style.gridRow, 10)).toBe(gridRowOf('s3') + 1);
    expect(gridRowOf('tail')).toBe(gridRowOf('s3') + 2);
  });

  it('버튼은 한 벌만 나온다 — 표 아래에 또 그리지 않는다', () => {
    render(<Harness />);
    expect(screen.getAllByRole('button', { name: '국가 추가' })).toHaveLength(1);
  });

  it('열린 수와 최대를 보인다', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(controlRow()).toHaveTextContent('2/4');

    await user.click(screen.getByRole('button', { name: '국가 추가' }));
    expect(controlRow()).toHaveTextContent('3/4');
  });

  it('병합 칸이 없는 표에서는 버튼 줄이 전 열을 덮는다', () => {
    render(<Harness />);
    expect(controlRow().style.gridColumn).toBe('1 / -1');
  });
});

describe('행 차례로 열기 — 묶음을 가로지르는 세로 병합 칸', () => {
  const mergedColumns: TableColumn[] = [
    { id: 'c0', label: '구분', width: 160 },
    { id: 'c1', label: '국가', width: 200 },
    { id: 'c2', label: '비중', width: 120 },
  ];

  function hidden(id: string): TableCell {
    return { id, content: '', type: 'text', isHidden: true };
  }

  /** 왼쪽 구분 칸이 묶음 4행 + 합계 행(5행)을 세로로 덮는다 — Q17-1 의 모양 */
  const mergedRows: TableRow[] = [
    {
      id: 's1',
      label: '1',
      cells: [
        { id: 'label', content: '수출 국가 및 비중', type: 'text', rowspan: 5 },
        inputCell('m1a'),
        inputCell('m1b'),
      ],
    },
    { id: 's2', label: '2', cells: [hidden('l2'), inputCell('m2a'), inputCell('m2b')] },
    { id: 's3', label: '3', cells: [hidden('l3'), inputCell('m3a'), inputCell('m3b')] },
    { id: 's4', label: '4', cells: [hidden('l4'), inputCell('m4a'), inputCell('m4b')] },
    {
      id: 'tail',
      label: '합계',
      cells: [
        hidden('l5'),
        { id: 't1', content: '합계', type: 'text' },
        { id: 't2', content: '100%', type: 'text' },
      ],
    },
  ];

  function MergedHarness() {
    const [value, setValue] = useState<Record<string, unknown>>({});
    return (
      <InteractiveTableResponse
        questionId="q1"
        columns={mergedColumns}
        rows={mergedRows}
        stagedRowsConfig={config}
        value={value}
        onChange={setValue}
        enableSticky={false}
      />
    );
  }

  it('구분 칸은 버튼 줄까지 한 칸으로 덮고, 버튼 줄은 나머지 열을 덮는다', () => {
    render(<MergedHarness />);

    // 보이는 행: s1 · s2 · (버튼 줄) · 합계 → 구분 칸은 4줄을 덮는다.
    const label = document.querySelector<HTMLElement>('[data-cell-id="label"]')!;
    expect(label.style.gridRow).toMatch(/span 4$/);
    expect(screen.getAllByText('수출 국가 및 비중')).toHaveLength(1);

    const control = screen.getByRole('group', { name: '행 추가·삭제' });
    expect(control.style.gridColumn).toBe('2 / -1');
  });

  it('가로지르는 병합 칸이 왼쪽 끝에 붙어 있지 않으면 병합을 버튼 줄에서 끊고 전 열을 덮는다', () => {
    // 오른쪽 끝 열이 묶음 4행 + 합계 행을 세로로 덮는 표
    const rightMerged: TableRow[] = [
      {
        id: 's1',
        label: '1',
        cells: [
          inputCell('r1a'),
          inputCell('r1b'),
          { id: 'note', content: '비고', type: 'text', rowspan: 5 },
        ],
      },
      { id: 's2', label: '2', cells: [inputCell('r2a'), inputCell('r2b'), hidden('n2')] },
      { id: 's3', label: '3', cells: [inputCell('r3a'), inputCell('r3b'), hidden('n3')] },
      { id: 's4', label: '4', cells: [inputCell('r4a'), inputCell('r4b'), hidden('n4')] },
      {
        id: 'tail',
        label: '합계',
        cells: [
          { id: 't1', content: '합계', type: 'text' },
          { id: 't2', content: '100%', type: 'text' },
          hidden('n5'),
        ],
      },
    ];
    render(
      <InteractiveTableResponse
        questionId="q1"
        columns={mergedColumns}
        rows={rightMerged}
        stagedRowsConfig={config}
        value={{}}
        onChange={() => {}}
        enableSticky={false}
      />,
    );

    const control = screen.getByRole('group', { name: '행 추가·삭제' });
    expect(control.style.gridColumn).toBe('1 / -1');
    // 보이는 묶음 행 2개만 덮고 끊긴다 — 버튼 줄과 겹치지 않는다.
    const note = document.querySelector<HTMLElement>('[data-cell-id="note"]')!;
    expect(note.style.gridRow).toMatch(/span 2$/);
    const noteEnd = Number.parseInt(note.style.gridRow, 10) + 2;
    expect(Number.parseInt(control.style.gridRow, 10)).toBe(noteEnd);
  });

  it('행을 열면 구분 칸이 따라 늘어난다', async () => {
    const user = userEvent.setup();
    render(<MergedHarness />);

    await user.click(screen.getByRole('button', { name: '국가 추가' }));

    const label = document.querySelector<HTMLElement>('[data-cell-id="label"]')!;
    expect(label.style.gridRow).toMatch(/span 5$/);
  });
});
