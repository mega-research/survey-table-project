import type { CellRef, LeftOperand } from '@/types/survey';
import { parseNumericInput } from '@/utils/numeric-input';
import type { EvalResult, LookupEvalCtx } from './types';

function evalCell(cell: CellRef, ctx: LookupEvalCtx): EvalResult<number> {
  const raw = ctx.responses[cell.questionId]?.[cell.cellId];
  if (raw === undefined || raw === '') {
    return { ok: false, reason: 'cell-value-missing' };
  }
  const n = parseNumericInput(raw);
  if (n === null) {
    return { ok: false, reason: 'cell-value-not-number' };
  }
  return { ok: true, value: n };
}

export function evaluateLeftOperand(
  op: LeftOperand,
  ctx: LookupEvalCtx,
): EvalResult<number> {
  if (op.kind === 'cell') return evalCell(op, ctx);

  const l = evalCell(op.left, ctx);
  if (!l.ok) return l;

  const r: EvalResult<number> =
    op.right.kind === 'cell'
      ? evalCell(op.right, ctx)
      : { ok: true, value: op.right.value };
  if (!r.ok) return r;

  switch (op.op) {
    case '+':
      return { ok: true, value: l.value + r.value };
    case '-':
      return { ok: true, value: l.value - r.value };
    case '*':
      return { ok: true, value: l.value * r.value };
    case '/':
      if (r.value === 0) return { ok: false, reason: 'divide-by-zero' };
      return { ok: true, value: l.value / r.value };
  }
}
