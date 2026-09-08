import { useState } from 'react';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it } from 'vitest';

import { expandRepeatRows } from '@/lib/question/row-repeat';
import type { Question, RowRepeatConfig, TableCell, TableColumn, TableRow } from '@/types/survey';

import { InteractiveTableResponse } from './interactive-table-response';

/**
 * 행 반복 응답 화면 — 응답자가 `+` 로 벌을 늘리고 `−` 로 마지막 벌을 접는다.
 *
 * 구조에는 maxRepeats 벌이 이미 펼쳐져 있다. 화면이 정하는 것은 "몇 벌을 보일까"뿐이고,
 * 그 값은 저장하지 않고 응답 값에서 파생한다.
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
  { id: 'c1', label: '성과명', width: 200 },
  { id: 'c2', label: '연도', width: 120 },
];

function inputCell(id: string): TableCell {
  return { id, content: '', type: 'input' };
}

const config: RowRepeatConfig = {
  enabled: true,
  templateRowIds: ['tpl'],
  maxRepeats: 3,
  addLabel: '성과 추가',
};

/** 머리 행(입력 없음) + 반복 템플릿 1행. 펼치면 템플릿이 3벌이 된다. */
function buildRows(): TableRow[] {
  const seed: TableRow[] = [
    {
      id: 'head',
      label: '구분',
      cells: [
        { id: 'h1', content: '구분', type: 'text' },
        { id: 'h2', content: '', type: 'text' },
      ],
    },
    { id: 'tpl', label: '성과', cells: [inputCell('t1'), inputCell('t2')] },
  ];
  let n = 0;
  return expandRepeatRows(seed, config, () => `gen${++n}`);
}

const rows = buildRows();

function Harness({ initial = {} }: { initial?: Record<string, unknown> }) {
  const [value, setValue] = useState<Record<string, unknown>>(initial);
  return (
    <>
      <InteractiveTableResponse
        questionId="q1"
        columns={columns}
        rows={rows}
        rowRepeatConfig={config}
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

describe('행 반복 — 응답 화면', () => {
  it('값이 없으면 1벌만 보인다', () => {
    render(<Harness />);
    expect(inputCount()).toBe(2);
  });

  it('+ 를 누르면 다음 벌이 드러난다', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: '성과 추가' }));
    expect(inputCount()).toBe(4);

    await user.click(screen.getByRole('button', { name: '성과 추가' }));
    expect(inputCount()).toBe(6);
  });

  it('maxRepeats 에 닿으면 + 가 비활성이 되고 안내가 붙는다', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: '성과 추가' }));
    await user.click(screen.getByRole('button', { name: '성과 추가' }));

    expect(screen.getByRole('button', { name: '성과 추가' })).toBeDisabled();
    expect(screen.getByText(/최대 3개/)).toBeInTheDocument();
  });

  it('값이 들어 있는 마지막 벌까지 처음부터 열려 있다', () => {
    const third = rows.find((r) => r.repeatIndex === 3)!;
    render(<Harness initial={{ [third.cells[0]!.id]: '세 번째' }} />);
    expect(inputCount()).toBe(6);
  });

  it('− 는 마지막 벌 값을 비우고 접는다 — 앞 벌 값은 그대로다', async () => {
    const user = userEvent.setup();
    const first = rows.find((r) => r.repeatIndex === 1)!;
    const second = rows.find((r) => r.repeatIndex === 2)!;
    render(
      <Harness
        initial={{ [first.cells[0]!.id]: '첫째', [second.cells[0]!.id]: '둘째' }}
      />,
    );
    expect(inputCount()).toBe(4);

    await user.click(screen.getByRole('button', { name: '마지막 줄 삭제' }));

    expect(inputCount()).toBe(2);
    const value = JSON.parse(screen.getByTestId('value').textContent!);
    expect(value[first.cells[0]!.id]).toBe('첫째');
    expect(value[second.cells[0]!.id]).toBe('');
  });

  it('1벌만 열려 있으면 − 가 나오지 않는다', () => {
    render(<Harness />);
    expect(screen.queryByRole('button', { name: '마지막 줄 삭제' })).toBeNull();
  });

  it('반복 설정이 없으면 버튼이 나오지 않는다', () => {
    render(
      <InteractiveTableResponse
        questionId="q2"
        columns={columns}
        rows={rows}
        value={{}}
        onChange={() => {}}
        enableSticky={false}
      />,
    );
    expect(screen.queryByRole('button', { name: '성과 추가' })).toBeNull();
    // 설정이 없으면 구조에 있는 3벌이 전부 그려진다
    expect(inputCount()).toBe(6);
  });
});

describe('행 반복 — 조건으로 숨은 열이 있어도', () => {
  /**
   * 열 displayCondition 으로 가려진 열의 셀은 렌더 파이프라인의 columnFilteredRows 에서
   * 아예 빠진다. 벌 판정과 접기 시 값 비우기가 그 목록을 보면 숨은 칸의 값이 남아
   * 응답자가 지운 벌이 내보내기의 "쓰인 벌"에 잡히고 조건이 뒤집히면 되살아난다.
   */
  const gateQuestion: Question = {
    id: 'gate',
    type: 'radio',
    title: '표시 여부',
    order: 0,
    required: false,
    options: [{ id: 'g1', value: 'yes', label: '예' }],
  } as Question;

  const conditionalColumns: TableColumn[] = [
    columns[0]!,
    {
      ...columns[1]!,
      displayCondition: {
        logicType: 'AND',
        conditions: [
          {
            id: 'cond1',
            sourceQuestionId: 'gate',
            conditionType: 'value-match',
            requiredValues: ['yes'],
          },
        ],
      },
    },
  ];

  function HiddenColumnHarness({ initial }: { initial: Record<string, unknown> }) {
    const [value, setValue] = useState<Record<string, unknown>>(initial);
    return (
      <>
        <InteractiveTableResponse
          questionId="q1"
          columns={conditionalColumns}
          rows={rows}
          rowRepeatConfig={config}
          value={value}
          onChange={setValue}
          allResponses={{ gate: 'no' }}
          allQuestions={[gateQuestion]}
          enableSticky={false}
        />
        <output data-testid="value">{JSON.stringify(value)}</output>
      </>
    );
  }

  it('숨은 칸에만 값이 있는 벌도 열린 것으로 센다', () => {
    const second = rows.find((r) => r.repeatIndex === 2)!;
    render(<HiddenColumnHarness initial={{ [second.cells[1]!.id]: '숨은 값' }} />);
    // 열이 하나 가려졌으므로 벌당 입력칸은 1개다 — 2벌이 열리면 2개.
    expect(inputCount()).toBe(2);
  });

  it('접을 때 숨은 칸의 값도 비운다', async () => {
    const user = userEvent.setup();
    const first = rows.find((r) => r.repeatIndex === 1)!;
    const second = rows.find((r) => r.repeatIndex === 2)!;
    render(
      <HiddenColumnHarness
        initial={{
          [first.cells[0]!.id]: '첫째',
          [second.cells[0]!.id]: '둘째',
          [second.cells[1]!.id]: '숨은 값',
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: '마지막 줄 삭제' }));

    const value = JSON.parse(screen.getByTestId('value').textContent!);
    expect(value[second.cells[0]!.id]).toBe('');
    expect(value[second.cells[1]!.id]).toBe('');
    expect(value[first.cells[0]!.id]).toBe('첫째');
  });
});
