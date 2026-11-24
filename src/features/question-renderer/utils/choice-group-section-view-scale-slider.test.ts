import { describe, expect, it } from 'vitest';

import type { ChoiceGroup, TableCell, TableColumn, TableRow } from '@/types/survey';

import { projectChoiceGroupSectionView } from './choice-group-section-view';

/**
 * 「행 단위 그룹 카드」의 섹션 — 보기 모양이 척도 슬라이더인 묶음. 슬라이더를 그릴 수 있기 전까지는
 * 「못 그리는 묶음」과 같은 사슬(원본 한 줄 → 세로 타일)로 그린다. 슬라이더 조각이 생기면 이 파일의
 * 기대가 바뀐다.
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

describe('projectChoiceGroupSectionView — 척도 슬라이더 묶음', () => {
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
