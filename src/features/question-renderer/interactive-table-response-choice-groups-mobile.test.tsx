import { useState } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { ChoiceGroup, TableColumn, TableRow } from '@/types/survey';

import { InteractiveTableResponse } from './interactive-table-response';

/**
 * 보기 그룹 표 — 모바일 표시 모드 넷(자동 카드 · 선택 행 원본 · 행별 원본 · 원본 표)에서
 * 보기 셀이 컨트롤로 보이고, 선택이 표 응답 안 `__choiceGroups` 에 쓰이며, 행 완료·진행률이
 * 그룹 단위로 센다. 행 단위 카드(row-cards)는 이 스펙 범위 밖이다.
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
      { id: 'amount', content: '', type: 'input', placeholder: '수량' },
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
  mode,
  initial = {},
  rowsOverride,
  errorCellIds,
}: {
  mode: 'auto' | 'drilldown-original-row' | 'row-wise-original' | 'row-group-cards' | 'original';
  initial?: Record<string, unknown>;
  rowsOverride?: TableRow[];
  errorCellIds?: Set<string>;
}) {
  const [value, setValue] = useState<Record<string, unknown>>(initial);
  return (
    <>
      <InteractiveTableResponse
        questionId="q1"
        columns={columns}
        rows={rowsOverride ?? rows}
        choiceGroups={choiceGroups}
        mobileTableDisplayMode={mode}
        mobileDrilldownOmitLeadingColumns={1}
        value={value}
        onChange={setValue}
        errorCellIds={errorCellIds}
      />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

function readValue(): Record<string, unknown> {
  return JSON.parse(screen.getByTestId('value').textContent ?? '{}');
}

describe('보기 그룹 표 — 모바일 표시 모드', () => {
  it('자동 카드(스테퍼)에서 보기 셀이 라디오·체크박스로 보이고 선택이 예약 키에 쓰인다', () => {
    render(<Harness mode="auto" />);
    fireEvent.click(screen.getByRole('radio', { name: 'FHD' }));
    expect(readValue()).toEqual({ __choiceGroups: { rad1: 'fhd' } });
  });

  it('선택 행 원본 보기에서 행을 열면 보기 셀이 컨트롤로 보이고, 고르면 그 행이 완료로 센다', () => {
    render(<Harness mode="drilldown-original-row" />);
    expect(screen.getByText(/전체/)).toHaveTextContent('전체 0 / 2개 항목');
    fireEvent.click(screen.getByRole('button', { name: /구매처/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: '대리점' }));
    expect(readValue()).toEqual({ __choiceGroups: { cb1: ['store'] } });
    expect(screen.getByText(/전체/)).toHaveTextContent('전체 1 / 2개 항목');
  });

  it('행별 원본 문항 보기에서 보기 셀만 있는 행도 문항이 되고 선택이 쓰인다', () => {
    render(<Harness mode="row-wise-original" />);
    expect(screen.getByRole('group', { name: '구매처' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'UHD' }));
    expect(readValue()).toEqual({ __choiceGroups: { rad1: 'uhd' } });
  });

  it('원본 표에서도 보기 셀이 컨트롤로 보인다', () => {
    render(<Harness mode="original" initial={{ __choiceGroups: { rad1: 'fhd' } }} />);
    expect(screen.getByRole('radio', { name: 'FHD' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: '온라인' }));
    expect(readValue()).toEqual({ __choiceGroups: { rad1: 'fhd', cb1: ['online'] } });
  });
});

/**
 * 행 단위 그룹 카드 — 보기 소스 표(choice-table-response)의 같은 모드를 테이블 유형에 이식한 것.
 * 행마다 카드 하나, 구분 셀은 제목·설명, 그룹마다 섹션 제목(축 이름) + 세로 타일. 같은 행의
 * 입력 셀은 섹션 아래에 온다.
 */
