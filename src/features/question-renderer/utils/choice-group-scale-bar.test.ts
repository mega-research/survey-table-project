import { describe, expect, it } from 'vitest';

import {
  type ProjectScaleBarInput,
  projectScaleBar,
} from '@/features/question-renderer/utils/choice-group-scale-bar';
import type { HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';

// 해운물류 멘토 C4 모양 — 구분·항목·활용 여부 2칸·만족도 11칸(⓪~⑩).
const CIRC = ['⓪', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
const col = (id: string): TableColumn => ({ id, label: id });
const head = (id: string, label: string, colspan: number, rowspan = 1): HeaderCell => ({
  id,
  label,
  colspan,
  rowspan,
});
const choice = (id: string, content: string, extra: Partial<TableCell> = {}): TableCell => ({
  id,
  type: 'choice_opt',
  content,
  choiceGroupId: 'g-sat',
  ...extra,
});

function c4(options: { scale?: TableCell[]; headerGrid?: HeaderCell[][] | undefined } = {}) {
  const scale = options.scale ?? CIRC.map((text, n) => choice(`c${n}`, text));
  const columns = [
    col('category'),
    col('item'),
    col('use1'),
    col('use2'),
    ...scale.map((_, n) => col(`s${n}`)),
  ];
  const row: TableRow = {
    id: 'r1',
    label: '회의실 및 교통비 지원',
    cells: [
      { id: 'cat', type: 'text', content: '지원 제도' },
      { id: 'item', type: 'text', content: '회의실 및 교통비 지원' },
      { id: 'u1', type: 'choice_opt', content: '①', choiceGroupId: 'g-use' },
      { id: 'u2', type: 'choice_opt', content: '②', choiceGroupId: 'g-use' },
      ...scale,
    ],
  };
  const input: ProjectScaleBarInput = {
    selectionType: 'radio',
    columns,
    headerGrid: 'headerGrid' in options ? options.headerGrid : C4_HEADER,
    row,
    targetCells: scale,
  };
  return input;
}

// 실측 C4 헤더 2줄 — 첫 줄은 그룹 제목(만족도), 둘째 줄은 구간.
const C4_HEADER: HeaderCell[][] = [
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

function modelOf(input: ProjectScaleBarInput) {
  const result = projectScaleBar(input);
  if (!result.ok) throw new Error(`폴백: ${result.reason}`);
  return result.model;
}

describe('projectScaleBar — 헤더 줄 역할 판정', () => {
  it('실측 C4 헤더 2줄: 제목 줄은 버리고 구간 5개, 양끝·가운데 라벨, 선택값 표시', () => {
    const model = modelOf(c4());
    expect(model.cells.map((c) => c.text)).toEqual(CIRC);
    expect(model.cells.map((c) => c.cellId)).toEqual(CIRC.map((_, n) => `c${n}`));
    expect(model.bands).toEqual([
      { label: '매우 불만족', start: 0, span: 1 },
      { label: '불만족', start: 1, span: 4 },
      { label: '보통', start: 5, span: 1 },
      { label: '만족', start: 6, span: 4 },
      { label: '매우 만족', start: 10, span: 1 },
    ]);
    expect(model.cells.map((c) => c.bandIndex)).toEqual([0, 1, 1, 1, 1, 2, 3, 3, 3, 3, 4]);
    expect(model.anchors).toEqual({
      left: '매우 불만족',
      middle: { label: '보통', index: 5 },
      right: '매우 만족',
    });
    expect(model.showsSelectionLabel).toBe(true);
  });

  it('D1 헤더 1줄 — 줄바꿈 라벨은 공백으로 잇고, 여러 칸짜리 구간 이름은 막대 아래에 쓰지 않는다', () => {
    const d1Header: HeaderCell[][] = [
      [
        head('h-cat', '구분', 1),
        head('h-item', '평가항목', 1),
        head('h-use', '활용 여부', 2),
        head('h-a', '전혀\n그렇지\n않다', 2),
        head('h-b', '별로\n그렇지\n않다', 3),
        head('h-c', '보통', 1),
        head('h-d', '약간\n그렇다', 3),
        head('h-e', '매우\n그렇다', 2),
      ],
    ];
    const model = modelOf(c4({ headerGrid: d1Header }));
    expect(model.bands.map((b) => b.label)).toEqual([
      '전혀 그렇지 않다',
      '별로 그렇지 않다',
      '보통',
      '약간 그렇다',
      '매우 그렇다',
    ]);
    expect(model.anchors).toEqual({
      left: '전혀 그렇지 않다',
      middle: { label: '보통', index: 5 },
      right: '매우 그렇다',
    });
  });

  it('3줄 헤더(제목 + 구간 + 숫자 칸 줄) + 빈 보기 칸 — 칸 글자는 칸 줄에서 온다', () => {
    const scale = CIRC.map((_, n) => choice(`c${n}`, ''));
    const header: HeaderCell[][] = [
      ...C4_HEADER.map((row) =>
        row.map((cell) => (cell.rowspan === 2 ? { ...cell, rowspan: 3 } : cell)),
      ),
      [
        head('h-u1n', '', 1),
        head('h-u2n', '', 1),
        ...CIRC.map((text, n) => head(`n${n}`, text, 1)),
      ],
    ];
    const model = modelOf(c4({ scale, headerGrid: header }));
    expect(model.cells.map((c) => c.text)).toEqual(CIRC);
    expect(model.bands).toHaveLength(5);
    expect(model.anchors.middle).toEqual({ label: '보통', index: 5 });
  });

  it('구간 줄이 둘이면 보기에 가장 가까운 아래 줄을 쓴다', () => {
    const header: HeaderCell[][] = [
      [
        head('h-pre', '', 4),
        head('h-top-neg', '부정', 5),
        head('h-top-5', '중립', 1),
        head('h-top-pos', '긍정', 5),
      ],
      [head('x-cat', '', 1), head('x-item', '', 1), ...C4_HEADER[1]!],
    ];
    const model = modelOf(c4({ headerGrid: header }));
    expect(model.bands.map((b) => b.label)).toEqual([
      '매우 불만족',
      '불만족',
      '보통',
      '만족',
      '매우 만족',
    ]);
  });

  it('짝수 칸이면 가운데 라벨이 없다', () => {
    const scale = CIRC.slice(0, 10).map((text, n) => choice(`c${n}`, text));
    const header: HeaderCell[][] = [
      [head('h-pre', '', 4), head('h-neg', '불만족', 5), head('h-pos', '만족', 5)],
    ];
    const model = modelOf(c4({ scale, headerGrid: header }));
    expect(model.anchors).toEqual({ left: '불만족', right: '만족' });
  });

  it('가운데 칸을 덮는 구간이 여러 칸짜리면 가운데 라벨이 없다', () => {
    const header: HeaderCell[][] = [
      [
        head('h-pre', '', 4),
        head('h-neg', '불만족', 3),
        head('h-mid', '보통', 5),
        head('h-pos', '만족', 3),
      ],
    ];
    const model = modelOf(c4({ headerGrid: header }));
    expect(model.anchors.middle).toBeUndefined();
  });

  it('헤더가 없으면 구간·라벨 없이 칸 글자만', () => {
    const model = modelOf(c4({ headerGrid: undefined }));
    expect(model.cells.map((c) => c.text)).toEqual(CIRC);
    expect(model.cells.every((c) => c.bandIndex === null)).toBe(true);
    expect(model.bands).toEqual([]);
    expect(model.anchors).toEqual({});
    expect(model.showsSelectionLabel).toBe(false);
  });

  it('그룹 밖 열만 덮는 헤더 칸은 빠지고, 걸친 병합 칸은 걸친 만큼만 남는다', () => {
    const header: HeaderCell[][] = [
      [
        head('h-cat', '구분', 1),
        head('h-item', '평가항목', 1),
        // 활용 여부 2칸 + 만족도 첫 칸(⓪)까지 걸친 구간
        head('h-left', '매우 불만족', 3),
        head('h-neg', '불만족', 4),
        head('h-5', '보통', 1),
        head('h-pos', '만족', 4),
        head('h-10', '매우 만족', 1),
      ],
    ];
    const model = modelOf(c4({ headerGrid: header }));
    expect(model.bands[0]).toEqual({ label: '매우 불만족', start: 0, span: 1 });
    expect(model.bands.map((b) => b.label)).not.toContain('평가항목');
  });

  it('칸 줄만 있으면 구간이 없다 — 칸 줄은 칸 글자의 대체 출처일 뿐이다', () => {
    const labels = [
      '전혀 아니다',
      '아니다',
      '약간 아니다',
      '보통',
      '약간 그렇다',
      '그렇다',
      '매우 그렇다',
    ];
    const scale = labels.map((_, n) => choice(`c${n}`, String(n + 1)));
    const header: HeaderCell[][] = [
      [head('h-pre', '', 4), ...labels.map((label, n) => head(`h${n}`, label, 1))],
    ];
    const model = modelOf(c4({ scale, headerGrid: header }));
    expect(model.cells.map((c) => c.text)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    expect(model.bands).toEqual([]);
    expect(model.anchors).toEqual({});
    expect(model.showsSelectionLabel).toBe(false);
  });

  it('일부 칸에만 이름이 있는 줄(양끝·가운데)은 구간 줄이다', () => {
    const header: HeaderCell[][] = [
      [
        head('h-pre', '', 4),
        head('h-0', '매우 불만족', 1),
        head('h-gap1', '', 4),
        head('h-5', '보통', 1),
        head('h-gap2', '', 4),
        head('h-10', '매우 만족', 1),
      ],
    ];
    const model = modelOf(c4({ headerGrid: header }));
    expect(model.bands.map((b) => b.label)).toEqual(['매우 불만족', '보통', '매우 만족']);
    expect(model.cells.map((c) => c.bandIndex)).toEqual([
      0,
      null,
      null,
      null,
      null,
      1,
      null,
      null,
      null,
      null,
      2,
    ]);
    expect(model.anchors).toEqual({
      left: '매우 불만족',
      middle: { label: '보통', index: 5 },
      right: '매우 만족',
    });
  });

  it('보기 칸 글자는 exportLabel 이 아니라 평문 content 다', () => {
    const scale = CIRC.map((text, n) => choice(`c${n}`, text, { exportLabel: `${n}점 (라벨)` }));
    const model = modelOf(c4({ scale }));
    expect(model.cells[0]!.text).toBe('⓪');
  });
});

describe('projectScaleBar — 5칸 이하 칸 안 라벨', () => {
  const FIVE = ['매우 불만족', '불만족', '보통', '만족', '매우 만족'];
  const fiveScale = (texts: string[] = ['1', '2', '3', '4', '5']) =>
    texts.map((text, n) => choice(`c${n}`, text));

  it('칸 줄이 있으면 칸 안 라벨은 칸 줄 글자다. 양끝·가운데 라벨과 선택값 표시는 없다', () => {
    const header: HeaderCell[][] = [
      [head('h-pre', '', 4), head('h-sat', '만족도', 5)],
      [head('h-pre2', '', 4), ...FIVE.map((label, n) => head(`h${n}`, label, 1))],
    ];
    const model = modelOf(c4({ scale: fiveScale(), headerGrid: header }));
    expect(model.cells.map((c) => [c.text, c.inCellLabel])).toEqual([
      ['1', '매우 불만족'],
      ['2', '불만족'],
      ['3', '보통'],
      ['4', '만족'],
      ['5', '매우 만족'],
    ]);
    expect(model.anchors).toEqual({});
    expect(model.showsSelectionLabel).toBe(false);
  });

  it('칸 줄이 없으면 그 칸을 덮는 한 칸짜리 구간 이름 — 여러 칸짜리 구간은 칸 안에 쓰지 않는다', () => {
    const header: HeaderCell[][] = [
      [
        head('h-pre', '', 4),
        head('h-neg', '불만족', 2),
        head('h-mid', '보통', 1),
        head('h-pos', '만족', 2),
      ],
    ];
    const model = modelOf(c4({ scale: fiveScale(), headerGrid: header }));
    expect(model.cells.map((c) => c.inCellLabel)).toEqual([
      undefined,
      undefined,
      '보통',
      undefined,
      undefined,
    ]);
    expect(model.bands.map((b) => b.label)).toEqual(['불만족', '보통', '만족']);
    expect(model.anchors).toEqual({});
    expect(model.showsSelectionLabel).toBe(false);
  });

  it('보기 칸 글자 자체가 라벨이면 그 글자 한 번만 — 같은 칸 줄 글자를 되풀이하지 않는다', () => {
    const noHeader = modelOf(c4({ scale: fiveScale(FIVE), headerGrid: undefined }));
    expect(noHeader.cells.map((c) => [c.text, c.inCellLabel])).toEqual(
      FIVE.map((label) => [label, undefined]),
    );
    const sameHeader: HeaderCell[][] = [
      [head('h-pre', '', 4), ...FIVE.map((label, n) => head(`h${n}`, label, 1))],
    ];
    const repeated = modelOf(c4({ scale: fiveScale(FIVE), headerGrid: sameHeader }));
    expect(repeated.cells.every((c) => c.inCellLabel === undefined)).toBe(true);
  });

  it('보기 칸 글자가 비어 칸 글자를 칸 줄에서 가져왔으면 칸 안 라벨로 또 쓰지 않는다', () => {
    const header: HeaderCell[][] = [
      [head('h-pre', '', 4), ...FIVE.map((label, n) => head(`h${n}`, label, 1))],
    ];
    const model = modelOf(c4({ scale: fiveScale(['', '', '', '', '']), headerGrid: header }));
    expect(model.cells.map((c) => [c.text, c.inCellLabel])).toEqual(
      FIVE.map((label) => [label, undefined]),
    );
  });

  it('한 칸짜리 구간이 일부 칸에만 있으면 그 칸에만 라벨이 붙는다', () => {
    const header: HeaderCell[][] = [
      [
        head('h-pre', '', 4),
        head('h0', '매우 불만족', 1),
        head('g1', '', 1),
        head('h2', '보통', 1),
        head('g3', '', 1),
        head('h4', '매우 만족', 1),
      ],
    ];
    const model = modelOf(c4({ scale: fiveScale(), headerGrid: header }));
    expect(model.cells.map((c) => c.inCellLabel)).toEqual([
      '매우 불만족',
      undefined,
      '보통',
      undefined,
      '매우 만족',
    ]);
  });

  it('보기 칸 글자가 라벨이고 칸 줄이 번호면 번호를 라벨로 붙이지 않는다', () => {
    const header: HeaderCell[][] = [
      [head('h-pre', '', 4), ...['①', '②', '③', '④', '⑤'].map((n, i) => head(`h${i}`, n, 1))],
    ];
    const model = modelOf(c4({ scale: fiveScale(FIVE), headerGrid: header }));
    expect(model.cells.map((c) => [c.text, c.inCellLabel])).toEqual(
      FIVE.map((label) => [label, undefined]),
    );
    const points = [
      [head('h-pre', '', 4), ...[1, 2, 3, 4, 5].map((n) => head(`p${n}`, `${n}점`, 1))],
    ];
    const withPoints = modelOf(c4({ scale: fiveScale(FIVE), headerGrid: points }));
    expect(withPoints.cells.every((c) => c.inCellLabel === undefined)).toBe(true);
  });

  it('보기 칸 글자의 줄바꿈도 헤더처럼 공백으로 이어 비교한다 — 같은 라벨을 두 번 쓰지 않는다', () => {
    const header: HeaderCell[][] = [
      [head('h-pre', '', 4), ...FIVE.map((label, n) => head(`h${n}`, label, 1))],
    ];
    const wrapped = FIVE.map((label) => label.replace(' ', '\n'));
    const model = modelOf(c4({ scale: fiveScale(wrapped), headerGrid: header }));
    expect(model.cells.map((c) => [c.text, c.inCellLabel])).toEqual(
      FIVE.map((label) => [label, undefined]),
    );
  });

  it('3칸도 같은 규칙이다', () => {
    const header: HeaderCell[][] = [
      [
        head('h-pre', '', 4),
        head('h0', '아니다', 1),
        head('h1', '보통', 1),
        head('h2', '그렇다', 1),
      ],
    ];
    const model = modelOf(c4({ scale: fiveScale(['1', '2', '3']), headerGrid: header }));
    expect(model.cells.map((c) => c.inCellLabel)).toEqual(['아니다', '보통', '그렇다']);
    expect(model.anchors).toEqual({});
  });

  it('6칸 이상은 칸 안 라벨이 없다', () => {
    const model = modelOf(c4());
    expect(model.cells.every((c) => c.inCellLabel === undefined)).toBe(true);
  });
});

describe('projectScaleBar — 폴백(null + 이유 코드)', () => {
  const reasonOf = (input: ProjectScaleBarInput) => {
    const result = projectScaleBar(input);
    return result.ok ? null : result.reason;
  };

  it('복수 선택·순위 그룹', () => {
    expect(reasonOf({ ...c4(), selectionType: 'checkbox' })).toBe('not-single-choice');
    expect(reasonOf({ ...c4(), selectionType: 'ranking' })).toBe('not-single-choice');
  });

  it('대상 칸에 보기 칸이 아닌 것이 섞였다', () => {
    const input = c4();
    const withInput = [...input.targetCells];
    withInput[3] = { id: 'c3', type: 'input', content: '' };
    const row = { ...input.row, cells: [...input.row.cells.slice(0, 4), ...withInput] };
    expect(reasonOf({ ...input, row, targetCells: withInput })).toBe('non-choice-cell');
  });

  it('대상 칸 사이에 입력칸이 끼어 있다', () => {
    const input = c4();
    const scale = input.targetCells;
    const row = {
      ...input.row,
      cells: [
        ...input.row.cells.slice(0, 4),
        ...scale.slice(0, 5),
        { id: 'mid-input', type: 'input' as const, content: '' },
        ...scale.slice(5),
      ],
    };
    const columns = [...input.columns, col('extra')];
    expect(reasonOf({ ...input, row, columns })).toBe('non-choice-cell');
  });

  it('대상 칸 사이에 다른 그룹 보기 칸이 끼어 있다 — 비연속 열', () => {
    const input = c4();
    const scale = input.targetCells;
    const row = {
      ...input.row,
      cells: [
        ...input.row.cells.slice(0, 4),
        ...scale.slice(0, 5),
        choice('other', '⑪', { choiceGroupId: 'g-other' }),
        ...scale.slice(5),
      ],
    };
    const columns = [...input.columns, col('extra')];
    expect(reasonOf({ ...input, row, columns })).toBe('non-contiguous');
  });

  it('상세기재가 붙은 보기', () => {
    const scale = CIRC.map((text, n) =>
      choice(`c${n}`, text, n === 10 ? { allowTextInput: true } : {}),
    );
    expect(reasonOf(c4({ scale }))).toBe('text-input');
  });

  it('단독 선택 보기', () => {
    const scale = CIRC.map((text, n) =>
      choice(`c${n}`, text, n === 10 ? { exclusiveChoice: true } : {}),
    );
    expect(reasonOf(c4({ scale }))).toBe('exclusive-choice');
  });

  it('칸 글자를 하나라도 얻지 못했다', () => {
    const scale = CIRC.map((text, n) => choice(`c${n}`, n === 4 ? '  ' : text));
    expect(reasonOf(c4({ scale }))).toBe('missing-text');
  });

  it('칸이 2개 미만이거나 12개를 넘는다', () => {
    expect(reasonOf(c4({ scale: [choice('c0', '⓪')], headerGrid: undefined }))).toBe('cell-count');
    const thirteen = Array.from({ length: 13 }, (_, n) => choice(`c${n}`, String(n)));
    expect(reasonOf(c4({ scale: thirteen, headerGrid: undefined }))).toBe('cell-count');
    const twelve = Array.from({ length: 12 }, (_, n) => choice(`c${n}`, String(n)));
    expect(reasonOf(c4({ scale: twelve, headerGrid: undefined }))).toBeNull();
  });

  it('보기 칸이 열과 짝이 안 맞는다', () => {
    const input = c4();
    expect(reasonOf({ ...input, columns: input.columns.slice(0, 5) })).toBe('non-contiguous');
  });
});
