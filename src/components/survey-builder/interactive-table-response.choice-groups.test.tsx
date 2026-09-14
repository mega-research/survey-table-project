import { useState } from 'react';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { useTestResponseStore } from '@/stores/test-response-store';
import type { ChoiceGroup, TableColumn, TableRow } from '@/types/survey';

import { ChoiceGroupsProvider } from './cells/choice-groups-context';
import { InteractiveCell } from './cells/interactive-cell';
import { InteractiveTableResponse } from './interactive-table-response';

/**
 * 보기 그룹 표 — table 문항의 choice_opt 셀이 radio/checkbox 컨트롤로 그려지고,
 * 선택은 표 응답 안 `__choiceGroups` 예약 키에 쓰인다. 같은 표의 입력 셀은 원래 자리다.
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
  { id: 'c1', label: '구분', width: 120 },
  { id: 'c2', label: '보기 1', width: 120 },
  { id: 'c3', label: '보기 2', width: 120 },
  { id: 'c4', label: '수량', width: 120 },
];

const choiceGroups: ChoiceGroup[] = [
  { id: 'g1', groupKey: 'rad1', type: 'radio', label: '보유' },
  { id: 'g2', groupKey: 'cb1', type: 'checkbox', label: '구매처' },
];

const rows: TableRow[] = [
  {
    id: 'r1',
    label: '보유',
    cells: [
      { id: 'r1-lbl', content: '보유', type: 'text' },
      { id: 'uhd', content: 'UHD', type: 'choice_opt', choiceGroupId: 'g1' },
      { id: 'fhd', content: 'FHD', type: 'choice_opt', choiceGroupId: 'g1' },
      { id: 'amount', content: '', type: 'input' },
    ],
  },
  {
    id: 'r2',
    label: '구매처',
    cells: [
      { id: 'r2-lbl', content: '구매처', type: 'text' },
      { id: 'online', content: '온라인', type: 'choice_opt', choiceGroupId: 'g2' },
      { id: 'store', content: '대리점', type: 'choice_opt', choiceGroupId: 'g2' },
      { id: 'r2-blank', content: '', type: 'text' },
    ],
  },
];

function Harness({
  initial = {},
  withGroups = true,
}: {
  initial?: Record<string, unknown>;
  withGroups?: boolean;
}) {
  const [value, setValue] = useState<Record<string, unknown>>(initial);
  return (
    <>
      <InteractiveTableResponse
        questionId="q1"
        columns={columns}
        rows={rows}
        choiceGroups={withGroups ? choiceGroups : undefined}
        value={value}
        onChange={setValue}
        enableSticky={false}
      />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

function readValue(): Record<string, unknown> {
  return JSON.parse(screen.getByTestId('value').textContent ?? '{}');
}

describe('보기 그룹 표 — 데스크톱 표 렌더', () => {
  it('보기 셀의 가로 정렬을 따른다 — 셀 래퍼의 items-* 는 w-full 인 이 행에 닿지 않아 행이 스스로 정렬한다', () => {
    const alignedRows: TableRow[] = [
      {
        id: 'r1',
        label: '보유',
        cells: [
          { id: 'r1-lbl', content: '보유', type: 'text' },
          {
            id: 'uhd',
            content: 'UHD',
            type: 'choice_opt',
            choiceGroupId: 'g1',
            horizontalAlign: 'center',
          },
          {
            id: 'fhd',
            content: 'FHD',
            type: 'choice_opt',
            choiceGroupId: 'g1',
            horizontalAlign: 'right',
          },
          { id: 'amount', content: '', type: 'input' },
        ],
      },
      {
        id: 'r2',
        label: '구매처',
        cells: [
          { id: 'r2-lbl', content: '구매처', type: 'text' },
          { id: 'online', content: '온라인', type: 'choice_opt', choiceGroupId: 'g2' },
          { id: 'store', content: '대리점', type: 'choice_opt', choiceGroupId: 'g2' },
          { id: 'r2-blank', content: '', type: 'text' },
        ],
      },
    ];
    render(
      <InteractiveTableResponse
        questionId="q1"
        columns={columns}
        rows={alignedRows}
        choiceGroups={choiceGroups}
        value={{}}
        onChange={() => {}}
        enableSticky={false}
      />,
    );
    expect(screen.getByRole('radio', { name: 'UHD' }).parentElement).toHaveClass('justify-center');
    expect(screen.getByRole('radio', { name: 'FHD' }).parentElement).toHaveClass('justify-end');
    // 미지정은 왼쪽 — 기존 화면 그대로
    expect(screen.getByRole('checkbox', { name: '온라인' }).parentElement).toHaveClass(
      'justify-start',
    );
  });

  it('보기 셀은 셀 텍스트만 보인다 — 옵션 라벨은 접근성 이름·데이터로만 쓴다(셀 편집 모달 미리보기와 같은 규칙)', () => {
    const labeledRows: TableRow[] = [
      {
        id: 'r1',
        label: '보유',
        cells: [
          { id: 'r1-lbl', content: '보유', type: 'text' },
          { id: 'uhd', content: '①', choiceLabel: '전혀 기대 안함', type: 'choice_opt', choiceGroupId: 'g1' },
          { id: 'fhd', content: '', choiceLabel: '기대 안함', type: 'choice_opt', choiceGroupId: 'g1' },
          { id: 'amount', content: '', type: 'input' },
        ],
      },
    ];
    render(
      <InteractiveTableResponse
        questionId="q1"
        columns={columns}
        rows={labeledRows}
        choiceGroups={choiceGroups}
        value={{}}
        onChange={() => {}}
        enableSticky={false}
      />,
    );
    expect(screen.getByText('①')).toBeInTheDocument();
    expect(screen.queryByText('전혀 기대 안함')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '전혀 기대 안함' })).toBeInTheDocument();
    // 셀 텍스트가 비면 컨트롤만 — 라벨 글자를 대신 넣지 않는다
    expect(screen.queryByText('기대 안함')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '기대 안함' })).toBeInTheDocument();
  });

  it('radio 그룹의 보기 셀은 라디오로 보이고, 고르면 __choiceGroups 에 셀 id 가 쓰인다', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    await user.click(screen.getByRole('radio', { name: 'FHD' }));
    expect(readValue()).toEqual({ __choiceGroups: { rad1: 'fhd' } });

    await user.click(screen.getByRole('radio', { name: 'UHD' }));
    expect(readValue()).toEqual({ __choiceGroups: { rad1: 'uhd' } });
  });

  it('checkbox 그룹의 보기 셀은 체크박스로 보이고, 고른 순서대로 배열에 쌓인다', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('checkbox', { name: '대리점' }));
    await user.click(screen.getByRole('checkbox', { name: '온라인' }));
    expect(readValue()).toEqual({ __choiceGroups: { cb1: ['store', 'online'] } });

    await user.click(screen.getByRole('checkbox', { name: '대리점' }));
    expect(readValue()).toEqual({ __choiceGroups: { cb1: ['online'] } });
  });

  it('단독 선택 보기를 고르면 같은 그룹의 나머지가 풀리고, 일반 보기를 고르면 단독 선택 보기가 풀린다', async () => {
    const user = userEvent.setup();
    const rowsWithNone: TableRow[] = [
      ...rows,
      {
        id: 'r3',
        label: '없음',
        cells: [
          { id: 'r3-lbl', content: '없음', type: 'text' },
          { id: 'r3-blank', content: '', type: 'text' },
          {
            id: 'none',
            content: '없음',
            type: 'choice_opt',
            choiceGroupId: 'g2',
            exclusiveChoice: true,
          },
          { id: 'r3-blank2', content: '', type: 'text' },
        ],
      },
    ];
    function NoneHarness() {
      const [value, setValue] = useState<Record<string, unknown>>({});
      return (
        <>
          <InteractiveTableResponse
            questionId="q1"
            columns={columns}
            rows={rowsWithNone}
            choiceGroups={choiceGroups}
            value={value}
            onChange={setValue}
            enableSticky={false}
          />
          <output data-testid="value">{JSON.stringify(value)}</output>
        </>
      );
    }
    render(<NoneHarness />);

    await user.click(screen.getByRole('checkbox', { name: '온라인' }));
    await user.click(screen.getByRole('checkbox', { name: '대리점' }));
    await user.click(screen.getByRole('checkbox', { name: '없음' }));
    expect(readValue()).toEqual({ __choiceGroups: { cb1: ['none'] } });
    expect(screen.getByRole('checkbox', { name: '온라인' })).not.toBeChecked();

    await user.click(screen.getByRole('checkbox', { name: '온라인' }));
    expect(readValue()).toEqual({ __choiceGroups: { cb1: ['online'] } });
    expect(screen.getByRole('checkbox', { name: '없음' })).not.toBeChecked();
  });

  it('표 전체 범위 단독 선택 보기는 다른 그룹까지 비우고, 어느 열에서든 다른 보기를 고르면 풀린다', async () => {
    const user = userEvent.setup();
    const twoCheckboxGroups: ChoiceGroup[] = [
      { id: 'g1', groupKey: 'cb1', type: 'checkbox', label: '활용 여부' },
      { id: 'g2', groupKey: 'cb2', type: 'checkbox', label: '활용 계획' },
    ];
    const rowsWithTableNone: TableRow[] = [
      {
        id: 'r1',
        label: 'TV',
        cells: [
          { id: 'r1-lbl', content: 'TV', type: 'text' },
          { id: 'tv-now', content: 'TV 현재', type: 'choice_opt', choiceGroupId: 'g1' },
          { id: 'tv-plan', content: 'TV 계획', type: 'choice_opt', choiceGroupId: 'g2' },
          { id: 'r1-blank', content: '', type: 'text' },
        ],
      },
      {
        id: 'r9',
        label: '없음',
        cells: [
          { id: 'r9-lbl', content: '없음', type: 'text' },
          { id: 'r9-blank', content: '', type: 'text' },
          {
            id: 'none',
            content: '없음',
            type: 'choice_opt',
            choiceGroupId: 'g2',
            exclusiveChoice: true,
            exclusiveScope: 'table',
          },
          { id: 'r9-blank2', content: '', type: 'text' },
        ],
      },
    ];
    function TableNoneHarness() {
      const [value, setValue] = useState<Record<string, unknown>>({});
      return (
        <>
          <InteractiveTableResponse
            questionId="q1"
            columns={columns}
            rows={rowsWithTableNone}
            choiceGroups={twoCheckboxGroups}
            value={value}
            onChange={setValue}
            enableSticky={false}
          />
          <output data-testid="value">{JSON.stringify(value)}</output>
        </>
      );
    }
    render(<TableNoneHarness />);

    await user.click(screen.getByRole('checkbox', { name: 'TV 현재' }));
    await user.click(screen.getByRole('checkbox', { name: 'TV 계획' }));
    await user.click(screen.getByRole('checkbox', { name: '없음' }));
    expect(readValue()).toEqual({ __choiceGroups: { cb2: ['none'] } });

    // 다른 그룹(활용 여부)에서 골라도 표 전체 「없음」이 풀린다
    await user.click(screen.getByRole('checkbox', { name: 'TV 현재' }));
    expect(readValue()).toEqual({ __choiceGroups: { cb1: ['tv-now'] } });
  });

  it('입력 셀 값과 그룹 선택이 같은 표 응답 객체에 나란히 산다', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ amount: '12' }} />);

    await user.click(screen.getByRole('radio', { name: 'UHD' }));
    expect(readValue()).toEqual({ amount: '12', __choiceGroups: { rad1: 'uhd' } });
  });

  it('저장된 선택은 처음부터 체크돼 있다', () => {
    render(<Harness initial={{ __choiceGroups: { rad1: 'fhd', cb1: ['online'] } }} />);
    expect(screen.getByRole('radio', { name: 'FHD' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'UHD' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: '온라인' })).toBeChecked();
  });

  it('보기 그룹이 없는 표에서는 choice_opt 셀이 지금처럼 글자로만 보인다', () => {
    render(<Harness withGroups={false} />);
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getByText('UHD')).toBeInTheDocument();
  });

  it('상세기재가 켜진 보기를 고르면 그 셀 안에 입력칸이 열린다', async () => {
    const user = userEvent.setup();
    const withEtc: TableRow[] = [
      {
        id: 'r1',
        label: '',
        cells: [
          { id: 'uhd', content: 'UHD', type: 'choice_opt', choiceGroupId: 'g1' },
          {
            id: 'etc',
            content: '기타',
            type: 'choice_opt',
            choiceGroupId: 'g1',
            allowTextInput: true,
            textInputPlaceholder: '직접 입력',
          },
        ],
      },
    ];
    function EtcHarness() {
      const [value, setValue] = useState<Record<string, unknown>>({});
      return (
        <InteractiveTableResponse
          questionId="q1"
          columns={columns.slice(0, 2)}
          rows={withEtc}
          choiceGroups={[choiceGroups[0]!]}
          value={value}
          onChange={setValue}
          enableSticky={false}
        />
      );
    }
    render(<EtcHarness />);
    expect(screen.queryByPlaceholderText('직접 입력')).toBeNull();
    await user.click(screen.getByRole('radio', { name: '기타' }));
    const cell = screen.getByRole('radio', { name: '기타' }).closest('[data-cell-id]')!;
    expect(within(cell as HTMLElement).getByPlaceholderText('직접 입력')).toBeInTheDocument();
  });
});

describe('보기 그룹 표 — 테스트 모드(빌더 미리보기)는 테스트 응답 스토어에 같은 모양으로 쓴다', () => {
  beforeEach(() => {
    useTestResponseStore.setState({ testResponses: {} });
  });

  it('보기를 고르면 스토어의 표 응답 안 __choiceGroups 가 바뀌고, 다른 셀 값은 그대로다', async () => {
    const user = userEvent.setup();
    useTestResponseStore.setState({ testResponses: { q1: { amount: '7' } } });
    const cell = rows[0]!.cells[1]!;
    render(
      <ChoiceGroupsProvider value={choiceGroups}>
        <InteractiveCell cell={cell} questionId="q1" isTestMode rowCells={rows[0]!.cells} />
      </ChoiceGroupsProvider>,
    );
    await user.click(screen.getByRole('radio', { name: 'UHD' }));
    expect(useTestResponseStore.getState().testResponses['q1']).toEqual({
      amount: '7',
      __choiceGroups: { rad1: 'uhd' },
    });
    expect(screen.getByRole('radio', { name: 'UHD' })).toBeChecked();
  });
});

describe('보기 그룹 표 — choice-selected 게이팅', () => {
  const gatedRows: TableRow[] = [
    {
      id: 'r1',
      label: '',
      cells: [
        { id: 'opt-yes', content: '있음', type: 'choice_opt', choiceGroupId: 'g1' },
        { id: 'opt-no', content: '없음', type: 'choice_opt', choiceGroupId: 'g1' },
        {
          id: 'when',
          content: '',
          type: 'input',
          placeholder: '구매 시기',
          enabledWhen: { kind: 'choice-selected', controllerCellId: 'opt-yes' },
        },
      ],
    },
  ];
  function GatedHarness({ initial = {} }: { initial?: Record<string, unknown> }) {
    const [value, setValue] = useState<Record<string, unknown>>(initial);
    return (
      <>
        <InteractiveTableResponse
          questionId="q1"
          columns={columns.slice(0, 3)}
          rows={gatedRows}
          choiceGroups={[choiceGroups[0]!]}
          value={value}
          onChange={setValue}
          enableSticky={false}
        />
        <output data-testid="value">{JSON.stringify(value)}</output>
      </>
    );
  }

  it('그 보기를 고르면 입력칸이 열리고, 다른 보기로 바꾸면 닫히며 값이 지워진다', async () => {
    const user = userEvent.setup();
    render(<GatedHarness />);
    expect(screen.queryByPlaceholderText('구매 시기')).toBeNull();

    await user.click(screen.getByRole('radio', { name: '있음' }));
    await user.type(screen.getByPlaceholderText('구매 시기'), '내년');
    expect(readValue()).toEqual({ when: '내년', __choiceGroups: { rad1: 'opt-yes' } });

    await user.click(screen.getByRole('radio', { name: '없음' }));
    expect(screen.queryByPlaceholderText('구매 시기')).toBeNull();
    expect(readValue()).toEqual({ __choiceGroups: { rad1: 'opt-no' } });
  });

  it('테스트 모드에서도 스토어의 그룹 선택으로 열리고 닫힌다', () => {
    useTestResponseStore.setState({
      testResponses: { q1: { __choiceGroups: { rad1: 'opt-yes' } } },
    });
    const gated = gatedRows[0]!.cells[2]!;
    render(
      <ChoiceGroupsProvider value={[choiceGroups[0]!]}>
        <InteractiveCell cell={gated} questionId="q1" isTestMode rowCells={gatedRows[0]!.cells} />
      </ChoiceGroupsProvider>,
    );
    expect(screen.getByPlaceholderText('구매 시기')).toBeInTheDocument();
  });
});
