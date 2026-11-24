import type { MobileTableDisplayMode } from '@/types/mobile-table-display';
import { type ScaleSliderDirection, isScaleSliderDirection } from '@/types/scale-slider';
import type { ChoiceGroup, HeaderCell, Question, TableColumn, TableRow } from '@/types/survey';
import { resolveMobileTableDisplayMode } from '@/utils/mobile-table-display-mode';

import { resolveChoiceGroupSliderDirection } from './choice-group-mobile-view';
import {
  type UngroupedSelectionType,
  projectRowScaleSliders,
  resolveUngroupedSelectionType,
} from './row-scale-bars';

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
 * - **슬라이더를 켜는 설정은 둘이고 표마다 하나만 읽는다.** 보기 그룹이 있는 표는 그룹의 보기 모양,
 *   그룹 없는 보기 소스 표(라디오 문항)는 문항 설정(`Question.scaleSlider`)이다. 어느 표가 문항 설정을
 *   읽는지는 `canChoiceTableUseQuestionScaleSlider` 한 곳이 정하고, 응답 호스트(값 읽기)와 빌더(스위치를
 *   보일지)가 같이 쓴다 — 갈리면 켜도 아무 일이 없는 스위치가 보인다.
 * - **호스트는 저작자가 고른 모바일 표시 방식을 직접 견주지 않는다 — `resolveRenderedTableDisplay` 가 낸
 *   「지금 유효한 표시 방식」만 읽는다.** 슬라이더가 행 단위 배치로 가져간 화면에서 고른 방식을 직접 읽는
 *   파생값이 하나라도 있으면 그 방식의 전용 장치가 샌다 — 「항목 단위 카드」로 둔 표에서 행 추가 버튼을
 *   그려지지 않는 카드에 넘기고 대체 버튼은 숨겼고, 「축 단위 카드」로 둔 보기 소스 표에서 문항 카드가
 *   필수 안내 상자를 거뒀다(2026-11-24 리뷰). 표를 그리는 호스트 둘(표 문항 · 보기 소스 표)과 문항
 *   카드(survey-response 의 group-step-item)가 이 값을 읽는다. 표시 방식을 새로 견주는 자리도 그렇게 한다.
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

/**
 * 지금 유효한 표시 방식 — 표를 그리는 쪽이 읽는 값. 저작자가 고른 값(`mobileMode`)에 슬라이더의 배치와
 * 폭을 반영한 것이다.
 */
export interface RenderedTableDisplay {
  layout: ScaleSliderTableLayout;
  /**
   * 유효한 표시 방식(폭과 무관) — 슬라이더가 행 단위 배치로 가져가면 저작 값이 아니라 `row-wise-scale`,
   * 그 밖에는 저작 값. 넓은 화면의 격자 표가 읽는 값이다(「원본」으로 둔 표의 좌우 여백).
   */
  mode: MobileTableDisplayMode;
  /**
   * 화면을 실제로 정하는 표시 방식 — 좁은 화면이면 `mode`, 넓은 화면은 슬라이더의 행 단위 배치일 때만
   * `row-wise-scale` 이고 그 밖에는 null(격자 표)이다. **방식별 분기·파생값은 이 값을 견준다.**
   */
  activeMode: MobileTableDisplayMode | null;
}

/** 지금 유효한 표시 방식을 한 번에 정한다 — 입력은 표 배치 판정과 같다 */
export function resolveRenderedTableDisplay(
  input: ResolveScaleSliderTableLayoutInput,
): RenderedTableDisplay {
  const layout = resolveScaleSliderTableLayout(input);
  if (layout === 'row-wise') {
    // 행 단위 배치는 고른 방식·폭과 무관하게 「행별 척도」와 같이 그린다
    return { layout, mode: 'row-wise-scale', activeMode: 'row-wise-scale' };
  }
  return { layout, mode: input.mobileMode, activeMode: input.narrow ? input.mobileMode : null };
}

export interface TableHasScaleSliderRowInput {
  /** 저작한 열 — 행의 셀과 인덱스가 맞는다 */
  columns: readonly TableColumn[];
  headerGrid?: HeaderCell[][] | undefined;
  rows: readonly TableRow[];
  choiceGroups: readonly ChoiceGroup[];
  /** 그룹 없는 보기 칸의 선택 방식 — 행 배치 투영과 같은 값(`resolveUngroupedSelectionType`) */
  ungroupedSelectionType: UngroupedSelectionType;
  /**
   * 그룹 없는 묶음의 슬라이더 방향 — 그룹 없는 보기 소스 표의 문항 설정
   * (`resolveChoiceTableQuestionSliderDirection`). 표 문항은 넘기지 않는다.
   */
  ungroupedSliderDirection?: ScaleSliderDirection | null | undefined;
}

