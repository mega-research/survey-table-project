import type { CalcExpr, Question, SurveyLookup, TableCell } from '@/types/survey';
import { evaluateRightOperand } from '@/lib/lookup/evaluate-lookup';
import { parseNumericInput } from '@/utils/numeric-input';

/**
 * 셀 수식 평가기.
 *
 * 응답 페이지·빌더 테스트 모드·차단형 검증·서버(운영자 수정 재계산)가 전부 이 모듈
 * 하나를 부른다 — 계산이 갈리면 "빌더에서 본 값과 실제 응답 값이 다름"이 생기므로
 * 다른 곳에 평가 로직을 복제하지 말 것 (answer-quote.ts 와 같은 규약).
 *
 * server-only 의존 금지 — isomorphic 유지.
 *
 * 3값 의미론:
 * - number  : 정상 값
 * - 'empty' : 빈 항 (SUM 0, AVG 분모 제외, group 항 0)
 * - null    : 무효 — 전파된다 (순환 / LUT 런타임 미해결 / 0 나누기)
 *
 * 표시 조건(displayCondition)은 평가하지 않는다 — 스펙 §4 (answer-quote 와 동일 결정).
 */

export const FORMULA_DEFAULT_DECIMAL_PLACES = 2;

export interface FormulaEvalCtx {
  questions: Question[];
  responses: Record<string, unknown>;
  lookups: SurveyLookup[];
  contactAttrs: Record<string, string | undefined>;
}

type TermResult = number | 'empty' | null;

export function roundFormulaValue(n: number, decimalPlaces: number | undefined): number {
  const places = decimalPlaces ?? FORMULA_DEFAULT_DECIMAL_PLACES;
  const factor = 10 ** places;
  return Math.round(n * factor) / factor;
}

function readCellRaw(ctx: FormulaEvalCtx, questionId: string, cellId: string): string | null {
  const qr = ctx.responses[questionId];
  if (!qr || typeof qr !== 'object' || Array.isArray(qr)) return null;
  const v = (qr as Record<string, unknown>)[cellId];
  return typeof v === 'string' ? v : null;
}

function findCell(ctx: FormulaEvalCtx, questionId: string): (cellId: string) => TableCell | undefined {
  const q = ctx.questions.find((it) => it.id === questionId);
  const cells = (q?.tableRowsData ?? []).flatMap((row) => row.cells);
  return (cellId) => cells.find((c) => c.id === cellId);
}

function evalExpr(
  expr: CalcExpr,
  ownQuestionId: string,
  ctx: FormulaEvalCtx,
  visited: Set<string>,
): TermResult {
  switch (expr.kind) {
    case 'literal':
      return expr.value;
    case 'cell': {
      const qid = expr.questionId ?? ownQuestionId;
      const cell = findCell(ctx, qid)(expr.cellId);
      if (!cell) return 'empty'; // 깨진 참조 — 항만 강등 (빌더 진단이 별도 경고)
      if (cell.type === 'calc') {
        // 계산 체인 — 재귀. visited 로 순환 감지.
        const key = `${qid}:${expr.cellId}`;
        if (visited.has(key)) return null;
        if (!cell.formula) return 'empty';
        visited.add(key);
        const inner = evalExpr(cell.formula, qid, ctx, visited);
        visited.delete(key);
        return inner;
      }
      const raw = readCellRaw(ctx, qid, expr.cellId);
      if (raw === null || raw.trim() === '') return 'empty';
      const n = parseNumericInput(raw);
      return n === null ? 'empty' : n;
    }
    case 'question': {
      const raw = ctx.responses[expr.questionId];
      if (typeof raw !== 'string' || raw.trim() === '') return 'empty';
      const n = parseNumericInput(raw);
      return n === null ? 'empty' : n;
    }
    case 'lookup': {
      // 분기 RightOperand.lookup 과 동일 구조 — 기존 평가기 재사용.
      // 런타임 미해결(익명 응답 attrs 부재 등)은 항 강등이 아니라 전체 무효 —
      // 틀린 숫자를 보여주거나 검증으로 응답자를 막지 않기 위한 fail-safe (스펙 §4).
      // 키 매핑 자체가 비었거나 불완전하면 빌더 미설정 — 깨진 참조 계열이므로 항만 강등.
      // (아래 attrs-key-missing 은 매핑은 온전한데 응답자 attrs 에 값이 없는 런타임 실패와
      // 같은 reason 문자열을 쓰므로, 빌더 시점 문제는 여기서 먼저 걸러야 구분된다.)
      if (
        expr.keyMapping.length === 0 ||
        expr.keyMapping.some((m) => !m.lutKey || !m.attrsKey)
      ) {
        return 'empty';
      }
      const result = evaluateRightOperand(
        { kind: 'lookup', surveyLookupId: expr.surveyLookupId, keyMapping: expr.keyMapping, valueColumn: expr.valueColumn },
        { responses: {}, contactAttrs: ctx.contactAttrs, lookups: ctx.lookups },
      );
      if (result.ok) return result.value;
      // 실패 사유를 나눈다 (스펙 §4):
      // - 삭제된 LUT·잘못된 값 컬럼은 빌더 시점에 판명되는 깨진 참조 — 셀 참조와 동일하게
      //   해당 항만 빈 값으로 강등한다 (빌더 진단이 별도 경고).
      // - attrs 부재·행 미매칭은 응답자별 런타임 미해결 — 전체 무효로 전파해
      //   틀린 숫자 표시나 부당한 검증 차단을 막는다.
      return result.reason === 'lookup-not-found' || result.reason === 'lookup-value-missing'
        ? 'empty'
        : null;
    }
    case 'agg': {
      let sum = 0;
      let filled = 0;
      for (const item of expr.items) {
        const v = evalExpr(item, ownQuestionId, ctx, visited);
        if (v === null) return null;
        if (v === 'empty') continue;
        sum += v;
        filled += 1;
      }
      if (expr.fn === 'sum') return sum;
      return filled === 0 ? null : sum / filled;
    }
    case 'group': {
      let acc: number | null = null;
      for (const term of expr.terms) {
        const v = evalExpr(term, ownQuestionId, ctx, visited);
        if (v === null) return null;
        const n = v === 'empty' ? 0 : v;
        if (acc === null) { acc = n; continue; }
        switch (expr.op) {
          case '+': acc += n; break;
          case '-': acc -= n; break;
          case '*': acc *= n; break;
          case '/':
            if (n === 0) return null;
            acc /= n;
            break;
        }
      }
      return acc ?? 'empty'; // 항이 0개인 그룹은 빈 항
    }
  }
}

