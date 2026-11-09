import { useState } from 'react';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { TableColumn, TableRow } from '@/types/survey';

import { InteractiveTableResponse } from './interactive-table-response';

/**
 * 테이블 유형의 축 단위 카드 — 응답 칸이 놓인 열마다 카드 하나. 묶음 규칙은
 * utils/column-axis-cards.test.ts 가 지키고, 여기는 응답 화면 배선(제목·행 제목·값 쓰기·오류 표식)을 본다.
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
  { id: 'item', label: '구분', width: 300 },
  { id: 'y25', label: '2025년', width: 120 },
  { id: 'y26', label: '2026년', width: 120 },
];

const rows: TableRow[] = [
  {
    id: 'r1',
    label: '',
    cells: [
      { id: 'r1-label', type: 'text', content: '전체 종사자 수' },
      { id: 'r1-25', type: 'input', content: '명', textPosition: 'right' },
      { id: 'r1-26', type: 'input', content: '명', textPosition: 'right' },
    ],
  },
  {
    id: 'r2',
    label: '',
    cells: [
      { id: 'r2-label', type: 'text', content: '인공지능 종사자 수' },
      { id: 'r2-25', type: 'input', content: '명', textPosition: 'right' },
      { id: 'r2-26', type: 'input', content: '명', textPosition: 'right' },
    ],
  },
];

function Harness({ errorCellIds }: { errorCellIds?: Set<string> }) {
  const [value, setValue] = useState<Record<string, unknown>>({});
  return (
    <>
      <InteractiveTableResponse
        questionId="q1"
        columns={columns}
        rows={rows}
        mobileTableDisplayMode="axis-cards"
        value={value}
        onChange={setValue}
        errorCellIds={errorCellIds}
      />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

describe('InteractiveTableResponse — 축 단위 카드(열 = 축)', () => {
  it('연도 열마다 카드 하나, 안에는 행 제목과 입력칸이 행 순서대로 놓인다', () => {
    render(<Harness />);
    const y25 = screen.getByTestId('column-axis-card-y25');
    const y26 = screen.getByTestId('column-axis-card-y26');
    expect(screen.queryByTestId('column-axis-card-item')).toBeNull();
    expect(within(y25).getByTestId('column-axis-card-header')).toHaveTextContent('2025년');
    expect(within(y26).getByTestId('column-axis-card-header')).toHaveTextContent('2026년');
    expect(within(y25).getByText('전체 종사자 수')).toBeInTheDocument();
    expect(within(y25).getByText('인공지능 종사자 수')).toBeInTheDocument();
    expect(within(y25).getAllByRole('textbox')).toHaveLength(2);
    expect(within(y26).getAllByRole('textbox')).toHaveLength(2);
  });

  it('입력값은 그 칸의 셀 id 로 쓰인다', () => {
    render(<Harness />);
    const y26 = screen.getByTestId('column-axis-card-y26');
    fireEvent.change(within(y26).getAllByRole('textbox')[1]!, { target: { value: '7' } });
    expect(JSON.parse(screen.getByTestId('value').textContent ?? '{}')).toEqual({ 'r2-26': '7' });
  });

  it('오류 칸에는 붉은 테두리가 붙는다', () => {
    render(<Harness errorCellIds={new Set(['r1-25'])} />);
    const holder = document.querySelector('[data-cell-id="r1-25"]');
    expect(holder?.querySelector('.ring-red-300')).not.toBeNull();
    expect(document.querySelector('[data-cell-id="r1-26"] .ring-red-300')).toBeNull();
  });
});

describe('InteractiveTableResponse — 축 단위 카드의 글자 없는 체크박스 칸', () => {
  const checkColumns: TableColumn[] = [
    { id: 'item', label: '구분', width: 300 },
    { id: 'y25', label: '2025년', width: 120 },
  ];
  const checkRows: TableRow[] = [
    {
      id: 'r1',
      label: '',
      cells: [
        { id: 'r1-label', type: 'text', content: '① 벤처캐피탈(VC)' },
        {
          id: 'r1-25',
          type: 'checkbox',
          content: '',
          checkboxOptions: [{ id: 'o1', label: '', value: '1' }],
        },
      ],
    },
    {
      id: 'r2',
      label: '',
      cells: [
        { id: 'r2-label', type: 'text', content: '투자유치 횟수' },
        { id: 'r2-25', type: 'input', content: '건', textPosition: 'right' },
      ],
    },
  ];

  function CheckHarness() {
    const [value, setValue] = useState<Record<string, unknown>>({});
    return (
      <>
        <InteractiveTableResponse
          questionId="q1"
          columns={checkColumns}
          rows={checkRows}
          mobileTableDisplayMode="axis-cards"
          value={value}
          onChange={setValue}
        />
        <output data-testid="value">{JSON.stringify(value)}</output>
      </>
    );
  }

  it('행 제목이 체크박스의 라벨로 옆에 붙고, 라벨을 눌러 체크할 수 있다', () => {
    render(<CheckHarness />);
    const card = screen.getByTestId('column-axis-card-y25');
    // 행 제목은 한 번만 — 체크박스의 라벨로만 그려진다
    expect(within(card).getAllByText('① 벤처캐피탈(VC)')).toHaveLength(1);
    const checkbox = within(card).getByLabelText('① 벤처캐피탈(VC)');
    expect(checkbox).toHaveAttribute('type', 'checkbox');

    fireEvent.click(within(card).getByText('① 벤처캐피탈(VC)'));
    expect(screen.getByTestId('value')).toHaveTextContent('"r1-25":["1"]');
    // 입력 칸의 행 제목은 종전대로 칸 위에 선다
    expect(within(card).getByText('투자유치 횟수').tagName).not.toBe('LABEL');
  });

  it('상세 기재를 받는 체크박스를 고르면 입력칸 칩이 「(라벨 없음)」이 아니라 행 제목을 쓴다', () => {
    const otherRows: TableRow[] = [
      {
        id: 'r1',
        label: '',
        cells: [
          { id: 'r1-label', type: 'text', content: '⑦ 기타' },
          {
            id: 'r1-25',
            type: 'checkbox',
            content: '',
            checkboxOptions: [{ id: 'o1', label: '', value: '1', allowTextInput: true }],
          },
        ],
      },
    ];
    function OtherHarness() {
      const [value, setValue] = useState<Record<string, unknown>>({});
      return (
        <InteractiveTableResponse
          questionId="q1"
          columns={checkColumns}
          rows={otherRows}
          mobileTableDisplayMode="axis-cards"
          value={value}
          onChange={setValue}
        />
      );
    }
    render(<OtherHarness />);
    const card = screen.getByTestId('column-axis-card-y25');
    fireEvent.click(within(card).getByLabelText('⑦ 기타'));
    expect(within(card).queryByText('(라벨 없음)')).toBeNull();
    // 체크박스 라벨 + 입력칸 칩
    expect(within(card).getAllByText('⑦ 기타')).toHaveLength(2);
  });
});

describe('InteractiveTableResponse — 축 단위 카드의 보기 그룹 열', () => {
  // 청암대 재학생 문14 — 표 유형 + 열마다 복수선택 보기 그룹. 전에는 축 카드가 보기 칸을 세지 않아 아무것도 안 그렸다.
  const groupColumns: TableColumn[] = [
    { id: 'know', label: '알고 있음', width: 140 },
    { id: 'used', label: '이용한 적 있음', width: 140 },
    { id: 'dept', label: '행정부서', width: 600 },
  ];
  const opt = (id: string, group: string, choiceLabel: string) => ({
    id,
    type: 'choice_opt' as const,
    content: '',
    choiceGroupId: group,
    choiceLabel,
    spssNumericCode: 1,
  });
  const groupRows: TableRow[] = [
    {
      id: 'r1',
      label: '교무처',
      cells: [
        opt('r1-k', 'gK', '교무처'),
        opt('r1-u', 'gU', '교무처'),
        { id: 'r1-d', type: 'text', content: '1. 교무처 (증명 발급 등)' },
      ],
    },
    {
      id: 'r2',
      label: '사무처',
      cells: [
        opt('r2-k', 'gK', '사무처'),
        opt('r2-u', 'gU', '사무처'),
        { id: 'r2-d', type: 'text', content: '2. 사무처 (등록금 수납 등)' },
      ],
    },
  ];

  function GroupHarness() {
    const [value, setValue] = useState<Record<string, unknown>>({});
    return (
      <>
        <InteractiveTableResponse
          questionId="q14"
          columns={groupColumns}
          rows={groupRows}
          choiceGroups={[
            { id: 'gK', groupKey: 'chk01', type: 'checkbox', label: '알고 있음' },
            { id: 'gU', groupKey: 'chk02', type: 'checkbox', label: '이용한 적 있음' },
          ]}
          mobileTableDisplayMode="axis-cards"
          value={value}
          onChange={setValue}
        />
        <output data-testid="value">{JSON.stringify(value)}</output>
      </>
    );
  }

  it('보기 그룹 열마다 카드가 서고, 보기 타일의 글자는 행 제목이다', () => {
    render(<GroupHarness />);
    const know = screen.getByTestId('column-axis-card-know');
    const used = screen.getByTestId('column-axis-card-used');
    expect(within(know).getByTestId('column-axis-card-header')).toHaveTextContent('알고 있음');
    expect(within(used).getByTestId('column-axis-card-header')).toHaveTextContent('이용한 적 있음');
    expect(within(know).getAllByRole('checkbox')).toHaveLength(2);
    expect(within(know).getByText('1. 교무처 (증명 발급 등)')).toBeInTheDocument();
    expect(screen.queryByTestId('column-axis-card-dept')).toBeNull();
  });

  it('고르면 그 그룹 키 아래에 보기 칸 id 가 쓰인다', () => {
    render(<GroupHarness />);
    const used = screen.getByTestId('column-axis-card-used');
    fireEvent.click(within(used).getAllByRole('checkbox')[1]!);
    expect(JSON.parse(screen.getByTestId('value').textContent ?? '{}')).toEqual({
      __choiceGroups: { chk02: ['r2-u'] },
    });
  });
});
