import type { Question, QuestionOption, TableCell, TableRow } from '@/types/survey';

/**
 * tableRowsData 에서 유효한 `choice_opt` 셀을 순서대로 수집.
 * rowspan/colspan continuation 으로 숨겨진 셀(isHidden)은 제외.
 * Case A 옵션 소스 변환 / 유효성 검사 / 카운트 등이 공유하는 단일 진실.
 */
export function collectChoiceOptCells(tableRowsData: TableRow[] | undefined): TableCell[] {
  if (!tableRowsData) return [];
  const cells: TableCell[] = [];
  for (const row of tableRowsData) {
    for (const cell of row.cells) {
      if (cell.type !== 'choice_opt') continue;
      if (cell.isHidden) continue;
      cells.push(cell);
    }
  }
  return cells;
}

/** choice_opt 셀의 표시 라벨: choiceLabel > content > fallback. */
function buildChoiceOptLabel(cell: TableCell, fallback: string): string {
  return (cell.choiceLabel ?? '').trim() || (cell.content ?? '').trim() || fallback;
}

/**
 * radio/checkbox 질문이 "테이블 내장 옵션 소스"인지.
 * choice_opt 셀이 1개 이상이면 table-source 로 본다 (별도 플래그/컬럼 없음).
 */
export function isChoiceTableSource(question: Question): boolean {
  if (question.type !== 'radio' && question.type !== 'checkbox') return false;
  return collectChoiceOptCells(question.tableRowsData).length > 0;
}

/**
 * radio/checkbox 질문의 옵션 소스를 통합 반환.
 * - choice_opt 셀 없음(manual): question.options 그대로
 * - choice_opt 셀 있음(table): 셀을 QuestionOption 으로 변환
 *   - id/value: cell.id (UUID — 셀 이동/라벨 변경에 강건. 응답값도 cell.id)
 *   - label: choiceLabel > content > '(라벨 없음)'
 *   - optionCode: TableCell 에는 optionCode 필드가 없으므로 항상 undefined
 *   - spssNumericCode: cell.spssNumericCode 우선, 없으면 수집 순서 1-based 인덱스
 *   - branchRule / allowTextInput / textInputPlaceholder: 셀에서 전달
 *   - answerQuoteText: 셀의 응답 인용 문구 (표-소스 옵션의 인용 수집에 필요)
 */
export function resolveChoiceOptions(question: Question): QuestionOption[] {
  const cells = collectChoiceOptCells(question.tableRowsData);
  if (cells.length === 0) return question.options ?? [];

  return cells.map((cell, idx) => ({
    id: cell.id,
    value: cell.id,
    label: buildChoiceOptLabel(cell, '(라벨 없음)'),
    spssNumericCode: cell.spssNumericCode ?? idx + 1,
    ...(cell.exportLabel !== undefined ? { exportLabel: cell.exportLabel } : {}),
    ...(cell.branchRule !== undefined ? { branchRule: cell.branchRule } : {}),
    ...(cell.allowTextInput !== undefined ? { allowTextInput: cell.allowTextInput } : {}),
    ...(cell.textInputPlaceholder !== undefined ? { textInputPlaceholder: cell.textInputPlaceholder } : {}),
    ...(cell.textInputType !== undefined ? { textInputType: cell.textInputType } : {}),
    ...(cell.textInputNumberFormat !== undefined
      ? { textInputNumberFormat: cell.textInputNumberFormat }
      : {}),
    ...(cell.textBold ? { textBold: true } : {}),
    ...(cell.backgroundColor ? { backgroundColor: cell.backgroundColor } : {}),
    ...(cell.textColor ? { textColor: cell.textColor } : {}),
    ...(cell.answerQuoteText !== undefined ? { answerQuoteText: cell.answerQuoteText } : {}),
  }));
}

/**
 * 이 셀이 질문의 마지막 남은 보기 옵션(choice_opt) 셀인지 — 설명 테이블(radio/checkbox)
 * 에서 마지막 보기 옵션 셀을 다른 타입으로 바꾸면 질문의 보기가 0개가 되어 저장이
 * 영구 차단되므로(question-edit-modal 검증), 셀 모달이 타입 변경을 사전 차단하는 데 쓴다.
 */
export function isLastRemainingChoiceOptCell(
  tableRowsData: TableRow[] | undefined,
  cellId: string,
): boolean {
  const cells = collectChoiceOptCells(tableRowsData);
  return cells.some((c) => c.id === cellId) && cells.length === 1;
}
