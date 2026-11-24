import type { MobileTableDisplayMode } from '@/types/mobile-table-display';
import type { ChoiceGroup, HeaderCell, TableColumn, TableRow } from '@/types/survey';

import { resolveChoiceGroupSliderDirection } from './choice-group-mobile-view';
import { type UngroupedSelectionType, projectRowScaleSliders } from './row-scale-bars';

/**
 * 표 배치 판정 — 척도 슬라이더가 켜진 표를 어느 배치로 그리는가(CONTEXT.md 「척도 슬라이더」).
 *
 * ── 배선과 규칙 ──
 * - 재료는 셋이다: **슬라이더로 그려지는 행이 있는가 · 폭 · 모바일 표시 방식.** 표를 그리는 호스트와 빌더
 *   안내가 이 함수 하나를 쓴다 — 호스트마다 「모바일이고 행별 방식인가」를 따로 보면 화면과 안내가 갈린다.
 *
 *   | 그려지는 행 | 폭   | 모바일 표시 방식    | 배치                                   |
 *   | ----------- | ---- | ------------------- | -------------------------------------- |
 *   | 없음        | —    | —                   | `unchanged` 지금과 같다                |
 *   | 있음        | 넓음 | —                   | `row-wise` 행 단위 배치                |
 *   | 있음        | 좁음 | 행 단위 그룹 카드   | `row-group-cards` 그 카드 안에서       |
 *   | 있음        | 좁음 | 그 밖 전부          | `row-wise` 행 단위 배치(행별 척도처럼) |
 *
 * - 「그려지는 행이 없음」은 설정이 없거나, 설정은 있는데 모든 행이 폴백인 경우다. 그때는 넓은 화면에 원본
 *   표를 그대로 그린다 — 못 그리는 표를 행 조각으로 흩어 놓지 않는다.
 * - **그려지는 행은 표의 구조로 판정한다**(`tableHasScaleSliderRow` — 저작한 행·열·헤더). 응답에 따라
 *   숨는 행·열은 보지 않는다. 지금 보이는 행으로 판정하면 답을 고칠 때마다 표와 행 단위 배치 사이를 오가고,
 *   응답이 없는 빌더 안내와도 갈린다. 그 결과 슬라이더 행이 전부 표시 조건으로 숨은 순간에도 배치는 행
 *   단위다(남은 행은 원본 조각으로 그려진다).
 * - `unchanged` 와 `row-group-cards` 는 호스트의 기존 분기를 그대로 탄다. 그룹 카드는 섹션마다 스스로
 *   슬라이더를 그린다(choice-group-section-view) — 이 판정은 카드를 쓸지만 정한다.
 */
export type ScaleSliderTableLayout = 'unchanged' | 'row-wise' | 'row-group-cards';

export interface ResolveScaleSliderTableLayoutInput {
  /** 슬라이더로 그려지는 행이 있는가 — `tableHasScaleSliderRow` */
  hasSliderRow: boolean;
  /** 좁은 화면인가 — 호스트의 기존 모바일 판정 */
  narrow: boolean;
  mobileMode: MobileTableDisplayMode;
}

export function resolveScaleSliderTableLayout({
  hasSliderRow,
  narrow,
  mobileMode,
}: ResolveScaleSliderTableLayoutInput): ScaleSliderTableLayout {
  if (!hasSliderRow) return 'unchanged';
  if (narrow && mobileMode === 'row-group-cards') return 'row-group-cards';
  return 'row-wise';
}

export interface TableHasScaleSliderRowInput {
  /** 저작한 열 — 행의 셀과 인덱스가 맞는다 */
  columns: readonly TableColumn[];
  headerGrid?: HeaderCell[][] | undefined;
  rows: readonly TableRow[];
  choiceGroups: readonly ChoiceGroup[];
  /** 그룹 없는 보기 칸의 선택 방식 — 행 배치 투영과 같은 값(`resolveUngroupedSelectionType`) */
  ungroupedSelectionType: UngroupedSelectionType;
}

/** 슬라이더로 고른 묶음이 실제로 그려지는 행이 하나라도 있는가 — 행 배치와 같은 투영으로 본다 */
export function tableHasScaleSliderRow(input: TableHasScaleSliderRowInput): boolean {
  // 슬라이더 설정이 없는 표(대다수)는 행을 돌지 않는다
  if (!input.choiceGroups.some((group) => resolveChoiceGroupSliderDirection(group) !== null)) {
    return false;
  }
  return input.rows.some(
    (row) =>
      projectRowScaleSliders({
        columns: input.columns,
        barHeaderGrid: input.headerGrid,
        row,
        choiceGroups: input.choiceGroups,
        ungroupedSelectionType: input.ungroupedSelectionType,
      }).sliders.length > 0,
  );
}
