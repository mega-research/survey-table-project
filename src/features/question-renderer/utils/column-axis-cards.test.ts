import { describe, expect, it } from 'vitest';

import type { HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';

import { buildColumnAxisCards, withRowTitleAsCheckLabel } from './column-axis-cards';

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

describe('buildColumnAxisCards — 상위 구분', () => {
  // AI 실태조사 Q28 모양 — 「내부 R&D」가 세 행을 세로로 덮고, 「합계」는 두 열을 가로로 덮는다.
  const rndColumns: TableColumn[] = [
    { id: 'group', label: '구분' },
    { id: 'item', label: '구분' },
    { id: 'ratio', label: '비율' },
  ];
  const rndRows = (groupExtra: Partial<TableCell> = {}): TableRow[] => [
    {
      id: 'a',
      label: '',
      cells: [
        text('in', '내부 R&D', { rowspan: 2, ...groupExtra }),
        text('a-l', '① 독자'),
        input('a-v'),
      ],
    },
    {
      id: 'b',
      label: '',
      cells: [text('in-x', '내부 R&D', { isHidden: true }), text('b-l', '② 공동'), input('b-v')],
    },
    { id: 'c', label: '', cells: [text('out', '외부 R&D'), text('c-l', '④ 외주'), input('c-v')] },
    {
      id: 't',
      label: '',
      cells: [
        text('sum', '합계', { colspan: 2 }),
        text('sum-x', '', { isHidden: true }),
        input('t-v'),
      ],
    },
  ];
  const groupsOf = (rows: TableRow[]) =>
    buildColumnAxisCards({ columns: rndColumns, displayRows: rows })[0]!.items.map((item) => [
      item.label,
      item.groupCells.map((cell) => cell.content),
    ]);

  it('세로 병합된 구분 셀은 덮인 아래 행에도 따라가고, 구분 없는 행은 비어 있다', () => {
    expect(groupsOf(rndRows())).toEqual([
      ['① 독자', ['내부 R&D']],
      ['② 공동', ['내부 R&D']],
      ['④ 외주', ['외부 R&D']],
      ['합계', []],
    ]);
  });

  it('모바일에서 숨긴 구분 셀은 상위 구분이 되지 않는다', () => {
    expect(groupsOf(rndRows({ mobileDisplay: 'hidden' })).slice(0, 2)).toEqual([
      ['① 독자', []],
      ['② 공동', []],
    ]);
  });
});

describe('withRowTitleAsCheckLabel — 글자 없는 체크박스 하나짜리 칸은 행 제목이 라벨', () => {
  const lone = (extra: Partial<TableCell> = {}): TableCell => ({
    id: 'c',
    type: 'checkbox',
    content: '',
    checkboxOptions: [{ id: 'o1', label: '', value: '1' }],
    ...extra,
  });

  it('행 제목을 보기 라벨로 옮기고 보기 id·값은 그대로 둔다', () => {
    const out = withRowTitleAsCheckLabel(lone(), '① 벤처캐피탈(VC)');
    expect(out?.checkboxOptions).toEqual([{ id: 'o1', label: '① 벤처캐피탈(VC)', value: '1' }]);
    expect(out?.id).toBe('c');
  });

  it('PC 열 폭에 맞춘 줄바꿈은 띄어쓰기로 편다', () => {
    const out = withRowTitleAsCheckLabel(
      lone(),
      '② 스타트업 투자자\n(엑셀러레이터,\n컴퍼니빌더 등)',
    );
    expect(out?.checkboxOptions?.[0]?.label).toBe(
      '② 스타트업 투자자 (엑셀러레이터, 컴퍼니빌더 등)',
    );
  });

  it('보기에 글자가 있거나 보기가 여럿이면 종전대로 둔다 — 행 제목은 묶음 이름이다', () => {
    expect(
      withRowTitleAsCheckLabel(
        lone({ checkboxOptions: [{ id: 'o1', label: '받은 적 없음', value: '1' }] }),
        '해당 없음',
      ),
    ).toBeNull();
    expect(
      withRowTitleAsCheckLabel(
        lone({
          checkboxOptions: [
            { id: 'o1', label: '', value: '1' },
            { id: 'o2', label: '', value: '2' },
          ],
        }),
        '기관',
      ),
    ).toBeNull();
  });

  it('행 제목이 없거나 체크 칸이 아니거나 칸에 글자가 있으면 해당 없다', () => {
    expect(withRowTitleAsCheckLabel(lone(), '  ')).toBeNull();
    expect(withRowTitleAsCheckLabel(lone({ type: 'radio' }), '제목')).toBeNull();
    expect(withRowTitleAsCheckLabel(lone({ content: '설명' }), '제목')).toBeNull();
  });
});

describe('buildColumnAxisCards — 같은 행 칸이 열어 주는 상세 입력', () => {
  // 문4·문5 「9) 기타비용」 — 항목 글자 칸 안 입력칸(기타 내용, 금액 > 0 일 때 열림) + 금액 칸
  const cols: TableColumn[] = [
    { id: 'item', label: '구분' },
    { id: 'item2', label: '' },
    { id: 'amount', label: '응답 기재' },
  ];
  const body: TableRow[] = [
    { id: 'r1', label: '1) 숙박', cells: [text('l1', '1) 숙박', { colspan: 2 }), text('l1c', '', { isHidden: true }), input('a1', { content: '원' })] },
    {
      id: 'r9',
      label: '9) 기타비용',
      cells: [
        input('etc', {
          content: '9) 기타비용', colspan: 2, mobileLabel: '기타 내용',
          enabledWhen: { kind: 'numeric', controllerCellId: 'a9', op: '>', value: 0 },
        }),
        text('etc-c', '', { isHidden: true }),
        input('a9', { content: '원' }),
      ],
    },
  ];

  it('상세 입력은 제 열 카드가 아니라 같은 행 금액 칸 바로 뒤에 딸린다', () => {
    const cards = buildColumnAxisCards({ columns: cols, displayRows: body });
    expect(cards.map((card) => card.key)).toEqual(['amount']);
    const items = cards[0]!.items;
    expect(items.map((item) => [item.cell.id, item.label])).toEqual([
      ['a1', '1) 숙박'],
      ['a9', '9) 기타비용'],
    ]);
    expect(items[1]!.details.map((cell) => cell.id)).toEqual(['etc']);
    expect(items[0]!.details).toEqual([]);
  });

  it('다른 행 칸이 열어 주는 입력은 종전대로 제 열 카드에 남는다', () => {
    const crossRow: TableRow[] = [
      body[0]!,
      {
        id: 'r2',
        label: '2) 기타',
        cells: [
          input('x', { colspan: 2, enabledWhen: { kind: 'numeric', controllerCellId: 'a1', op: '>', value: 0 } }),
          text('x-c', '', { isHidden: true }),
          input('a2', { content: '원' }),
        ],
      },
    ];
    const cards = buildColumnAxisCards({ columns: cols, displayRows: crossRow });
    expect(cards.map((card) => card.key)).toEqual(['item', 'amount']);
  });
});
