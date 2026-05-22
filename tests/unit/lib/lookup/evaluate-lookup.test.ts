import { describe, it, expect } from 'vitest';
import { evaluateRightOperand } from '@/lib/lookup/evaluate-lookup';
import type { RightOperand, SurveyLookup } from '@/types/survey';
import type { LookupEvalCtx } from '@/lib/lookup/types';

const LUT: SurveyLookup = {
  id: 'lut-1',
  name: 'avg-airfare',
  columns: ['대륙', '2026년도_적용액', '평균'],
  rows: [
    { 대륙: '유럽', '2026년도_적용액': 2470000, 평균: 2243739 },
    { 대륙: '아시아', '2026년도_적용액': 800000, 평균: 774110 },
    { 대륙: '북미', '2026년도_적용액': '2210000', 평균: 2013052 }, // 문자열 숫자도 허용
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

  it('lookup: 정상 룩업 (첫 번째 값 컬럼)', () => {
    const op: RightOperand = {
      kind: 'lookup',
      surveyLookupId: 'lut-1',
      keyMapping: [{ lutKey: '대륙', attrsKey: '개최대륙' }],
      valueColumn: '2026년도_적용액',
    };
    const r = evaluateRightOperand(op, ctx({ 개최대륙: '유럽' }));
    expect(r).toEqual({ ok: true, value: 2470000 });
  });

  it('lookup: 동일 LUT 에서 다른 값 컬럼 선택', () => {
    const op: RightOperand = {
      kind: 'lookup',
      surveyLookupId: 'lut-1',
      keyMapping: [{ lutKey: '대륙', attrsKey: '개최대륙' }],
      valueColumn: '평균',
    };
    const r = evaluateRightOperand(op, ctx({ 개최대륙: '유럽' }));
    expect(r).toEqual({ ok: true, value: 2243739 });
  });

  it('lookup: 문자열 숫자 값도 number 로 변환', () => {
    const op: RightOperand = {
      kind: 'lookup',
      surveyLookupId: 'lut-1',
      keyMapping: [{ lutKey: '대륙', attrsKey: '개최대륙' }],
      valueColumn: '2026년도_적용액',
    };
    const r = evaluateRightOperand(op, ctx({ 개최대륙: '북미' }));
    expect(r).toEqual({ ok: true, value: 2210000 });
  });

  it('lookup: surveyLookupId 가 lookups 에 없음', () => {
    const op: RightOperand = {
      kind: 'lookup',
      surveyLookupId: 'missing',
      keyMapping: [{ lutKey: '대륙', attrsKey: '개최대륙' }],
      valueColumn: '2026년도_적용액',
    };
    const r = evaluateRightOperand(op, ctx({ 개최대륙: '유럽' }));
    expect(r).toEqual({ ok: false, reason: 'lookup-not-found' });
  });

  it('lookup: attrs 에 매핑된 키 없음', () => {
    const op: RightOperand = {
      kind: 'lookup',
      surveyLookupId: 'lut-1',
      keyMapping: [{ lutKey: '대륙', attrsKey: '개최대륙' }],
      valueColumn: '2026년도_적용액',
    };
    const r = evaluateRightOperand(op, ctx({}));
    expect(r).toEqual({ ok: false, reason: 'attrs-key-missing' });
  });

  it('lookup: attrs 값으로 행 매칭 실패', () => {
    const op: RightOperand = {
      kind: 'lookup',
      surveyLookupId: 'lut-1',
      keyMapping: [{ lutKey: '대륙', attrsKey: '개최대륙' }],
      valueColumn: '2026년도_적용액',
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
      valueColumn: '2026년도_적용액',
    };
    const r = evaluateRightOperand(op, {
      responses: {},
      contactAttrs: { 개최대륙: '유럽' },
      lookups: [lutNoValue],
    });
    expect(r).toEqual({ ok: false, reason: 'lookup-value-missing' });
  });

  it('lookup: valueColumn 이 빈 문자열이면 lookup-value-missing', () => {
    const op: RightOperand = {
      kind: 'lookup',
      surveyLookupId: 'lut-1',
      keyMapping: [{ lutKey: '대륙', attrsKey: '개최대륙' }],
      valueColumn: '',
    };
    const r = evaluateRightOperand(op, ctx({ 개최대륙: '유럽' }));
    expect(r).toEqual({ ok: false, reason: 'lookup-value-missing' });
  });

  it('lookup: valueColumn 이 LUT 의 columns 목록에 없으면 lookup-value-missing', () => {
    const op: RightOperand = {
      kind: 'lookup',
      surveyLookupId: 'lut-1',
      keyMapping: [{ lutKey: '대륙', attrsKey: '개최대륙' }],
      valueColumn: '미등록컬럼',
    };
    const r = evaluateRightOperand(op, ctx({ 개최대륙: '유럽' }));
    expect(r).toEqual({ ok: false, reason: 'lookup-value-missing' });
  });
});
