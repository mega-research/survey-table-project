import {
  SCALE_BAR_MAX_CELLS,
  type ScaleBarFallbackReason,
  isScaleBarVisibleCell,
  projectScaleBar,
} from '@/features/question-renderer/utils/choice-group-scale-bar';
import { DEFAULT_TABLE_ANSWERABLE_CELL_TYPES } from '@/features/question-renderer/utils/classify-table';
import { buildMobileRowWiseOriginalModel } from '@/features/question-renderer/utils/mobile-row-wise-original';
import {
  type UngroupedSelectionType,
  projectRowWiseScaleBars,
} from '@/features/question-renderer/utils/row-scale-bars';
import type { ChoiceGroup, HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';

/**
 * 척도 막대 폴백 진단 — 작성자가 「척도 막대」를 골랐는데 응답 화면이 조용히 원본 표 조각으로
 * 그릴 자리를 빌더에서 미리 알린다(CONTEXT.md 「척도 막대」).
 *
 * 판정은 응답 화면과 같은 투영(projectScaleBar)을 그대로 부른다 — 여기서 규칙을 다시 쓰면
 * 경고와 화면이 갈린다. 빌더에는 응답값·표시 조건이 없으므로 모든 열·보이는 칸 기준으로 본다.
 */

/** 폴백 이유별 안내 — 무엇을 고치면 막대가 나오는지 알 수 있게 쓴다 */
export const SCALE_BAR_FALLBACK_MESSAGES: Readonly<Record<ScaleBarFallbackReason, string>> = {
  'not-single-choice':
    '복수 선택(체크박스) 보기는 막대로 그릴 수 없습니다. 척도 막대는 하나만 고르는 보기 전용입니다.',
  'non-choice-cell': '보기 칸이 아닌 응답 칸(입력칸·계산칸 등)이 섞여 있습니다.',
  'non-contiguous':
    '보기 칸이 한 줄에 이어져 있지 않습니다. 척도 칸은 사이에 다른 칸 없이 연달아 놓여야 합니다.',
  'cell-count': `보기 칸이 2개보다 적거나 ${SCALE_BAR_MAX_CELLS}개보다 많습니다.`,
  'text-input': '「선택 시 텍스트 입력 받기」가 켜진 보기가 있습니다.',
  'exclusive-choice': '「단독 선택 보기」(모름·해당 없음 등)가 섞여 있습니다.',
  'missing-text':
    '글자가 없는 보기 칸이 있습니다. 보기 칸이나 그 열의 헤더에 번호·라벨을 적어 주세요.',
};

export interface ScaleBarIssue {
  reason: ScaleBarFallbackReason;
  message: string;
  /** 폴백하는 행 — 행 이름, 없으면 첫 글자 칸, 그것도 없으면 「N행」 */
  rowLabels: string[];
}

function rowLabelOf(row: TableRow, index: number): string {
  const label = (row.label ?? '').trim();
  if (label) return label;
  const text = row.cells.find(
    (cell) =>
      cell.type === 'text' && isScaleBarVisibleCell(cell) && (cell.content ?? '').trim() !== '',
  );
  return text ? text.content!.trim() : `${index + 1}행`;
}

/** 폴백 행을 이유별로 모은다 — 이유는 처음 나온 순서 */
export function collectScaleBarIssues(
  failures: ReadonlyArray<{ reason: ScaleBarFallbackReason; rowLabel: string }>,
): ScaleBarIssue[] {
  const byReason = new Map<ScaleBarFallbackReason, string[]>();
  for (const { reason, rowLabel } of failures) {
    const labels = byReason.get(reason) ?? [];
    if (!labels.includes(rowLabel)) labels.push(rowLabel);
    byReason.set(reason, labels);
  }
  return [...byReason].map(([reason, rowLabels]) => ({
    reason,
    message: SCALE_BAR_FALLBACK_MESSAGES[reason],
    rowLabels,
  }));
}

export interface DiagnoseChoiceGroupScaleBarInput {
  group: ChoiceGroup;
  rows: readonly TableRow[];
  columns: readonly TableColumn[];
  headerGrid?: HeaderCell[][] | undefined;
}

/**
 * 보기 그룹 「척도 막대」 진단 — 그룹 칸이 있는 행마다 「행 단위 그룹 카드」와 같은 투영을 돌려
 * 막대로 못 그리는 행을 이유별로 모은다. 그 행의 그룹은 응답 화면에서 원본 한 줄로 보인다.
 */
export function diagnoseChoiceGroupScaleBar(
  input: DiagnoseChoiceGroupScaleBarInput,
): ScaleBarIssue[] {
  const { group } = input;
  const failures: Array<{ reason: ScaleBarFallbackReason; rowLabel: string }> = [];
  input.rows.forEach((row, index) => {
    const targetCells = row.cells.filter(
      (cell) =>
        cell.type === 'choice_opt' &&
        cell.choiceGroupId === group.id &&
        isScaleBarVisibleCell(cell),
    );
    if (targetCells.length === 0) return;
    const result = projectScaleBar({
      selectionType: group.type,
      columns: input.columns,
      headerGrid: input.headerGrid,
      row,
      targetCells,
    });
    if (!result.ok) failures.push({ reason: result.reason, rowLabel: rowLabelOf(row, index) });
  });
  return collectScaleBarIssues(failures);
}

export interface DiagnoseRowScaleBarsInput {
  rows: TableRow[];
  columns: TableColumn[];
  headerGrid?: HeaderCell[][] | undefined;
  choiceGroups: readonly ChoiceGroup[];
  /** 그룹 없는 보기 칸의 선택 방식 — resolveUngroupedSelectionType(문항 유형) */
  ungroupedSelectionType: UngroupedSelectionType;
  hideColumnLabels: boolean;
  omitLeadingColumns: number;
  repeatHeaderStartRow?: number | null | undefined;
  repeatHeaderEndRow?: number | null | undefined;
}

/** 행 문항 판정에 쓰는 응답 칸 — 표 문항·보기 소스 표 양쪽을 덮는다(보기 칸 없는 행은 어차피 보지 않는다) */
const ROW_WISE_ANSWERABLE_CELL_TYPES: readonly TableCell['type'][] = [
  ...DEFAULT_TABLE_ANSWERABLE_CELL_TYPES,
  'choice_opt',
];

/**
 * 「행별 척도」 진단 — 응답 화면과 같은 행별 원본 모델(행 문항·앞쪽 열 제외·헤더 조각)을 만들고
 * 행마다 같은 투영(projectRowScaleBars)을 돌려 막대로 못 그리는 행을 이유별로 모은다. 그 행은 응답
 * 화면에서 원본 표 조각으로 보인다. 막대가 될 보기 칸이 없는 행(설명·입력 전용 행)은 척도가 아니라
 * 알리지 않는다.
 */
export function diagnoseRowScaleBars(input: DiagnoseRowScaleBarsInput): ScaleBarIssue[] {
  const model = buildMobileRowWiseOriginalModel({
    authoredColumns: input.columns,
    authoredRows: input.rows,
    visibleColumns: input.columns,
    ...(input.headerGrid ? { visibleHeaderGrid: input.headerGrid } : {}),
    displayRows: input.rows,
    hideColumnLabels: input.hideColumnLabels,
    settings: {
      omitLeadingAuthoredColumns: input.omitLeadingColumns,
      repeatHeaderStartRow: input.repeatHeaderStartRow,
      repeatHeaderEndRow: input.repeatHeaderEndRow,
    },
    answerableCellTypes: ROW_WISE_ANSWERABLE_CELL_TYPES,
  });
  const byRowId = projectRowWiseScaleBars(model, input.choiceGroups, input.ungroupedSelectionType);
  const groupIds = new Set(input.choiceGroups.map((group) => group.id));
  const authoredById = new Map(input.rows.map((row, index) => [row.id, { row, index }]));
  const failures: Array<{ reason: ScaleBarFallbackReason; rowLabel: string }> = [];
  const rowQuestions = model.sections.flatMap((section) =>
    section.subgroups.flatMap((subgroup) => subgroup.questions),
  );
  for (const rowQuestion of rowQuestions) {
    const result = byRowId.get(rowQuestion.rowId);
    if (!result || result.ok) continue;
    // 막대가 될 보기 칸이 없는 행은 척도가 아니다 — 원본 조각이 곧 제 모양이라 알리지 않는다
    const hasScaleCell = rowQuestion.projection.row.cells.some(
      (cell) =>
        cell.type === 'choice_opt' &&
        isScaleBarVisibleCell(cell) &&
        ((cell.choiceGroupId !== undefined && groupIds.has(cell.choiceGroupId)) ||
          input.ungroupedSelectionType !== null),
    );
    if (!hasScaleCell) continue;
    const authored = authoredById.get(rowQuestion.rowId);
    const rowLabel =
      rowQuestion.title.trim() ||
      (authored ? rowLabelOf(authored.row, authored.index) : rowQuestion.rowId);
    failures.push({ reason: result.reason, rowLabel });
  }
  return collectScaleBarIssues(failures);
}
