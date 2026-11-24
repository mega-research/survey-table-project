import { describe, expect, it } from 'vitest';

import type { ChoiceGroup, TableCell, TableColumn, TableRow } from '@/types/survey';

import { projectChoiceGroupSectionViewWithSlider } from './choice-group-section-view';

/**
 * 「행 단위 그룹 카드」의 묶음 없는 섹션 — 묶음 없는 보기 소스 표는 묶음별 설정이 없어 문항 설정의 방향
 * (`ungroupedSliderDirection`)이 슬라이더를 켠다(CONTEXT.md 「척도 슬라이더」). 보기 묶음의 섹션은 이 값을
 * 읽지 않는다.
 */

const cells: TableCell[] = ['①', '②', '③'].map((content, n) => ({
  id: `c${n}`,
  type: 'choice_opt',
  content,
}));
const row: TableRow = {
  id: 'r1',
  label: '항목',
  cells: [{ id: 'item', type: 'text', content: '항목' }, ...cells],
};
const columns: TableColumn[] = [
  { id: 'col-item', label: '항목' },
  ...cells.map((_, n) => ({ id: `col${n}`, label: `${n + 1}점` })),
];

const base = {
  group: undefined,
  selectionType: 'radio' as const,
  columns,
  row,
  groupCells: cells,
  hideColumnLabels: false,
};

describe('projectChoiceGroupSectionViewWithSlider — 묶음 없는 섹션', () => {
  it('문항 설정의 방향이 있으면 슬라이더다', () => {
    const view = projectChoiceGroupSectionViewWithSlider({
      ...base,
      ungroupedSliderDirection: 'positive-right',
    });
    expect(view.kind).toBe('ungrouped-scale-slider');
    if (view.kind !== 'ungrouped-scale-slider') return;
    expect(view.model.ticks.map((tick) => tick.choiceId)).toEqual(['c0', 'c1', 'c2']);
    expect(view.model.ticks.map((tick) => tick.side)).toEqual(['negative', 'neutral', 'positive']);
  });

  it('방향이 없으면(없음·null) 지금과 같이 세로 타일이다', () => {
    expect(projectChoiceGroupSectionViewWithSlider(base).kind).toBe('tiles');
    expect(
      projectChoiceGroupSectionViewWithSlider({ ...base, ungroupedSliderDirection: null }).kind,
    ).toBe('tiles');
  });

  it('그 행에서 못 그리면 세로 타일이다 — 묶음 없는 섹션에는 원본 한 줄이 없다', () => {
    const withDetail = cells.map((cell, n) => (n === 2 ? { ...cell, allowTextInput: true } : cell));
    const view = projectChoiceGroupSectionViewWithSlider({
      ...base,
      row: { ...row, cells: [row.cells[0]!, ...withDetail] },
      groupCells: withDetail,
      ungroupedSliderDirection: 'positive-right',
    });
    expect(view.kind).toBe('tiles');
  });

  it('체크박스 문항의 묶음 없는 섹션은 방향을 줘도 슬라이더가 아니다', () => {
    const view = projectChoiceGroupSectionViewWithSlider({
      ...base,
      selectionType: 'checkbox',
      ungroupedSliderDirection: 'positive-right',
    });
    expect(view.kind).toBe('tiles');
  });

  it('보기 묶음의 섹션은 문항 설정의 방향을 읽지 않는다', () => {
    const group: ChoiceGroup = { id: 'g', groupKey: 'rad1', type: 'radio', label: '만족도' };
    const grouped = cells.map((cell) => ({ ...cell, choiceGroupId: 'g' }));
    const view = projectChoiceGroupSectionViewWithSlider({
      ...base,
      group,
      row: { ...row, cells: [row.cells[0]!, ...grouped] },
      groupCells: grouped,
      ungroupedSliderDirection: 'positive-right',
    });
    expect(view.kind).toBe('tiles');
  });
});
