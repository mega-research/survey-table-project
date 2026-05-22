import type { RightOperand } from '@/types/survey';
import { findLookupRow } from './lookup-row-matcher';
import type { EvalResult, LookupEvalCtx } from './types';

export function evaluateRightOperand(
  op: RightOperand,
  ctx: LookupEvalCtx,
): EvalResult<number> {
  if (op.kind === 'literal') {
    return { ok: true, value: op.value };
  }

  const lookup = ctx.lookups.find((l) => l.id === op.surveyLookupId);
  if (!lookup) return { ok: false, reason: 'lookup-not-found' };

  // keyMapping 으로 keys 만들기
  const keys: Record<string, string | undefined> = {};
  for (const { lutKey, attrsKey } of op.keyMapping) {
    const v = ctx.contactAttrs[attrsKey];
    if (v === undefined || v === '') {
      return { ok: false, reason: 'attrs-key-missing' };
    }
    keys[lutKey] = v;
  }

  const row = findLookupRow(lookup, keys);
  if (!row) return { ok: false, reason: 'lookup-row-not-matched' };

  // 비교 시점에 우변에서 선택한 값 컬럼을 사용. 선택 안 됐거나(빈 문자열),
  // LUT 의 columns 목록에 없는 키면 fail-safe SHOW.
  const valueColumn = op.valueColumn;
  if (!valueColumn || !lookup.columns.includes(valueColumn)) {
    return { ok: false, reason: 'lookup-value-missing' };
  }

  const raw = row[valueColumn];
  if (raw === undefined || raw === null || raw === '') {
    return { ok: false, reason: 'lookup-value-missing' };
  }
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) {
    return { ok: false, reason: 'lookup-value-missing' };
  }
  return { ok: true, value: n };
}
