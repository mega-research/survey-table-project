import type { NumericComparison } from '@/types/survey';
import { evaluateLeftOperand } from './evaluate-arith';
import { evaluateRightOperand } from './evaluate-lookup';
import type { FailReason, LookupEvalCtx } from './types';

export type ComparisonResult = {
  satisfied: boolean;       // 조건 평가 결과 (fail-safe 적용 후)
  failSafeShow: boolean;    // true 면 평가 실패로 SHOW 됨
  reason?: FailReason;      // failSafeShow 일 때만 채워짐
  debug?: { leftValue?: number; rightValue?: number };
};

export function evaluateComparisonWithFailSafe(
  cmp: NumericComparison,
  ctx: LookupEvalCtx,
): ComparisonResult {
  // 좌변
  if (!cmp.left) {
    return { satisfied: true, failSafeShow: true, reason: 'cell-value-missing' };
  }
  const left = evaluateLeftOperand(cmp.left, ctx);
  if (!left.ok) {
    return { satisfied: true, failSafeShow: true, reason: left.reason };
  }

  // 우변 (right 우선, 없으면 comparand 하위 호환)
  const rightOp = cmp.right ?? (cmp.comparand ? cmp.comparand : null);
  if (!rightOp) {
    return { satisfied: true, failSafeShow: true, reason: 'lookup-not-found' };
  }
  const right = evaluateRightOperand(rightOp, ctx);
  if (!right.ok) {
    return { satisfied: true, failSafeShow: true, reason: right.reason };
  }

  const L = left.value;
  const R = right.value;
  let satisfied = false;
  switch (cmp.operator) {
    case '==': satisfied = L === R; break;
    case '!=': satisfied = L !== R; break;
    case '<':  satisfied = L < R; break;
    case '<=': satisfied = L <= R; break;
    case '>':  satisfied = L > R; break;
    case '>=': satisfied = L >= R; break;
  }
  return {
    satisfied,
    failSafeShow: false,
    debug: { leftValue: L, rightValue: R },
  };
}