describe('보기 그룹 표 — 행 단위 그룹 카드', () => {
  /** B1 축소판: 한 행에 인지 여부(radio 2)·참여 의향(checkbox 2) + 수량 input, 구분 셀은 제목+설명 */
  const groupsB1: ChoiceGroup[] = [
    { id: 'g1', groupKey: 'rad1', type: 'radio', label: '1) 얼라이언스 운영 - 인지여부' },
    { id: 'g2', groupKey: 'cb1', type: 'checkbox', label: '1) 얼라이언스 운영 - 참여 의향' },
  ];
  const rowsB1: TableRow[] = [
    {
      id: 'r1',
      label: '얼라이언스',
      cells: [
        {
          id: 'r1-lbl',
          content: '1) 얼라이언스 운영\n네트워킹 및 행사 개최',
          type: 'text',
          boldFirstLine: true,
        },
        {
          id: 'know',
          content: '①',
          choiceLabel: '알고 있음',
          type: 'choice_opt',
          choiceGroupId: 'g1',
        },
        { id: 'dunno', content: '②', choiceLabel: '모름', type: 'choice_opt', choiceGroupId: 'g1' },
        { id: 'yes', content: '①', choiceLabel: '있음', type: 'choice_opt', choiceGroupId: 'g2' },
        { id: 'no', content: '②', choiceLabel: '없음', type: 'choice_opt', choiceGroupId: 'g2' },
        { id: 'amount', content: '', type: 'input', placeholder: '수량', exportLabel: '참여 인원' },
      ],
    },
    {
      id: 'r2',
      label: '설명',
      cells: [
        { id: 'r2-lbl', content: '설명만 있는 행', type: 'text' },
        { id: 'r2-a', content: '', type: 'text' },
        { id: 'r2-b', content: '', type: 'text' },
        { id: 'r2-c', content: '', type: 'text' },
        { id: 'r2-d', content: '', type: 'text' },
        { id: 'r2-e', content: '', type: 'text' },
      ],
    },
  ];
  const columnsB1: TableColumn[] = [
    { id: 'c0', label: '구분', width: 120 },
    { id: 'c1', label: '알고 있음', width: 80 },
    { id: 'c2', label: '모름', width: 80 },
    { id: 'c3', label: '있음', width: 80 },
    { id: 'c4', label: '없음', width: 80 },
    { id: 'c5', label: '인원', width: 80 },
  ];

  function HarnessB1({
    initial = {},
    errorCellIds,
  }: {
    initial?: Record<string, unknown>;
    errorCellIds?: Set<string>;
  }) {
    const [value, setValue] = useState<Record<string, unknown>>(initial);
    return (
      <>
        <InteractiveTableResponse
          questionId="q1"
          columns={columnsB1}
          rows={rowsB1}
          choiceGroups={groupsB1}
          mobileTableDisplayMode="row-group-cards"
          value={value}
          onChange={setValue}
          errorCellIds={errorCellIds}
        />
        <output data-testid="value">{JSON.stringify(value)}</output>
      </>
    );
  }

  it('보기 셀이 있는 행마다 카드 하나 — 구분 셀이 제목·설명으로 보이고 그룹마다 섹션 제목(축 이름)이 붙는다', () => {
    const { container } = render(<HarnessB1 />);
    // 보기 셀이 없는 설명 행은 카드가 되지 않는다
    expect(container.querySelectorAll('.rounded-2xl')).toHaveLength(1);
    expect(screen.getByText('1) 얼라이언스 운영')).toBeInTheDocument();
    expect(screen.getByText(/네트워킹 및 행사 개최/)).toBeInTheDocument();
    expect(screen.queryByText('설명만 있는 행')).not.toBeInTheDocument();
    expect(screen.getByText('인지여부')).toBeInTheDocument();
    expect(screen.getByText('참여 의향')).toBeInTheDocument();
  });

  it('타일은 옵션 라벨을 보이고 세로로 한 줄씩 쌓이며, 고르면 __choiceGroups 에 쓰인다', () => {
    render(<HarnessB1 />);
    const section = screen.getByTestId('choice-group-section-g1');
    const tiles = section.querySelectorAll('label');
    expect(tiles).toHaveLength(2);
    expect(tiles[0]!.parentElement).toHaveClass('flex-col');
    expect(screen.getByText('알고 있음')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: '모름' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '있음' }));
    expect(readValue()).toEqual({ __choiceGroups: { rad1: 'dunno', cb1: ['yes'] } });
    // 고른 타일은 파랗게 칠해진다
    expect(screen.getByRole('radio', { name: '모름' }).closest('label')).toHaveClass('bg-blue-50');
  });

  it('같은 행의 입력 셀은 섹션 아래에 라벨과 함께 나온다', () => {
    render(<HarnessB1 />);
    expect(screen.getByText('참여 인원')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('수량')).toBeInTheDocument();
  });

  it('위반 셀 집합에 든 그룹의 섹션만 붉게 두른다', () => {
    render(<HarnessB1 errorCellIds={new Set(['yes', 'no'])} />);
    expect(screen.getByTestId('choice-group-section-g1')).not.toHaveClass('border-red-300');
    expect(screen.getByTestId('choice-group-section-g2')).toHaveClass('border-red-300');
  });

  it('보기 그룹 정의가 없으면 이 모드는 자동 카드로 떨어진다', () => {
    render(
      <InteractiveTableResponse
        questionId="q1"
        columns={columnsB1}
        rows={rowsB1}
        mobileTableDisplayMode="row-group-cards"
        value={{}}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByText('인지여부')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('수량')).toBeInTheDocument();
  });
});
