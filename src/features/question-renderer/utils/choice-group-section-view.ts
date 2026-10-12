import type { ChoiceGroup } from '@/types/survey';

import { resolveChoiceGroupMobileView } from './choice-group-mobile-view';
import {
  type ChoiceGroupOriginalLine,
  type ProjectChoiceGroupOriginalLineInput,
  projectChoiceGroupOriginalLine,
} from './choice-group-original-line';
import { type ScaleBarModel, projectScaleBar } from './choice-group-scale-bar';

/**
 * 「행 단위 그룹 카드」의 보기 그룹 한 섹션을 무엇으로 그릴지 — 척도 막대 / 원본 한 줄 / 세로 타일.
 *
 * 폴백 사슬(척도 막대를 못 그리면 원본 한 줄, 원본 조각을 못 만들면 세로 타일)을 한 곳에 둔다.
 * 표 문항(mobile-row-group-cards)과 보기 소스 표(choice-table-response)가 같은 판정을 쓴다 —
 * 두 표면은 선택 쓰기 채널만 다르다.
 */
export type ChoiceGroupSectionView =
  | { kind: 'scale-bar'; group: ChoiceGroup; model: ScaleBarModel }
  | { kind: 'original-line'; line: ChoiceGroupOriginalLine }
  | { kind: 'tiles' };

export interface ProjectChoiceGroupSectionViewInput extends ProjectChoiceGroupOriginalLineInput {
  /** 이 그룹의 선택 방식 — 쓰기와 같은 판정이어야 한다(복수 선택이면 막대 대신 폴백) */
  selectionType: ChoiceGroup['type'];
}

export function projectChoiceGroupSectionView(
  input: ProjectChoiceGroupSectionViewInput,
): ChoiceGroupSectionView {
  const { group } = input;
  if (group && resolveChoiceGroupMobileView(group) === 'scale-bar') {
    const scaleBar = projectScaleBar({
      selectionType: input.selectionType,
      columns: input.columns,
      headerGrid: input.headerGrid,
      row: input.row,
      targetCells: input.groupCells,
    });
    if (scaleBar.ok) return { kind: 'scale-bar', group, model: scaleBar.model };
  }
  const line = projectChoiceGroupOriginalLine(input);
  return line ? { kind: 'original-line', line } : { kind: 'tiles' };
}
