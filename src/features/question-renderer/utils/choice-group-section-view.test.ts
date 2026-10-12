import { describe, expect, it } from 'vitest';

import type { ChoiceGroup, TableCell, TableColumn, TableRow } from '@/types/survey';

import { projectChoiceGroupSectionView } from './choice-group-section-view';

const group: ChoiceGroup = { id: 'g', groupKey: 'rad1', type: 'radio', label: '만족도' };
const cells: TableCell[] = ['①', '②', '③'].map((content, n) => ({
  id: `c${n}`,
  type: 'choice_opt',
  content,
  choiceGroupId: 'g',
}));
const row: TableRow = { id: 'r1', label: '항목', cells };
const columns: TableColumn[] = cells.map((_, n) => ({ id: `col${n}`, label: `${n + 1}점` }));

function view(overrides: Partial<ChoiceGroup>, selectionType: ChoiceGroup['type'] = 'radio') {
  return projectChoiceGroupSectionView({
    group: { ...group, ...overrides },
    selectionType,
    columns,
    row,
    groupCells: cells,
    hideColumnLabels: false,
  });
}

describe('projectChoiceGroupSectionView', () => {
  it('아무것도 고르지 않은 그룹은 세로 타일', () => {
    expect(view({}).kind).toBe('tiles');
  });

  it('원본 한 줄을 고르면 원본 표 조각', () => {
    expect(view({ mobileOriginalLine: true }).kind).toBe('original-line');
  });

  it('척도 막대를 고르고 그릴 수 있으면 막대 모델과 그룹을 싣는다', () => {
    const result = view({ mobileScaleBar: true });
    expect(result.kind).toBe('scale-bar');
    if (result.kind !== 'scale-bar') return;
    expect(result.group.id).toBe('g');
    expect(result.model.cells.map((cell) => cell.cellId)).toEqual(['c0', 'c1', 'c2']);
  });

  it('척도 막대를 못 그리면(복수 선택) 원본 한 줄로 폴백한다', () => {
    expect(view({ mobileScaleBar: true, type: 'checkbox' }, 'checkbox').kind).toBe(
      'original-line',
    );
  });

  it('그룹이 없으면 세로 타일', () => {
    expect(
      projectChoiceGroupSectionView({
        group: undefined,
        selectionType: 'radio',
        columns,
        row,
        groupCells: cells,
        hideColumnLabels: false,
      }).kind,
    ).toBe('tiles');
  });
});
