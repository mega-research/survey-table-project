import { describe, expect, it } from 'vitest';

import type { HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';

import { buildColumnAxisCards } from './column-axis-cards';

// AI 실태조사 Q22 모양 — 구분 열(들여쓰기 칸 포함) + 연도 열 둘, 칸마다 「명」 단위가 붙은 입력칸.
const columns: TableColumn[] = [
  { id: 'indent', label: '구분' },
  { id: 'item', label: '' },
  { id: 'y25', label: '2025년\n(`25.12.31)' },
  { id: 'y26', label: '2026년 (현재**)' },
];
const text = (id: string, content: string, extra: Partial<TableCell> = {}): TableCell => ({
  id,
  type: 'text',
  content,
  ...extra,
});
const input = (id: string, extra: Partial<TableCell> = {}): TableCell => ({
  id,
  type: 'input',
  content: '명',
  ...extra,
});
const rows: TableRow[] = [
  {
    id: 'r1',
    label: '',
    cells: [
      text('r1a', '22-1) 전체 종사자 수', { colspan: 2 }),
      text('r1b', '', { isHidden: true }),
      input('r1-25'),
      input('r1-26'),
    ],
  },
  {
    id: 'r2',
    label: '',
    cells: [text('r2a', ''), text('r2b', '22-2-1) 여성 종사자 수'), input('r2-25'), input('r2-26')],
  },
];

describe('buildColumnAxisCards', () => {
  it('응답 칸이 놓인 열마다 카드 하나 — 제목은 열 제목(줄바꿈은 공백), 항목은 행 순서', () => {
    const cards = buildColumnAxisCards({ columns, displayRows: rows });
    expect(cards.map((card) => [card.key, card.title])).toEqual([
      ['y25', '2025년 (`25.12.31)'],
      ['y26', '2026년 (현재**)'],
    ]);
    expect(cards[0]!.items.map((item) => [item.cell.id, item.label])).toEqual([
      ['r1-25', '22-1) 전체 종사자 수'],
      ['r2-25', '22-2-1) 여성 종사자 수'],
    ]);
    expect(cards[1]!.items.map((item) => item.cell.id)).toEqual(['r1-26', 'r2-26']);
  });

  it('다단 헤더는 가장 아래 글자가 제목, 위쪽은 상위 줄이다', () => {
    const head = (label: string, colspan = 1, rowspan = 1): HeaderCell => ({
      id: label,
      label,
      colspan,
      rowspan,
    });
    const cards = buildColumnAxisCards({
      columns,
      headerGrid: [
        [head('구분', 2, 2), head('종사자 수', 2)],
        [head('2025년'), head('2026년')],
      ],
      displayRows: rows,
    });
    expect(cards.map((card) => [card.ancestors, card.title])).toEqual([
      [['종사자 수'], '2025년'],
      [['종사자 수'], '2026년'],
    ]);
  });

  it('숨긴 칸·세로 병합으로 가려진 칸은 항목이 아니고, 모바일에서 숨긴 글자 셀은 행 제목이 되지 않는다', () => {
    const cards = buildColumnAxisCards({
      columns,
      displayRows: [
        {
          id: 'r1',
          label: '행 라벨',
          cells: [
            text('a', '상위'),
            text('b', '숨긴 제목', { mobileDisplay: 'hidden' }),
            input('i25'),
            input('i26', { isHidden: true }),
          ],
        },
      ],
    });
    expect(cards.map((card) => card.key)).toEqual(['y25']);
    expect(cards[0]!.items[0]!.label).toBe('상위');
  });

  it('응답 칸이 없는 표는 카드가 없다', () => {
    expect(
      buildColumnAxisCards({
        columns,
        displayRows: [{ id: 'r', label: '', cells: [text('a', 'x'), text('b', 'y')] }],
      }),
    ).toEqual([]);
  });
});
