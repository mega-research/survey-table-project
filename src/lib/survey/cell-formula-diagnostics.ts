import type {
  CalcExpr,
  ExpressionConditionConfig,
  ExpressionOperand,
  LeftOperand,
  Question,
  QuestionConditionGroup,
  QuestionGroup,
  SurveyLookup,
  TableCell,
} from '@/types/survey';
import { buildRenderSteps, findStepIndexOfQuestion } from '@/lib/group-ordering';
import { formatCellLabel } from '@/utils/cell-label';

/**
 * 빌더 진단 수집기.
 *
 * 응답/테스트 모드 런타임(cell-formula.ts)은 무효 수식에 관대하다 — 깨진 참조는 조용히
 * '빈 항'으로 강등하고 '—' 로 표시한다. 저작 실수를 저작자에게 알리는 방어선은 오직
 * 이 모듈이다. 응답값 없이 formula 그래프만 정적으로 순회한다 (server-only 금지, isomorphic).
 *
 * 진단은 저장을 막지 않는 경고일 뿐이다 — 확신이 낮은 조건으로 남발하지 않는다.
 */

export interface FormulaDiagnostic {
  kind: 'broken-ref' | 'cycle' | 'non-numeric-ref' | 'validation-backward-ref' | 'branch-same-group-calc';
  questionId: string; // 수식(또는 분기)을 가진 질문
  cellId: string; // 수식을 가진 셀 (branch-same-group-calc 는 참조된 calc 셀)
  message: string; // 경고 패널에 그대로 표시할 한국어 문구
}

// ── 수식 트리 재귀 walker (calc-formula-diagnostics 전용 단일 통로) ──

function walkExpr(expr: CalcExpr, visit: (e: CalcExpr) => void): void {
  visit(expr);
  if (expr.kind === 'agg') for (const item of expr.items) walkExpr(item, visit);
  if (expr.kind === 'group') for (const term of expr.terms) walkExpr(term, visit);
}

function findCell(questions: Question[], questionId: string, cellId: string): TableCell | undefined {
  const question = questions.find((q) => q.id === questionId);
  if (!question) return undefined;
  return (question.tableRowsData ?? []).flatMap((row) => row.cells).find((c) => c.id === cellId);
}

function isNumericCell(cell: TableCell): boolean {
  return cell.type === 'calc' || (cell.type === 'input' && cell.inputType === 'number');
}

function questionLabel(question: Question): string {
  return question.title || question.id.slice(0, 6);
}

// ── 규칙 1/3/4: broken-ref, non-numeric-ref, validation-backward-ref ──
// 수식을 가진 셀(calc + 검증 input) 하나의 formula 트리를 순회하며 세 규칙을 함께 판정한다.

