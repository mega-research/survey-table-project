import { describe, it, expect } from 'vitest';
import {
  toneFromRate,
  sortGroupRows,
  computeTotals,
  type ProgressRow,
} from '@/lib/operations/report-progress';

describe('toneFromRate', () => {
  it('listCount=0 일 때 gray', () => {
    expect(toneFromRate(0, 0)).toBe('gray');
  });
  it('completedCount=0 일 때 gray', () => {
    expect(toneFromRate(0, 100)).toBe('gray');
  });
  it('1 <= rate < 25 일 때 rose', () => {
    expect(toneFromRate(1, 100)).toBe('rose');   // 1%
    expect(toneFromRate(24, 100)).toBe('rose');  // 24%
  });
  it('25 <= rate < 50 일 때 amber', () => {
    expect(toneFromRate(25, 100)).toBe('amber'); // 25%
    expect(toneFromRate(49, 100)).toBe('amber'); // 49%
  });
  it('50 <= rate <= 100 일 때 green', () => {
    expect(toneFromRate(50, 100)).toBe('green');  // 50%
    expect(toneFromRate(100, 100)).toBe('green'); // 100%
  });
});

const fixture: ProgressRow[] = [
  { groupLabel: 'A 전시회', groupValueRaw: 'A 전시회', firstResid: 1, listCount: 10, completedCount: 5, meta: { '월': '03' } },
  { groupLabel: 'B 전시회', groupValueRaw: 'B 전시회', firstResid: 11, listCount: 20, completedCount: 18, meta: { '월': '01' } },
  { groupLabel: '(미분류)', groupValueRaw: null, firstResid: null, listCount: 5, completedCount: 0, meta: { '월': null } },
  { groupLabel: 'C 전시회', groupValueRaw: 'C 전시회', firstResid: 31, listCount: 0, completedCount: 0, meta: { '월': '04' } },
];

describe('sortGroupRows', () => {
  it('responseRate desc 는 90% > 50% > 0% > NULL(listCount=0) NULLS LAST', () => {
    const sorted = sortGroupRows(fixture, 'responseRate', 'desc');
    expect(sorted.map((r) => r.groupLabel)).toEqual(['B 전시회', 'A 전시회', '(미분류)', 'C 전시회']);
  });
  it('responseRate asc 는 0% < 50% < 90%, NULL 마지막', () => {
    const sorted = sortGroupRows(fixture, 'responseRate', 'asc');
    expect(sorted.map((r) => r.groupLabel)).toEqual(['(미분류)', 'A 전시회', 'B 전시회', 'C 전시회']);
  });
  it('groupLabel asc 는 한글 자모 순 (localeCompare ko)', () => {
    const sorted = sortGroupRows(fixture, 'groupLabel', 'asc');
    expect(sorted[0].groupLabel).toBe('(미분류)'); // '(' 가 한글 앞
  });
  it('listCount desc', () => {
    const sorted = sortGroupRows(fixture, 'listCount', 'desc');
    expect(sorted.map((r) => r.listCount)).toEqual([20, 10, 5, 0]);
  });
  it('meta:월 desc 는 04 > 03 > 01 > NULL', () => {
    const sorted = sortGroupRows(fixture, 'meta:월', 'desc');
    expect(sorted.map((r) => r.meta['월'])).toEqual(['04', '03', '01', null]);
  });
});

describe('computeTotals', () => {
  it('빈 배열은 0 합계', () => {
    expect(computeTotals([])).toEqual({ groupCount: 0, listTotal: 0, completedTotal: 0 });
  });
  it('fixture 합계 검증', () => {
    expect(computeTotals(fixture)).toEqual({
      groupCount: 4,
      listTotal: 10 + 20 + 5 + 0,
      completedTotal: 5 + 18 + 0 + 0,
    });
  });
});
