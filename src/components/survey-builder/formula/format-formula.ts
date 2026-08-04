import type { CalcExpr, Question, SurveyLookup, TableCell } from '@/types/survey';
import { formatCellLabel } from '@/utils/cell-label';

/**
 * 수식 트리를 사람이 읽는 한 줄 문자열로 포맷한다 (빌더 미리보기 전용).
 *
 * 평가하지 않는다 — 구조만 보여준다. 저작자가 방금 조립한 그룹 중첩이 의도한 우선순위인지
 * 눈으로 확인하는 것이 유일한 목적이다. 예: `(2 × 3) + SUM(1행 금액, 2행 금액)`.
 *
 * 깨진 참조는 `[삭제된 셀]` 처럼 대괄호 자리표시자로 남긴다. 이는 경고가 아니라 가독성 장치다 —
 * 실제 진단(broken-ref/cycle/non-numeric-ref)은 `cell-formula-diagnostics.ts` 단일 통로가 담당하며,
 * 여기서 중복 판정하지 않는다.
 */

/** 그룹 연산자. 저장 값은 항상 이 4개 ASCII 기호다 (표시 기호와 구분). */
export type CalcOperator = Extract<CalcExpr, { kind: 'group' }>['op'];

/** 미리보기용 연산자 기호. 빌더 드롭다운 라벨(＋ 전각)과 별개다 — 문장 안에서는 반각이 읽기 좋다. */
const OPERATOR_SYMBOLS: Record<CalcOperator, string> = {
  '+': '+',
  '-': '−',
  '*': '×',
  '/': '÷',
};

export const BROKEN_CELL_LABEL = '[삭제된 셀]';
export const BROKEN_QUESTION_LABEL = '[삭제된 질문]';
export const BROKEN_LOOKUP_LABEL = '[삭제된 LUT]';
export const EMPTY_GROUP_LABEL = '[빈 그룹]';
export const EMPTY_AGG_LABEL = '[대상 없음]';
export const UNSET_COLUMN_LABEL = '[컬럼 미지정]';

export interface FormatFormulaOptions {
  /**
   * questionId 를 생략한 cell 항(같은 질문 참조)이 속한 질문 id.
   * 미지정 시 전체 질문에서 cellId 로 검색한다 (셀 id 는 nanoid 라 사실상 전역 유일).
   */
  ownQuestionId?: string;
  /** LUT 이름 표시용. 미지정 시 이름을 알 수 없으므로 `[삭제된 LUT]` 대신 id 를 그대로 쓴다. */
  lookups?: SurveyLookup[];
}

function questionLabel(question: Question): string {
  return question.questionCode || question.title || question.id.slice(0, 6);
}

function findCellRef(
  questions: Question[],
  cellId: string,
  questionId: string | undefined,
): { question: Question; cell: TableCell } | undefined {
  // undefined 만 "전체 검색" 이다. 빈 문자열은 빌더의 "아직 질문 미선택" 자리표시자이므로
  // 어떤 질문과도 매칭되지 않아야 한다 — 전체 검색으로 넘기면 우연히 같은 cellId 를 가진 셀을
  // 찾아내 미선택 상태가 정상 참조처럼 보인다.
  const pool = questionId !== undefined ? questions.filter((q) => q.id === questionId) : questions;
  for (const question of pool) {
    const cell = (question.tableRowsData ?? []).flatMap((row) => row.cells).find((c) => c.id === cellId);
    if (cell) return { question, cell };
  }
  return undefined;
}

function formatCellTerm(
  expr: Extract<CalcExpr, { kind: 'cell' }>,
  questions: Question[],
  options: FormatFormulaOptions,
): string {
  const targetQuestionId = expr.questionId ?? options.ownQuestionId;
  const found = findCellRef(questions, expr.cellId, targetQuestionId);
  if (!found) return BROKEN_CELL_LABEL;
  // 다른 질문의 셀이면 어느 질문인지 함께 보여준다 (같은 질문 셀은 라벨만으로 충분).
  const isCrossQuestion = expr.questionId !== undefined && expr.questionId !== options.ownQuestionId;
  const cellLabel = formatCellLabel(found.cell);
  return isCrossQuestion ? `${questionLabel(found.question)}.${cellLabel}` : cellLabel;
}

function formatLookupTerm(
  expr: Extract<CalcExpr, { kind: 'lookup' }>,
  options: FormatFormulaOptions,
): string {
  const column = expr.valueColumn || UNSET_COLUMN_LABEL;
  if (!options.lookups) return `LUT:${expr.surveyLookupId || BROKEN_LOOKUP_LABEL}.${column}`;
  const lookup = options.lookups.find((l) => l.id === expr.surveyLookupId);
  return `LUT:${lookup ? lookup.name : BROKEN_LOOKUP_LABEL}.${column}`;
}

function formatExpr(
  expr: CalcExpr,
  questions: Question[],
  options: FormatFormulaOptions,
  depth: number,
): string {
  switch (expr.kind) {
    case 'literal':
      return String(expr.value);
    case 'cell':
      return formatCellTerm(expr, questions, options);
    case 'question': {
      const question = questions.find((q) => q.id === expr.questionId);
      return question ? questionLabel(question) : BROKEN_QUESTION_LABEL;
    }
    case 'lookup':
      return formatLookupTerm(expr, options);
    case 'agg': {
      const fn = expr.fn === 'sum' ? 'SUM' : 'AVG';
      if (expr.items.length === 0) return `${fn}(${EMPTY_AGG_LABEL})`;
      const items = expr.items.map((item) => formatExpr(item, questions, options, depth + 1));
      return `${fn}(${items.join(', ')})`;
    }
    case 'group': {
      if (expr.terms.length === 0) return EMPTY_GROUP_LABEL;
      const separator = ` ${OPERATOR_SYMBOLS[expr.op]} `;
      const body = expr.terms
        .map((term) => formatExpr(term, questions, options, depth + 1))
        .join(separator);
      // 루트 그룹은 괄호를 생략한다 — 중첩된 그룹만 괄호로 우선순위를 드러낸다.
      return depth === 0 ? body : `(${body})`;
    }
  }
}

export function formatFormulaPreview(
  expr: CalcExpr,
  questions: Question[],
  options: FormatFormulaOptions = {},
): string {
  return formatExpr(expr, questions, options, 0);
}
