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
const groups: ChoiceGroup[] = ITEMS.map((_, i) => ({
  id: `g${i + 1}`,
  groupKey: `rad${i + 1}`,
  type: 'radio',
  label: '',
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
  initialValue = {},
  errorCellIds,
}: {
  mode?: MobileTableDisplayMode;
  rowsOverride?: TableRow[];
  columnsOverride?: TableColumn[];
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
        choiceGroups={groups}
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
      expect(within(block).getAllByRole('radio').every((radio) => bar.contains(radio))).toBe(true);
    }
    // 양끝·가운데 라벨은 헤더 구간에서
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
    expect(within(bar).getByTestId('scale-bar-selection')).toHaveTextContent('③ · 별로 그렇지 않다');
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

  it('막대로 못 그리는 행은 그 행만 원본 표 조각이다', () => {
    const mixed = rows.map((row) =>
      row.id === 'r2'
        ? { ...row, cells: [...row.cells, { id: 'r2-memo', type: 'input' as const, content: '' }] }
        : { ...row, cells: [...row.cells, { id: `${row.id}-blank`, type: 'text' as const, content: '' }] },
    );
    render(<Harness rowsOverride={mixed} columnsOverride={[...columns, { id: 'memo', label: '메모' }]} />);
    expect(screen.getByTestId('choice-group-scale-bar-g1')).toBeInTheDocument();
    expect(screen.getByTestId('choice-group-scale-bar-g3')).toBeInTheDocument();
    expect(screen.queryByTestId('choice-group-scale-bar-g2')).not.toBeInTheDocument();
    // 원본 표 조각 — 보기 칸이 표 셀 컨트롤로, 입력칸도 함께 그려진다
    expect(within(rowBlock('r2')).getAllByRole('radio')).toHaveLength(11);
    expect(within(rowBlock('r2')).getByRole('textbox')).toBeInTheDocument();
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