/** 슬라이더로 고른 묶음이 실제로 그려지는 행이 하나라도 있는가 — 행 배치와 같은 투영으로 본다 */
export function tableHasScaleSliderRow(input: TableHasScaleSliderRowInput): boolean {
  const ungroupedSliderDirection = input.ungroupedSliderDirection ?? null;
  // 슬라이더 설정이 없는 표(대다수)는 행을 돌지 않는다
  if (
    ungroupedSliderDirection === null &&
    !input.choiceGroups.some((group) => resolveChoiceGroupSliderDirection(group) !== null)
  ) {
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
        ungroupedSliderDirection,
      }).sliders.length > 0,
  );
}

/**
 * 문항 설정으로 슬라이더를 켜는 보기 소스 표인가 — **라디오 문항이고 라디오·체크박스 보기 그룹이 하나도
 * 없을 때**다. 그룹이 하나라도 있으면 응답이 그룹 맵이고 그 표는 그룹 설정만 따른다(순위 그룹만 있는 표는
 * 그룹 없는 표와 같다 — 응답 모양 판정 `isGroupedChoiceQuestion` 과 같은 기준). 체크박스 문항은 단일 선택이
 * 아니라 대상이 아니다.
 *
 * 표가 있는지(보기 소스 표인지)는 보지 않는다 — 부르는 쪽이 이미 안다.
 */
export function canChoiceTableUseQuestionScaleSlider(
  question: Pick<Question, 'type'> & { choiceGroups?: readonly ChoiceGroup[] | null | undefined },
): boolean {
  if (question.type !== 'radio') return false;
  return !(question.choiceGroups ?? []).some(
    (group) => group.type === 'radio' || group.type === 'checkbox',
  );
}

/**
 * 보기 소스 표가 읽는 문항 설정의 슬라이더 방향 — 그룹 없는 묶음에 넘길 값. 문항 설정을 읽지 않는 표
 * (그룹이 있는 표 · 체크박스 문항)와 꺼진 문항(값 없음 · 빌더가 끈 null · 어휘 밖)은 null 이다.
 */
export function resolveChoiceTableQuestionSliderDirection(
  question: Pick<Question, 'type' | 'choiceGroups' | 'scaleSlider'>,
): ScaleSliderDirection | null {
  if (!canChoiceTableUseQuestionScaleSlider(question)) return null;
  return isScaleSliderDirection(question.scaleSlider) ? question.scaleSlider : null;
}

/** 보기 소스 표 문항에서 판정에 쓰는 필드 — 호스트와 문항 카드가 같은 문항 객체를 넘긴다 */
type ChoiceTableDisplayQuestion = Pick<
  Question,
  | 'type'
  | 'choiceGroups'
  | 'scaleSlider'
  | 'tableColumns'
  | 'tableHeaderGrid'
  | 'tableRowsData'
  | 'mobileTableDisplayMode'
  | 'mobileOriginalTable'
>;

const NO_COLUMNS: readonly TableColumn[] = [];
const NO_ROWS: readonly TableRow[] = [];
const NO_CHOICE_GROUPS: readonly ChoiceGroup[] = [];

/**
 * 보기 소스 표에 슬라이더로 그려지는 행이 있는가 — 그룹의 보기 모양과 문항 설정 가운데 그 표가 읽는
 * 하나로 본다. 표가 없는 문항(보통 라디오·체크박스 문항)은 거짓이다. 구조에만 의존하므로 부르는 쪽이
 * 문항 객체로 메모한다.
 */
export function choiceTableHasScaleSliderRow(question: ChoiceTableDisplayQuestion): boolean {
  return tableHasScaleSliderRow({
    columns: question.tableColumns ?? NO_COLUMNS,
    headerGrid: question.tableHeaderGrid ?? undefined,
    rows: question.tableRowsData ?? NO_ROWS,
    choiceGroups: question.choiceGroups ?? NO_CHOICE_GROUPS,
    ungroupedSelectionType: resolveUngroupedSelectionType(question.type),
    ungroupedSliderDirection: resolveChoiceTableQuestionSliderDirection(question),
  });
}

/**
 * 보기 소스 표 문항의 지금 유효한 표시 방식 — 표를 그리는 호스트 밖에서 표시 방식을 읽어야 하는 자리
 * (문항 카드의 필수 안내)가 호스트와 같은 값을 보게 한다.
 */
export function resolveChoiceTableRenderedDisplay(
  question: ChoiceTableDisplayQuestion,
  narrow: boolean,
): RenderedTableDisplay {
  return resolveRenderedTableDisplay({
    hasSliderRow: choiceTableHasScaleSliderRow(question),
    narrow,
    mobileMode: resolveMobileTableDisplayMode(question),
  });
}
