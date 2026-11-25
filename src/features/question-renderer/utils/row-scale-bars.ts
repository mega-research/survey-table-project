import type {
  ChoiceGroup,
  HeaderCell,
  QuestionType,
  TableCell,
  TableColumn,
  TableRow,
} from '@/types/survey';

import type { ScaleSliderDirection } from '@/types/scale-slider';

import {
  resolveChoiceGroupMobileView,
  resolveChoiceGroupSliderDirection,
} from './choice-group-mobile-view';
import {
  type ChoiceGroupOriginalLine,
  projectOriginalColumnPiece,
} from './choice-group-original-line';
import {
  type ScaleBarFallbackReason,
  type ScaleBarModel,
  projectScaleBar,
} from './choice-group-scale-bar';
import type { MobileRowWiseOriginalModel } from './mobile-row-wise-original';
import { isScaleVisibleCell } from './scale-header-reading';
import {
  type ScaleSliderFallbackReason,
  type ScaleSliderModel,
  projectScaleSlider,
} from './scale-slider';

/**
 * 「행별 척도」 모바일 표시 방식의 한 행 — 행별 원본 문항의 원본 표 조각 자리를 무엇으로 채우는지
 * (CONTEXT.md 「행별 척도」).
 *
 * 보기 그룹은 **제 보기 모양**을 따른다 — 「행 단위 그룹 카드」와 같은 설정(세로 타일 기본 · 원본 한 줄 ·
 * 척도 막대, choice-group-mobile-view)이다. 그룹 없는 보기 소스 표의 보기 칸은 그룹별 설정이 없어 모드
 * 자체가 선택이라 막대다(이어진 묶음마다 하나). 막대를 못 그리면 그 묶음은 원본 한 줄로 떨어지고 이유가
 * 남는다(빌더 경고 재료). 나머지 응답 칸(입력칸 등)은 원래 형태 — 열 순서대로 이어진 열을 잘라 낸 원본
 * 표 조각이다. 막대 하나의 판정은 척도 막대 투영(choice-group-scale-bar) 그대로다.
 *
 * ── 척도 슬라이더(CONTEXT.md 「척도 슬라이더」) ──
 * - 투영은 둘이다. **슬라이더를 그리는 호출부는 `projectRowSliderLayout`**(조각에 `slider` 가 더 있다),
 *   그리지 않는 호출부는 `projectRowScaleLayout` 이다 — 뒤쪽에서 슬라이더 그룹은 원본 한 줄로 고른 그룹과
 *   같이 그 그룹 열의 원본 조각이다. 조각 종류를 타입으로 갈라, 슬라이더를 그릴 줄 모르는 호출부가 슬라이더
 *   조각을 받는 일이 없다. 순회·묶음 가르기·조각 자르기는 한 구현이다.
 * - 슬라이더 그룹은 슬라이더 조각이고, 그 행에서 못 그리면(투영 scale-slider 의 폴백) 그 그룹 열의 원본
 *   조각이다. 이유는 `sliderFallbacks` 에 남는다 — 막대를 고른 것이 아니라 막대 폴백(`fallbacks`)에는 남지
 *   않는다.
 * - **넓은 화면(`wide`)에서는 슬라이더가 아닌 보기 그룹을 제 보기 모양으로 내지 않는다** — 세로 타일과
 *   척도 막대는 모바일 폭에 맞춘 모양이다. 그 열은 보기 그룹 밖의 응답 칸과 같이 다뤄, 이웃한 열과 함께
 *   원본 조각 하나로 이어진다(표를 그룹마다 잘게 흩지 않는다). 못 그린 슬라이더 그룹도 같다.
 * - 슬라이더도 막대도 타일도 없는 행은 종전과 같이 행 전체가 원본 표 조각이다(segments null).
 * - 한 행에서 슬라이더로 그려지는 묶음만 알면 되는 자리(표 배치 판정 · 빌더 진단)는
 *   `projectRowScaleSliders` 를 쓴다 — 조각을 자르지 않는다.
 * - **그룹 없는 묶음의 슬라이더는 문항 설정이 켠다**(`ungroupedSliderDirection`). 그룹 없는 보기 소스 표에는
 *   그룹별 설정이 없어서다. 단위는 막대와 같다 — 이어진 묶음마다 하나. 보기 그룹은 이 값을 읽지 않는다
 *   (그룹의 방향만). 어느 문항에서 이 값을 넘길지는 호출부가 한 곳의 판정으로 정한다
 *   (scale-slider-table-layout 의 `resolveChoiceTableQuestionSliderDirection`).
 */