function checkFormulaOwner(
  ownerQuestion: Question,
  ownerCell: TableCell,
  questions: Question[],
  lookups: SurveyLookup[],
  out: FormulaDiagnostic[],
): void {
  if (!ownerCell.formula) return;
  const ownerLabel = formatCellLabel(ownerCell);
  // 검증 셀(입력 셀 + formula)만 뒤 순서 질문 참조가 문제다. 표시용 calc 셀은
  // 값이 늦게 채워져도 무해하다 — 검증 셀은 빈 값을 0으로 취급해 응답자를 차단할 수 있다.
  const isValidationCell = ownerCell.type === 'input';

  walkExpr(ownerCell.formula, (expr) => {
    if (expr.kind === 'cell') {
      const targetQuestionId = expr.questionId ?? ownerQuestion.id;
      const targetQuestion = questions.find((q) => q.id === targetQuestionId);
      const targetCell = targetQuestion ? findCell(questions, targetQuestionId, expr.cellId) : undefined;

      if (!targetQuestion || !targetCell) {
        out.push({
          kind: 'broken-ref',
          questionId: ownerQuestion.id,
          cellId: ownerCell.id,
          message: `수식이 존재하지 않는 셀을 참조합니다: ${ownerLabel}`,
        });
        return;
      }

      if (!isNumericCell(targetCell)) {
        out.push({
          kind: 'non-numeric-ref',
          questionId: ownerQuestion.id,
          cellId: ownerCell.id,
          message: `수식이 숫자 셀이 아닌 셀을 참조합니다: ${ownerLabel} → ${formatCellLabel(targetCell)}. 계산에 포함되지 않고 빈 항으로 처리됩니다.`,
        });
      }

      if (isValidationCell && targetQuestion.id !== ownerQuestion.id && targetQuestion.order > ownerQuestion.order) {
        out.push({
          kind: 'validation-backward-ref',
          questionId: ownerQuestion.id,
          cellId: ownerCell.id,
          message: `검증 수식이 뒤 순서 질문을 참조합니다: ${ownerLabel} → ${formatCellLabel(targetCell)}. 아직 입력되지 않은 값은 0으로 취급되거나 계산에서 제외되어 응답자가 올바른 값을 입력해도 통과하지 못할 수 있습니다.`,
        });
      }
      return;
    }

    if (expr.kind === 'question') {
      const targetQuestion = questions.find((q) => q.id === expr.questionId);
      if (!targetQuestion) {
        out.push({
          kind: 'broken-ref',
          questionId: ownerQuestion.id,
          cellId: ownerCell.id,
          message: `수식이 존재하지 않는 질문을 참조합니다: ${ownerLabel}`,
        });
        return;
      }
      if (isValidationCell && targetQuestion.id !== ownerQuestion.id && targetQuestion.order > ownerQuestion.order) {
        out.push({
          kind: 'validation-backward-ref',
          questionId: ownerQuestion.id,
          cellId: ownerCell.id,
          message: `검증 수식이 뒤 순서 질문을 참조합니다: ${ownerLabel} → ${questionLabel(targetQuestion)}. 아직 입력되지 않은 값은 0으로 취급되거나 계산에서 제외되어 응답자가 올바른 값을 입력해도 통과하지 못할 수 있습니다.`,
        });
      }
      return;
    }

    if (expr.kind === 'lookup') {
      const found = lookups.some((l) => l.id === expr.surveyLookupId);
      if (!found) {
        out.push({
          kind: 'broken-ref',
          questionId: ownerQuestion.id,
          cellId: ownerCell.id,
          message: `수식이 존재하지 않는 LUT를 참조합니다: ${ownerLabel}`,
        });
      }
    }
  });
}

// ── 규칙 2: cycle (calc→calc 간선만, 정적 DFS) ──
// evaluateCellFormula(cell-formula.ts)의 visited 순환 감지와 같은 키 개념(`${questionId}:${cellId}`)
// 이지만 응답값 없이 formula 그래프만 순회한다.

function hasCycleFromCalcCell(questions: Question[], startQuestionId: string, startCellId: string): boolean {
  function dfs(questionId: string, cellId: string, path: Set<string>): boolean {
    const key = `${questionId}:${cellId}`;
    if (path.has(key)) return true;
    const cell = findCell(questions, questionId, cellId);
    if (!cell || cell.type !== 'calc' || !cell.formula) return false;

    const nextPath = new Set(path);
    nextPath.add(key);
    let cyclic = false;
    walkExpr(cell.formula, (expr) => {
      if (cyclic || expr.kind !== 'cell') return;
      const nextQuestionId = expr.questionId ?? questionId;
      if (dfs(nextQuestionId, expr.cellId, nextPath)) cyclic = true;
    });
    return cyclic;
  }

  return dfs(startQuestionId, startCellId, new Set());
}

// ── 규칙 5: branch-same-group-calc ──
// displayCondition 내 셀 참조(LeftOperand/ExpressionOperand) 를 모두 추출한다.

interface RawCellRef {
  questionId: string;
  cellId: string;
}

function collectFromLeftOperand(operand: LeftOperand, out: RawCellRef[]): void {
  if (operand.kind === 'cell') {
    out.push({ questionId: operand.questionId, cellId: operand.cellId });
    return;
  }
  out.push({ questionId: operand.left.questionId, cellId: operand.left.cellId });
  if (operand.right.kind === 'cell') {
    out.push({ questionId: operand.right.questionId, cellId: operand.right.cellId });
  }
}

function collectFromExpressionOperand(operand: ExpressionOperand, out: RawCellRef[]): void {
  if (operand.kind === 'cell') {
    out.push({ questionId: operand.questionId, cellId: operand.cellId });
    return;
  }
  if (operand.kind === 'binop') {
    collectFromExpressionOperand(operand.left, out);
    collectFromExpressionOperand(operand.right, out);
  }
}

