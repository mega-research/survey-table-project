import { useState } from 'react';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { MobileTableDisplayMode } from '@/types/mobile-table-display';
import type { ChoiceGroup, HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';

import { InteractiveTableResponse } from './interactive-table-response';

/**
 * 표 문항 — 모바일 표시 방식 「행별 척도」(row-wise-scale). 「행별 원본 문항」과 같은 시트 구조에서
 * 원본 표 조각 자리만 척도 막대로 바뀐다. 해운물류 멘토 D1(항목마다 0~10점, 행마다 보기 그룹).
 */

const view = vi.hoisted(() => ({ mobile: true }));
vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => view.mobile,
  useMediaQuery: () => view.mobile,
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
const ITEMS = ['멘토의 전문성', '멘토링 시간', '자료 제공'];
const head = (id: string, label: string, colspan: number): HeaderCell => ({
  id,
  label,
  colspan,
  rowspan: 1,
});
const headerGrid: HeaderCell[][] = [
  [
    head('h-item', '항목', 1),
    head('h-0', '전혀\n그렇지\n않다', 2),
    head('h-2', '별로\n그렇지\n않다', 3),
    head('h-5', '보통', 1),
    head('h-6', '약간\n그렇다', 3),
    head('h-9', '매우\n그렇다', 2),
  ],
];
const columns: TableColumn[] = [
  { id: 'item', label: '항목', width: 190 },
  ...CIRC.map((_, n) => ({ id: `s${n}`, label: `${n}점`, width: 64 })),
];
// 행마다 그룹 하나, 보기 모양 「척도 막대」 — 행별 척도는 막대로 고른 그룹만 막대로 그린다
const groups: ChoiceGroup[] = ITEMS.map((_, i) => ({
  id: `g${i + 1}`,
  groupKey: `rad${i + 1}`,
  type: 'radio',
  label: '',
  mobileScaleBar: true,
}));
const scaleCells = (rowIndex: number): TableCell[] =>
  CIRC.map((content, n) => ({
    id: `r${rowIndex + 1}-c${n}`,
    type: 'choice_opt' as const,
    content,
    choiceGroupId: `g${rowIndex + 1}`,
  }));
const rows: TableRow[] = ITEMS.map((item, i) => ({
  id: `r${i + 1}`,
  label: item,
  cells: [{ id: `r${i + 1}-item`, type: 'text', content: item }, ...scaleCells(i)],
}));

function Harness({
  mode = 'row-wise-scale',
  rowsOverride,
  columnsOverride,
  groupsOverride,
  initialValue = {},
  errorCellIds,
  headerHidden = false,
}: {
  headerHidden?: boolean;
  mode?: MobileTableDisplayMode;
  rowsOverride?: TableRow[];
  columnsOverride?: TableColumn[];
  groupsOverride?: ChoiceGroup[];
  initialValue?: Record<string, unknown>;
  errorCellIds?: Set<string>;
}) {
  const [value, setValue] = useState<Record<string, unknown>>(initialValue);
  return (
    <>
      <InteractiveTableResponse
        questionId="q1"
        columns={columnsOverride ?? columns}
        rows={rowsOverride ?? rows}
        tableHeaderGrid={headerGrid}
        choiceGroups={groupsOverride ?? groups}
        mobileTableDisplayMode={mode}
        mobileDrilldownOmitLeadingColumns={1}
        {...(headerHidden
          ? {
              hideColumnLabels: true,
              mobileDrilldownRepeatHeaderStartRow: null,
              mobileDrilldownRepeatHeaderEndRow: null,
            }
          : {})}
        value={value}
        onChange={setValue}
        errorCellIds={errorCellIds}
      />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

const valueOf = () => JSON.parse(screen.getByTestId('value').textContent!);
const rowBlock = (rowId: string) =>
  document.querySelector<HTMLElement>(`[data-row-question-id="${rowId}"]`)!;

describe('행별 척도 — 표 문항', () => {
  it('행마다 척도 막대 하나 — 행 제목은 그대로, 원본 표 조각은 없다', () => {
    render(<Harness />);
    for (const [i, item] of ITEMS.entries()) {
      const block = rowBlock(`r${i + 1}`);
      expect(within(block).getByText(item)).toBeInTheDocument();
      const bar = within(block).getByTestId(`choice-group-scale-bar-g${i + 1}`);
      expect(within(bar).getAllByRole('radio')).toHaveLength(11);
      expect(within(bar).getByRole('radiogroup', { name: item })).toBeInTheDocument();
      // 행의 컨트롤은 막대 칸뿐 — 원본 표 조각이 함께 그려지지 않는다
      expect(
        within(block)
          .getAllByRole('radio')
          .every((radio) => bar.contains(radio)),
      ).toBe(true);
    }
    // 양끝·가운데 라벨은 헤더 구간에서
    const bar = screen.getByTestId('choice-group-scale-bar-g1');
    for (const label of ['전혀 그렇지 않다', '보통', '매우 그렇다']) {
      expect(within(bar).getByText(label)).toBeInTheDocument();
    }
  });

  it('열 헤더를 숨기고 반복 헤더를 비운 표도 막대 라벨은 헤더 구간에서 온다', () => {
    render(<Harness headerHidden />);
    const bar = screen.getByTestId('choice-group-scale-bar-g1');
    for (const label of ['전혀 그렇지 않다', '보통', '매우 그렇다']) {
      expect(within(bar).getByText(label)).toBeInTheDocument();
    }
  });

  it('칸을 누르면 원래 보기 칸 id 로 그 행 그룹에 저장되고, 다른 칸을 누르면 바뀐다', () => {
    render(<Harness />);
    const bar = screen.getByTestId('choice-group-scale-bar-g2');
    fireEvent.click(within(bar).getByText('⑦'));
    expect(valueOf()).toEqual({ __choiceGroups: { rad2: 'r2-c7' } });
    fireEvent.click(within(bar).getByText('③'));
    expect(valueOf()).toEqual({ __choiceGroups: { rad2: 'r2-c3' } });
    expect(within(bar).getByTestId('scale-bar-selection')).toHaveTextContent(
      '③ · 별로 그렇지 않다',
    );
  });

  it('저장된 답이 있으면 그 칸이 선택된 채로 그려진다', () => {
    render(<Harness initialValue={{ __choiceGroups: { rad1: 'r1-c8', rad3: 'r3-c0' } }} />);
    expect(
      within(screen.getByTestId('choice-group-scale-bar-g1')).getByRole('radio', {
        name: '⑧ 약간 그렇다',
      }),
    ).toBeChecked();
    expect(
      within(screen.getByTestId('choice-group-scale-bar-g3')).getByRole('radio', {
        name: '⓪ 전혀 그렇지 않다',
      }),
    ).toBeChecked();
  });

  it('행에 입력칸이 있으면 막대 뒤에 입력칸 원본 조각이 남는다', () => {
    const withMemo = rows.map((row) =>
      row.id === 'r2'
        ? { ...row, cells: [...row.cells, { id: 'r2-memo', type: 'input' as const, content: '' }] }
        : {
            ...row,
            cells: [...row.cells, { id: `${row.id}-blank`, type: 'text' as const, content: '' }],
          },
    );
    render(
      <Harness
        rowsOverride={withMemo}
        columnsOverride={[...columns, { id: 'memo', label: '메모' }]}
      />,
    );
    const block = rowBlock('r2');
    const bar = within(block).getByTestId('choice-group-scale-bar-g2');
    expect(
      within(block)
        .getAllByRole('radio')
        .every((radio) => bar.contains(radio)),
    ).toBe(true);
    expect(within(block).getByRole('textbox')).toBeInTheDocument();
  });

  it('막대로 고른 그룹을 못 그리면 그 그룹은 원본 조각이다', () => {
    const flagged = rows.map((row) =>
      row.id === 'r2'
        ? {
            ...row,
            cells: row.cells.map((cell) =>
              cell.id === 'r2-c10' ? { ...cell, allowTextInput: true } : cell,
            ),
          }
        : row,
    );
    render(<Harness rowsOverride={flagged} />);
    expect(screen.getByTestId('choice-group-scale-bar-g1')).toBeInTheDocument();
    expect(screen.queryByTestId('choice-group-scale-bar-g2')).not.toBeInTheDocument();
    expect(within(rowBlock('r2')).getAllByRole('radio')).toHaveLength(11);
  });

  it('막대로 고르지 않은 그룹은 그룹 카드와 같은 세로 타일이고, 같은 행의 막대 그룹만 막대다', () => {
    // 한 행에 활용 여부(2칸, 보기 모양 기본) + 만족도(11칸, 척도 막대)
    const use: ChoiceGroup = { id: 'g-use', groupKey: 'rad9', type: 'radio', label: '활용 여부' };
    const mixedRow: TableRow = {
      ...rows[0]!,
      cells: [
        rows[0]!.cells[0]!,
        { id: 'use1', type: 'choice_opt', content: '①', choiceGroupId: 'g-use' },
        { id: 'use2', type: 'choice_opt', content: '②', choiceGroupId: 'g-use' },
        ...rows[0]!.cells.slice(1),
      ],
    };
    const withUse = [
      ...columns.slice(0, 1),
      { id: 'u1', label: '활용함' },
      { id: 'u2', label: '활용 안함' },
      ...columns.slice(1),
    ];
    render(
      <Harness
        rowsOverride={[mixedRow]}
        columnsOverride={withUse}
        groupsOverride={[use, { ...groups[0]!, label: '만족도' }]}
      />,
    );
    const block = rowBlock('r1');
    const bar = within(block).getByTestId('choice-group-scale-bar-g1');
    expect(within(bar).getAllByRole('radio')).toHaveLength(11);
    // 막대가 행에 여럿과 섞이면 그룹 이름으로 가른다
    expect(within(bar).getByRole('radiogroup', { name: '만족도' })).toBeInTheDocument();
    // 활용 여부는 세로 타일 두 장 — 행에 여럿이라 그룹 이름을 머리로 단다
    const tiles = within(block).getByRole('group', { name: '활용 여부' });
    expect(within(tiles).getAllByRole('radio')).toHaveLength(2);
    expect(
      within(block)
        .getAllByRole('radio')
        .filter((r) => !bar.contains(r)),
    ).toHaveLength(2);
    fireEvent.click(within(tiles).getAllByRole('radio')[1]!);
    expect(valueOf()).toEqual({ __choiceGroups: { rad9: 'use2' } });
  });

  it('보기 모양을 따로 고르지 않은 그룹은 세로 타일이다 — 행에 하나면 행 제목을 이름으로', () => {
    const tiles = groups.map(({ mobileScaleBar: _bar, ...group }) => group);
    render(<Harness groupsOverride={tiles} />);
    expect(screen.queryByTestId('choice-group-scale-bar-g1')).not.toBeInTheDocument();
    const group = within(rowBlock('r1')).getByRole('group', { name: ITEMS[0]! });
    expect(within(group).getAllByRole('radio')).toHaveLength(11);
    fireEvent.click(within(group).getAllByRole('radio')[3]!);
    expect(valueOf()).toEqual({ __choiceGroups: { rad1: 'r1-c3' } });
  });

  it('「원본 한 줄」로 고른 그룹은 그 그룹 열의 원본 표 조각이다', () => {
    const lines = groups.map(({ mobileScaleBar: _bar, ...group }) => ({
      ...group,
      mobileOriginalLine: true,
    }));
    render(<Harness groupsOverride={lines} />);
    const block = rowBlock('r1');
    expect(within(block).queryByRole('group', { name: ITEMS[0]! })).not.toBeInTheDocument();
    expect(within(block).getAllByRole('radio')).toHaveLength(11);
  });

  it('「다음」 뒤 미충족 필수 행이면 그 막대 묶음이 오류 상태다', () => {
    render(<Harness errorCellIds={new Set(scaleCells(0).map((cell) => cell.id))} />);
    expect(
      within(screen.getByTestId('choice-group-scale-bar-g1')).getByRole('radiogroup'),
    ).toHaveAttribute('aria-invalid', 'true');
    expect(
      within(screen.getByTestId('choice-group-scale-bar-g2')).getByRole('radiogroup'),
    ).not.toHaveAttribute('aria-invalid');
  });

  it('「행별 원본 문항」은 종전 원본 표 조각 그대로다', () => {
    render(<Harness mode="row-wise-original" />);
    expect(screen.queryByTestId('choice-group-scale-bar-g1')).not.toBeInTheDocument();
    expect(within(rowBlock('r1')).getAllByRole('radio')).toHaveLength(11);
  });

  it('데스크톱 폭에서는 막대가 나오지 않는다', () => {
    view.mobile = false;
    render(<Harness />);
    expect(screen.queryByTestId('choice-group-scale-bar-g1')).not.toBeInTheDocument();
    expect(screen.getAllByRole('radio').length).toBeGreaterThanOrEqual(33);
  });
});
