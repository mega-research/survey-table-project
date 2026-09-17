import { describe, it, expect } from 'vitest';
import { evaluateLeftOperand } from '@/lib/lookup/evaluate-arith';
import type { LeftOperand } from '@/types/survey';
import type { LookupEvalCtx } from '@/lib/lookup/types';

const baseCtx: LookupEvalCtx = {
  responses: {
    q1: { c_exp: '1000000', c_ppl: '2', c_empty: '', c_bad: '약 50' },
  },
  contactAttrs: {},
  lookups: [],
};

describe('evaluateLeftOperand', () => {
  it('단일 셀: 정수 파싱', () => {
    const op: LeftOperand = { kind: 'cell', questionId: 'q1', cellId: 'c_exp' };
    const r = evaluateLeftOperand(op, baseCtx);
    expect(r).toEqual({ ok: true, value: 1000000 });
  });

  it('단일 셀: 응답 없음 → cell-value-missing', () => {
    const op: LeftOperand = { kind: 'cell', questionId: 'q1', cellId: 'c_missing' };
    const r = evaluateLeftOperand(op, baseCtx);
    expect(r).toEqual({ ok: false, reason: 'cell-value-missing' });
  });

  it('단일 셀: 빈 문자열 → cell-value-missing', () => {
    const op: LeftOperand = { kind: 'cell', questionId: 'q1', cellId: 'c_empty' };
    const r = evaluateLeftOperand(op, baseCtx);
    expect(r).toEqual({ ok: false, reason: 'cell-value-missing' });
  });

  it('단일 셀: 파싱 실패 → cell-value-not-number', () => {
    const op: LeftOperand = { kind: 'cell', questionId: 'q1', cellId: 'c_bad' };
    const r = evaluateLeftOperand(op, baseCtx);
    expect(r).toEqual({ ok: false, reason: 'cell-value-not-number' });
  });

  it('binop: 나눗셈 정상', () => {
    const op: LeftOperand = {
      kind: 'binop',
      op: '/',
      left: { kind: 'cell', questionId: 'q1', cellId: 'c_exp' },
      right: { kind: 'cell', questionId: 'q1', cellId: 'c_ppl' },
    };
    const r = evaluateLeftOperand(op, baseCtx);
    expect(r).toEqual({ ok: true, value: 500000 });
  });

  it('binop: 0 으로 나누기 → divide-by-zero', () => {
    const ctx: LookupEvalCtx = {
      ...baseCtx,
      responses: { q1: { a: '100', b: '0' } },
    };
    const op: LeftOperand = {
      kind: 'binop',
      op: '/',
      left: { kind: 'cell', questionId: 'q1', cellId: 'a' },
      right: { kind: 'cell', questionId: 'q1', cellId: 'b' },
    };
    const r = evaluateLeftOperand(op, ctx);
    expect(r).toEqual({ ok: false, reason: 'divide-by-zero' });
  });

  it('binop: 우측 리터럴 곱셈', () => {
    const op: LeftOperand = {
      kind: 'binop',
      op: '*',
      left: { kind: 'cell', questionId: 'q1', cellId: 'c_ppl' },
      right: { kind: 'literal', value: 3 },
    };
    const r = evaluateLeftOperand(op, baseCtx);
    expect(r).toEqual({ ok: true, value: 6 });
  });

  it('binop: 좌측 셀 빈 응답 → cell-value-missing 전파', () => {
    const op: LeftOperand = {
      kind: 'binop',
      op: '+',
      left: { kind: 'cell', questionId: 'q1', cellId: 'c_empty' },
      right: { kind: 'cell', questionId: 'q1', cellId: 'c_ppl' },
    };
    const r = evaluateLeftOperand(op, baseCtx);
    expect(r).toEqual({ ok: false, reason: 'cell-value-missing' });
  });
});
