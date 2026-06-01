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
 *   - isOtherChoiceCell=true → allowTextInput=true + 기본 라벨 "기타 (직접 입력)"
 */
export function resolveChoiceOptions(question: Question): QuestionOption[] {
  const cells = collectChoiceOptCells(question.tableRowsData);
  if (cells.length === 0) return question.options ?? [];

  return cells.map((cell, idx) => {
    const isOther = cell.isOtherChoiceCell === true;
    return {
      id: cell.id,
      value: cell.id,
      label: buildChoiceOptLabel(cell, isOther ? '기타 (직접 입력)' : '(라벨 없음)'),
      optionCode: undefined,
      spssNumericCode: cell.spssNumericCode ?? idx + 1,
      branchRule: cell.branchRule,
      allowTextInput: isOther ? true : cell.allowTextInput,
      textInputPlaceholder: cell.textInputPlaceholder,
    };
  });
}

/**
 * 같은 tableRowsData 내에 isOtherChoiceCell=true 인 유효 choice_opt 셀이 있는지.
 * excludeCellId 가 있으면 해당 셀은 제외 (자기 자신 검사 제외용).
 */
export function hasExistingOtherChoiceCell(
  rows: TableRow[] | undefined,
  excludeCellId?: string,
): boolean {
  if (!rows) return false;
  return rows.some((row) =>
    row.cells.some(
      (c) =>
        c.id !== excludeCellId
        && c.type === 'choice_opt'
        && !c.isHidden
        && c.isOtherChoiceCell === true,
    ),
  );
}
