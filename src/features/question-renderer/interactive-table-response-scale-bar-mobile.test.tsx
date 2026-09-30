import { useState } from 'react';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ChoiceGroup, HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';

import { InteractiveTableResponse } from './interactive-table-response';

/**
 * 보기 그룹 표 — 「행 단위 그룹 카드」에서 보기 모양 「척도 막대」(mobileScaleBar)를 고른 그룹만
 * 가로 스크롤 없는 척도 막대로 그린다. 해운물류 멘토 C4(활용 여부 + 11점 만족도).
 */

const view = vi.hoisted(() => ({ mobile: true }));
vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => view.mobile,
  useMediaQuery: () => view.mobile,
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
afterEach(() => {
  view.mobile = true;
});

const CIRC = ['⓪', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
const columns: TableColumn[] = [
  { id: 'category', label: '구분', width: 60 },
  { id: 'item', label: '평가항목', width: 190 },
  { id: 'use1', label: '활용함', width: 70 },
  { id: 'use2', label: '활용 안함', width: 64 },
  ...CIRC.map((_, n) => ({ id: `s${n}`, label: `${n}점`, width: 64 })),
];
const head = (id: string, label: string, colspan: number, rowspan = 1): HeaderCell => ({
  id,
  label,
  colspan,
  rowspan,
});
const headerGrid: HeaderCell[][] = [
  [
    head('h-cat', '구분', 1, 2),
    head('h-item', '평가항목', 1, 2),
    head('h-use', '활용 여부', 2),
    head('h-sat', '만족도', 11),
  ],
  [
    head('h-u1', '활용함', 1),
    head('h-u2', '활용 안함', 1),
    head('h-0', '매우 불만족', 1),
    head('h-neg', '불만족', 4),
    head('h-5', '보통', 1),
    head('h-pos', '만족', 4),
    head('h-10', '매우 만족', 1),
  ],
];
const scaleCells: TableCell[] = CIRC.map((content, n) => ({
  id: `sat${n}`,
  type: 'choice_opt' as const,
  content,
  choiceLabel: `${n}점`,
  choiceGroupId: 'g-sat',
}));
const rows: TableRow[] = [
  {
    id: 'r1',
    label: '회의실 및 교통비 지원',
    cells: [
      { id: 'cat', type: 'text', content: '지원 제도' },
      { id: 'item', type: 'text', content: '1) 회의실 및 교통비 지원' },
      {
        id: 'use1',
        type: 'choice_opt',
        content: '①',
        choiceLabel: '활용함',
        choiceGroupId: 'g-use',
      },
      {
        id: 'use2',
        type: 'choice_opt',
        content: '②',
        choiceLabel: '활용 안함',
        choiceGroupId: 'g-use',
      },
      ...scaleCells,
    ],
  },
];

function Harness({
  satGroup = { mobileScaleBar: true },
  rowsOverride,
  initialValue = {},
  errorCellIds,
}: {
  satGroup?: Partial<ChoiceGroup>;
  rowsOverride?: TableRow[];
  initialValue?: Record<string, unknown>;
  errorCellIds?: Set<string>;
}) {
  const [value, setValue] = useState<Record<string, unknown>>(initialValue);
  const groups: ChoiceGroup[] = [
    { id: 'g-use', groupKey: 'rad1', type: 'radio', label: '활용 여부' },
    { id: 'g-sat', groupKey: 'rad2', type: 'radio', label: '만족도', ...satGroup },
  ];
  return (
    <>
      <InteractiveTableResponse
        questionId="q1"
        columns={columns}
        rows={rowsOverride ?? rows}
        tableHeaderGrid={headerGrid}
        choiceGroups={groups}
        mobileTableDisplayMode="row-group-cards"
        value={value}
        onChange={setValue}
        errorCellIds={errorCellIds}
      />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

const valueOf = () => JSON.parse(screen.getByTestId('value').textContent!);

describe('행 단위 그룹 카드 — 척도 막대 그룹', () => {
  it('고른 그룹만 막대로 그린다 — 칸 글자 11개, 양끝·가운데 라벨. 다른 그룹은 세로 타일 그대로다', () => {
    render(<Harness />);
    const bar = screen.getByTestId('choice-group-scale-bar-g-sat');
    expect(within(bar).getAllByRole('radio')).toHaveLength(11);
    for (const text of CIRC) expect(within(bar).getByText(text)).toBeInTheDocument();
    for (const label of ['매우 불만족', '보통', '매우 만족']) {
      expect(within(bar).getByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByTestId('choice-group-original-line-g-sat')).not.toBeInTheDocument();
    // 활용 여부는 종전 타일
    expect(screen.getByText('활용 안함', { selector: 'span' })).toBeInTheDocument();
  });

  it('칸을 누르면 원래 보기 칸 id 로 저장되고, 다른 칸을 누르면 바뀐다. 선택값 표시가 뜬다', () => {
    render(<Harness />);
    const bar = screen.getByTestId('choice-group-scale-bar-g-sat');
    expect(within(bar).queryByTestId('scale-bar-selection')).not.toBeInTheDocument();
    fireEvent.click(within(bar).getByText('⑦'));
    expect(valueOf()).toEqual({ __choiceGroups: { rad2: 'sat7' } });
    fireEvent.click(within(bar).getByText('⑨'));
    expect(valueOf()).toEqual({ __choiceGroups: { rad2: 'sat9' } });
    expect(within(bar).getByTestId('scale-bar-selection')).toHaveTextContent('⑨ · 만족');
  });

  it('칸의 접근성 이름은 칸 글자 + 구간 이름이다', () => {
    render(<Harness />);
    const bar = screen.getByTestId('choice-group-scale-bar-g-sat');
    expect(within(bar).getByRole('radio', { name: '⑧ 만족' })).toBeInTheDocument();
    expect(within(bar).getByRole('radio', { name: '⓪ 매우 불만족' })).toBeInTheDocument();
  });

  it('저장된 답이 있으면 그 칸이 선택된 채로 그려진다', () => {
    render(<Harness initialValue={{ __choiceGroups: { rad2: 'sat8' } }} />);
    const bar = screen.getByTestId('choice-group-scale-bar-g-sat');
    expect(within(bar).getByRole('radio', { name: '⑧ 만족' })).toBeChecked();
    expect(within(bar).getByTestId('scale-bar-selection')).toHaveTextContent('⑧ · 만족');
  });

  it('원본 한 줄만 켠 그룹은 종전 원본 표 조각 그대로다', () => {
    render(<Harness satGroup={{ mobileOriginalLine: true }} />);
    expect(screen.getByTestId('choice-group-original-line-g-sat')).toBeInTheDocument();
    expect(screen.queryByTestId('choice-group-scale-bar-g-sat')).not.toBeInTheDocument();
  });

  it('칸 글자가 없는 보기가 있으면 원본 한 줄로 폴백한다', () => {
    const blank = rows.map((row) => ({
      ...row,
      cells: row.cells.map((cell) => (cell.id === 'sat4' ? { ...cell, content: '' } : cell)),
    }));
    render(<Harness rowsOverride={blank} />);
    expect(screen.queryByTestId('choice-group-scale-bar-g-sat')).not.toBeInTheDocument();
    expect(screen.getByTestId('choice-group-original-line-g-sat')).toBeInTheDocument();
  });

  it('보기 칸 사이에 입력칸이 섞이면 원본 한 줄로 폴백한다', () => {
    const mixed = rows.map((row) => ({
      ...row,
      cells: [
        ...row.cells.slice(0, 9),
        { id: 'note', type: 'input' as const, content: '' },
        ...row.cells.slice(9),
      ],
    }));
    const withExtraColumn = [
      ...columns.slice(0, 9),
      { id: 'note-col', label: '메모' },
      ...columns.slice(9),
    ];
    render(
      <InteractiveTableResponse
        questionId="q1"
        columns={withExtraColumn}
        rows={mixed}
        choiceGroups={[
          { id: 'g-use', groupKey: 'rad1', type: 'radio', label: '활용 여부' },
          { id: 'g-sat', groupKey: 'rad2', type: 'radio', label: '만족도', mobileScaleBar: true },
        ]}
        mobileTableDisplayMode="row-group-cards"
        value={{}}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByTestId('choice-group-scale-bar-g-sat')).not.toBeInTheDocument();
    expect(screen.getByTestId('choice-group-original-line-g-sat')).toBeInTheDocument();
  });

  it('데스크톱 폭에서는 막대가 나오지 않는다', () => {
    view.mobile = false;
    render(<Harness />);
    expect(screen.queryByTestId('choice-group-scale-bar-g-sat')).not.toBeInTheDocument();
    expect(screen.getAllByRole('radio').length).toBeGreaterThanOrEqual(13);
  });
});

describe('행 단위 그룹 카드 — 척도 막대 상태(필수 오류 · 접근성 · 방향키)', () => {
  it('「다음」 뒤 미충족 필수 그룹이면 막대 묶음이 오류 상태다 — 섹션 판정과 같은 위반 셀 집합', () => {
    const { rerender } = render(<Harness errorCellIds={new Set(scaleCells.map((c) => c.id))} />);
    expect(screen.getByRole('radiogroup', { name: '만족도' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    rerender(<Harness errorCellIds={new Set(['use1', 'use2'])} />);
    expect(screen.getByRole('radiogroup', { name: '만족도' })).not.toHaveAttribute('aria-invalid');
  });

  it('방향키로 칸을 옮기면 그 칸이 선택되고 포커스가 따라간다. 양끝에서는 반대편으로 돈다', () => {
    render(<Harness initialValue={{ __choiceGroups: { rad2: 'sat5' } }} />);
    const group = screen.getByRole('radiogroup', { name: '만족도' });
    const five = within(group).getByRole('radio', { name: '⑤ 보통' });
    fireEvent.keyDown(five, { key: 'ArrowRight' });
    expect(valueOf()).toEqual({ __choiceGroups: { rad2: 'sat6' } });
    const six = within(group).getByRole('radio', { name: '⑥ 만족' });
    expect(six).toHaveFocus();
    expect(six).toBeChecked();
    fireEvent.keyDown(six, { key: 'ArrowUp' });
    expect(valueOf()).toEqual({ __choiceGroups: { rad2: 'sat5' } });
    fireEvent.keyDown(within(group).getByRole('radio', { name: '⑤ 보통' }), { key: 'ArrowLeft' });
    expect(valueOf()).toEqual({ __choiceGroups: { rad2: 'sat4' } });

    fireEvent.keyDown(within(group).getByRole('radio', { name: '④ 불만족' }), { key: 'Home' });
    expect(valueOf()).toEqual({ __choiceGroups: { rad2: 'sat0' } });
    fireEvent.keyDown(within(group).getByRole('radio', { name: '⓪ 매우 불만족' }), {
      key: 'ArrowLeft',
    });
    expect(valueOf()).toEqual({ __choiceGroups: { rad2: 'sat10' } });
    expect(within(group).getByRole('radio', { name: '⑩ 매우 만족' })).toHaveFocus();
  });

  it('다른 키·수정키 조합은 선택을 바꾸지 않는다', () => {
    render(<Harness initialValue={{ __choiceGroups: { rad2: 'sat5' } }} />);
    const five = screen.getByRole('radio', { name: '⑤ 보통' });
    fireEvent.keyDown(five, { key: 'a' });
    fireEvent.keyDown(five, { key: 'ArrowRight', altKey: true });
    fireEvent.keyDown(five, { key: 'ArrowLeft', metaKey: true });
    expect(valueOf()).toEqual({ __choiceGroups: { rad2: 'sat5' } });
  });
});

describe('행 단위 그룹 카드 — 5점 척도 막대(칸 안 라벨)', () => {
  const FIVE = ['매우 불만족', '불만족', '보통', '만족', '매우 만족'];
  const fiveColumns: TableColumn[] = [
    { id: 'item', label: '평가항목' },
    ...FIVE.map((_, n) => ({ id: `s${n}`, label: `${n + 1}점` })),
  ];
  const fiveHeader: HeaderCell[][] = [
    [head('h-item', '평가항목', 1, 2), head('h-sat', '만족도', 5)],
    FIVE.map((label, n) => head(`h${n}`, label, 1)),
  ];
  const fiveRows: TableRow[] = [
    {
      id: 'r1',
      label: '회의실 및 교통비 지원',
      cells: [
        { id: 'item', type: 'text', content: '1) 회의실 및 교통비 지원' },
        ...FIVE.map((_, n) => ({
          id: `f${n}`,
          type: 'choice_opt' as const,
          content: String(n + 1),
          choiceGroupId: 'g-sat',
        })),
      ],
    },
  ];

  function FiveHarness() {
    const [value, setValue] = useState<Record<string, unknown>>({});
    return (
      <>
        <InteractiveTableResponse
          questionId="q1"
          columns={fiveColumns}
          rows={fiveRows}
          tableHeaderGrid={fiveHeader}
          choiceGroups={[
            { id: 'g-sat', groupKey: 'rad1', type: 'radio', label: '만족도', mobileScaleBar: true },
          ]}
          mobileTableDisplayMode="row-group-cards"
          value={value}
          onChange={setValue}
        />
        <output data-testid="value">{JSON.stringify(value)}</output>
      </>
    );
  }

  it('칸 안에 번호와 라벨이 함께 나오고, 접근성 이름에 라벨이 들어간다', () => {
    render(<FiveHarness />);
    const bar = screen.getByTestId('choice-group-scale-bar-g-sat');
    for (const label of FIVE) expect(within(bar).getByText(label)).toBeInTheDocument();
    expect(within(bar).getByRole('radio', { name: '4 만족' })).toBeInTheDocument();
  });

  it('고르면 저장되지만 선택값 표시는 없다 — 라벨이 이미 칸 안에 보인다', () => {
    render(<FiveHarness />);
    const bar = screen.getByTestId('choice-group-scale-bar-g-sat');
    fireEvent.click(within(bar).getByRole('radio', { name: '4 만족' }));
    expect(valueOf()).toEqual({ __choiceGroups: { rad1: 'f3' } });
    expect(within(bar).queryByTestId('scale-bar-selection')).not.toBeInTheDocument();
  });
});