export interface RowScaleBar {
  /** 행 안에서 막대를 가르는 키 — 그룹 id, 그룹 없는 묶음은 첫 칸 id 로 만든다 */
  key: string;
  /** 막대의 보기 그룹 — 그룹 없는 묶음(보기 소스 표의 문항 선택)이면 없음 */
  group: ChoiceGroup | undefined;
  /** 막대 칸이 된 원래 보기 칸(행 순서) */
  cells: TableCell[];
  model: ScaleBarModel;
}

export type RowScaleSegment =
  | { kind: 'bar'; bar: RowScaleBar }
  /** 세로 타일 — 그룹 카드의 섹션과 같은 얼굴. 선택 쓰기가 문항마다 달라 호스트가 그린다 */
  | { kind: 'tiles'; key: string; group: ChoiceGroup; cells: TableCell[] }
  | { kind: 'original'; key: string; piece: ChoiceGroupOriginalLine };

export interface RowScaleSlider {
  /** 행 안에서 슬라이더를 가르는 키 — 막대와 같은 규칙(그룹 id, 그룹 없는 묶음은 첫 칸 id 로 만든다) */
  key: string;
  /** 슬라이더의 보기 그룹 — 그룹 없는 묶음이면 없음 */
  group: ChoiceGroup | undefined;
  /** 눈금·척도 밖 보기가 된 원래 보기 칸(행 순서) — 모델의 `choiceId` 가 이 칸들의 id 다 */
  cells: TableCell[];
  model: ScaleSliderModel;
}

/** 슬라이더를 그리는 호출부의 조각 — 막대·타일·원본에 슬라이더가 더 있다 */
export type RowSliderSegment = RowScaleSegment | { kind: 'slider'; slider: RowScaleSlider };

export interface RowScaleSliderFallback {
  key: string;
  group: ChoiceGroup | undefined;
  reason: ScaleSliderFallbackReason;
}

export interface RowScaleFallback {
  key: string;
  group: ChoiceGroup | undefined;
  reason: ScaleBarFallbackReason;
}

export interface RowScaleLayout {
  /** 행 순서대로의 막대·타일·원본 조각. 막대도 타일도 없으면 null — 행 전체를 원본 표 조각으로 그린다 */
  segments: RowScaleSegment[] | null;
  /** 막대로 고른 묶음 중 못 그려 원본으로 떨어진 것 */
  fallbacks: RowScaleFallback[];
}

export interface RowSliderLayout {
  /** 행 순서대로의 조각. 슬라이더도 막대도 타일도 없으면 null — 행 전체를 원본 표 조각으로 그린다 */
  segments: RowSliderSegment[] | null;
  /** 막대로 고른 묶음 중 못 그려 원본으로 떨어진 것 */
  fallbacks: RowScaleFallback[];
  /** 슬라이더로 고른 묶음 중 이 행에서 못 그려 원본으로 떨어진 것 */
  sliderFallbacks: RowScaleSliderFallback[];
}

export interface ProjectRowScaleLayoutInput {
  /** 행의 셀과 인덱스가 맞는 열 — 표시 조건·앞쪽 열 제외로 걸러진 뒤의 열 */
  columns: readonly TableColumn[];
  /** 막대 라벨 재료 — 반복 헤더·열 라벨 숨김과 무관하게 잘라 낸 헤더 격자 */
  barHeaderGrid?: HeaderCell[][] | undefined;
  /** 원본 조각의 헤더 — 행별 원본 조각이 그리는 것과 같다(설정에 따라 없다) */
  pieceHeaderGrid?: HeaderCell[][] | undefined;
  /** 원본 조각에 헤더를 그리는가 — 행별 원본 조각과 같은 판정 */
  showPieceHeader: boolean;
  row: TableRow;
  choiceGroups: readonly ChoiceGroup[];
  /**
   * 그룹 없는 보기 칸의 선택 방식. 보기 소스 표는 문항 유형(radio/checkbox), 표 문항은 null —
   * 표 문항의 그룹 없는 보기 칸은 답할 수 없는 칸이라 막대로 만들지 않는다.
   */
  ungroupedSelectionType: UngroupedSelectionType;
  /**
   * 그룹 없는 묶음의 슬라이더 방향 — 그룹 없는 보기 소스 표의 문항 설정. 없음·null 이면 그룹 없는 묶음은
   * 슬라이더가 아니다(지금과 같다). 슬라이더를 그리지 않는 호출부는 읽지 않는다.
   */
  ungroupedSliderDirection?: ScaleSliderDirection | null | undefined;
}

