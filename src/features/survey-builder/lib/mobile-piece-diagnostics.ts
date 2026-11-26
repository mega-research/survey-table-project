import { DEFAULT_TABLE_ANSWERABLE_CELL_TYPES } from '@/features/question-renderer/utils/classify-table';
import {
  type MobilePieceFitFallback,
  type MobilePieceReverseFallback,
  arrangeMobilePiece,
} from '@/features/question-renderer/utils/mobile-piece-arrangement';
import { buildMobileRowWiseOriginalModel } from '@/features/question-renderer/utils/mobile-row-wise-original';
import type { HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';

import { collectScaleFallbackIssues, scaleRowLabelOf } from './scale-bar-diagnostics';

/**
 * 조각 좌우 반전 · 조각 한 화면 칸 수의 폴백 진단 — 작성자가 켰는데 응답 화면이 조용히 작성 순서·원본 폭으로
 * 그릴 행을 빌더에서 미리 알린다(CONTEXT.md 「조각 좌우 반전」·「조각 한 화면 칸 수」).
 *
 * 판정은 응답 화면과 같은 행별 원본 모델과 같은 재배치 판정(`arrangeMobilePiece`)을 그대로 부른다 — 여기서
 * 규칙을 다시 쓰면 경고와 화면이 갈린다. 빌더에는 응답값·표시 조건이 없으므로 모든 열·모든 행 기준으로 본다.
 * 「선택 행 원본 보기」도 같은 조각을 그리므로 같은 진단을 쓴다.
 */

export type MobilePieceFallbackReason = MobilePieceReverseFallback | MobilePieceFitFallback;

/** 폴백 이유별 안내 — 무엇을 고치면 적용되는지 알 수 있게 쓴다 */
export const MOBILE_PIECE_FALLBACK_MESSAGES: Readonly<Record<MobilePieceFallbackReason, string>> = {
  'merged-across-pinned':
    '좌우 반전을 적용하지 못합니다 — 뒤집을 칸과 「평균에서 제외」 칸을 함께 덮는 합친 칸(머리글·본문)이 있습니다. 합친 칸을 나누면 적용됩니다.',
  'non-choice-answer-cell':
    '한 화면 칸 수를 적용하지 못합니다 — 입력칸·드롭다운·순위 칸이나 보기가 여럿 든 칸이 섞여 있습니다. 보기 칸만 있는 행에 맞는 설정입니다.',
  'no-answer-cell': '한 화면 칸 수를 적용하지 못합니다 — 응답 칸이 없는 행입니다.',
};

export interface MobilePieceIssue {
  reason: MobilePieceFallbackReason;
  message: string;
  /** 폴백하는 행 — 행 문항 제목, 없으면 행 이름 */
  rowLabels: string[];
}

export interface DiagnoseMobilePieceInput {
  rows: TableRow[];
  columns: TableColumn[];
  headerGrid?: HeaderCell[][] | undefined;
  hideColumnLabels: boolean;
  omitLeadingColumns: number;
  repeatHeaderStartRow?: number | null | undefined;
  repeatHeaderEndRow?: number | null | undefined;
  reverseColumns?: boolean | null | undefined;
  columnsPerView?: number | null | undefined;
}

/** 행 문항 판정에 쓰는 응답 칸 — 표 문항·보기 소스 표 양쪽을 덮는다 */
const ROW_WISE_ANSWERABLE_CELL_TYPES: readonly TableCell['type'][] = [
  ...DEFAULT_TABLE_ANSWERABLE_CELL_TYPES,
  'choice_opt',
];

export function diagnoseMobilePieceArrangement(input: DiagnoseMobilePieceInput): MobilePieceIssue[] {
  if (input.reverseColumns !== true && input.columnsPerView == null) return [];

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
  const authoredById = new Map(input.rows.map((row, index) => [row.id, { row, index }]));
  const failures: Array<{ reason: MobilePieceFallbackReason; rowLabel: string }> = [];

  const rowQuestions = model.sections.flatMap((section) =>
    section.subgroups.flatMap((subgroup) => subgroup.questions),
  );
  for (const rowQuestion of rowQuestions) {
    // 조각을 그리지 않는 줄(제목 아래 입력칸)은 적용할 조각이 없다
    if (rowQuestion.hidesPiece) continue;
    const { projection } = rowQuestion;
    const arrangement = arrangeMobilePiece(
      {
        columns: projection.columns,
        headerGrid: projection.headerGrid,
        rows: [...projection.repeatedRows, projection.row],
        interactiveRowId: projection.row.id,
      },
      { reverseColumns: input.reverseColumns, columnsPerView: input.columnsPerView },
    );
    const authored = authoredById.get(rowQuestion.rowId);
    const rowLabel =
      rowQuestion.title.trim() ||
      (authored ? scaleRowLabelOf(authored.row, authored.index) : rowQuestion.rowId);
    if (arrangement.reverseFallback) {
      failures.push({ reason: arrangement.reverseFallback, rowLabel });
    }
    if (arrangement.fitFallback) failures.push({ reason: arrangement.fitFallback, rowLabel });
  }
  return collectScaleFallbackIssues(failures, MOBILE_PIECE_FALLBACK_MESSAGES);
}
