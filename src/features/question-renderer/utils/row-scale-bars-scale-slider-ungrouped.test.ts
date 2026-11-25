import { describe, expect, it } from 'vitest';

import type { ChoiceGroup, HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';

import {
  type ProjectRowSliderLayoutInput,
  projectRowScaleLayout,
  projectRowScaleSliders,
  projectRowSliderLayout,
} from './row-scale-bars';

/**
 * 행 단위 배치의 한 행 — 묶음 없는 보기 칸의 척도 슬라이더(CONTEXT.md 「척도 슬라이더」).
 *
 * 묶음 없는 보기 소스 표에는 묶음별 설정이 없어 **문항 설정의 방향**(`ungroupedSliderDirection`)이 켠다.
 * 단위는 「행별 척도」에서 묶음 없는 보기 칸이 막대가 되는 것과 같다 — 이어진 묶음마다 하나.
 * 보기 묶음은 이 값을 읽지 않는다(묶음의 방향만).
 */

const NAMES = ['매우 불만족', '불만족', '보통', '만족', '매우 만족'];
const head = (id: string, label: string): HeaderCell => ({ id, label, colspan: 1, rowspan: 1 });
const HEADER: HeaderCell[][] = [[head('h-item', '평가항목'), ...NAMES.map((name, n) => head(`h${n}`, name))]];
const columns: TableColumn[] = [
  { id: 'item', label: '평가항목' },
  ...NAMES.map((label, n) => ({ id: `s${n}`, label })),
];
const scaleCells = (edit: (cell: TableCell, n: number) => TableCell = (c) => c): TableCell[] =>
  ['①', '②', '③', '④', '⑤'].map((content, n) =>
    edit({ id: `sat${n}`, type: 'choice_opt', content, choiceLabel: NAMES[n]! }, n),
  );
const rowOf = (cells: TableCell[]): TableRow => ({
  id: 'r1',
  label: '시설',
  cells: [{ id: 'item', type: 'text', content: '1) 시설' }, ...cells],
});

function input(extra: Partial<ProjectRowSliderLayoutInput> = {}): ProjectRowSliderLayoutInput {
  return {
    columns,
    barHeaderGrid: HEADER,
    pieceHeaderGrid: HEADER,
    showPieceHeader: true,
    row: rowOf(scaleCells()),
    choiceGroups: [],
    ungroupedSelectionType: 'radio',
    wide: true,
    ...extra,
  };
}

describe('행 배치 — 묶음 없는 보기 칸의 척도 슬라이더', () => {
  it('문항 설정의 방향이 있으면 이어진 묶음이 슬라이더 조각이 된다(넓은 폭)', () => {
    const { segments, sliderFallbacks } = projectRowSliderLayout(
      input({ ungroupedSliderDirection: 'positive-right' }),
    );
    expect(segments?.map((segment) => segment.kind)).toEqual(['slider']);
    const [segment] = segments!;
    if (segment?.kind !== 'slider') throw new Error('슬라이더 조각이 아니다');
    expect(segment.slider.group).toBeUndefined();
    expect(segment.slider.key).toBe('run:sat0');
    expect(segment.slider.cells.map((cell) => cell.id)).toEqual([
      'sat0',
      'sat1',
      'sat2',
      'sat3',
      'sat4',
    ]);
    expect(segment.slider.model.ticks.map((tick) => tick.choiceId)).toEqual([
      'sat0',
      'sat1',
      'sat2',
      'sat3',
      'sat4',
    ]);
    expect(sliderFallbacks).toEqual([]);
  });

  it('방향이 왼쪽 긍정이면 첫 눈금이 긍정 쪽이다', () => {
    const { segments } = projectRowSliderLayout(input({ ungroupedSliderDirection: 'positive-left' }));
    const [segment] = segments!;
    if (segment?.kind !== 'slider') throw new Error('슬라이더 조각이 아니다');
    expect(segment.slider.model.ticks.map((tick) => tick.side)).toEqual([
      'positive',
      'positive',
      'neutral',
      'negative',
      'negative',
    ]);
  });

  it('좁은 폭에서도 슬라이더 조각이다 — 묶음 없는 묶음의 기본인 척도 막대가 아니다', () => {
    const { segments, fallbacks } = projectRowSliderLayout(
      input({ wide: false, ungroupedSliderDirection: 'positive-right' }),
    );
    expect(segments?.map((segment) => segment.kind)).toEqual(['slider']);
    expect(fallbacks).toEqual([]);
  });

  it('문항 설정이 없으면(없음·null) 지금과 같다 — 좁은 폭은 척도 막대, 넓은 폭은 행 전체가 원본 조각', () => {
    for (const direction of [undefined, null] as const) {
      const extra = direction === undefined ? {} : { ungroupedSliderDirection: direction };
      expect(
        projectRowSliderLayout(input({ wide: false, ...extra })).segments?.map((s) => s.kind),
      ).toEqual(['bar']);
      expect(projectRowSliderLayout(input({ wide: true, ...extra })).segments).toBeNull();
    }
  });

  it('사이에 다른 칸이 끼면 묶음이 둘이고 슬라이더도 둘이다', () => {
    const cells = scaleCells();
    const row: TableRow = {
      id: 'r1',
      label: '시설',
      cells: [
        { id: 'item', type: 'text', content: '1) 시설' },
        cells[0]!,
        cells[1]!,
        { id: 'gap', type: 'text', content: '/' },
        cells[2]!,
        cells[3]!,
      ],
    };
    const { sliders } = projectRowScaleSliders({
      columns: columns.slice(0, 6),
      barHeaderGrid: undefined,
      row,
      choiceGroups: [],
      ungroupedSelectionType: 'radio',
      ungroupedSliderDirection: 'positive-right',
    });
    expect(sliders.map((slider) => slider.key)).toEqual(['run:sat0', 'run:sat2']);
  });

  it('그 행에서 못 그리면 이유가 남고 원본 조각으로 떨어진다(좁은 폭) — 척도 막대로 바꿔 그리지 않는다', () => {
    const withDetail = rowOf(
      scaleCells((cell, n) => (n === 4 ? { ...cell, allowTextInput: true } : cell)),
    );
    const { segments, sliderFallbacks, fallbacks } = projectRowSliderLayout(
      input({ wide: false, row: withDetail, ungroupedSliderDirection: 'positive-right' }),
    );
    expect(sliderFallbacks).toEqual([{ key: 'run:sat0', group: undefined, reason: 'text-input' }]);
    // 조각이 원본뿐이면 행 전체를 원본 표 조각으로 그린다(segments null)
    expect(segments).toBeNull();
    expect(fallbacks).toEqual([]);
  });

  it('체크박스 문항의 묶음 없는 칸은 방향을 줘도 슬라이더가 아니다 — 단일 선택이 아니다', () => {
    const { sliders, fallbacks } = projectRowScaleSliders({
      ...input({ ungroupedSelectionType: 'checkbox', ungroupedSliderDirection: 'positive-right' }),
    });
    expect(sliders).toEqual([]);
    expect(fallbacks.map((fallback) => fallback.reason)).toEqual(['not-single-choice']);
  });

  it('표 문항의 묶음 없는 보기 칸(답할 수 없는 칸)은 방향을 줘도 묶음이 아니다', () => {
    const { sliders, fallbacks } = projectRowScaleSliders(
      input({ ungroupedSelectionType: null, ungroupedSliderDirection: 'positive-right' }),
    );
    expect(sliders).toEqual([]);
    expect(fallbacks).toEqual([]);
  });

  it('보기 묶음은 문항 설정의 방향을 읽지 않는다 — 묶음의 설정만 따른다', () => {
    const PLAIN: ChoiceGroup = { id: 'g-sat', groupKey: 'rad1', type: 'radio', label: '만족도' };
    const grouped = rowOf(scaleCells((cell) => ({ ...cell, choiceGroupId: 'g-sat' })));
    const { sliders } = projectRowScaleSliders(
      input({ row: grouped, choiceGroups: [PLAIN], ungroupedSliderDirection: 'positive-right' }),
    );
    expect(sliders).toEqual([]);

    const { sliders: own } = projectRowScaleSliders(
      input({
        row: grouped,
        choiceGroups: [{ ...PLAIN, scaleSlider: 'positive-left' }],
        ungroupedSliderDirection: 'positive-right',
      }),
    );
    expect(own.map((slider) => slider.model.ticks[0]?.side)).toEqual(['positive']);
  });

  it('슬라이더를 그리지 않는 호출부(행별 척도의 옛 투영)는 방향을 줘도 종전과 같이 척도 막대다', () => {
    const { segments } = projectRowScaleLayout(
      input({ ungroupedSliderDirection: 'positive-right' }),
    );
    expect(segments?.map((segment) => segment.kind)).toEqual(['bar']);
  });
});
