import { describe, expect, it } from 'vitest';

import type { HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';

import {
  buildCellPositionLabels,
  buildColumnAxisCards,
  withRowTitleAsCheckLabel,
} from './column-axis-cards';

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

describe('buildColumnAxisCards — 보기 그룹 칸(표 유형 문항의 choice_opt)', () => {
  // 청암대 재학생 문14 모양 — 「알고 있음」 열 · 「이용한 적 있음」 열이 각각 복수선택 보기 그룹이고,
  // 부서 이름(행 제목)은 보기 칸 뒤 마지막 열에 있다.
  const groupColumns: TableColumn[] = [
    { id: 'know', label: '알고 있음' },
    { id: 'used', label: '이용한 적 있음' },
    { id: 'dept', label: '행정부서' },
  ];
  const opt = (id: string, group: string, extra: Partial<TableCell> = {}): TableCell => ({
    id,
    type: 'choice_opt',
    content: '',
    choiceGroupId: group,
    ...extra,
  });
  const groupRows: TableRow[] = [
    {
      id: 'r1',
      label: '교무처',
      cells: [opt('r1-k', 'gK'), opt('r1-u', 'gU'), text('r1-d', '1. 교무처')],
    },
    {
      id: 'r2',
      label: '사무처',
      cells: [opt('r2-k', 'gK'), opt('r2-u', 'gU'), text('r2-d', '2. 사무처')],
    },
  ];

  it('옵션을 켜지 않으면 보기 그룹 칸은 카드가 되지 않는다 — 표 아래 상세 기재 투영은 종전 그대로', () => {
    expect(buildColumnAxisCards({ columns: groupColumns, displayRows: groupRows })).toEqual([]);
  });

  it('옵션을 켜면 보기 그룹 칸이 놓인 열마다 카드, 행 제목은 그 행의 글자 셀이다', () => {
    const cards = buildColumnAxisCards({
      columns: groupColumns,
      displayRows: groupRows,
      includeChoiceOptCells: true,
    });
    expect(cards.map((card) => [card.key, card.title])).toEqual([
      ['know', '알고 있음'],
      ['used', '이용한 적 있음'],
    ]);
    expect(cards[0]!.items.map((item) => [item.cell.id, item.label])).toEqual([
      ['r1-k', '1. 교무처'],
      ['r2-k', '2. 사무처'],
    ]);
  });

  it('그룹이 없는 보기 칸과 숨은 보기 칸은 넣지 않는다', () => {
    const cards = buildColumnAxisCards({
      columns: groupColumns,
      displayRows: [
        {
          id: 'r1',
          label: '',
          cells: [
            { id: 'a', type: 'choice_opt', content: '' },
            opt('b', 'gU', { isHidden: true }),
            text('t', '교무처'),
          ],
        },
      ],
      includeChoiceOptCells: true,
    });
    expect(cards).toEqual([]);
  });
});

// 피지컬 AI 실태조사 A3 모양 — 적용 산업 | 판단 예시 | 공급(S) | 활용(U), 열마다 복수 선택 그룹.
// 판단 예시는 「바로 표시」, 마지막 행은 첫 칸이 「⑭ 기타」 입력(두 보기 칸 중 하나라도 고르면 열린다).
describe('buildColumnAxisCards — 설명 셀과 보기 칸이 여는 상세 입력', () => {
  const industryColumns: TableColumn[] = [
    { id: 'name', label: '적용 산업' },
    { id: 'example', label: '판단 예시' },
    { id: 'supply', label: '공급(S)' },
    { id: 'use', label: '활용(U)' },
  ];
  const choice = (id: string, group: string): TableCell => ({
    id,
    type: 'choice_opt',
    content: '',
    choiceGroupId: group,
  });
  const example = (id: string, content: string, extra: Partial<TableCell> = {}): TableCell =>
    text(id, content, { mobileDisplay: 'inline', ...extra });
  const otherInput: TableCell = {
    id: 'other-name',
    type: 'input',
    content: '⑭ 기타',
    enabledWhen: {
      kind: 'group',
      op: 'OR',
      terms: [
        { kind: 'choice-selected', controllerCellId: 's14' },
        { kind: 'choice-selected', controllerCellId: 'u14' },
      ],
    },
  };
  const industryRows: TableRow[] = [
    {
      id: 'r1',
      label: '제조 – 자동차·운송장비',
      cells: [text('n1', '① 제조 – 자동차·운송장비'), example('e1', '차량조립공정로봇'), choice('s1', 'gs'), choice('u1', 'gu')],
    },
    {
      id: 'r14',
      label: '⑭ 기타',
      cells: [otherInput, example('e14', '우주, 해양등'), choice('s14', 'gs'), choice('u14', 'gu')],
    },
  ];
  const build = (rowsIn: TableRow[], includeChoiceOptCells = true) =>
    buildColumnAxisCards({
      columns: industryColumns,
      displayRows: rowsIn,
      includeChoiceOptCells,
      inlineTextAsDescription: true,
    });

  it('「바로 표시」 글자 셀은 행 제목이 아니라 설명이 되고, 행 제목은 그 앞 글자 셀이다', () => {
    const [supply, use] = build(industryRows);
    expect([supply!.key, use!.key]).toEqual(['supply', 'use']);
    const first = supply!.items[0]!;
    expect(first.label).toBe('① 제조 – 자동차·운송장비');
    expect(first.descriptionCells.map((cell) => cell.id)).toEqual(['e1']);
    // 설명 셀은 상위 구분으로도 올라가지 않는다
    expect(first.groupCells).toEqual([]);
  });

  it('「바로 표시」가 아닌 글자 셀이 둘이면 종전대로 뒤 칸이 행 제목, 앞 칸이 상위 구분이다', () => {
    const plain: TableRow[] = [
      { id: 'r1', label: '', cells: [text('n1', '① 제조'), text('e1', '차량조립공정로봇'), choice('s1', 'gs'), choice('u1', 'gu')] },
    ];
    const item = build(plain)[0]!.items[0]!;
    expect(item.label).toBe('차량조립공정로봇');
    expect(item.groupCells.map((cell) => cell.id)).toEqual(['n1']);
    expect(item.descriptionCells).toEqual([]);
  });

  it('행 제목이 될 다른 글자 셀도 행 이름도 없으면 「바로 표시」 셀이 종전대로 행 제목이다', () => {
    const only: TableRow[] = [
      { id: 'r1', label: '', cells: [text('n1', ''), example('e1', '차량조립공정로봇'), choice('s1', 'gs'), choice('u1', 'gu')] },
    ];
    const item = build(only)[0]!.items[0]!;
    expect(item.label).toBe('차량조립공정로봇');
    expect(item.descriptionCells).toEqual([]);
  });

  it('보기 칸만으로 열리는 입력 칸은 제 열 카드가 서지 않고 컨트롤러 보기 타일마다 딸린다', () => {
    const cards = build(industryRows);
    // 「적용 산업」 열에는 다른 응답 칸이 없어 카드가 서지 않는다
    expect(cards.map((card) => card.key)).toEqual(['supply', 'use']);
    const [supplyOther, useOther] = cards.map((card) => card.items[1]!);
    expect(supplyOther!.cell.id).toBe('s14');
    expect(supplyOther!.details.map((cell) => cell.id)).toEqual(['other-name']);
    expect(useOther!.details.map((cell) => cell.id)).toEqual(['other-name']);
    // 입력 칸이 첫 칸이어도 뒤의 설명 셀이 제목 구역에 든다 — 제목은 행 이름, 설명은 판단 예시
    expect(supplyOther!.label).toBe('⑭ 기타');
    expect(supplyOther!.descriptionCells.map((cell) => cell.id)).toEqual(['e14']);
    // 다른 행 타일에는 딸리지 않는다
    expect(cards[0]!.items[0]!.details).toEqual([]);
  });

  it('컨트롤러에 응답 칸이 섞이면 묶지 않는다 — 종전대로 제 열 카드', () => {
    const mixed: TableRow[] = [
      {
        id: 'r1',
        label: '기타',
        cells: [
          {
            ...otherInput,
            enabledWhen: {
              kind: 'group',
              op: 'OR',
              terms: [
                { kind: 'choice-selected', controllerCellId: 's14' },
                { kind: 'filled', controllerCellId: 'memo' },
              ],
            },
          },
          input('memo', { content: '' }),
          choice('s14', 'gs'),
          choice('u14', 'gu'),
        ],
      },
    ];
    const cards = build(mixed);
    expect(cards.map((card) => card.key)).toEqual(['name', 'example', 'supply', 'use']);
    expect(cards[2]!.items[0]!.details).toEqual([]);
  });

  it('보기 칸을 카드 항목으로 넣지 않는 호출에서는 입력 칸이 종전대로 제 열 카드다', () => {
    const cards = build(industryRows, false);
    expect(cards.map((card) => card.key)).toEqual(['name']);
    expect(cards[0]!.items.map((item) => item.cell.id)).toEqual(['other-name']);
  });

  // Codex 리뷰(2026-11-13): 조건이 참이어도 고른 타일이 없을 수 있으면 타일 아래로 옮기면 안 된다 —
  // 「기타를 고르지 않았을 때 열리는 칸」은 타일을 고르면 닫히고 안 고르면 그릴 자리가 없어 영영 못 쓴다
  it('보기 칸을 NOT 으로 본 입력 칸은 묶지 않는다 — 종전대로 제 열 카드', () => {
    const negated: TableRow[] = [
      {
        id: 'r1',
        label: '기타',
        cells: [
          {
            ...otherInput,
            enabledWhen: {
              kind: 'group',
              op: 'NOT',
              terms: [{ kind: 'choice-selected', controllerCellId: 's14' }],
            },
          },
          example('e14', '우주, 해양등'),
          choice('s14', 'gs'),
          choice('u14', 'gu'),
        ],
      },
    ];
    const cards = build(negated);
    expect(cards.map((card) => card.key)).toEqual(['name', 'supply', 'use']);
    expect(cards[0]!.items.map((item) => item.cell.id)).toEqual(['other-name']);
    expect(cards[1]!.items[0]!.details).toEqual([]);
  });

  it('보기 칸이 여는 입력 칸이 다시 여는 칸(사슬)은 묶지 않고 제 열 카드에 남는다 — 어느 카드에도 안 그려지는 칸이 없게', () => {
    const chainColumns: TableColumn[] = [
      { id: 'name', label: '적용 산업' },
      { id: 'memo', label: '비고' },
      { id: 'supply', label: '공급(S)' },
      { id: 'use', label: '활용(U)' },
    ];
    const chained: TableRow[] = [
      {
        id: 'r1',
        label: '기타',
        cells: [
          { ...otherInput, enabledWhen: { kind: 'choice-selected', controllerCellId: 's14' } },
          input('memo', { content: '', enabledWhen: { kind: 'filled', controllerCellId: 'other-name' } }),
          choice('s14', 'gs'),
          choice('u14', 'gu'),
        ],
      },
    ];
    const cards = buildColumnAxisCards({ columns: chainColumns, displayRows: chained, includeChoiceOptCells: true });
    expect(cards.map((card) => card.key)).toEqual(['memo', 'supply', 'use']);
    expect(cards[0]!.items.map((item) => item.cell.id)).toEqual(['memo']);
    expect(cards[1]!.items[0]!.details.map((cell) => cell.id)).toEqual(['other-name']);
    // 그려진 칸 전부: 보기 둘 + 기타 내용(타일 아래) + 비고(제 열 카드)
    const drawn = new Set(cards.flatMap((card) => card.items.flatMap((item) => [item.cell.id, ...item.details.map((d) => d.id)])));
    expect([...drawn].sort()).toEqual(['memo', 'other-name', 's14', 'u14']);
  });

  // Codex 리뷰(2026-11-13): 행 제목 규칙은 표 아래 상세 기재 라벨·이미지 머리 줄도 쓴다 — 설명 셀 규칙은 축 카드 호출만 켠다
  it('설명 셀 규칙을 켜지 않은 호출은 「바로 표시」 셀도 종전대로 행 제목 후보다', () => {
    const cards = buildColumnAxisCards({ columns: industryColumns, displayRows: industryRows, includeChoiceOptCells: true });
    const first = cards.find((card) => card.key === 'supply')!.items[0]!;
    expect(first.label).toBe('차량조립공정로봇');
    expect(first.groupCells.map((cell) => cell.id)).toEqual(['n1']);
    expect(first.descriptionCells).toEqual([]);
    expect(buildCellPositionLabels({ columns: industryColumns, displayRows: industryRows }).get('s1')).toBe(
      '차량조립공정로봇 · 공급(S)',
    );
  });
});
