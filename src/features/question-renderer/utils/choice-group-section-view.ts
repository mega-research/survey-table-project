import type { ChoiceGroup } from '@/types/survey';

import {
  resolveChoiceGroupMobileView,
  resolveChoiceGroupSliderDirection,
} from './choice-group-mobile-view';
import {
  type ChoiceGroupOriginalLine,
  type ProjectChoiceGroupOriginalLineInput,
  projectChoiceGroupOriginalLine,
} from './choice-group-original-line';
import { type ScaleBarModel, projectScaleBar } from './choice-group-scale-bar';
import { type ScaleSliderModel, projectScaleSlider } from './scale-slider';

/**
 * 「행 단위 그룹 카드」의 보기 그룹 한 섹션을 무엇으로 그릴지 — 척도 막대 / 원본 한 줄 / 세로 타일.
 *
 * 폴백 사슬(척도 막대를 못 그리면 원본 한 줄, 원본 조각을 못 만들면 세로 타일)을 한 곳에 둔다.
 * 표 문항(mobile-row-group-cards)과 보기 소스 표(choice-table-response)가 같은 판정을 쓴다 —
 * 두 표면은 선택 쓰기 채널만 다르다.
 *
 * 척도 슬라이더(CONTEXT.md 「척도 슬라이더」)는 사슬의 맨 앞에 선다 — 슬라이더 → 원본 한 줄 → 세로 타일.
 * **슬라이더를 그리는 호출부는 `projectChoiceGroupSectionViewWithSlider`**, 그리지 않는 호출부는
 * `projectChoiceGroupSectionView` 를 부른다(뒤쪽에서 슬라이더 그룹은 처음부터 원본 한 줄이다). 종류를
 * 타입으로 갈라, 슬라이더를 그릴 줄 모르는 호출부가 슬라이더 섹션을 받는 일이 없다.
 */
export type ChoiceGroupSectionView =
  | { kind: 'scale-bar'; group: ChoiceGroup; model: ScaleBarModel }
  | { kind: 'original-line'; line: ChoiceGroupOriginalLine }
  | { kind: 'tiles' };

/** 슬라이더를 그리는 호출부의 섹션 — 종전 셋에 슬라이더가 더 있다 */
export type ChoiceGroupSliderSectionView =
  | ChoiceGroupSectionView
  | { kind: 'scale-slider'; group: ChoiceGroup; model: ScaleSliderModel };

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
      middleBandLabel: group.mobileScaleBarMiddleLabel === true,
    });
    if (scaleBar.ok) return { kind: 'scale-bar', group, model: scaleBar.model };
  }
  const line = projectChoiceGroupOriginalLine(input);
  return line ? { kind: 'original-line', line } : { kind: 'tiles' };
}

/**
 * 슬라이더를 그리는 호출부의 사슬 — 슬라이더로 고른 그룹이 이 행에서 그려지면 슬라이더, 아니면 종전 사슬
 * 그대로다(슬라이더 그룹은 원본 한 줄 → 세로 타일).
 */
export function projectChoiceGroupSectionViewWithSlider(
  input: ProjectChoiceGroupSectionViewInput,
): ChoiceGroupSliderSectionView {
  const { group } = input;
  const direction = resolveChoiceGroupSliderDirection(group);
  if (group && direction !== null) {
    const slider = projectScaleSlider({
      selectionType: input.selectionType,
      columns: input.columns,
      headerGrid: input.headerGrid,
      row: input.row,
      targetCells: input.groupCells,
      direction,
    });
    if (slider.ok) return { kind: 'scale-slider', group, model: slider.model };
  }
  return projectChoiceGroupSectionView(input);
}
