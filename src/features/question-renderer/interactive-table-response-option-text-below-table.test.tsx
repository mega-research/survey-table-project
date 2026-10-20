import { render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import type { TableCell, TableColumn, TableRow } from '@/types/survey';

import { CheckboxCell } from './cells';
import { InteractiveTableResponse } from './interactive-table-response';

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
  { id: 'c0', label: '구분', width: 250 },
  { id: 'c1', label: '2022년', width: 123 },
  { id: 'c2', label: '2023년', width: 123 },
];

const other = (id: string, below: boolean): TableCell => ({
  id,
  content: '',
  type: 'checkbox',
  checkboxOptions: [
    { id: `${id}-o`, label: '', value: '7', allowTextInput: true, textInputPlaceholder: '직접 기입' },
  ],
  ...(below ? { optionTextBelowTable: true } : {}),
});

const rowsWith = (below: boolean): TableRow[] => [
  {
    id: 'r1',
    label: '기타',
    cells: [{ id: 'lbl', content: '⑦ 기타', type: 'text' }, other('y22', below), other('y23', below)],
  },
];

const renderTable = (below: boolean, value: Record<string, unknown>) =>
  render(
    <InteractiveTableResponse
      questionId="q1"
      columns={columns}
      rows={rowsWith(below)}
      value={value}
      onChange={() => {}}
      enableSticky={false}
    />,
  );

/** 좁은 연도 칸의 「기타」 입력칸을 표 아래 줄로 — 칸 옵션, 기본은 종전대로 칸 안 */
describe('표 — 상세 기재 입력칸을 표 아래에', () => {
  it('옵션을 켜지 않은 칸은 종전대로 칸 안에 입력칸을 그린다', () => {
    const { container } = renderTable(false, { y22: ['7'] });
    const cell = container.querySelector('[data-cell-id="y22"]') as HTMLElement;
    expect(within(cell).getByPlaceholderText('직접 기입')).toBeTruthy();
    expect(screen.queryByTestId('option-text-below-table')).toBeNull();
  });

  it('옵션을 켠 칸은 선택한 「기타」의 입력칸을 표 아래에 행 제목 · 열 제목 라벨로 그린다', () => {
    const { container } = renderTable(true, { y22: ['7'], y23: ['7'] });
    const cell = container.querySelector('[data-cell-id="y22"]') as HTMLElement;
    expect(within(cell).queryByPlaceholderText('직접 기입')).toBeNull();

    const below = screen.getByTestId('option-text-below-table');
    expect(within(below).getAllByPlaceholderText('직접 기입')).toHaveLength(2);
    expect(within(below).getByLabelText('⑦ 기타 · 2022년')).toBeTruthy();
    expect(within(below).getByLabelText('⑦ 기타 · 2023년')).toBeTruthy();
    // 표 아래 줄은 가로 스크롤되는 격자 밖이다
    expect(below.closest('[role="grid"]')).toBeNull();
  });

  it('선택하지 않으면 표 아래에 아무것도 없다', () => {
    renderTable(true, {});
    expect(screen.queryByTestId('option-text-below-table')).toBeNull();
  });

  it('격자 표 밖(모바일 카드 등)에서 그린 칸은 옵션을 켜도 칸 안에 입력칸을 둔다', () => {
    render(
      <CheckboxCell
        cell={other('y22', true)}
        cellResponse={['7']}
        onUpdateValue={() => {}}
        questionId="q1"
      />,
    );
    expect(screen.getByPlaceholderText('직접 기입')).toBeTruthy();
  });
});