export interface ProjectRowSliderLayoutInput extends ProjectRowScaleLayoutInput {
  /**
   * 넓은 화면의 행 단위 배치인가 — 참이면 슬라이더가 아닌 보기 그룹을 제 보기 모양(세로 타일·척도 막대)
   * 대신 원본 조각으로 낸다. 좁은 화면은 「행별 척도」와 같이 그룹마다 제 보기 모양이다.
   */
  wide: boolean;
}

export type UngroupedSelectionType = 'radio' | 'checkbox' | null;

/**
 * 그룹 없는 보기 칸의 선택 방식 — 보기 소스 표(radio·checkbox 문항)는 문항 선택이라 문항 유형,
 * 표 문항은 null(그룹 없는 보기 칸은 답할 수 없는 글자 칸이다).
 */
export function resolveUngroupedSelectionType(
  questionType: QuestionType | undefined,
): UngroupedSelectionType {
  if (questionType === 'radio' || questionType === 'checkbox') return questionType;
  return null;
}

/** 원본 조각을 만들 만한 칸 — 응답 칸·계산 칸·보기 칸. 글자만 있는 열은 행 제목이 이미 보인다 */
const PIECE_CELL_TYPES = new Set<TableCell['type']>([
  'input',
  'radio',
  'checkbox',
  'select',
  'ranking',
  'ranking_opt',
  'calc',
  'choice_opt',
]);

/** 행 안의 한 묶음 — 보기 그룹(보기 모양에 따라 그린다) 또는 그룹 없는 보기 칸의 이어진 묶음 */
interface ChoiceUnit {
  key: string;
  group: ChoiceGroup | undefined;
  selectionType: ChoiceGroup['type'];
  cells: TableCell[];
}

type Draft =
  | { kind: 'bar'; bar: RowScaleBar }
  | { kind: 'slider'; slider: RowScaleSlider }
  | { kind: 'tiles'; key: string; group: ChoiceGroup; cells: TableCell[] }
  | { kind: 'piece'; key: string; cells: TableCell[] };

/** 묶음 투영의 재료 — 조각을 자르지 않는 자리(슬라이더로 그려지는 묶음만 볼 때)도 이것만 있으면 된다 */
type ChoiceUnitInput = Pick<
  ProjectRowScaleLayoutInput,
  | 'columns'
  | 'barHeaderGrid'
  | 'row'
  | 'choiceGroups'
  | 'ungroupedSelectionType'
  | 'ungroupedSliderDirection'
>;

/**
 * 행의 보기 칸을 묶음으로 가른다 — radio·checkbox 보기 그룹마다 하나, (보기 소스 표라면) 그룹 없는 보기
 * 칸은 이어진 묶음마다 하나. 순위 그룹 칸과 표 문항의 그룹 없는 보기 칸은 묶음이 아니다(원본 조각 몫).
 */
