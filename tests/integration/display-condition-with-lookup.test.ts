import { describe, expect, it } from 'vitest';

import { buildSurveySnapshot } from '@/lib/versioning/snapshot-builder';
import type {
  NumericComparison,
  Survey,
  SurveyLookup,
} from '@/types/survey';
import { evaluateNumericComparisonV2 } from '@/utils/branch-logic';

// 항공비 비교용 외부 데이터 LUT — 좌변 (1인당 출장비) ≤ 우변 (대륙별 평균 항공비)
const LUT: SurveyLookup = {
  id: 'lut-airfare',
  name: '항공비 평균',
  keyColumns: ['대륙'],
  valueColumn: '적용액',
  rows: [
    { 대륙: '유럽', 적용액: 2470000 },
    { 대륙: '아시아', 적용액: 800000 },
  ],
};

function buildSurveyWithLookups(): Survey {
  return {
    id: 'survey-1',
    title: 'lookup-e2e',
    questions: [],
    groups: [],
    settings: {
      isPublic: true,
      allowMultipleResponses: false,
      showProgressBar: true,
      shuffleQuestions: false,
      requireLogin: false,
      thankYouMessage: 'thanks',
    },
    lookups: [LUT],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('displayCondition with lookup E2E', () => {
  it('buildSurveySnapshot 가 survey.lookups 를 snapshot 에 freeze 한다', () => {
    const survey = buildSurveyWithLookups();
    const snap = buildSurveySnapshot(survey);
    expect(snap.lookups).toHaveLength(1);
    expect(snap.lookups[0].id).toBe('lut-airfare');
    expect(snap.lookups[0].valueColumn).toBe('적용액');
  });

  it('binop / lookup 조건 평가: 1인당 출장비 ≤ 평균 항공비 → 만족 (SHOW)', () => {
    const cmp: NumericComparison = {
      operator: '<=',
      left: {
        kind: 'binop',
        op: '/',
        left: { kind: 'cell', questionId: 'q1', cellId: 'expense' },
        right: { kind: 'cell', questionId: 'q1', cellId: 'people' },
      },
      right: {
        kind: 'lookup',
        surveyLookupId: 'lut-airfare',
        keyMapping: [{ lutKey: '대륙', attrsKey: '개최대륙' }],
      },
    };
    const result = evaluateNumericComparisonV2(cmp, '__unused__', {
      responses: { q1: { expense: '1000000', people: '2' } },
      contactAttrs: { 개최대륙: '유럽' },
      lookups: [LUT],
    });
    // 1000000 / 2 = 500000 ≤ 2470000 → satisfied
    expect(result.satisfied).toBe(true);
    expect(result.failSafeShow).toBe(false);
    expect(result.debug?.leftValue).toBe(500000);
    expect(result.debug?.rightValue).toBe(2470000);
  });

  it('binop / lookup 조건 평가: 1인당 출장비가 평균 항공비 초과 → 불만족 (HIDE)', () => {
    const cmp: NumericComparison = {
      operator: '<=',
      left: {
        kind: 'binop',
        op: '/',
        left: { kind: 'cell', questionId: 'q1', cellId: 'expense' },
        right: { kind: 'cell', questionId: 'q1', cellId: 'people' },
      },
      right: {
        kind: 'lookup',
        surveyLookupId: 'lut-airfare',
        keyMapping: [{ lutKey: '대륙', attrsKey: '개최대륙' }],
      },
    };
    const result = evaluateNumericComparisonV2(cmp, '__unused__', {
      responses: { q1: { expense: '5000000', people: '1' } },
      contactAttrs: { 개최대륙: '유럽' },
      lookups: [LUT],
    });
    // 5000000 / 1 = 5000000 > 2470000 → not satisfied
    expect(result.satisfied).toBe(false);
    expect(result.failSafeShow).toBe(false);
  });

  it('attrs 누락 시 fail-safe SHOW (익명 응답)', () => {
    const cmp: NumericComparison = {
      operator: '<=',
      left: { kind: 'cell', questionId: 'q1', cellId: 'expense' },
      right: {
        kind: 'lookup',
        surveyLookupId: 'lut-airfare',
        keyMapping: [{ lutKey: '대륙', attrsKey: '개최대륙' }],
      },
    };
    const result = evaluateNumericComparisonV2(cmp, '__unused__', {
      responses: { q1: { expense: '500000' } },
      contactAttrs: {}, // 익명 — invite 없이 진입
      lookups: [LUT],
    });
    expect(result.satisfied).toBe(true);
    expect(result.failSafeShow).toBe(true);
    expect(result.reason).toBe('attrs-key-missing');
  });

  it('LUT 행 매칭 실패 시 fail-safe SHOW (등록되지 않은 대륙)', () => {
    const cmp: NumericComparison = {
      operator: '<=',
      left: { kind: 'cell', questionId: 'q1', cellId: 'expense' },
      right: {
        kind: 'lookup',
        surveyLookupId: 'lut-airfare',
        keyMapping: [{ lutKey: '대륙', attrsKey: '개최대륙' }],
      },
    };
    const result = evaluateNumericComparisonV2(cmp, '__unused__', {
      responses: { q1: { expense: '500000' } },
      contactAttrs: { 개최대륙: '남극' }, // LUT 에 없음
      lookups: [LUT],
    });
    expect(result.satisfied).toBe(true);
    expect(result.failSafeShow).toBe(true);
    expect(result.reason).toBe('lookup-row-not-matched');
  });

  it('binop 0으로 나누기 → fail-safe SHOW', () => {
    const cmp: NumericComparison = {
      operator: '<=',
      left: {
        kind: 'binop',
        op: '/',
        left: { kind: 'cell', questionId: 'q1', cellId: 'expense' },
        right: { kind: 'cell', questionId: 'q1', cellId: 'people' },
      },
      right: {
        kind: 'lookup',
        surveyLookupId: 'lut-airfare',
        keyMapping: [{ lutKey: '대륙', attrsKey: '개최대륙' }],
      },
    };
    const result = evaluateNumericComparisonV2(cmp, '__unused__', {
      responses: { q1: { expense: '1000000', people: '0' } },
      contactAttrs: { 개최대륙: '유럽' },
      lookups: [LUT],
    });
    expect(result.satisfied).toBe(true);
    expect(result.failSafeShow).toBe(true);
    expect(result.reason).toBe('divide-by-zero');
  });
});
