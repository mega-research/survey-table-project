import { describe, it, expect } from 'vitest';
import { evaluateRightOperand } from '@/lib/lookup/evaluate-lookup';
import type { RightOperand, SurveyLookup } from '@/types/survey';
import type { LookupEvalCtx } from '@/lib/lookup/types';

const LUT: SurveyLookup = {
  id: 'lut-1',
  name: 'avg-airfare',
  keyColumns: ['대륙'],
  valueColumn: '2026년도_적용액',
  rows: [
    { 대륙: '유럽', '2026년도_적용액': 2470000 },
    { 대륙: '아시아', '2026년도_적용액': 800000 },
    { 대륙: '북미', '2026년도_적용액': '2210000' }, // 문자열 숫자도 허용
  ],
};

const ctx = (attrs: Record<string, string>): LookupEvalCtx => ({
  responses: {},
  contactAttrs: attrs,
  lookups: [LUT],
});

describe('evaluateRightOperand', () => {
  it('literal: 그대로 반환', () => {
    const op: RightOperand = { kind: 'literal', value: 100 };
    const r = evaluateRightOperand(op, ctx({}));
    expect(r).toEqual({ ok: true, value: 100 });
  });

  it('lookup: 정상 룩업', () => {
    const op: RightOperand = {
      kind: 'lookup',
      surveyLookupId: 'lut-1',
      keyMapping: [{ lutKey: '대륙', attrsKey: '개최대륙' }],
    };
    const r = evaluateRightOperand(op, ctx({ 개최대륙: '유럽' }));
    expect(r).toEqual({ ok: true, value: 2470000 });
  });

  it('lookup: 문자열 숫자 값도 number 로 변환', () => {
    const op: RightOperand = {
      kind: 'lookup',
      surveyLookupId: 'lut-1',
      keyMapping: [{ lutKey: '대륙', attrsKey: '개최대륙' }],
    };
    const r = evaluateRightOperand(op, ctx({ 개최대륙: '북미' }));
    expect(r).toEqual({ ok: true, value: 2210000 });
  });

  it('lookup: surveyLookupId 가 lookups 에 없음', () => {
    const op: RightOperand = {
      kind: 'lookup',
      surveyLookupId: 'missing',
      keyMapping: [{ lutKey: '대륙', attrsKey: '개최대륙' }],
    };
    const r = evaluateRightOperand(op, ctx({ 개최대륙: '유럽' }));
    expect(r).toEqual({ ok: false, reason: 'lookup-not-found' });
  });

  it('lookup: attrs 에 매핑된 키 없음', () => {
    const op: RightOperand = {
      kind: 'lookup',
      surveyLookupId: 'lut-1',
      keyMapping: [{ lutKey: '대륙', attrsKey: '개최대륙' }],
    };
    const r = evaluateRightOperand(op, ctx({}));
    expect(r).toEqual({ ok: false, reason: 'attrs-key-missing' });
  });

  it('lookup: attrs 값으로 행 매칭 실패', () => {
    const op: RightOperand = {
      kind: 'lookup',
      surveyLookupId: 'lut-1',
      keyMapping: [{ lutKey: '대륙', attrsKey: '개최대륙' }],
    };
    const r = evaluateRightOperand(op, ctx({ 개최대륙: '남극' }));
    expect(r).toEqual({ ok: false, reason: 'lookup-row-not-matched' });
  });

  it('lookup: 행에 valueColumn 키 없음 → lookup-value-missing', () => {
    const lutNoValue: SurveyLookup = {
      ...LUT,
      rows: [{ 대륙: '유럽' }],
    };
    const op: RightOperand = {
      kind: 'lookup',
      surveyLookupId: 'lut-1',
      keyMapping: [{ lutKey: '대륙', attrsKey: '개최대륙' }],
    };
    const r = evaluateRightOperand(op, {
      responses: {},
      contactAttrs: { 개최대륙: '유럽' },
      lookups: [lutNoValue],
    });
    expect(r).toEqual({ ok: false, reason: 'lookup-value-missing' });
  });
});
