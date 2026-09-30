import type {
  ChoiceGroup,
  HeaderCell,
  QuestionType,
  TableCell,
  TableColumn,
  TableRow,
} from '@/types/survey';

import { resolveChoiceGroupMobileView } from './choice-group-mobile-view';
import {
  type ChoiceGroupOriginalLine,
  projectOriginalColumnPiece,
} from './choice-group-original-line';
import {
  type ScaleBarFallbackReason,
  type ScaleBarModel,
  isScaleBarVisibleCell,
  projectScaleBar,
} from './choice-group-scale-bar';
import type { MobileRowWiseOriginalModel } from './mobile-row-wise-original';

/**
 * 「행별 척도」 모바일 표시 방식의 한 행 — 행별 원본 문항의 원본 표 조각 자리를 무엇으로 채우는지
 * (CONTEXT.md 「행별 척도」).
 *
 * 보기 그룹은 **제 보기 모양**을 따른다 — 「행 단위 그룹 카드」와 같은 설정(세로 타일 기본 · 원본 한 줄 ·
 * 척도 막대, choice-group-mobile-view)이다. 그룹 없는 보기 소스 표의 보기 칸은 그룹별 설정이 없어 모드
 * 자체가 선택이라 막대다(이어진 묶음마다 하나). 막대를 못 그리면 그 묶음은 원본 한 줄로 떨어지고 이유가
 * 남는다(빌더 경고 재료). 나머지 응답 칸(입력칸 등)은 원래 형태 — 열 순서대로 이어진 열을 잘라 낸 원본
 * 표 조각이다. 막대 하나의 판정은 척도 막대 투영(choice-group-scale-bar) 그대로다.
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
  | { kind: 'tiles'; key: string; group: ChoiceGroup; cells: TableCell[] }
  | { kind: 'piece'; key: string; cells: TableCell[] };

/**
 * 행의 보기 칸을 묶음으로 가른다 — radio·checkbox 보기 그룹마다 하나, (보기 소스 표라면) 그룹 없는 보기
 * 칸은 이어진 묶음마다 하나. 순위 그룹 칸과 표 문항의 그룹 없는 보기 칸은 묶음이 아니다(원본 조각 몫).
 */
function collectChoiceUnits(input: ProjectRowScaleLayoutInput): ChoiceUnit[] {
  const groupById = new Map(input.choiceGroups.map((group) => [group.id, group]));
  const units: ChoiceUnit[] = [];
  const byGroupId = new Map<string, ChoiceUnit>();
  let run: ChoiceUnit | undefined;
  let prevIndex = -2;
  for (const [index, cell] of input.row.cells.entries()) {
    if (cell.type !== 'choice_opt' || !isScaleBarVisibleCell(cell)) continue;
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

export function projectRowScaleLayout(input: ProjectRowScaleLayoutInput): RowScaleLayout {
  const { row, columns } = input;
  const fallbacks: RowScaleFallback[] = [];
  const drafts: Draft[] = [];
  for (const unit of collectChoiceUnits(input)) {
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
    // 원본 한 줄, 또는 막대를 못 그린 묶음 — 그 열만 잘라 낸 원본 조각
    drafts.push({ kind: 'piece', key: unit.key, cells: unit.cells });
  }
  // 막대도 타일도 없으면 행별 원본과 같다 — 반복 헤더 행까지 그리는 종전 조각이 낫다
  if (!drafts.some((draft) => draft.kind !== 'piece')) return { segments: null, fallbacks };

  const draftAtIndex = new Map<number, Draft>();
  for (const draft of drafts) {
    const cells = draft.kind === 'bar' ? draft.bar.cells : draft.cells;
    for (const cell of cells) {
      draftAtIndex.set(
        row.cells.findIndex((c) => c.id === cell.id),
        draft,
      );
    }
  }
  const pieceOf = (key: string, indices: readonly number[]): RowScaleSegment | null => {
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
  const segments: RowScaleSegment[] = [];
  const emitted = new Set<Draft>();
  let freeIndices: number[] = [];
  const flushFree = () => {
    const indices = freeIndices;
    freeIndices = [];
    const hasAnswerCell = indices.some((index) => {
      const cell = row.cells[index];
      return cell !== undefined && isScaleBarVisibleCell(cell) && PIECE_CELL_TYPES.has(cell.type);
    });
    if (!hasAnswerCell) return;
    const segment = pieceOf(`piece:${columns[indices[0]!]!.id}`, indices);
    if (segment) segments.push(segment);
  };
  // 행 앞쪽의 글자 열(첫 응답 칸 앞)은 조각에 넣지 않는다 — 행 제목이 이미 보인다. 응답 칸 사이·뒤의
  // 글자 열(단위 등)은 원래 형태 그대로 조각에 남는다.
  const firstAnswerIndex = row.cells.findIndex(
    (cell) => isScaleBarVisibleCell(cell) && PIECE_CELL_TYPES.has(cell.type),
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
  return { segments, fallbacks };
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
  const byRowId = new Map<string, RowScaleLayout>();
  for (const section of model.sections) {
    for (const subgroup of section.subgroups) {
      for (const rowQuestion of subgroup.questions) {
        const { projection } = rowQuestion;
        byRowId.set(
          rowQuestion.rowId,
          projectRowScaleLayout({
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