function collectChoiceUnits(input: ChoiceUnitInput): ChoiceUnit[] {
  const groupById = new Map(input.choiceGroups.map((group) => [group.id, group]));
  const units: ChoiceUnit[] = [];
  const byGroupId = new Map<string, ChoiceUnit>();
  let run: ChoiceUnit | undefined;
  let prevIndex = -2;
  for (const [index, cell] of input.row.cells.entries()) {
    if (cell.type !== 'choice_opt' || !isScaleVisibleCell(cell)) continue;
    const group = cell.choiceGroupId ? groupById.get(cell.choiceGroupId) : undefined;
    if (group) {
      if (group.type !== 'radio' && group.type !== 'checkbox') continue;
      const existing = byGroupId.get(group.id);
      if (existing) existing.cells.push(cell);
      else {
        const unit = { key: group.id, group, selectionType: group.type, cells: [cell] };
        byGroupId.set(group.id, unit);
        units.push(unit);
      }
      continue;
    }
    if (input.ungroupedSelectionType === null) continue;
    // 그룹 없는 보기 칸은 바로 옆 칸끼리만 한 막대다 — 사이에 다른 칸이 끼면 새 막대
    if (run && index === prevIndex + 1) run.cells.push(cell);
    else {
      run = {
        key: `run:${cell.id}`,
        group: undefined,
        selectionType: input.ungroupedSelectionType,
        cells: [cell],
      };
      units.push(run);
    }
    prevIndex = index;
  }
  return units;
}

/**
 * 묶음의 슬라이더 방향 — 보기 그룹은 그룹의 설정, 그룹 없는 묶음은 문항 설정(호출부가 넘긴다).
 * 그룹이 있는 묶음은 문항 설정을 읽지 않는다.
 */
function sliderDirectionOf(unit: ChoiceUnit, input: ChoiceUnitInput): ScaleSliderDirection | null {
  if (unit.group) return resolveChoiceGroupSliderDirection(unit.group);
  return input.ungroupedSliderDirection ?? null;
}

/** 묶음 하나를 슬라이더로 — 판정은 척도 슬라이더 투영(scale-slider) 그대로다 */
function projectUnitSlider(
  unit: ChoiceUnit,
  direction: ScaleSliderDirection,
  input: ChoiceUnitInput,
): { ok: true; slider: RowScaleSlider } | { ok: false; fallback: RowScaleSliderFallback } {
  const projected = projectScaleSlider({
    selectionType: unit.selectionType,
    columns: input.columns,
    headerGrid: input.barHeaderGrid,
    row: input.row,
    targetCells: unit.cells,
    direction,
  });
  return projected.ok
    ? {
        ok: true,
        slider: { key: unit.key, group: unit.group, cells: unit.cells, model: projected.model },
      }
    : { ok: false, fallback: { key: unit.key, group: unit.group, reason: projected.reason } };
}

/**
 * 한 행에서 슬라이더로 고른 묶음 — 그려지는 것과, 이 행에서 못 그리는 것(이유와 함께). 행 단위 배치가
 * 슬라이더 조각을 내는 판정과 같은 순회·같은 투영이다.
 */
export function projectRowScaleSliders(input: ChoiceUnitInput): {
  sliders: RowScaleSlider[];
  fallbacks: RowScaleSliderFallback[];
} {
  const sliders: RowScaleSlider[] = [];
  const fallbacks: RowScaleSliderFallback[] = [];
  for (const unit of collectChoiceUnits(input)) {
    const direction = sliderDirectionOf(unit, input);
    if (direction === null) continue;
    const projected = projectUnitSlider(unit, direction, input);
    if (projected.ok) sliders.push(projected.slider);
    else fallbacks.push(projected.fallback);
  }
  return { sliders, fallbacks };
}

export function projectRowScaleLayout(input: ProjectRowScaleLayoutInput): RowScaleLayout {
  const { segments, fallbacks } = buildRowLayout(input, null);
  // 슬라이더를 그리지 않는 배치에는 슬라이더 조각이 생기지 않는다 — 타입만 좁힌다
  return {
    segments:
      segments?.filter((segment): segment is RowScaleSegment => segment.kind !== 'slider') ?? null,
    fallbacks,
  };
}

/** 슬라이더를 그리는 호출부의 행 배치 — 슬라이더 그룹이 슬라이더 조각이 된다(머리 주석 「척도 슬라이더」) */
export function projectRowSliderLayout(input: ProjectRowSliderLayoutInput): RowSliderLayout {
  return buildRowLayout(input, { wide: input.wide });
}

