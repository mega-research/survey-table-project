import { describe, expect, it } from 'vitest';

import type { ScaleSliderDirection } from '@/types/scale-slider';
import type { HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';

import { type ProjectScaleSliderInput, projectScaleSlider } from './scale-slider';

/**
 * 척도 슬라이더 투영 — 표·행·대상 칸을 넣으면 모델 또는 폴백 이유가 나온다(CONTEXT.md 「척도 슬라이더」).
 * 헤더 읽기 자체는 옆 파일(scale-header-reading.test.ts)이, 척도 막대의 결과는
 * choice-group-scale-bar.test.ts 가 지킨다.
 */

const CIRC = ['⓪', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭'];
const FIVE_NAMES = ['매우 불만족', '불만족', '보통', '만족', '매우 만족'];
const SEVEN_NAMES = [
  '전혀 그렇지 않다',
  '그렇지 않다',
  '약간 그렇지 않다',
  '보통',
  '약간 그렇다',
  '그렇다',
  '매우 그렇다',
];

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
/** 눈금 칸 — id 는 c0, c1 … */
const ticks = (contents: readonly string[]): TableCell[] =>
  contents.map((content, n) => choice(`c${n}`, content));
/** 척도 밖 보기 칸 — 「평균에서 제외」가 붙은 보기 칸 */
const off = (id: string, content: string, extra: Partial<TableCell> = {}): TableCell =>
  choice(id, content, { excludeFromMean: true, ...extra });
const marks = (from: number, count: number): string[] => CIRC.slice(from, from + count);
const blank = (count: number): string[] => Array.from({ length: count }, () => '');

interface TableOptions {
  /** 항목 열 뒤에 놓이는 칸 — 행 순서 그대로 */
  cells: TableCell[];
  /** 대상 칸 — 안 주면 cells 의 보기 칸 전부 */
  targetCells?: TableCell[];
  headerGrid?: HeaderCell[][];
  /** 항목 열 뒤 열들의 열 제목 — 안 주면 전부 빈 글자(다단 헤더를 보는 테스트에 섞이지 않게) */
  columnLabels?: readonly string[];
  direction?: ScaleSliderDirection;
  selectionType?: ProjectScaleSliderInput['selectionType'];
}

/** 항목 열 하나 + 넘긴 칸들로 된 한 행짜리 표 */
function table(options: TableOptions): ProjectScaleSliderInput {
  const { cells } = options;
  const columns: TableColumn[] = [
    { id: 'item', label: '' },
    ...cells.map((_, n) => ({ id: `s${n}`, label: options.columnLabels?.[n] ?? '' })),
  ];
  const row: TableRow = {
    id: 'r1',
    label: '주차/접근성',
    cells: [{ id: 'item', type: 'text', content: '주차/접근성' }, ...cells],
  };
  return {
    selectionType: options.selectionType ?? 'radio',
    columns,
    headerGrid: options.headerGrid,
    row,
    targetCells: options.targetCells ?? cells.filter((cell) => cell.type === 'choice_opt'),
    direction: options.direction ?? 'positive-right',
  };
}

function modelOf(input: ProjectScaleSliderInput) {
  const result = projectScaleSlider(input);
  if (!result.ok) throw new Error(`폴백: ${result.reason}`);
  return result.model;
}

/** 제목 줄 하나 — 항목 + 척도 전체를 덮는 묶음 제목 */
const titleOnly = (span: number): HeaderCell[][] => [
  [head('h-item', '항목', 1), head('h-title', '만족도', span)],
];

describe('projectScaleSlider — 타일 세 가지', () => {
  it('5점에 점마다 이름이 있으면 점 타일 5장이고, 칸 글자가 이름과 다르면 눈금 글자로 싣는다', () => {
    // 머리에 이름 줄과 번호 줄이 함께 있고 칸에는 컨트롤만 둔 표 — 번호가 칸 글자, 이름이 타일 이름
    const model = modelOf(
      table({
        cells: ticks(blank(5)),
        headerGrid: [
          [head('h-item', '항목', 1, 2), ...FIVE_NAMES.map((name, n) => head(`h-n${n}`, name, 1))],
          marks(1, 5).map((mark, n) => head(`h-m${n}`, mark, 1)),
        ],
      }),
    );
    expect(model.tileKind).toBe('point');
    expect(model.ticks.map((tick) => tick.choiceId)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4']);
    expect(model.ticks.map((tick) => tick.name)).toEqual(FIVE_NAMES);
    expect(model.ticks.map((tick) => tick.text)).toEqual(marks(1, 5));
    expect(model.ticks.map((tick) => tick.mark)).toEqual(marks(1, 5));
    expect(model.bands).toEqual([]);
    expect(model.showsSelectionLabel).toBe(false);
    expect(model.offScale).toEqual([]);
  });

  it('칸 글자 자체가 이름이면 점 타일이고 눈금 글자는 싣지 않는다 — 이름은 한 번만 보인다', () => {
    const model = modelOf(table({ cells: ticks(FIVE_NAMES), headerGrid: titleOnly(5) }));
    expect(model.tileKind).toBe('point');
    expect(model.ticks.map((tick) => tick.name)).toEqual(FIVE_NAMES);
    expect(model.ticks.map((tick) => tick.text)).toEqual(FIVE_NAMES);
    expect(model.ticks.map((tick) => tick.mark)).toEqual(blank(5).map(() => undefined));
  });

  it('다단 헤더 없이 열 제목에만 이름이 있어도 점 타일이다', () => {
    const model = modelOf(table({ cells: ticks(marks(1, 5)), columnLabels: FIVE_NAMES }));
    expect(model.tileKind).toBe('point');
    expect(model.ticks.map((tick) => tick.name)).toEqual(FIVE_NAMES);
    expect(model.ticks.map((tick) => tick.mark)).toEqual(marks(1, 5));
  });

  it('칸마다 눈금 글자는 제 이름과 견준다 — 이름이 머리에서 온 칸만 눈금 글자가 있다', () => {
    // 양끝은 칸 글자가 곧 이름, 가운데 셋은 번호 + 머리 이름
    const model = modelOf(
      table({
        cells: ticks(['매우 불만족', '②', '③', '④', '매우 만족']),
        columnLabels: FIVE_NAMES,
      }),
    );
    expect(model.tileKind).toBe('point');
    expect(model.ticks.map((tick) => tick.name)).toEqual(FIVE_NAMES);
    expect(model.ticks.map((tick) => tick.mark)).toEqual([undefined, '②', '③', '④', undefined]);
  });

  it('13점에 구간 이름 3개면 구간 타일 3장이고, 눈금 글자 13개와 고른 값 표시를 쓴다', () => {
    const model = modelOf(
      table({
        cells: ticks(marks(1, 13)),
        headerGrid: [
          [
            head('h-item', '항목', 1),
            head('h-lo', '불만족', 5),
            head('h-mid', '보통', 3),
            head('h-hi', '만족', 5),
          ],
        ],
      }),
    );
    expect(model.tileKind).toBe('band');
    expect(model.bands).toEqual([
      { label: '불만족', start: 0, span: 5, side: 'negative' },
      { label: '보통', start: 5, span: 3, side: 'neutral' },
      { label: '만족', start: 8, span: 5, side: 'positive' },
    ]);
    expect(model.ticks).toHaveLength(13);
    expect(model.ticks.map((tick) => tick.mark)).toEqual(marks(1, 13));
    expect(model.ticks.map((tick) => tick.name)).toEqual(blank(13).map(() => undefined));
    expect(model.ticks.map((tick) => tick.bandIndex)).toEqual([
      0, 0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 2, 2,
    ]);
    expect(model.showsSelectionLabel).toBe(true);
    expect(model.bandsCoverAllTicks).toBe(true);
  });

  it('번호뿐인 11점은 타일이 없고 눈금 글자 11개만 있다', () => {
    const model = modelOf(table({ cells: ticks(marks(0, 11)), headerGrid: titleOnly(11) }));
    expect(model.tileKind).toBe('none');
    expect(model.bands).toEqual([]);
    expect(model.ticks.map((tick) => tick.mark)).toEqual(marks(0, 11));
    expect(model.ticks.map((tick) => tick.name)).toEqual(blank(11).map(() => undefined));
    expect(model.showsSelectionLabel).toBe(false);
    expect(model.bandsCoverAllTicks).toBe(false);
  });

  it('점 이름과 구간이 함께 있는 7점은 점 타일이고, 구간은 고른 값 표시의 재료로 남는다', () => {
    const model = modelOf(
      table({
        cells: ticks(marks(1, 7)),
        headerGrid: [
          [
            head('h-item', '항목', 1, 2),
            head('h-lo', '부정', 3),
            head('h-mid', '중립', 1),
            head('h-hi', '긍정', 3),
          ],
          SEVEN_NAMES.map((name, n) => head(`h-n${n}`, name, 1)),
        ],
      }),
    );
    expect(model.tileKind).toBe('point');
    expect(model.ticks.map((tick) => tick.name)).toEqual(SEVEN_NAMES);
    expect(model.ticks.map((tick) => tick.mark)).toEqual(marks(1, 7));
    expect(model.bands.map((band) => band.label)).toEqual(['부정', '중립', '긍정']);
    expect(model.ticks.map((tick) => tick.bandIndex)).toEqual([0, 0, 0, 1, 2, 2, 2]);
    expect(model.showsSelectionLabel).toBe(true);
  });

  it('이름이 일부 눈금에만 있으면 점 타일이 아니다 — 양끝에만 이름이 있는 척도는 그 이름이 구간이지만 눈금을 다 덮지 못한다', () => {
    const model = modelOf(
      table({
        cells: ticks(marks(1, 5)),
        columnLabels: ['전혀 그렇지 않다', '', '', '', '매우 그렇다'],
      }),
    );
    expect(model.tileKind).toBe('band');
    expect(model.bands).toEqual([
      { label: '전혀 그렇지 않다', start: 0, span: 1, side: 'negative' },
      { label: '매우 그렇다', start: 4, span: 1, side: 'positive' },
    ]);
    expect(model.ticks.map((tick) => tick.name)).toEqual(blank(5).map(() => undefined));
    expect(model.ticks.map((tick) => tick.mark)).toEqual(marks(1, 5));
    // 타일 상자를 그릴 수 없는 구간이다 — 그리는 쪽이 이름을 글자로만 둔다
    expect(model.bandsCoverAllTicks).toBe(false);
  });

  it('구간이 눈금을 빠짐없이 덮는가를 싣는다 — 가운데가 비거나 한쪽 끝이 비면 덮지 못한 것이다', () => {
    const cover = (heads: HeaderCell[]) =>
      modelOf(
        table({ cells: ticks(marks(0, 11)), headerGrid: [[head('h-item', '항목', 1), ...heads]] }),
      ).bandsCoverAllTicks;
    expect(cover([head('a', '낮음', 4), head('b', '중간', 3), head('c', '높음', 4)])).toBe(true);
    // 양끝과 한가운데에만 이름 — 사이가 빈다
    expect(
      cover([
        head('a', '전혀 없다', 1),
        head('g1', '', 4),
        head('b', '보통', 1),
        head('g2', '', 4),
        head('c', '매우 많다', 1),
      ]),
    ).toBe(false);
    // 왼쪽 구간만 — 오른쪽 끝이 빈다
    expect(cover([head('a', '낮음', 5), head('g', '', 6)])).toBe(false);
  });

  it('점 타일이어도 구간이 눈금을 다 덮는가는 구간만 보고 싣는다', () => {
    const model = modelOf(table({ cells: ticks(FIVE_NAMES), headerGrid: titleOnly(5) }));
    expect(model.tileKind).toBe('point');
    expect(model.bandsCoverAllTicks).toBe(false);
  });

  it('칸 글자가 이름인 눈금이 일부뿐이고 구간도 없으면 타일이 없다 — 그 이름은 눈금 글자로만 보인다', () => {
    const texts = ['매우 불만족', '②', '③', '④', '매우 만족'];
    const model = modelOf(table({ cells: ticks(texts), headerGrid: titleOnly(5) }));
    expect(model.tileKind).toBe('none');
    expect(model.ticks.map((tick) => tick.name)).toEqual(blank(5).map(() => undefined));
    expect(model.ticks.map((tick) => tick.mark)).toEqual(texts);
  });
});

describe('projectScaleSlider — 척도 밖 보기', () => {
  it('「평균에서 제외」 칸이 끝에 하나 있으면 척도 밖 보기로 떼고 눈금 수에 세지 않는다', () => {
    const model = modelOf(
      table({
        cells: [...ticks(marks(1, 5)), off('na', '이용한 적 없음')],
        columnLabels: [...FIVE_NAMES, ''],
      }),
    );
    expect(model.ticks.map((tick) => tick.choiceId)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4']);
    expect(model.offScale).toEqual([{ choiceId: 'na', label: '이용한 적 없음' }]);
    // 한가운데는 눈금 다섯의 셋째다 — 척도 밖 보기는 자리를 차지하지 않는다
    expect(model.ticks.map((tick) => tick.side)).toEqual([
      'negative',
      'negative',
      'neutral',
      'positive',
      'positive',
    ]);
    expect(model.tileKind).toBe('point');
  });

  it('둘이면 행 순서대로 둘 다 뗀다', () => {
    const model = modelOf(
      table({ cells: [...ticks(FIVE_NAMES), off('na', '이용한 적 없음'), off('dk', '모름')] }),
    );
    expect(model.ticks).toHaveLength(5);
    expect(model.offScale).toEqual([
      { choiceId: 'na', label: '이용한 적 없음' },
      { choiceId: 'dk', label: '모름' },
    ]);
  });

  it('눈금 줄 앞에 붙은 척도 밖 보기도 뗀다', () => {
    const model = modelOf(
      table({ cells: [off('dk', '모름'), ...ticks(FIVE_NAMES), off('na', '해당 없음')] }),
    );
    expect(model.ticks.map((tick) => tick.name)).toEqual(FIVE_NAMES);
    expect(model.offScale.map((choice) => choice.choiceId)).toEqual(['dk', 'na']);
  });

  it('칸 글자가 비면 그 칸만 덮는 머리 이름이 글자다 — 묶음 제목은 눈금의 제목 줄로 버려진다', () => {
    const model = modelOf(
      table({
        cells: [...ticks(blank(5)), off('dk', '')],
        headerGrid: [
          [head('h-item', '항목', 1, 2), head('h-title', '만족도', 6)],
          [...marks(1, 5).map((mark, n) => head(`h-m${n}`, mark, 1)), head('h-dk', '모름', 1)],
        ],
      }),
    );
    expect(model.offScale).toEqual([{ choiceId: 'dk', label: '모름' }]);
    expect(model.ticks.map((tick) => tick.text)).toEqual(marks(1, 5));
    expect(model.tileKind).toBe('none');
  });

  it('칸 글자가 있으면 머리 이름보다 칸 글자다', () => {
    const model = modelOf(
      table({
        cells: [...ticks(marks(1, 5)), off('dk', '잘 모르겠음')],
        columnLabels: [...FIVE_NAMES, '모름'],
      }),
    );
    expect(model.offScale).toEqual([{ choiceId: 'dk', label: '잘 모르겠음' }]);
  });

  it('칸 글자가 번호뿐이고 그 칸만 덮는 머리 이름이 있으면 머리 이름이 글자다 — 체크 옆에 번호만 보이지 않는다', () => {
    const model = modelOf(
      table({
        cells: [...ticks(marks(1, 5)), off('dk', '⑨')],
        columnLabels: [...FIVE_NAMES, '모름'],
      }),
    );
    expect(model.offScale).toEqual([{ choiceId: 'dk', label: '모름' }]);
  });

  it('칸 글자가 번호뿐이어도 머리 이름이 없거나 머리도 번호뿐이면 칸 글자 그대로다', () => {
    const noHead = modelOf(
      table({
        cells: [...ticks(marks(1, 5)), off('dk', '⑨')],
        columnLabels: [...FIVE_NAMES, ''],
      }),
    );
    expect(noHead.offScale).toEqual([{ choiceId: 'dk', label: '⑨' }]);
    const numberHead = modelOf(
      table({
        cells: [...ticks(marks(1, 5)), off('dk', '⑨')],
        columnLabels: [...FIVE_NAMES, '9'],
      }),
    );
    expect(numberHead.offScale).toEqual([{ choiceId: 'dk', label: '⑨' }]);
  });

  it('칸 글자가 비었으면 머리가 번호뿐이어도 그것이 글자다', () => {
    const model = modelOf(
      table({
        cells: [...ticks(marks(1, 5)), off('dk', '')],
        columnLabels: [...FIVE_NAMES, '9'],
      }),
    );
    expect(model.offScale).toEqual([{ choiceId: 'dk', label: '9' }]);
  });

  it('척도 밖 보기의 머리 이름은 눈금의 구간이 되지 않는다', () => {
    const model = modelOf(
      table({
        cells: [...ticks(marks(1, 13)), off('dk', '')],
        headerGrid: [
          [
            head('h-item', '항목', 1),
            head('h-lo', '불만족', 5),
            head('h-mid', '보통', 3),
            head('h-hi', '만족', 5),
            head('h-dk', '모름', 1),
          ],
        ],
      }),
    );
    expect(model.bands.map((band) => band.label)).toEqual(['불만족', '보통', '만족']);
    expect(model.offScale).toEqual([{ choiceId: 'dk', label: '모름' }]);
  });
});

describe('projectScaleSlider — 눈금 수', () => {
  const reasonOf = (input: ProjectScaleSliderInput) => {
    const result = projectScaleSlider(input);
    return result.ok ? 'ok' : result.reason;
  };

  it('눈금 2개와 13개는 그린다', () => {
    expect(reasonOf(table({ cells: ticks(['아니오', '예']) }))).toBe('ok');
    expect(reasonOf(table({ cells: ticks(marks(1, 13)) }))).toBe('ok');
  });

  it('눈금 1개와 14개는 폴백이다', () => {
    expect(reasonOf(table({ cells: ticks(['예']) }))).toBe('cell-count');
    expect(reasonOf(table({ cells: ticks(marks(1, 14)) }))).toBe('cell-count');
  });

  it('눈금 13 + 척도 밖 2는 그린다 — 척도 밖 보기는 세지 않는다', () => {
    const model = modelOf(
      table({ cells: [...ticks(marks(1, 13)), off('na', '해당 없음'), off('dk', '모름')] }),
    );
    expect(model.ticks).toHaveLength(13);
    expect(model.offScale).toHaveLength(2);
  });

  it('척도 밖 보기를 빼고 눈금이 2개에 못 미치면 폴백이다', () => {
    expect(
      reasonOf(table({ cells: [...ticks(['예']), off('na', '해당 없음'), off('dk', '모름')] })),
    ).toBe('cell-count');
    expect(reasonOf(table({ cells: [off('na', '해당 없음'), off('dk', '모름')] }))).toBe(
      'cell-count',
    );
  });
});

describe('projectScaleSlider — 쪽과 긍정 방향', () => {
  const sides = (model: { ticks: { side: string }[] }) => model.ticks.map((tick) => tick.side);
  const N = 'negative';
  const M = 'neutral';
  const P = 'positive';

  it('오른쪽이 긍정이면 정가운데보다 왼쪽이 부정, 오른쪽이 긍정, 한가운데가 중립이다', () => {
    expect(
      sides(modelOf(table({ cells: ticks(FIVE_NAMES), direction: 'positive-right' }))),
    ).toEqual([N, N, M, P, P]);
  });

  it('왼쪽이 긍정이면 같은 표의 쪽이 뒤집히고 눈금 순서는 그대로다', () => {
    const cells = ticks(['매우 만족', '만족', '보통', '불만족', '매우 불만족']);
    const right = modelOf(table({ cells, direction: 'positive-right' }));
    const left = modelOf(table({ cells, direction: 'positive-left' }));
    expect(sides(left)).toEqual([P, P, M, N, N]);
    expect(sides(right)).toEqual([N, N, M, P, P]);
    expect(left.ticks.map((tick) => tick.choiceId)).toEqual(
      right.ticks.map((tick) => tick.choiceId),
    );
    expect(left.ticks.map((tick) => tick.name)).toEqual(right.ticks.map((tick) => tick.name));
  });

  it('홀수 눈금은 한가운데 하나만 중립이다', () => {
    expect(sides(modelOf(table({ cells: ticks(marks(0, 11)) })))).toEqual([
      N,
      N,
      N,
      N,
      N,
      M,
      P,
      P,
      P,
      P,
      P,
    ]);
    expect(sides(modelOf(table({ cells: ticks(['아니다', '보통', '그렇다']) })))).toEqual([
      N,
      M,
      P,
    ]);
  });

  it('짝수 눈금에는 중립이 없다', () => {
    expect(sides(modelOf(table({ cells: ticks(marks(1, 4)) })))).toEqual([N, N, P, P]);
    expect(sides(modelOf(table({ cells: ticks(marks(1, 10)) })))).not.toContain(M);
    expect(
      sides(modelOf(table({ cells: ticks(['아니오', '예']), direction: 'positive-left' }))),
    ).toEqual([P, N]);
  });

  const bandHeader = (spans: readonly number[]): HeaderCell[][] => [
    [head('h-item', '항목', 1), ...spans.map((span, n) => head(`h-b${n}`, `구간${n + 1}`, span))],
  ];
  const bandSides = (count: number, spans: readonly number[], direction?: ScaleSliderDirection) =>
    modelOf(
      table({
        cells: ticks(marks(1, count)),
        headerGrid: bandHeader(spans),
        ...(direction ? { direction } : {}),
      }),
    ).bands.map((band) => band.side);

  it('구간은 구간의 가운데 자리로 가르고, 왼쪽이 긍정이면 함께 뒤집힌다', () => {
    expect(bandSides(13, [5, 3, 5])).toEqual([N, M, P]);
    expect(bandSides(13, [5, 3, 5], 'positive-left')).toEqual([P, M, N]);
    expect(bandSides(11, [1, 4, 1, 4, 1])).toEqual([N, N, M, P, P]);
  });

  it('한가운데 눈금을 덮어도 가운데가 한쪽으로 치우친 구간은 그쪽이다', () => {
    // 13점을 7 · 6 으로 가른 구간 — 첫 구간이 한가운데 눈금(⑦)을 덮지만 가운데 자리는 왼쪽이다
    expect(bandSides(13, [7, 6])).toEqual([N, P]);
  });

  it('짝수 눈금에서도 정가운데에 놓인 구간은 중립이다', () => {
    expect(bandSides(10, [4, 2, 4])).toEqual([N, M, P]);
    expect(bandSides(10, [5, 5])).toEqual([N, P]);
  });
});

describe('projectScaleSlider — 폴백 이유', () => {
  const reasonOf = (input: ProjectScaleSliderInput) => {
    const result = projectScaleSlider(input);
    return result.ok ? 'ok' : result.reason;
  };
  const input = (id: string): TableCell => ({ id, type: 'input', content: '' });

  it('단일 선택이 아니면 not-single-choice', () => {
    expect(reasonOf(table({ cells: ticks(FIVE_NAMES), selectionType: 'checkbox' }))).toBe(
      'not-single-choice',
    );
    expect(reasonOf(table({ cells: ticks(FIVE_NAMES), selectionType: 'ranking' }))).toBe(
      'not-single-choice',
    );
  });

  it('대상에 보기 칸이 아닌 칸이 있거나 눈금 사이에 입력칸이 끼면 non-choice-cell', () => {
    const radioCell: TableCell = { id: 'x', type: 'radio', content: '' };
    expect(
      reasonOf(
        table({
          cells: [...ticks(FIVE_NAMES), radioCell],
          targetCells: [...ticks(FIVE_NAMES), radioCell],
        }),
      ),
    ).toBe('non-choice-cell');
    const five = ticks(FIVE_NAMES);
    expect(
      reasonOf(table({ cells: [five[0]!, five[1]!, input('memo'), five[2]!, five[3]!, five[4]!] })),
    ).toBe('non-choice-cell');
  });

  it('눈금 사이에 다른 묶음의 보기 칸·숨은 칸이 끼면 non-contiguous', () => {
    const five = ticks(FIVE_NAMES);
    const other = choice('other', '활용함', { choiceGroupId: 'g-use' });
    expect(
      reasonOf(
        table({
          cells: [five[0]!, five[1]!, other, five[2]!, five[3]!, five[4]!],
          targetCells: five,
        }),
      ),
    ).toBe('non-contiguous');
    const hidden = choice('hidden', '숨김', { isHidden: true });
    expect(
      reasonOf(
        table({
          cells: [five[0]!, five[1]!, hidden, five[2]!, five[3]!, five[4]!],
          targetCells: five,
        }),
      ),
    ).toBe('non-contiguous');
  });

  it('척도 밖 보기가 눈금 사이에 끼어 눈금이 끊기면 non-contiguous', () => {
    const five = ticks(FIVE_NAMES);
    expect(
      reasonOf(
        table({ cells: [five[0]!, five[1]!, off('dk', '모름'), five[2]!, five[3]!, five[4]!] }),
      ),
    ).toBe('non-contiguous');
  });

  it('척도 밖 보기가 눈금 줄에서 떨어져 있으면 폴백이다 — 사이에 낀 칸에 따라 이유가 갈린다', () => {
    const five = ticks(FIVE_NAMES);
    expect(reasonOf(table({ cells: [...five, input('memo'), off('dk', '모름')] }))).toBe(
      'non-choice-cell',
    );
    const other = choice('other', '활용함', { choiceGroupId: 'g-use' });
    const dk = off('dk', '모름');
    expect(reasonOf(table({ cells: [...five, other, dk], targetCells: [...five, dk] }))).toBe(
      'non-contiguous',
    );
  });

  it('행에 없는 칸이 대상이면 non-contiguous', () => {
    const five = ticks(FIVE_NAMES);
    expect(reasonOf(table({ cells: five, targetCells: [...five, choice('ghost', '유령')] }))).toBe(
      'non-contiguous',
    );
  });

  it('눈금 수가 2~13 을 벗어나면 cell-count', () => {
    expect(reasonOf(table({ cells: ticks(['예']) }))).toBe('cell-count');
    expect(reasonOf(table({ cells: ticks(marks(1, 14)) }))).toBe('cell-count');
  });

  it('상세 기재 보기가 있으면 text-input — 척도 밖 보기여도 같다', () => {
    const withText = ticks(FIVE_NAMES).map((cell, n) =>
      n === 4 ? { ...cell, allowTextInput: true } : cell,
    );
    expect(reasonOf(table({ cells: withText }))).toBe('text-input');
    expect(
      reasonOf(
        table({ cells: [...ticks(FIVE_NAMES), off('etc', '기타', { allowTextInput: true })] }),
      ),
    ).toBe('text-input');
  });

  it('단독 선택 보기가 있으면 exclusive-choice — 척도 밖 보기여도 같다', () => {
    const withExclusive = ticks(FIVE_NAMES).map((cell, n) =>
      n === 0 ? { ...cell, exclusiveChoice: true } : cell,
    );
    expect(reasonOf(table({ cells: withExclusive }))).toBe('exclusive-choice');
    expect(
      reasonOf(
        table({ cells: [...ticks(FIVE_NAMES), off('na', '해당 없음', { exclusiveChoice: true })] }),
      ),
    ).toBe('exclusive-choice');
  });

  it('눈금의 칸 글자를 어디서도 읽을 수 없으면 missing-text', () => {
    expect(reasonOf(table({ cells: ticks(blank(5)), headerGrid: titleOnly(5) }))).toBe(
      'missing-text',
    );
    expect(reasonOf(table({ cells: ticks(['①', '②', '', '④', '⑤']) }))).toBe('missing-text');
  });

  it('척도 밖 보기의 글자를 칸에서도 머리에서도 읽을 수 없으면 missing-text', () => {
    // 머리는 눈금과 척도 밖 보기를 함께 묶은 제목뿐이다 — 그 칸만의 이름이 없다
    expect(
      reasonOf(table({ cells: [...ticks(FIVE_NAMES), off('dk', '')], headerGrid: titleOnly(6) })),
    ).toBe('missing-text');
    expect(reasonOf(table({ cells: [...ticks(FIVE_NAMES), off('dk', '  ')] }))).toBe(
      'missing-text',
    );
  });
});
