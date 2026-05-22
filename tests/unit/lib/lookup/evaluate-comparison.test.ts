import { describe, it, expect } from 'vitest';
import { evaluateComparisonWithFailSafe } from '@/lib/lookup/evaluate-comparison';
import type { NumericComparison, SurveyLookup } from '@/types/survey';
import type { LookupEvalCtx } from '@/lib/lookup/types';

const LUT: SurveyLookup = {
  id: 'lut-1',
  name: 'avg',
  keyColumns: ['대륙'],
  valueColumn: 'v',
  rows: [{ 대륙: '유럽', v: 1000 }],
};

const baseCtx: LookupEvalCtx = {
  responses: { q1: { a: '500', b: '2' } },
  contactAttrs: { 개최대륙: '유럽' },
  lookups: [LUT],
};

describe('evaluateComparisonWithFailSafe', () => {
  it('binop / lookup: 만족', () => {
    const cmp: NumericComparison = {
      operator: '<=',
      left: {
        kind: 'binop',
        op: '/',
        left: { kind: 'cell', questionId: 'q1', cellId: 'a' },
        right: { kind: 'cell', questionId: 'q1', cellId: 'b' },
      },
      right: {
        kind: 'lookup',
        surveyLookupId: 'lut-1',
        keyMapping: [{ lutKey: '대륙', attrsKey: '개최대륙' }],
      },
    };
    const r = evaluateComparisonWithFailSafe(cmp, baseCtx);
    expect(r.satisfied).toBe(true);
    expect(r.failSafeShow).toBe(false);
    expect(r.reason).toBeUndefined();
  });

  it('binop / lookup: 만족 (boundary)', () => {
    const cmp: NumericComparison = {
      operator: '<=',
      left: {
        kind: 'binop',
        op: '*',
        left: { kind: 'cell', questionId: 'q1', cellId: 'a' },
        right: { kind: 'cell', questionId: 'q1', cellId: 'b' },
      },
      right: {
        kind: 'lookup',
        surveyLookupId: 'lut-1',
        keyMapping: [{ lutKey: '대륙', attrsKey: '개최대륙' }],
      },
    };
    const r = evaluateComparisonWithFailSafe(cmp, baseCtx);
    expect(r.satisfied).toBe(true);
  });

  it('fail-safe: attrs 누락 시 satisfied=true (SHOW), failSafeShow=true, reason 포함', () => {
    const cmp: NumericComparison = {
      operator: '<',
      left: { kind: 'cell', questionId: 'q1', cellId: 'a' },
      right: {
        kind: 'lookup',
        surveyLookupId: 'lut-1',
        keyMapping: [{ lutKey: '대륙', attrsKey: '개최대륙' }],
      },
    };
    const r = evaluateComparisonWithFailSafe(cmp, { ...baseCtx, contactAttrs: {} });
    expect(r.satisfied).toBe(true);
    expect(r.failSafeShow).toBe(true);
    expect(r.reason).toBe('attrs-key-missing');
  });

  it('하위 호환: comparand (literal) 만 있는 기존 데이터', () => {
    const cmp: NumericComparison = {
      operator: '<',
      left: { kind: 'cell', questionId: 'q1', cellId: 'a' },
      comparand: { kind: 'literal', value: 1000 },
    };
    const r = evaluateComparisonWithFailSafe(cmp, baseCtx);
    expect(r.satisfied).toBe(true);
  });

  it('6 연산자 모두', () => {
    const ctx: LookupEvalCtx = { ...baseCtx, responses: { q1: { x: '10' } } };
    const mk = (op: NumericComparison['operator']): NumericComparison => ({
      operator: op,
      left: { kind: 'cell', questionId: 'q1', cellId: 'x' },
      right: { kind: 'literal', value: 10 },
    });
    expect(evaluateComparisonWithFailSafe(mk('=='), ctx).satisfied).toBe(true);
    expect(evaluateComparisonWithFailSafe(mk('!='), ctx).satisfied).toBe(false);
    expect(evaluateComparisonWithFailSafe(mk('<'), ctx).satisfied).toBe(false);
    expect(evaluateComparisonWithFailSafe(mk('<='), ctx).satisfied).toBe(true);
    expect(evaluateComparisonWithFailSafe(mk('>'), ctx).satisfied).toBe(false);
    expect(evaluateComparisonWithFailSafe(mk('>='), ctx).satisfied).toBe(true);
  });

  it('0 나누기 → fail-safe SHOW + divide-by-zero', () => {
    const ctx: LookupEvalCtx = { ...baseCtx, responses: { q1: { a: '100', b: '0' } } };
    const cmp: NumericComparison = {
      operator: '<',
      left: {
        kind: 'binop',
        op: '/',
        left: { kind: 'cell', questionId: 'q1', cellId: 'a' },
        right: { kind: 'cell', questionId: 'q1', cellId: 'b' },
      },
      right: { kind: 'literal', value: 1000 },
    };
    const r = evaluateComparisonWithFailSafe(cmp, ctx);
    expect(r.satisfied).toBe(true);
    expect(r.failSafeShow).toBe(true);
    expect(r.reason).toBe('divide-by-zero');
  });
});