function buildRowLayout(
  input: ProjectRowScaleLayoutInput,
  /** 슬라이더를 그리는 호출부인가 — null 이면 슬라이더 그룹은 원본 조각이다 */
  sliderMode: { wide: boolean } | null,
): RowSliderLayout {
  const { row, columns } = input;
  const wide = sliderMode?.wide === true;
  const fallbacks: RowScaleFallback[] = [];
  const sliderFallbacks: RowScaleSliderFallback[] = [];
  const drafts: Draft[] = [];
  for (const unit of collectChoiceUnits(input)) {
    const direction = sliderMode ? sliderDirectionOf(unit, input) : null;
    if (direction !== null) {
      const projected = projectUnitSlider(unit, direction, input);
      if (projected.ok) {
        drafts.push({ kind: 'slider', slider: projected.slider });
        continue;
      }
      sliderFallbacks.push(projected.fallback);
    }
    // 넓은 화면 — 슬라이더가 아닌(또는 못 그린) 묶음은 묶음 밖 응답 칸과 같이 이웃 열과 한 조각으로 이어진다
    if (wide) continue;
    if (direction !== null) {
      drafts.push({ kind: 'piece', key: unit.key, cells: unit.cells });
      continue;
    }
    // 보기 그룹은 제 보기 모양을 따른다(그룹 카드와 같다). 그룹 없는 보기 칸은 설정이 없어 막대가 기본
    const view = unit.group ? resolveChoiceGroupMobileView(unit.group) : 'scale-bar';
    if (view === 'tiles' && unit.group) {
      drafts.push({ kind: 'tiles', key: unit.key, group: unit.group, cells: unit.cells });
      continue;
    }
    if (view === 'scale-bar') {
      const projected = projectScaleBar({
        selectionType: unit.selectionType,
        columns,
        headerGrid: input.barHeaderGrid,
        row,
        targetCells: unit.cells,
        // 그룹 없는 묶음(보기 소스 표의 문항 선택)은 그룹 설정이 없어 늘 꺼짐이다
        middleBandLabel: unit.group?.mobileScaleBarMiddleLabel === true,
      });
      if (projected.ok) {
        drafts.push({
          kind: 'bar',
          bar: { key: unit.key, group: unit.group, cells: unit.cells, model: projected.model },
        });
        continue;
      }
      fallbacks.push({ key: unit.key, group: unit.group, reason: projected.reason });
    }
    // 원본 한 줄 · 슬라이더를 그리지 않는 호출부의 슬라이더 그룹, 또는 막대를 못 그린 묶음 — 그 열만 잘라 낸 원본 조각
    drafts.push({ kind: 'piece', key: unit.key, cells: unit.cells });
  }
  // 슬라이더도 막대도 타일도 없으면 행별 원본과 같다 — 반복 헤더 행까지 그리는 종전 조각이 낫다
  if (!drafts.some((draft) => draft.kind !== 'piece')) {
    return { segments: null, fallbacks, sliderFallbacks };
  }

  const draftAtIndex = new Map<number, Draft>();
  for (const draft of drafts) {
    const cells =
      draft.kind === 'bar'
        ? draft.bar.cells
        : draft.kind === 'slider'
          ? draft.slider.cells
          : draft.cells;
    for (const cell of cells) {
      draftAtIndex.set(
        row.cells.findIndex((c) => c.id === cell.id),
        draft,
      );
    }
  }
  const pieceOf = (key: string, indices: readonly number[]): RowSliderSegment | null => {
    const piece = projectOriginalColumnPiece({
      columns,
      headerGrid: input.pieceHeaderGrid,
      hideColumnLabels: !input.showPieceHeader,
      row,
      columnIds: new Set(indices.map((index) => columns[index]!.id)),
    });
    return piece ? { kind: 'original', key, piece } : null;
  };

  // 열 순서대로 걷는다 — 묶음 열은 그 묶음 하나로, 나머지 이어진 열은 원본 조각 하나로 묶는다
  const segments: RowSliderSegment[] = [];
  const emitted = new Set<Draft>();
  let freeIndices: number[] = [];
  const flushFree = () => {
    const indices = freeIndices;
    freeIndices = [];
    const hasAnswerCell = indices.some((index) => {
      const cell = row.cells[index];
      return cell !== undefined && isScaleVisibleCell(cell) && PIECE_CELL_TYPES.has(cell.type);
    });
    if (!hasAnswerCell) return;
    const segment = pieceOf(`piece:${columns[indices[0]!]!.id}`, indices);
    if (segment) segments.push(segment);
  };
  // 행 앞쪽의 글자 열(첫 응답 칸 앞)은 조각에 넣지 않는다 — 행 제목이 이미 보인다. 응답 칸 사이·뒤의
  // 글자 열(단위 등)은 원래 형태 그대로 조각에 남는다.
  const firstAnswerIndex = row.cells.findIndex(
    (cell) => isScaleVisibleCell(cell) && PIECE_CELL_TYPES.has(cell.type),
  );
  for (let index = Math.max(firstAnswerIndex, 0); index < columns.length; index += 1) {
    const draft = draftAtIndex.get(index);
    if (!draft) {
      freeIndices.push(index);
      continue;
    }
    flushFree();
    if (emitted.has(draft)) continue;
    emitted.add(draft);
    if (draft.kind === 'bar') segments.push({ kind: 'bar', bar: draft.bar });
    else if (draft.kind === 'slider') segments.push({ kind: 'slider', slider: draft.slider });
    else if (draft.kind === 'tiles') {
      segments.push({ kind: 'tiles', key: draft.key, group: draft.group, cells: draft.cells });
    } else {
      const segment = pieceOf(
        draft.key,
        draft.cells.map((cell) => row.cells.findIndex((c) => c.id === cell.id)),
      );
      if (segment) segments.push(segment);
    }
  }
  flushFree();
  return { segments, fallbacks, sliderFallbacks };
}