export function evaluateCellFormula(
  expr: CalcExpr,
  ownQuestionId: string,
  ctx: FormulaEvalCtx,
  decimalPlaces?: number,
): number | null {
  const out = evalExpr(expr, ownQuestionId, ctx, new Set());
  if (out === null || out === 'empty') return null;
  if (!Number.isFinite(out)) return null;
  return roundFormulaValue(out, decimalPlaces);
}

/**
 * 저장 페이로드에 calc 셀 값을 주입한다 (스펙 §5).
 * 표시용은 항상 파생 계산이고, 이 함수는 저장 경계(draft flush / complete / beacon /
 * 운영자 수정)에서만 불린다 — 키스트로크마다 쓰지 않는다.
 */
export function withCalcValues(
  payloadAnswers: Record<string, unknown>,
  ctx: FormulaEvalCtx,
): Record<string, unknown> {
  // 평가는 ctx.responses 위에 payload 를 병합한 최신 상태 기준이어야 한다.
  // 이탈 beacon/flush 가 상태 렌더보다 먼저 실행되면 최신 입력이 payload 에만 있는데,
  // ctx 만으로 평가하면 계산값이 한 박자 전 응답 기준으로 저장된다.
  const mergedResponses: Record<string, unknown> = { ...ctx.responses };
  for (const [qid, payload] of Object.entries(payloadAnswers)) {
    const prev = mergedResponses[qid];
    if (
      payload && typeof payload === 'object' && !Array.isArray(payload) &&
      prev && typeof prev === 'object' && !Array.isArray(prev)
    ) {
      mergedResponses[qid] = { ...(prev as Record<string, unknown>), ...(payload as Record<string, unknown>) };
    } else {
      mergedResponses[qid] = payload;
    }
  }
  const evalCtx: FormulaEvalCtx = { ...ctx, responses: mergedResponses };

  let out: Record<string, unknown> | null = null;
  for (const q of ctx.questions) {
    const calcCells = (q.tableRowsData ?? [])
      .flatMap((row) => row.cells)
      .filter((c) => c.type === 'calc' && !c.isHidden && c.formula);
    if (calcCells.length === 0) continue;

    const merged = mergedResponses[q.id];
    const base = {
      ...(merged && typeof merged === 'object' && !Array.isArray(merged)
        ? (merged as Record<string, unknown>)
        : {}),
    };
    for (const cell of calcCells) {
      const value = evaluateCellFormula(cell.formula!, q.id, evalCtx, cell.numberFormat?.decimalPlaces);
      base[cell.id] = value === null ? '' : String(value);
    }
    out ??= { ...payloadAnswers };
    out[q.id] = base;
  }
  return out ?? payloadAnswers;
}
