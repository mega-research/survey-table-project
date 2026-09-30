import type {
  ChoiceGroup,
  HeaderCell,
  QuestionType,
  TableCell,
  TableColumn,
  TableRow,
} from '@/types/survey';

import {
  type ScaleBarFallbackReason,
  type ScaleBarModel,
  isScaleBarVisibleCell,
  projectScaleBar,
} from './choice-group-scale-bar';
import type { MobileRowWiseOriginalModel } from './mobile-row-wise-original';

/**
 * 「행별 척도」 모바일 표시 방식의 한 행 — 행별 원본 문항의 원본 표 조각 자리를 척도 막대로 바꿀 수
 * 있는지와, 바꾼다면 어떤 막대들인지(CONTEXT.md 「행별 척도」).
 *
 * 막대 하나의 판정은 척도 막대 투영(choice-group-scale-bar) 그대로다. 여기서는 행을 막대 단위로
 * 가른다 — 보기 그룹이 있으면 그룹마다, 그룹 없는 보기 칸은 이어진 묶음마다 막대 하나.
 *
 * 행 단위로 전부 아니면 전무다. 한 묶음이라도 막대로 못 그리거나 보기 칸 말고 다른 응답 칸(입력칸
 * 등)이 있으면 그 행은 원본 표 조각으로 그린다 — 막대만 그리면 나머지 칸이 화면에서 사라진다.
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

export type RowScaleBarsProjection =
  { ok: true; bars: RowScaleBar[] } | { ok: false; reason: ScaleBarFallbackReason };

export interface ProjectRowScaleBarsInput {
  /** 행의 셀과 인덱스가 맞는 열 — 표시 조건·앞쪽 열 제외로 걸러진 뒤의 열 */
  columns: readonly TableColumn[];
  /** columns 와 짝이 맞는 헤더 격자 */
  headerGrid?: HeaderCell[][] | undefined;
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

/** 보기 칸 말고 이 행에 있으면 막대로 바꿀 수 없는 칸 — 응답 칸과 계산 칸 */
const OTHER_ANSWER_CELL_TYPES = new Set<TableCell['type']>([
  'input',
  'radio',
  'checkbox',
  'select',
  'ranking',
  'ranking_opt',
  'calc',
]);

interface Segment {
  key: string;
  group: ChoiceGroup | undefined;
  selectionType: ChoiceGroup['type'];
  cells: TableCell[];
}

export function projectRowScaleBars(input: ProjectRowScaleBarsInput): RowScaleBarsProjection {
  const { row } = input;
  const groupById = new Map(input.choiceGroups.map((group) => [group.id, group]));
  const segments: Segment[] = [];
  const segmentByGroupId = new Map<string, Segment>();
  let run: Segment | undefined;
  let prevIndex = -2;

  for (const [index, cell] of row.cells.entries()) {
    if (!isScaleBarVisibleCell(cell)) continue;
    if (OTHER_ANSWER_CELL_TYPES.has(cell.type)) return { ok: false, reason: 'non-choice-cell' };
    if (cell.type !== 'choice_opt') continue;
    const group = cell.choiceGroupId ? groupById.get(cell.choiceGroupId) : undefined;
    if (group) {
      const existing = segmentByGroupId.get(group.id);
      if (existing) existing.cells.push(cell);
      else {
        const segment = { key: group.id, group, selectionType: group.type, cells: [cell] };
        segmentByGroupId.set(group.id, segment);
        segments.push(segment);
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
      segments.push(run);
    }
    prevIndex = index;
  }

  if (segments.length === 0) return { ok: false, reason: 'cell-count' };

  const bars: RowScaleBar[] = [];
  for (const segment of segments) {
    const projected = projectScaleBar({
      selectionType: segment.selectionType,
      columns: input.columns,
      headerGrid: input.headerGrid,
      row,
      targetCells: segment.cells,
    });
    if (!projected.ok) return projected;
    bars.push({
      key: segment.key,
      group: segment.group,
      cells: segment.cells,
      model: projected.model,
    });
  }
  return { ok: true, bars };
}

/**
 * 행별 원본 모델의 행 문항마다 막대 판정 — 두 응답 호스트(표 문항·보기 소스 표)와 빌더 진단이 같은
 * 순회·같은 헤더 재료를 쓴다. 헤더는 반복 헤더 설정과 무관하게 잘라 낸 격자(clippedHeaderGrid)다 —
 * 원본 조각의 헤더를 숨긴 표에서도 막대 라벨은 헤더에서 온다.
 */
export function projectRowWiseScaleBars(
  model: MobileRowWiseOriginalModel,
  choiceGroups: readonly ChoiceGroup[],
  ungroupedSelectionType: UngroupedSelectionType,
): Map<string, RowScaleBarsProjection> {
  const byRowId = new Map<string, RowScaleBarsProjection>();
  for (const section of model.sections) {
    for (const subgroup of section.subgroups) {
      for (const rowQuestion of subgroup.questions) {
        const { projection } = rowQuestion;
        byRowId.set(
          rowQuestion.rowId,
          projectRowScaleBars({
            columns: projection.columns,
            headerGrid: projection.clippedHeaderGrid,
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
