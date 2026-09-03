import { describe, it, expect } from 'vitest';
import { findLookupRow } from '@/lib/lookup/lookup-row-matcher';
import type { SurveyLookup } from '@/types/survey';

const SINGLE_KEY_LUT: SurveyLookup = {
  id: 'lut-1',
  name: 'avg-airfare',
  columns: ['대륙', '2026년도_적용액'],
  rows: [
    { 대륙: '유럽', '2026년도_적용액': 2470000 },
    { 대륙: '아시아', '2026년도_적용액': 800000 },
  ],
};

const COMPOSITE_KEY_LUT: SurveyLookup = {
  id: 'lut-2',
  name: 'avg-airfare-by-class',
  columns: ['대륙', '클래스', '평균'],
  rows: [
    { 대륙: '유럽', 클래스: '이코노미', 평균: 1500000 },
    { 대륙: '유럽', 클래스: '비즈', 평균: 3200000 },
  ],
};

describe('findLookupRow', () => {
  it('단일 키 정확 매칭 성공', () => {
    const row = findLookupRow(SINGLE_KEY_LUT, { 대륙: '유럽' });
    expect(row).toEqual({ 대륙: '유럽', '2026년도_적용액': 2470000 });
  });

  it('단일 키 매칭 실패 시 null', () => {
    const row = findLookupRow(SINGLE_KEY_LUT, { 대륙: '오세아니아' });
    expect(row).toBeNull();
  });

  it('공백 trim 후 매칭', () => {
    const row = findLookupRow(SINGLE_KEY_LUT, { 대륙: ' 유럽 ' });
    expect(row).not.toBeNull();
    expect(row?.['2026년도_적용액']).toBe(2470000);
  });

  it('복합 키 모두 일치해야 매칭', () => {
    const row = findLookupRow(COMPOSITE_KEY_LUT, { 대륙: '유럽', 클래스: '비즈' });
    expect(row?.['평균']).toBe(3200000);
  });

  it('복합 키 중 하나만 일치하면 매칭 실패', () => {
    const row = findLookupRow(COMPOSITE_KEY_LUT, { 대륙: '유럽', 클래스: '퍼스트' });
    expect(row).toBeNull();
  });

  it('keys 가 비어있으면 첫 행이 매칭 (no-op matcher)', () => {
    // 어떤 키도 강제하지 않으면 첫 행이 반환된다.
    // RightOperand 측에서 keys 가 비지 않도록 보장하는 게 호출 책임.
    const row = findLookupRow(SINGLE_KEY_LUT, {});
    expect(row).toEqual({ 대륙: '유럽', '2026년도_적용액': 2470000 });
  });

  it('대소문자 구분 (정확 매칭 정책)', () => {
    const row = findLookupRow(SINGLE_KEY_LUT, { 대륙: '유럽 ' });
    expect(row).not.toBeNull();

    const row2 = findLookupRow(SINGLE_KEY_LUT, { 대륙: 'Europe' });
    expect(row2).toBeNull();
  });
});
