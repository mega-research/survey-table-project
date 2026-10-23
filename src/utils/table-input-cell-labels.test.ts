import { describe, expect, it } from 'vitest';

import type { TableCell, TableRow } from '@/types/survey';

import { tableInputCellLabels } from './table-input-cell-labels';

function cell(id: string, type: TableCell['type'], content = ''): TableCell {
  return { id, type, content } as TableCell;
}

describe('tableInputCellLabels', () => {
  it('같은 행 앞 글자 칸 첫 줄로 부르고, 없으면 행 이름·위치로 부른다', () => {
    const rows = [
      {
        id: 'r1',
        label: '',
        cells: [cell('t1', 'text', '(1) 기업명\n법인 기준'), cell('i1', 'input')],
      },
      { id: 'r2', label: '연락처', cells: [cell('i2', 'input'), cell('i3', 'input')] },
      { id: 'r3', label: '', cells: [cell('i4', 'input')] },
    ] as TableRow[];
    expect([...tableInputCellLabels(rows)]).toEqual([
      ['i1', '(1) 기업명'],
      ['i2', '연락처'],
      ['i3', '연락처'],
      ['i4', '3행 1열'],
    ]);
  });

  it('한 글자 칸 뒤 입력 칸이 여럿이면 몇 번째인지 붙이고, 병합에 가려진 칸은 뺀다', () => {
    const rows = [
      {
        id: 'r1',
        label: '',
        cells: [
          cell('t1', 'text', '설립연도'),
          cell('i1', 'input'),
          cell('i2', 'input'),
          { ...cell('i3', 'input'), isHidden: true },
        ],
      },
    ] as TableRow[];
    expect([...tableInputCellLabels(rows)]).toEqual([
      ['i1', '설립연도'],
      ['i2', '설립연도 (2번째 칸)'],
    ]);
  });
});