function collectFromExpressionConfig(config: ExpressionConditionConfig, out: RawCellRef[]): void {
  for (const clause of config.clauses) {
    if (clause.kind === 'comparison') {
      collectFromExpressionOperand(clause.comparison.left, out);
      collectFromExpressionOperand(clause.comparison.right, out);
    } else {
      collectFromExpressionConfig(clause.group, out);
    }
  }
}

function collectCellRefsFromDisplayCondition(group: QuestionConditionGroup): RawCellRef[] {
  const out: RawCellRef[] = [];
  for (const condition of group.conditions) {
    if (condition.tableConditions?.numericComparison?.left) {
      collectFromLeftOperand(condition.tableConditions.numericComparison.left, out);
    }
    if (condition.additionalConditions?.numericComparison?.left) {
      collectFromLeftOperand(condition.additionalConditions.numericComparison.left, out);
    }
    if (condition.expressionConfig) {
      collectFromExpressionConfig(condition.expressionConfig, out);
    }
  }
  return out;
}

/**
 * 표 질문 수식 빌더 진단.
 *
 * @param questions 설문 전체 질문 목록
 * @param lookups 설문에 복사된 LUT 목록 (broken-ref LUT id 판정용)
 * @param groups 질문 그룹 목록. branch-same-group-calc 판정 시 buildRenderSteps 로 실제
 *   응답 페이지 분할(수동 pageBreakBefore 구분점 모델)을 계산하는 데 쓴다 — "같은 groupId"는
 *   페이지 경계와 무관하므로(group-ordering.ts) 근사로 쓰지 않는다. 필수 인자다 — 그룹 정보가
 *   없는 호출은 `[]` 를 명시적으로 넘겨야 한다(빠뜨리면 이 규칙만 조용히 항상 빈 결과가 되는
 *   실수를 컴파일 타임에 막기 위함. 그 경우도 오탐은 나지 않는다 — 페이지를 모르면 판정을
 *   보류할 뿐이다).
 */
export function collectFormulaDiagnostics(
  questions: Question[],
  lookups: SurveyLookup[],
  groups: QuestionGroup[],
): FormulaDiagnostic[] {
  const diagnostics: FormulaDiagnostic[] = [];

  for (const question of questions) {
    for (const row of question.tableRowsData ?? []) {
      for (const cell of row.cells) {
        if (!cell.formula) continue;
        checkFormulaOwner(question, cell, questions, lookups, diagnostics);
        if (cell.type === 'calc' && hasCycleFromCalcCell(questions, question.id, cell.id)) {
          diagnostics.push({
            kind: 'cycle',
            questionId: question.id,
            cellId: cell.id,
            message: `계산 셀 수식이 순환 참조를 포함합니다: ${formatCellLabel(cell)}. 항상 빈 값(—)으로 표시됩니다.`,
          });
        }
      }
    }
  }

  const steps = buildRenderSteps(questions, groups);
  for (const question of questions) {
    if (!question.displayCondition) continue;
    const refs = collectCellRefsFromDisplayCondition(question.displayCondition);
    for (const ref of refs) {
      const targetQuestion = questions.find((q) => q.id === ref.questionId);
      if (!targetQuestion) continue;
      const targetCell = findCell(questions, ref.questionId, ref.cellId);
      if (!targetCell || targetCell.type !== 'calc') continue;

      const ownPage = findStepIndexOfQuestion(steps, question.id);
      const targetPage = findStepIndexOfQuestion(steps, targetQuestion.id);
      if (ownPage === -1 || targetPage === -1) continue; // groups 미제공 등 — 오탐 방지
      if (ownPage !== targetPage) continue;

      diagnostics.push({
        kind: 'branch-same-group-calc',
        questionId: question.id,
        cellId: targetCell.id,
        message: `"${questionLabel(question)}"의 분기 조건이 같은 페이지의 계산 셀을 참조합니다: ${formatCellLabel(targetCell)}. 계산 값은 다음 페이지로 넘어갈 때 저장되므로 같은 페이지에서는 사용할 수 없습니다.`,
      });
    }
  }

  return diagnostics;
}
