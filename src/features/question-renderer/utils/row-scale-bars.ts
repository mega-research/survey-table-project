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
 * 「행별 척도」 모바일 표시 방식의 한 행 — 행별 원본 문항의 원본 표 조각을 어디까지 척도 막대로
 * 바꾸는지(CONTEXT.md 「행별 척도」).
 *
 * 막대가 되는 것은 **작성자가 고른 것뿐**이다 — 보기 그룹 보기 모양이 「척도 막대」인 그룹, 그리고
 * 그룹 없는 보기 소스 표의 보기 칸(그룹별 설정이 없어 모드 자체가 선택이다, 이어진 묶음마다 하나).
 * 나머지 응답 칸(다른 보기 그룹·입력칸 등)은 원래 형태 그대로 — 열 순서대로 이어진 열을 잘라 낸
 * 원본 표 조각이다. 막대 하나의 판정은 척도 막대 투영(choice-group-scale-bar) 그대로이고, 고른
 * 그룹을 못 그리면 그 그룹 열도 원본 조각으로 떨어지며 이유가 남는다(빌더 경고 재료).
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
  | { kind: 'original'; key: string; piece: ChoiceGroupOriginalLine };

export interface RowScaleFallback {
  key: string;
  group: ChoiceGroup | undefined;
  reason: ScaleBarFallbackReason;
}

export interface RowScaleLayout {
  /** 행 순서대로의 막대·원본 조각. 막대가 하나도 없으면 null — 행 전체를 원본 표 조각으로 그린다 */
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

interface BarCandidate {
  key: string;
  group: ChoiceGroup | undefined;
  selectionType: ChoiceGroup['type'];
  cells: TableCell[];
}

/** 막대 후보 — 「척도 막대」로 고른 그룹, 그리고 (보기 소스 표라면) 그룹 없는 보기 칸의 이어진 묶음 */
function collectBarCandidates(input: ProjectRowScaleLayoutInput): BarCandidate[] {
  const groupById = new Map(input.choiceGroups.map((group) => [group.id, group]));
  const candidates: BarCandidate[] = [];
  const byGroupId = new Map<string, BarCandidate>();
  let run: BarCandidate | undefined;
  let prevIndex = -2;
  for (const [index, cell] of input.row.cells.entries()) {
    if (cell.type !== 'choice_opt' || !isScaleBarVisibleCell(cell)) continue;
    const group = cell.choiceGroupId ? groupById.get(cell.choiceGroupId) : undefined;
    if (group) {
      if (resolveChoiceGroupMobileView(group) !== 'scale-bar') continue;
      const existing = byGroupId.get(group.id);
      if (existing) existing.cells.push(cell);
      else {
        const candidate = { key: group.id, group, selectionType: group.type, cells: [cell] };
        byGroupId.set(group.id, candidate);
        candidates.push(candidate);
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
      candidates.push(run);
    }
    prevIndex = index;
  }
  return candidates;
}

export function projectRowScaleLayout(input: ProjectRowScaleLayoutInput): RowScaleLayout {
  const { row, columns } = input;
  const fallbacks: RowScaleFallback[] = [];
  /** 막대가 차지한 열 인덱스 → 그 막대 */
  const barAtIndex = new Map<number, RowScaleBar>();
  for (const candidate of collectBarCandidates(input)) {
    const projected = projectScaleBar({
      selectionType: candidate.selectionType,
      columns,
      headerGrid: input.barHeaderGrid,
      row,
      targetCells: candidate.cells,
    });
    if (!projected.ok) {
      fallbacks.push({ key: candidate.key, group: candidate.group, reason: projected.reason });
      continue;
    }
    const bar: RowScaleBar = {
      key: candidate.key,
      group: candidate.group,
      cells: candidate.cells,
      model: projected.model,
    };
    for (const cell of candidate.cells) {
      barAtIndex.set(
        row.cells.findIndex((c) => c.id === cell.id),
        bar,
      );
    }
  }
  if (barAtIndex.size === 0) return { segments: null, fallbacks };

  // 열 순서대로 걷는다 — 막대 열은 그 막대 하나로, 나머지 이어진 열은 원본 조각 하나로 묶는다
  const segments: RowScaleSegment[] = [];
  let pieceIndices: number[] = [];
  const flushPiece = () => {
    const indices = pieceIndices;
    pieceIndices = [];
    const hasAnswerCell = indices.some((index) => {
      const cell = row.cells[index];
      return cell !== undefined && isScaleBarVisibleCell(cell) && PIECE_CELL_TYPES.has(cell.type);
    });
    if (!hasAnswerCell) return;
    const piece = projectOriginalColumnPiece({
      columns,
      headerGrid: input.pieceHeaderGrid,
      hideColumnLabels: !input.showPieceHeader,
      row,
      columnIds: new Set(indices.map((index) => columns[index]!.id)),
    });
    if (piece) {
      segments.push({ kind: 'original', key: `piece:${columns[indices[0]!]!.id}`, piece });
    }
  };
  // 행 앞쪽의 글자 열(첫 응답 칸 앞)은 조각에 넣지 않는다 — 행 제목이 이미 보인다. 응답 칸 사이·뒤의
  // 글자 열(단위 등)은 원래 형태 그대로 조각에 남는다.
  const firstAnswerIndex = row.cells.findIndex(
    (cell) => isScaleBarVisibleCell(cell) && PIECE_CELL_TYPES.has(cell.type),
  );
  let lastBar: RowScaleBar | undefined;
  for (let index = Math.max(firstAnswerIndex, 0); index < columns.length; index += 1) {
    const bar = barAtIndex.get(index);
    if (bar) {
      flushPiece();
      if (bar !== lastBar) segments.push({ kind: 'bar', bar });
      lastBar = bar;
      continue;
    }
    lastBar = undefined;
    pieceIndices.push(index);
  }
  flushPiece();
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
