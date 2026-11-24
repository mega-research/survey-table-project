import { describe, expect, it } from 'vitest';

import type { ChoiceGroup, TableCell, TableColumn, TableRow } from '@/types/survey';

import {
  projectChoiceGroupSectionView,
  projectChoiceGroupSectionViewWithSlider,
} from './choice-group-section-view';

/**
 * 「행 단위 그룹 카드」의 섹션 — 보기 모양이 척도 슬라이더인 묶음.
 *
 * 슬라이더를 그리는 호출부(`projectChoiceGroupSectionViewWithSlider`)에서는 슬라이더이고, 그 행에서 못
 * 그리면 원본 한 줄 → 세로 타일 사슬로 떨어진다. 슬라이더를 그리지 않는 호출부
 * (`projectChoiceGroupSectionView`)에서는 처음부터 그 사슬이다.
 */

const group: ChoiceGroup = {
  id: 'g',
  groupKey: 'rad1',
  type: 'radio',
  label: '만족도',
  scaleSlider: 'positive-right',
};
const cells: TableCell[] = ['①', '②', '③'].map((content, n) => ({
  id: `c${n}`,
  type: 'choice_opt',
  content,
  choiceGroupId: 'g',
}));
const row: TableRow = { id: 'r1', label: '항목', cells };
const columns: TableColumn[] = cells.map((_, n) => ({ id: `col${n}`, label: `${n + 1}점` }));

function view(overrides: Partial<ChoiceGroup> = {}, groupCells: readonly TableCell[] = cells) {
  return projectChoiceGroupSectionView({
    group: { ...group, ...overrides },
    selectionType: 'radio',
    columns,
    row,
    groupCells,
    hideColumnLabels: false,
  });
}

describe('projectChoiceGroupSectionView — 척도 슬라이더 묶음(슬라이더를 그리지 않는 호출부)', () => {
  it('슬라이더를 고른 묶음은 그 묶음 열의 원본 한 줄로 그린다', () => {
    const result = view();
    expect(result.kind).toBe('original-line');
    if (result.kind !== 'original-line') return;
    expect(result.line.columns.map((column) => column.id)).toEqual(['col0', 'col1', 'col2']);
    expect(result.line.row.cells.map((cell) => cell.id)).toEqual(['c0', 'c1', 'c2']);
  });

  it('긍정 방향이 왼쪽이어도 같다', () => {
    expect(view({ scaleSlider: 'positive-left' }).kind).toBe('original-line');
  });

  it('척도 막대 필드가 함께 켜져 있어도 막대로 그리지 않는다 — 슬라이더가 먼저 읽힌다', () => {
    expect(view({ mobileScaleBar: true }).kind).toBe('original-line');
  });

  it('원본 조각을 만들 수 없으면 세로 타일이다', () => {
    expect(view({}, []).kind).toBe('tiles');
    const stranger: TableCell = { id: 'stranger', type: 'choice_opt', content: '①' };
    expect(view({}, [stranger]).kind).toBe('tiles');
  });
});

/** 슬라이더 방향이 적히지 않은 같은 묶음 */
const plainGroup: ChoiceGroup = { id: 'g', groupKey: 'rad1', type: 'radio', label: '만족도' };

function sliderView(
  overrides: Partial<ChoiceGroup> = {},
  options: {
    base?: ChoiceGroup;
    groupCells?: readonly TableCell[];
    row?: TableRow;
    selectionType?: ChoiceGroup['type'];
  } = {},
) {
  return projectChoiceGroupSectionViewWithSlider({
    group: { ...(options.base ?? group), ...overrides },
    selectionType: options.selectionType ?? 'radio',
    columns,
    row: options.row ?? row,
    groupCells: options.groupCells ?? cells,
    hideColumnLabels: false,
  });
}

describe('projectChoiceGroupSectionViewWithSlider — 척도 슬라이더 묶음', () => {
  it('슬라이더를 고른 묶음은 슬라이더다 — 눈금은 그 묶음의 보기 칸 그대로다', () => {
    const result = sliderView();
    expect(result.kind).toBe('scale-slider');
    if (result.kind !== 'scale-slider') return;
    expect(result.group.id).toBe('g');
    expect(result.model.ticks.map((tick) => tick.choiceId)).toEqual(['c0', 'c1', 'c2']);
    expect(result.model.ticks.map((tick) => tick.side)).toEqual(['negative', 'neutral', 'positive']);
  });

  it('긍정 방향이 왼쪽이면 쪽이 뒤집힌다', () => {
    const result = sliderView({ scaleSlider: 'positive-left' });
    expect(result.kind).toBe('scale-slider');
    if (result.kind !== 'scale-slider') return;
    expect(result.model.ticks.map((tick) => tick.side)).toEqual(['positive', 'neutral', 'negative']);
  });

  it('척도 막대 필드가 함께 켜져 있어도 슬라이더다', () => {
    expect(sliderView({ mobileScaleBar: true }).kind).toBe('scale-slider');
  });

  it('그 행에서 슬라이더를 못 그리면 원본 한 줄이다', () => {
    const withTextInput = cells.map((cell, n) => (n === 2 ? { ...cell, allowTextInput: true } : cell));
    const result = sliderView({}, { groupCells: withTextInput, row: { ...row, cells: withTextInput } });
    expect(result.kind).toBe('original-line');
  });

  it('쓰기가 복수 선택이면 슬라이더가 아니라 원본 한 줄이다', () => {
    expect(sliderView({}, { selectionType: 'checkbox' }).kind).toBe('original-line');
  });

  it('슬라이더도 원본 조각도 못 만들면 세로 타일이다', () => {
    expect(sliderView({}, { groupCells: [] }).kind).toBe('tiles');
  });

  it('슬라이더가 아닌 묶음은 종전 사슬 그대로다', () => {
    const plain = { base: plainGroup };
    expect(sliderView({}, plain).kind).toBe('tiles');
    expect(sliderView({ mobileOriginalLine: true }, plain).kind).toBe('original-line');
    expect(sliderView({ mobileScaleBar: true }, plain).kind).toBe('scale-bar');
  });
});
