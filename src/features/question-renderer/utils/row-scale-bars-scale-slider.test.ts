import { describe, expect, it } from 'vitest';

import type { ChoiceGroup, HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';

import {
  type ProjectRowScaleLayoutInput,
  type ProjectRowSliderLayoutInput,
  type RowScaleSegment,
  type RowSliderSegment,
  projectRowScaleLayout,
  projectRowScaleSliders,
  projectRowSliderLayout,
} from './row-scale-bars';

/**
 * 행 단위 배치의 한 행 — 보기 모양이 척도 슬라이더인 묶음.
 *
 * 슬라이더를 그리는 호출부(`projectRowSliderLayout`)에서는 슬라이더 조각이고, 그 행에서 못 그리면 그 묶음
 * 열의 원본 조각이다. 넓은 화면에서는 슬라이더가 아닌 보기 묶음도 원본 조각이다. 슬라이더를 그리지 않는
 * 호출부(`projectRowScaleLayout`)에서는 원본 한 줄로 고른 묶음과 같이 처음부터 원본 조각이다.
 */

const CIRC = ['①', '②', '③', '④', '⑤'];
const head = (id: string, label: string, colspan: number): HeaderCell => ({
  id,
  label,
  colspan,
  rowspan: 1,
});
const HEADER: HeaderCell[][] = [
  [
    head('h-item', '평가항목', 1),
    head('h-u1', '활용함', 1),
    head('h-u2', '활용 안함', 1),
    head('h-lo', '불만족', 2),
    head('h-mid', '보통', 1),
    head('h-hi', '만족', 2),
  ],
];
const columns: TableColumn[] = [
  { id: 'item', label: '평가항목' },
  { id: 'u1', label: '활용함' },
  { id: 'u2', label: '활용 안함' },
  ...CIRC.map((_, n) => ({ id: `s${n}`, label: '' })),
];
const USE: ChoiceGroup = { id: 'g-use', groupKey: 'rad1', type: 'radio', label: '활용 여부' };
const SAT: ChoiceGroup = {
  id: 'g-sat',
  groupKey: 'rad2',
  type: 'radio',
  label: '만족도',
  scaleSlider: 'positive-right',
};
const useCells: TableCell[] = [
  { id: 'use1', type: 'choice_opt', content: '①', choiceGroupId: 'g-use' },
  { id: 'use2', type: 'choice_opt', content: '②', choiceGroupId: 'g-use' },
];
const satCells: TableCell[] = CIRC.map((content, n) => ({
  id: `sat${n}`,
  type: 'choice_opt',
  content,
  choiceGroupId: 'g-sat',
}));
const row: TableRow = {
  id: 'r1',
  label: '회의실 지원',
  cells: [{ id: 'item-cell', type: 'text', content: '회의실 지원' }, ...useCells, ...satCells],
};

function input(overrides: Partial<ProjectRowScaleLayoutInput> = {}): ProjectRowScaleLayoutInput {
  return {
    columns,
    barHeaderGrid: HEADER,
    pieceHeaderGrid: HEADER,
    showPieceHeader: true,
    row,
    choiceGroups: [USE, SAT],
    ungroupedSelectionType: null,
    ...overrides,
  };
}

const kinds = (segments: RowScaleSegment[] | null) =>
  segments?.map((segment) =>
    segment.kind === 'bar'
      ? `bar:${segment.bar.key}`
      : segment.kind === 'tiles'
        ? `tiles:${segment.group.id}`
        : `original:${segment.piece.columns.map((c) => c.id).join(',')}`,
  ) ?? null;

describe('projectRowScaleLayout — 척도 슬라이더 묶음(슬라이더를 그리지 않는 호출부)', () => {
  it('슬라이더 묶음은 그 묶음 열의 원본 조각이고 막대 폴백 이유는 남지 않는다', () => {
    const layout = projectRowScaleLayout(input());
    expect(kinds(layout.segments)).toEqual(['tiles:g-use', 'original:s0,s1,s2,s3,s4']);
    expect(layout.fallbacks).toEqual([]);
  });

  it('척도 막대 필드가 함께 켜져 있어도 막대가 되지 않는다', () => {
    const layout = projectRowScaleLayout(
      input({ choiceGroups: [USE, { ...SAT, mobileScaleBar: true }] }),
    );
    expect(kinds(layout.segments)).toEqual(['tiles:g-use', 'original:s0,s1,s2,s3,s4']);
    expect(layout.fallbacks).toEqual([]);
  });

  it('행의 묶음이 슬라이더뿐이면 행 전체를 원본 표 조각으로 그린다', () => {
    const onlySat: TableRow = {
      ...row,
      cells: [row.cells[0]!, { id: 'pad1', type: 'text', content: '' }, { id: 'pad2', type: 'text', content: '' }, ...satCells],
    };
    const layout = projectRowScaleLayout(input({ row: onlySat, choiceGroups: [SAT] }));
    expect(layout.segments).toBeNull();
    expect(layout.fallbacks).toEqual([]);
  });

  it('체크박스 묶음에 적힌 슬라이더 방향은 읽지 않는다 — 제 보기 모양(세로 타일) 그대로다', () => {
    const layout = projectRowScaleLayout(
      input({ choiceGroups: [USE, { ...SAT, type: 'checkbox' }] }),
    );
    expect(kinds(layout.segments)).toEqual(['tiles:g-use', 'tiles:g-sat']);
  });
});

function sliderInput(
  overrides: Partial<ProjectRowSliderLayoutInput> = {},
): ProjectRowSliderLayoutInput {
  return { ...input(), wide: false, ...overrides };
}

const sliderKinds = (segments: RowSliderSegment[] | null) =>
  segments?.map((segment) =>
    segment.kind === 'slider' ? `slider:${segment.slider.key}` : kinds([segment])![0]!,
  ) ?? null;

const MEMO_COLUMN: TableColumn = { id: 'memo', label: '개선 의견' };
const MEMO_CELL: TableCell = { id: 'memo-cell', type: 'input', content: '' };
const withTextInput = (cells: TableCell[]) =>
  cells.map((cell, n) => (n === cells.length - 1 ? { ...cell, allowTextInput: true } : cell));

describe('projectRowSliderLayout — 좁은 화면(「행별 척도」와 같이)', () => {
  it('슬라이더 묶음은 슬라이더 조각이고 다른 묶음은 제 보기 모양 그대로다', () => {
    const layout = projectRowSliderLayout(sliderInput());
    expect(sliderKinds(layout.segments)).toEqual(['tiles:g-use', 'slider:g-sat']);
    expect(layout.fallbacks).toEqual([]);
    expect(layout.sliderFallbacks).toEqual([]);
    const slider = layout.segments!.find((segment) => segment.kind === 'slider');
    if (slider?.kind !== 'slider') throw new Error('슬라이더 조각이 없다');
    expect(slider.slider.group?.id).toBe('g-sat');
    expect(slider.slider.cells.map((cell) => cell.id)).toEqual(satCells.map((cell) => cell.id));
    // 눈금은 보기 칸 id 그대로다 — 호스트의 토글에 그대로 넘긴다
    expect(slider.slider.model.ticks.map((tick) => tick.choiceId)).toEqual(
      satCells.map((cell) => cell.id),
    );
    expect(slider.slider.model.bands.map((band) => band.label)).toEqual(['불만족', '보통', '만족']);
    expect(slider.slider.model.ticks.map((tick) => tick.side)).toEqual([
      'negative',
      'negative',
      'neutral',
      'positive',
      'positive',
    ]);
  });

  it('긍정 방향이 왼쪽이면 쪽이 뒤집힌다', () => {
    const layout = projectRowSliderLayout(
      sliderInput({ choiceGroups: [USE, { ...SAT, scaleSlider: 'positive-left' }] }),
    );
    const slider = layout.segments!.find((segment) => segment.kind === 'slider');
    if (slider?.kind !== 'slider') throw new Error('슬라이더 조각이 없다');
    expect(slider.slider.model.ticks[0]!.side).toBe('positive');
    expect(slider.slider.model.ticks[4]!.side).toBe('negative');
  });

  it('척도 막대 필드가 함께 켜져 있어도 슬라이더다', () => {
    const layout = projectRowSliderLayout(
      sliderInput({ choiceGroups: [USE, { ...SAT, mobileScaleBar: true }] }),
    );
    expect(sliderKinds(layout.segments)).toEqual(['tiles:g-use', 'slider:g-sat']);
    expect(layout.fallbacks).toEqual([]);
  });

  it('행의 묶음이 슬라이더뿐이어도 슬라이더 조각이다', () => {
    const onlySat: TableRow = { ...row, cells: [row.cells[0]!, ...satCells] };
    const layout = projectRowSliderLayout(
      sliderInput({
        row: onlySat,
        columns: [columns[0]!, ...columns.slice(3)],
        barHeaderGrid: undefined,
        pieceHeaderGrid: undefined,
        choiceGroups: [SAT],
      }),
    );
    expect(sliderKinds(layout.segments)).toEqual(['slider:g-sat']);
  });

  it('그 행에서 못 그리면 그 묶음 열의 원본 조각이고 슬라이더 폴백 이유가 남는다', () => {
    const failing: TableRow = {
      ...row,
      cells: [row.cells[0]!, ...useCells, ...withTextInput(satCells)],
    };
    const layout = projectRowSliderLayout(sliderInput({ row: failing }));
    expect(sliderKinds(layout.segments)).toEqual(['tiles:g-use', 'original:s0,s1,s2,s3,s4']);
    expect(layout.sliderFallbacks).toEqual([{ key: 'g-sat', group: SAT, reason: 'text-input' }]);
    // 막대를 고른 것이 아니라 막대 폴백 이유는 남지 않는다
    expect(layout.fallbacks).toEqual([]);
  });

  it('묶음이 슬라이더뿐인 행에서 못 그리면 행 전체를 원본 표 조각으로 그린다', () => {
    const failing: TableRow = {
      ...row,
      cells: [
        row.cells[0]!,
        { id: 'pad1', type: 'text', content: '' },
        { id: 'pad2', type: 'text', content: '' },
        ...withTextInput(satCells),
      ],
    };
    const layout = projectRowSliderLayout(sliderInput({ row: failing, choiceGroups: [SAT] }));
    expect(layout.segments).toBeNull();
    expect(layout.sliderFallbacks.map((fallback) => fallback.reason)).toEqual(['text-input']);
  });

  it('한 행에 슬라이더 묶음이 둘이면 열 순서대로 둘 다 슬라이더 조각이다', () => {
    const layout = projectRowSliderLayout(
      sliderInput({ choiceGroups: [{ ...USE, scaleSlider: 'positive-right' }, SAT] }),
    );
    expect(sliderKinds(layout.segments)).toEqual(['slider:g-use', 'slider:g-sat']);
  });

  it('체크박스 묶음에 적힌 슬라이더 방향은 읽지 않는다', () => {
    const layout = projectRowSliderLayout(
      sliderInput({ choiceGroups: [USE, { ...SAT, type: 'checkbox' }] }),
    );
    expect(sliderKinds(layout.segments)).toEqual(['tiles:g-use', 'tiles:g-sat']);
    expect(layout.sliderFallbacks).toEqual([]);
  });

  it('묶음 밖 응답 칸은 슬라이더 뒤 원본 조각으로 남는다', () => {
    const withMemo: TableRow = { ...row, cells: [...row.cells, MEMO_CELL] };
    const layout = projectRowSliderLayout(
      sliderInput({ row: withMemo, columns: [...columns, MEMO_COLUMN] }),
    );
    expect(sliderKinds(layout.segments)).toEqual(['tiles:g-use', 'slider:g-sat', 'original:memo']);
  });
});

describe('projectRowSliderLayout — 넓은 화면', () => {
  it('슬라이더가 아닌 보기 묶음은 세로 타일이 아니라 원본 조각이다', () => {
    const layout = projectRowSliderLayout(sliderInput({ wide: true }));
    expect(sliderKinds(layout.segments)).toEqual(['original:u1,u2', 'slider:g-sat']);
  });

  it('척도 막대·원본 한 줄로 설정한 묶음도 원본 조각이다 — 막대를 넓은 화면에 내지 않는다', () => {
    for (const use of [
      { ...USE, mobileScaleBar: true },
      { ...USE, mobileOriginalLine: true },
    ] satisfies ChoiceGroup[]) {
      const layout = projectRowSliderLayout(sliderInput({ wide: true, choiceGroups: [use, SAT] }));
      expect(sliderKinds(layout.segments)).toEqual(['original:u1,u2', 'slider:g-sat']);
      // 막대를 그리려 한 적이 없으니 막대 폴백 이유도 없다
      expect(layout.fallbacks).toEqual([]);
    }
  });

  it('슬라이더가 아닌 묶음과 이웃한 응답 칸은 원본 조각 하나로 이어진다', () => {
    const mixed: TableRow = {
      ...row,
      cells: [row.cells[0]!, ...useCells, MEMO_CELL, ...satCells],
    };
    const layout = projectRowSliderLayout(
      sliderInput({
        wide: true,
        row: mixed,
        columns: [...columns.slice(0, 3), MEMO_COLUMN, ...columns.slice(3)],
        barHeaderGrid: undefined,
        pieceHeaderGrid: undefined,
      }),
    );
    expect(sliderKinds(layout.segments)).toEqual(['original:u1,u2,memo', 'slider:g-sat']);
  });

  it('슬라이더를 못 그린 행은 행 전체가 원본 표 조각이다', () => {
    const failing: TableRow = {
      ...row,
      cells: [row.cells[0]!, ...useCells, ...withTextInput(satCells)],
    };
    const layout = projectRowSliderLayout(sliderInput({ wide: true, row: failing }));
    expect(layout.segments).toBeNull();
    expect(layout.sliderFallbacks).toEqual([{ key: 'g-sat', group: SAT, reason: 'text-input' }]);
  });

  it('슬라이더 묶음이 없는 행도 행 전체가 원본 표 조각이다', () => {
    const useOnly: TableRow = { ...row, cells: [row.cells[0]!, ...useCells] };
    const layout = projectRowSliderLayout(
      sliderInput({ wide: true, row: useOnly, columns: columns.slice(0, 3) }),
    );
    expect(layout.segments).toBeNull();
  });
});

describe('projectRowScaleSliders — 한 행에서 슬라이더로 그려지는 묶음', () => {
  it('그려지는 묶음과 못 그린 묶음을 이유와 함께 가른다', () => {
    const drawn = projectRowScaleSliders(input());
    expect(drawn.sliders.map((slider) => slider.key)).toEqual(['g-sat']);
    expect(drawn.fallbacks).toEqual([]);

    const failing: TableRow = {
      ...row,
      cells: [row.cells[0]!, ...useCells, ...withTextInput(satCells)],
    };
    const failed = projectRowScaleSliders(input({ row: failing }));
    expect(failed.sliders).toEqual([]);
    expect(failed.fallbacks).toEqual([{ key: 'g-sat', group: SAT, reason: 'text-input' }]);
  });

  it('슬라이더 설정이 없는 행은 둘 다 비어 있다', () => {
    const result = projectRowScaleSliders(
      input({ choiceGroups: [USE, { ...SAT, scaleSlider: undefined, mobileScaleBar: true }] }),
    );
    expect(result).toEqual({ sliders: [], fallbacks: [] });
  });
});
