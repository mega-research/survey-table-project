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

  it('천단위 구분자/단위가 섞인 값은 절단하지 않고 제외한다', () => {
    // '1,000'→1, '5kg'→5 로 silent 절단되어 평균/합계가 왜곡되던 회귀 방지
    const stats = computeNumericStats(['1,000', '5kg', '10', '20']);
    expect(stats!.count).toBe(2); // '10', '20' 만 유효
    expect(stats!.sum).toBe(30);
    expect(stats!.mean).toBe(15);
    expect(stats!.min).toBe(10);
    expect(stats!.max).toBe(20);
  });

  it('모든 값이 천단위 구분자 형태면 null 을 반환한다', () => {
    expect(computeNumericStats(['1,000', '2,500'])).toBeNull();
  });
});
