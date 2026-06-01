import { describe, expect, it } from 'vitest';

import { computeNumericStats } from '@/lib/analytics/numeric-stats';

describe('computeNumericStats', () => {
  it('빈 문자열은 제외하고 실제 0 은 포함한다', () => {
    const stats = computeNumericStats(['0', '', '10', '  ', '5']);
    expect(stats).not.toBeNull();
    expect(stats!.count).toBe(3); // '0', '10', '5'
    expect(stats!.sum).toBe(15);
    expect(stats!.min).toBe(0);
    expect(stats!.max).toBe(10);
    expect(stats!.mean).toBe(5);
  });

  it('비숫자 값은 제외한다', () => {
    const stats = computeNumericStats(['abc', '3', 'N/A', '7']);
    expect(stats!.count).toBe(2);
    expect(stats!.sum).toBe(10);
  });

  it('짝수 개수의 중앙값은 두 가운데 값의 평균', () => {
    const stats = computeNumericStats(['1', '2', '3', '4']);
    expect(stats!.median).toBe(2.5);
  });

  it('홀수 개수의 중앙값은 가운데 값', () => {
    const stats = computeNumericStats(['3', '1', '2']);
    expect(stats!.median).toBe(2);
  });

  it('음수와 소수도 처리한다', () => {
    const stats = computeNumericStats(['-1.5', '2.5']);
    expect(stats!.sum).toBe(1);
    expect(stats!.min).toBe(-1.5);
    expect(stats!.max).toBe(2.5);
  });

  it('유효 숫자가 없으면 null 을 반환한다', () => {
    expect(computeNumericStats(['', 'abc', '  '])).toBeNull();
  });
});