/**
 * 행별 원본 모델의 행 문항마다 행별 척도 배치 — 두 응답 호스트(표 문항·보기 소스 표)와 빌더 진단이
 * 같은 순회·같은 헤더 재료를 쓴다. 막대 라벨은 반복 헤더 설정과 무관하게 잘라 낸 격자
 * (clippedHeaderGrid)에서, 원본 조각의 헤더는 행별 원본 조각과 같은 격자에서 읽는다.
 */
export function projectRowWiseScaleLayouts(
  model: MobileRowWiseOriginalModel,
  choiceGroups: readonly ChoiceGroup[],
  ungroupedSelectionType: UngroupedSelectionType,
): Map<string, RowScaleLayout> {
  return projectRowWiseLayouts(model, choiceGroups, ungroupedSelectionType, projectRowScaleLayout);
}

/** 슬라이더를 그리는 호출부의 행별 배치 — 순회·헤더 재료는 `projectRowWiseScaleLayouts` 와 같다 */
export function projectRowWiseSliderLayouts(
  model: MobileRowWiseOriginalModel,
  choiceGroups: readonly ChoiceGroup[],
  ungroupedSelectionType: UngroupedSelectionType,
  options: {
    wide: boolean;
    /** 그룹 없는 묶음의 슬라이더 방향 — 그룹 없는 보기 소스 표의 문항 설정(없으면 꺼짐) */
    ungroupedSliderDirection?: ScaleSliderDirection | null | undefined;
  },
): Map<string, RowSliderLayout> {
  return projectRowWiseLayouts(model, choiceGroups, ungroupedSelectionType, (input) =>
    projectRowSliderLayout({
      ...input,
      wide: options.wide,
      ungroupedSliderDirection: options.ungroupedSliderDirection,
    }),
  );
}

function projectRowWiseLayouts<Layout>(
  model: MobileRowWiseOriginalModel,
  choiceGroups: readonly ChoiceGroup[],
  ungroupedSelectionType: UngroupedSelectionType,
  project: (input: ProjectRowScaleLayoutInput) => Layout,
): Map<string, Layout> {
  const byRowId = new Map<string, Layout>();
  for (const section of model.sections) {
    for (const subgroup of section.subgroups) {
      for (const rowQuestion of subgroup.questions) {
        const { projection } = rowQuestion;
        byRowId.set(
          rowQuestion.rowId,
          project({
            columns: projection.columns,
            barHeaderGrid: projection.clippedHeaderGrid,
            pieceHeaderGrid: projection.headerGrid,
            showPieceHeader: projection.showColumnHeader,
            row: projection.row,
            choiceGroups,
            ungroupedSelectionType,
          }),
        );
      }
    }
  }
  return byRowId;
}
