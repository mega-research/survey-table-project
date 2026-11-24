import { describe, expect, it } from 'vitest';

import {
  type ProjectScaleBarInput,
  projectScaleBar,
  resolveScaleBarAnchorLayout,
  resolveScaleBarBandTones,
  resolveScaleBarCellMinWidths,
} from '@/features/question-renderer/utils/choice-group-scale-bar';
import type { HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';

// 해운물류 멘토 C4 모양 — 구분·항목·활용 여부 2칸·만족도 11칸(⓪~⑩).
const CIRC = ['⓪', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
// 열 제목은 비운다 — 다단 헤더가 없으면 열 제목이 칸 줄로 읽히므로, 헤더 격자를 보는 테스트에 섞이면 안 된다
const col = (id: string): TableColumn => ({ id, label: '' });
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
    // 6칸 이상이라 칸 안에 못 넣는 칸 이름은 막대 아래 목록으로 간다
    expect(model.cells.map((c) => c.legendLabel)).toEqual(labels);
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

  it('칸 줄이 둘(이름 줄 + 번호 줄)이고 보기 칸 글자가 비면 번호가 칸 글자, 이름이 칸 안 라벨이다', () => {
    // 원문 조사표 모양 — 머리에 「전혀 그렇지 않다 …」 줄과 「① … ⑤」 줄이 함께 있고 칸에는 라디오만 둔다
    const NUMS = ['①', '②', '③', '④', '⑤'];
    const header: HeaderCell[][] = [
      [head('h-pre', '', 4), head('h-sat', '평가', 5)],
      [head('h-pre2', '', 4), ...FIVE.map((label, n) => head(`h${n}`, label, 1))],
      [head('h-pre3', '', 4), ...NUMS.map((label, n) => head(`n${n}`, label, 1))],
    ];
    const model = modelOf(c4({ scale: fiveScale(['', '', '', '', '']), headerGrid: header }));
    expect(model.cells.map((c) => [c.text, c.inCellLabel])).toEqual(
      FIVE.map((label, n) => [NUMS[n], label]),
    );
    expect(model.bands).toEqual([]);
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

describe('resolveScaleBarAnchorLayout — 막대 아래 라벨 줄의 배치', () => {
  it('10점 척도 — 가운데 구간(5·6번째 칸)의 중심이 한가운데라 양옆 자리가 같다', () => {
    expect(
      resolveScaleBarAnchorLayout(
        { left: '매우 만족', middle: { label: '보통', index: 4, span: 2 }, right: '매우 불만족' },
        10,
      ),
    ).toEqual({ gridColumn: '1 / 11', template: 'minmax(0, 5fr) fit-content(40%) minmax(0, 5fr)' });
  });

  it('척도 밖 칸이 끝에 낀 막대 — 라벨 줄은 오른쪽 라벨의 끝 칸까지만 차지한다', () => {
    expect(
      resolveScaleBarAnchorLayout(
        { left: 'A', middle: { label: 'M', index: 4, span: 2 }, right: 'B', rightEnd: 9 },
        11,
      ).gridColumn,
    ).toBe('1 / 11');
    expect(
      resolveScaleBarAnchorLayout({ left: 'A', leftStart: 1, right: 'B' }, 11),
    ).toEqual({ gridColumn: '2 / 12', template: null });
  });

  it('가운데 구간이 한쪽으로 치우치면 양옆 자리를 그 중심 앞뒤 칸 수에 비례해 나눈다', () => {
    // 7칸 중 3번째 칸(중심 2.5) — 앞 2.5칸 · 뒤 4.5칸
    expect(
      resolveScaleBarAnchorLayout({ left: 'A', middle: { label: 'M', index: 2 }, right: 'B' }, 7)
        .template,
    ).toBe('minmax(0, 2.5fr) fit-content(40%) minmax(0, 4.5fr)');
  });

  it('가운데 라벨이 없으면 틀이 없다 — 양끝 라벨만 양쪽으로 벌린다', () => {
    expect(resolveScaleBarAnchorLayout({ left: 'A', right: 'B' }, 7)).toEqual({
      gridColumn: '1 / 8',
      template: null,
    });
  });
});

describe('resolveScaleBarBandTones — 구간 띠 색', () => {
  const band = (start: number, span: number) => ({ label: `${start}`, start, span });

  it('C4 11점: 왼쪽 붉은색·가운데 회색·오른쪽 파란색, 양끝 한 칸 구간은 짙게', () => {
    const tones = resolveScaleBarBandTones(
      [band(0, 1), band(1, 4), band(5, 1), band(6, 4), band(10, 1)],
      11,
    );
    expect(tones).toEqual([
      { side: 'negative', strong: true },
      { side: 'negative', strong: false },
      { side: 'neutral', strong: false },
      { side: 'positive', strong: false },
      { side: 'positive', strong: true },
    ]);
  });

  it('짝수 칸은 가운데 경계로 가르고, 그쪽 구간이 하나뿐이면 짙게 하지 않는다', () => {
    expect(resolveScaleBarBandTones([band(0, 3), band(3, 3)], 6)).toEqual([
      { side: 'negative', strong: false },
      { side: 'positive', strong: false },
    ]);
  });

  it('가운데를 걸쳐 덮는 구간은 회색이다', () => {
    expect(resolveScaleBarBandTones([band(0, 2), band(2, 3), band(5, 2)], 7)).toEqual([
      { side: 'negative', strong: false },
      { side: 'neutral', strong: false },
      { side: 'positive', strong: false },
    ]);
  });
});

describe('projectScaleBar — 다단 헤더 없는 표(열 제목 한 줄)', () => {
  // AI 실태조사 Q21 모양 — headerGrid 없이 열 제목이 곧 척도 라벨, 보기 칸 글자는 번호.
  const LABELS = ['전혀 중요하지 않음', '중요하지 않음', '보통', '중요', '매우 중요'];
  const scale = ['①', '②', '③', '④', '⑤'].map((text, n) => choice(`c${n}`, text));
  const input: ProjectScaleBarInput = {
    selectionType: 'radio',
    columns: [
      { id: 'a', label: '지원 분야' },
      { id: 'b', label: '세부 지원 내용' },
      ...LABELS.map((label, n) => ({ id: `s${n}`, label })),
    ],
    headerGrid: undefined,
    row: {
      id: 'r1',
      label: '',
      cells: [
        { id: 'x', type: 'text', content: '① 사전 정보 제공' },
        { id: 'y', type: 'text', content: '국제 입찰 정보' },
        ...scale,
      ],
    },
    targetCells: scale,
  };

  it('열 제목이 칸 안 라벨이 된다', () => {
    const result = projectScaleBar(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.cells.map((c) => c.inCellLabel)).toEqual(LABELS);
    expect(result.model.cells.map((c) => c.text)).toEqual(['①', '②', '③', '④', '⑤']);
  });
});

describe('projectScaleBar — 막대 아래 칸 이름 목록', () => {
  // 예술기업 11-1 모양 — 한 줄 표, 열 제목이 칸마다 이름, 보기 칸 글자는 번호 6개.
  const NAMES = [
    '전혀 관련 없음\n(지원사업 시점* 불일치)',
    '전혀\n도움되지 않음',
    '도움되지 않음',
    '보통',
    '도움이 되는 편',
    '매우 도움 됨',
  ];
  const sixCells = ['ⓞ', '①', '②', '③', '④', '⑤'].map((text, n) => choice(`c${n}`, text));
  const lineOf = (
    cells: TableCell[],
    labels: string[],
    headerGrid?: HeaderCell[][],
  ): ProjectScaleBarInput => ({
    selectionType: 'radio',
    columns: labels.map((label, n) => ({ id: `s${n}`, label })),
    headerGrid,
    row: { id: 'r1', label: '도움 정도', cells },
    targetCells: cells,
  });

  it('6칸 이상이고 칸마다 이름이 있으면 칸 이름을 목록으로 싣는다 — 줄바꿈은 공백으로 잇는다', () => {
    const model = modelOf(lineOf(sixCells, NAMES));
    expect(model.cells.map((c) => c.legendLabel)).toEqual([
      '전혀 관련 없음 (지원사업 시점* 불일치)',
      '전혀 도움되지 않음',
      '도움되지 않음',
      '보통',
      '도움이 되는 편',
      '매우 도움 됨',
    ]);
    expect(model.cells.every((c) => c.inCellLabel === undefined)).toBe(true);
    expect(model.anchors).toEqual({});
  });

  it('이름 줄 아래 번호 줄이 따로 있고 보기 칸 글자가 비어도 이름 줄로 목록을 싣는다', () => {
    const numbers = ['ⓞ', '①', '②', '③', '④', '⑤'];
    const header: HeaderCell[][] = [
      NAMES.map((label, n) => head(`h${n}`, label, 1)),
      numbers.map((label, n) => head(`n${n}`, label, 1)),
    ];
    const empty = numbers.map((_, n) => choice(`c${n}`, ''));
    const model = modelOf(lineOf(empty, NAMES.map(() => ''), header));
    expect(model.cells.map((c) => c.text)).toEqual(numbers);
    expect(model.cells.map((c) => c.legendLabel)).toEqual(
      NAMES.map((name) => name.replace(/\s+/g, ' ')),
    );
  });

  it('5칸 이하는 칸 안 라벨이 있으므로 목록이 없다', () => {
    const model = modelOf(lineOf(sixCells.slice(1), NAMES.slice(1)));
    expect(model.cells.every((c) => c.legendLabel === undefined)).toBe(true);
    expect(model.cells[0]!.inCellLabel).toBe('전혀 도움되지 않음');
  });

  it('구간 줄이 있으면 양끝 라벨·선택값 표시가 맡으므로 목록이 없다', () => {
    const model = modelOf(c4());
    expect(model.bands.length).toBeGreaterThan(0);
    expect(model.cells.every((c) => c.legendLabel === undefined)).toBe(true);
  });

  it('이름이 번호뿐이거나 칸 글자와 같은 칸이 하나라도 있으면 목록을 두지 않는다', () => {
    const numbered = modelOf(lineOf(sixCells, ['0', '1', '2', '3', '4', '5']));
    expect(numbered.cells.every((c) => c.legendLabel === undefined)).toBe(true);
    const sameAsText = modelOf(
      lineOf(
        NAMES.map((_, n) => choice(`c${n}`, n === 3 ? '보통' : String(n))),
        NAMES,
      ),
    );
    expect(sameAsText.cells.every((c) => c.legendLabel === undefined)).toBe(true);
  });
});

describe('projectScaleBar — 척도 밖 보기 칸이 낀 막대(청암대 재학생 문31)', () => {
  // ⑩~① 열 칸 뒤에 「미참여」 한 칸. 구간 줄은 「매우 만족 | (빈칸) | 보통 | (빈칸) | 매우 불만족 | (빈칸)」.
  const DESC = ['⑩', '⑨', '⑧', '⑦', '⑥', '⑤', '④', '③', '②', '①'];
  const anchorHeader = (tail: boolean): HeaderCell[][] => [
    [
      head('h-cat', '구분', 1),
      head('h-item', '질 문', 1),
      head('h-use', '활용 여부', 2),
      head('h-a', '매우 만족', 2),
      head('h-b', '', 2),
      head('h-c', '보통', 2),
      head('h-d', '', 2),
      head('h-e', '매우 불만족', 2),
      ...(tail ? [head('h-f', '', 1)] : []),
    ],
  ];
  const q31 = (extra: Partial<ProjectScaleBarInput> = {}) => ({
    ...c4({
      scale: [...DESC, '미참여'].map((text, n) => choice(`c${n}`, text)),
      headerGrid: anchorHeader(true),
    }),
    ...extra,
  });
  const q24 = (extra: Partial<ProjectScaleBarInput> = {}) => ({
    ...c4({ scale: DESC.map((text, n) => choice(`c${n}`, text)), headerGrid: anchorHeader(false) }),
    ...extra,
  });

  it('마지막 칸에 구간 이름이 없으면 이름 있는 마지막 구간을 오른쪽 라벨로 쓰고 그 구간 끝 칸에 붙인다', () => {
    const model = modelOf(q31());
    expect(model.bands.map((b) => b.label)).toEqual(['매우 만족', '보통', '매우 불만족']);
    expect(model.anchors).toEqual({ left: '매우 만족', right: '매우 불만족', rightEnd: 9 });
  });

  it('첫 칸에 구간 이름이 없으면 이름 있는 첫 구간을 왼쪽 라벨로 쓰고 그 구간 첫 칸에 붙인다', () => {
    const header: HeaderCell[][] = [
      [
        head('h-cat', '구분', 1),
        head('h-item', '질 문', 1),
        head('h-use', '활용 여부', 2),
        head('h-x', '', 1),
        head('h-a', '매우 만족', 2),
        head('h-b', '', 6),
        head('h-e', '매우 불만족', 2),
      ],
    ];
    const model = modelOf(
      c4({ scale: ['모름', ...DESC].map((text, n) => choice(`c${n}`, text)), headerGrid: header }),
    );
    expect(model.anchors).toEqual({ left: '매우 만족', leftStart: 1, right: '매우 불만족' });
  });

  // 원문 조사표 모양 — 머리에만 「미참여」를 적고 칸에는 컨트롤만 둔다(청암대 교직원 문8).
  const namedTailHeader: HeaderCell[][] = [
    [...anchorHeader(false)[0]!, head('h-f', '미참여', 1)],
  ];

  it('칸 글자가 빈 척도 밖 보기 칸은 그 칸만 덮는 머리 이름을 칸 글자로 쓰고, 그 이름은 구간·양끝 라벨이 되지 않는다', () => {
    const model = modelOf(
      c4({
        scale: [...DESC, ''].map((text, n) => choice(`c${n}`, text)),
        headerGrid: namedTailHeader,
      }),
    );
    expect(model.cells.map((cell) => cell.text)).toEqual([...DESC, '미참여']);
    expect(model.bands.map((b) => b.label)).toEqual(['매우 만족', '보통', '매우 불만족']);
    expect(model.cells[10]!.bandIndex).toBeNull();
    expect(model.anchors).toEqual({ left: '매우 만족', right: '매우 불만족', rightEnd: 9 });
  });

  it('칸 글자가 있으면 머리 이름을 종전대로 구간으로 읽는다 — 운영 중인 막대는 바뀌지 않는다', () => {
    const model = modelOf(
      c4({
        scale: [...DESC, '미참여'].map((text, n) => choice(`c${n}`, text)),
        headerGrid: namedTailHeader,
      }),
    );
    expect(model.bands.map((b) => b.label)).toEqual(['매우 만족', '보통', '매우 불만족', '미참여']);
    expect(model.cells[10]!.bandIndex).toBe(3);
  });

  it('칸 글자도 그 칸의 머리 이름도 비었거나, 머리 이름이 여러 칸을 덮으면 칸 글자를 얻지 못한 것이다', () => {
    const emptyTail = [...DESC, ''].map((text, n) => choice(`c${n}`, text));
    expect(projectScaleBar(c4({ scale: emptyTail, headerGrid: anchorHeader(true) }))).toEqual({
      ok: false,
      reason: 'missing-text',
    });
    const emptyFirst = ['', ...DESC.slice(1)].map((text, n) => choice(`c${n}`, text));
    expect(projectScaleBar(c4({ scale: emptyFirst, headerGrid: anchorHeader(false) }))).toEqual({
      ok: false,
      reason: 'missing-text',
    });
  });

  it('5칸 이하에서도 머리 이름을 칸 글자로 쓴 칸은 같은 이름을 칸 안 라벨로 되풀이하지 않는다', () => {
    const header: HeaderCell[][] = [
      [
        head('h-cat', '구분', 1),
        head('h-item', '질 문', 1),
        head('h-use', '활용 여부', 2),
        head('h-a', '아니다', 1),
        head('h-b', '', 1),
        head('h-c', '그렇다', 1),
        head('h-d', '모름', 1),
      ],
    ];
    const model = modelOf(
      c4({ scale: ['①', '②', '③', ''].map((text, n) => choice(`c${n}`, text)), headerGrid: header }),
    );
    expect(model.cells.map((cell) => [cell.text, cell.inCellLabel])).toEqual([
      ['①', '아니다'],
      ['②', undefined],
      ['③', '그렇다'],
      ['모름', undefined],
    ]);
    expect(model.bands.map((b) => b.label)).toEqual(['아니다', '그렇다']);
  });

  it('이름 있는 구간이 하나뿐이면 양쪽에 같은 이름을 되풀이하지 않는다', () => {
    const header: HeaderCell[][] = [
      [
        head('h-cat', '구분', 1),
        head('h-item', '질 문', 1),
        head('h-use', '활용 여부', 2),
        head('h-a', '매우 만족', 2),
        head('h-b', '', 9),
      ],
    ];
    const model = modelOf(
      c4({ scale: [...DESC, '미참여'].map((text, n) => choice(`c${n}`, text)), headerGrid: header }),
    );
    expect(model.anchors).toEqual({ left: '매우 만족' });
  });

  it('가운데 구간 이름(middleBandLabel)을 켜면 척도 한가운데의 여러 칸짜리 구간 이름을 그 띠 아래에 둔다', () => {
    expect(modelOf(q31({ middleBandLabel: true })).anchors).toEqual({
      left: '매우 만족',
      middle: { label: '보통', index: 4, span: 2 },
      right: '매우 불만족',
      rightEnd: 9,
    });
    expect(modelOf(q24({ middleBandLabel: true })).anchors).toEqual({
      left: '매우 만족',
      middle: { label: '보통', index: 4, span: 2 },
      right: '매우 불만족',
    });
  });

  it('켜지 않으면 종전대로 여러 칸짜리 가운데 구간 이름은 쓰지 않는다', () => {
    expect(modelOf(q24()).anchors).toEqual({ left: '매우 만족', right: '매우 불만족' });
    expect(modelOf(q31()).anchors.middle).toBeUndefined();
  });

  it('켜도 한 칸짜리 정가운데 구간은 종전과 같은 모양이고, 한가운데가 아닌 구간은 가운데 라벨이 아니다', () => {
    expect(modelOf({ ...c4(), middleBandLabel: true }).anchors).toEqual({
      left: '매우 불만족',
      middle: { label: '보통', index: 5 },
      right: '매우 만족',
    });
    const offCenter: HeaderCell[][] = [
      [
        head('h-cat', '구분', 1),
        head('h-item', '질 문', 1),
        head('h-use', '활용 여부', 2),
        head('h-a', '매우 만족', 2),
        head('h-c', '보통', 2),
        head('h-d', '', 4),
        head('h-e', '매우 불만족', 2),
      ],
    ];
    const model = modelOf({
      ...c4({ scale: DESC.map((text, n) => choice(`c${n}`, text)), headerGrid: offCenter }),
      middleBandLabel: true,
    });
    expect(model.anchors).toEqual({ left: '매우 만족', right: '매우 불만족' });
  });
});

describe('resolveScaleBarCellMinWidths — 글자가 긴 칸의 최소 폭', () => {
  const DESC = ['⑩', '⑨', '⑧', '⑦', '⑥', '⑤', '④', '③', '②', '①'];
  const widened = (texts: string[]) =>
    resolveScaleBarCellMinWidths(texts).map((width) => width !== undefined);

  it('글자가 긴 칸에만 최소 폭을 준다 — 번호 칸과 띄어 쓴 짧은 낱말은 그대로다', () => {
    const widths = resolveScaleBarCellMinWidths([...DESC, '미참여']);
    expect(widths.slice(0, 10).every((width) => width === undefined)).toBe(true);
    expect(widths[10]).toBeGreaterThanOrEqual(42);
    expect(
      widened([...DESC.slice(0, 6), '10점', '모름', '해당 없음', '해당없음', 'N/A']).slice(6),
    ).toEqual([false, false, false, true, false]);
  });

  it('칸이 넉넉한 막대는 긴 글자 칸도 넓히지 않는다 — 고르게 나눈 폭에 이미 들어간다', () => {
    // 여성기업 사전조사 E4 모양(6칸) · 균형성장 만족도 모양(7칸) — 운영 중인 막대는 열 틀이 그대로여야 한다
    const six = ['①', '②', '③', '④', '⑤', '운영과 관계 없음'];
    const seven = ['① 전혀 그렇지 않다', '② 그렇지 않다', '③', '④ 보통', '⑤', '⑥ 그렇다', '⑦ 매우 그렇다'];
    expect(widened(six).some(Boolean)).toBe(false);
    expect(widened(seven).some(Boolean)).toBe(false);
  });

  it('긴 글자 칸이 많아 좁은 화면에서 나머지 칸이 설 자리가 없으면 아무 칸도 넓히지 않는다', () => {
    // 최소 폭의 합이 막대 폭을 넘으면 뒤쪽 칸이 화면 밖으로 밀려 누를 수 없다 — 고르게 나누는 종전 모양이 낫다
    const manyLong = ['매우불만족', '불만족함', '약간불만', '보통임', '약간만족', '만족함', '매우만족함', '모름'];
    expect(widened(manyLong).some(Boolean)).toBe(false);
    // 척도 밖 보기 칸이 둘이어도 나머지 칸이 설 자리가 남으면 넓힌다
    expect(widened([...DESC.slice(0, 8), '미참여', '해당없음']).slice(8)).toEqual([true, true]);
  });
});
