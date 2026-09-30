import { useState } from 'react';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ChoiceGroup, Question, TableCell, TableRow } from '@/types/survey';

import { ChoiceTableResponse } from './choice-table-response';

/**
 * 보기 소스 표(radio/checkbox 문항 + 내장 표) — 모바일 표시 방식 「행별 척도」(row-wise-scale).
 * 행별 원본 문항과 같은 시트에서 원본 표 조각 자리만 척도 막대로 바뀐다. 쓰기는 이 문항의 보기
 * 선택 채널 그대로다(그룹이 있으면 그룹 맵, 없으면 문항 값).
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

const SCALE = ['①', '②', '③', '④', '⑤', '⑥', '⑦'];
const ITEMS = ['제품 기획', '마케팅'];

function question(options: {
  type?: 'radio' | 'checkbox';
  grouped?: boolean;
  mode?: Question['mobileTableDisplayMode'];
  editRow?: (row: TableRow) => TableRow;
}): Question {
  const { type = 'radio', grouped = true, mode = 'row-wise-scale' } = options;
  const choiceGroups: ChoiceGroup[] = grouped
    ? ITEMS.map((_, i) => ({ id: `g${i + 1}`, groupKey: `rad${i + 1}`, type, label: '' }))
    : [];
  const rows: TableRow[] = ITEMS.map((item, i) => ({
    id: `r${i + 1}`,
    label: item,
    cells: [
      { id: `r${i + 1}-item`, type: 'text', content: item },
      ...SCALE.map(
        (content, n): TableCell => ({
          id: `r${i + 1}-c${n}`,
          type: 'choice_opt',
          content,
          choiceLabel: `${n + 1}점`,
          ...(grouped ? { choiceGroupId: `g${i + 1}` } : {}),
        }),
      ),
    ],
  }));
  return {
    id: 'q1',
    type,
    title: '필요도',
    required: false,
    order: 0,
    mobileTableDisplayMode: mode,
    mobileDrilldownOmitLeadingColumns: 1,
    choiceGroups,
    tableColumns: [
      { id: 'item', label: '분야' },
      ...SCALE.map((_, n) => ({ id: `s${n}`, label: '' })),
    ],
    tableHeaderGrid: [
      [
        { id: 'h-item', label: '분야', colspan: 1, rowspan: 1 },
        { id: 'h-lo', label: '전혀 필요 없음', colspan: 3, rowspan: 1 },
        { id: 'h-mid', label: '보통', colspan: 1, rowspan: 1 },
        { id: 'h-hi', label: '매우 필요함', colspan: 3, rowspan: 1 },
      ],
    ],
    tableRowsData: options.editRow ? rows.map(options.editRow) : rows,
  } as Question;
}

function Harness({ q, initialValue }: { q: Question; initialValue?: unknown }) {
  const [value, setValue] = useState<unknown>(initialValue);
  return (
    <>
      <ChoiceTableResponse question={q} value={value} onChange={setValue} />
      <output data-testid="value">{JSON.stringify(value ?? null)}</output>
    </>
  );
}

const valueOf = () => JSON.parse(screen.getByTestId('value').textContent!);
const rowBlock = (rowId: string) =>
  document.querySelector<HTMLElement>(`[data-row-question-id="${rowId}"]`)!;

describe('ChoiceTableResponse (mobile) — 행별 척도', () => {
  it('행마다 막대 하나 — 행 제목을 접근성 이름으로, 가운데 라벨은 헤더 구간에서', () => {
    render(<Harness q={question({})} />);
    for (const [i, item] of ITEMS.entries()) {
      const block = rowBlock(`r${i + 1}`);
      const bar = within(block).getByTestId(`choice-group-scale-bar-g${i + 1}`);
      expect(within(bar).getByRole('radiogroup', { name: item })).toBeInTheDocument();
      expect(within(bar).getAllByRole('radio')).toHaveLength(7);
      expect(within(block).getAllByRole('radio').every((radio) => bar.contains(radio))).toBe(true);
    }
    const bar = screen.getByTestId('choice-group-scale-bar-g1');
    for (const label of ['전혀 필요 없음', '보통', '매우 필요함']) {
      expect(within(bar).getByText(label)).toBeInTheDocument();
    }
  });

  it('보기 그룹 행 — 칸을 누르면 그룹 맵에 원래 보기 칸 id, 다른 칸을 누르면 바뀐다', () => {
    render(<Harness q={question({})} />);
    const bar = screen.getByTestId('choice-group-scale-bar-g2');
    fireEvent.click(within(bar).getByText('⑥'));
    expect(valueOf()).toEqual({ rad2: 'r2-c5' });
    fireEvent.click(within(bar).getByText('②'));
    expect(valueOf()).toEqual({ rad2: 'r2-c1' });
  });

  it('저장된 답이 있으면 그 칸이 선택된 채로 그려진다', () => {
    render(<Harness q={question({})} initialValue={{ rad1: 'r1-c3' }} />);
    expect(
      within(screen.getByTestId('choice-group-scale-bar-g1')).getByRole('radio', { name: '④ 보통' }),
    ).toBeChecked();
  });

  it('그룹 없는 radio 문항 — 행의 보기 칸 묶음이 막대이고 문항 값에 원래 보기 칸 id', () => {
    render(<Harness q={question({ grouped: false })} />);
    const bar = within(rowBlock('r1')).getByTestId('choice-group-scale-bar-run:r1-c0');
    fireEvent.click(within(bar).getByText('⑦'));
    expect(valueOf()).toBe('r1-c6');
  });

  it('checkbox 문항의 그룹 없는 보기 칸은 복수 선택이라 원본 표 조각이다', () => {
    render(<Harness q={question({ type: 'checkbox', grouped: false })} />);
    expect(screen.queryByTestId('choice-group-scale-bar-run:r1-c0')).not.toBeInTheDocument();
    expect(within(rowBlock('r1')).getAllByRole('checkbox')).toHaveLength(7);
  });

  it('막대로 못 그리는 행은 그 행만 원본 표 조각이다', () => {
    render(
      <Harness
        q={question({
          editRow: (row) =>
            row.id === 'r2'
              ? {
                  ...row,
                  cells: row.cells.map((cell) =>
                    cell.id === 'r2-c6' ? { ...cell, allowTextInput: true } : cell,
                  ),
                }
              : row,
        })}
      />,
    );
    expect(screen.getByTestId('choice-group-scale-bar-g1')).toBeInTheDocument();
    expect(screen.queryByTestId('choice-group-scale-bar-g2')).not.toBeInTheDocument();
    expect(within(rowBlock('r2')).getAllByRole('radio')).toHaveLength(7);
  });

  it('「행별 원본 문항」은 종전 원본 표 조각 그대로다', () => {
    render(<Harness q={question({ mode: 'row-wise-original' })} />);
    expect(screen.queryByTestId('choice-group-scale-bar-g1')).not.toBeInTheDocument();
    expect(within(rowBlock('r1')).getAllByRole('radio')).toHaveLength(7);
  });

  it('데스크톱 폭에서는 막대가 나오지 않는다', () => {
    view.mobile = false;
    render(<Harness q={question({})} />);
    expect(screen.queryByTestId('choice-group-scale-bar-g1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mobile-row-wise-original-sheet')).not.toBeInTheDocument();
  });
});
