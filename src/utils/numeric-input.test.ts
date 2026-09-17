import { describe, expect, it } from 'vitest';

import {
  isPartialNumericInput,
  parseNumericInput,
} from '@/utils/numeric-input';

describe('parseNumericInput', () => {
  it('정상 숫자 문자열을 number 로 파싱한다', () => {
    expect(parseNumericInput('3')).toBe(3);
    expect(parseNumericInput('0')).toBe(0);
    expect(parseNumericInput('-1.5')).toBe(-1.5);
    expect(parseNumericInput('.5')).toBe(0.5);
    expect(parseNumericInput('1.')).toBe(1);
    expect(parseNumericInput('-.5')).toBe(-0.5);
  });

  it('앞뒤 공백을 trim 한 뒤 파싱한다', () => {
    expect(parseNumericInput('  12  ')).toBe(12);
  });

  it('빈 문자열과 부분 입력은 null 을 반환한다', () => {
    expect(parseNumericInput('')).toBeNull();
    expect(parseNumericInput('   ')).toBeNull();
    expect(parseNumericInput('-')).toBeNull();
    expect(parseNumericInput('.')).toBeNull();
    expect(parseNumericInput('-.')).toBeNull();
  });

  it('천단위 구분자가 섞인 값은 절단하지 않고 null 을 반환한다', () => {
    // parseFloat('1,000') === 1 로 silent 절단되던 회귀 방지
    expect(parseNumericInput('1,000')).toBeNull();
    expect(parseNumericInput('1,000,000')).toBeNull();
  });

  it('단위/문자가 섞인 값은 절단하지 않고 null 을 반환한다', () => {
    // parseFloat('5kg') === 5, parseFloat('1a') === 1 로 절단되던 회귀 방지
    expect(parseNumericInput('5kg')).toBeNull();
    expect(parseNumericInput('1a')).toBeNull();
    expect(parseNumericInput('5%')).toBeNull();
    expect(parseNumericInput('+5')).toBeNull();
  });

  it('잘못된 숫자 형식은 null 을 반환한다', () => {
    expect(parseNumericInput('1.2.3')).toBeNull();
    expect(parseNumericInput('5.0.0')).toBeNull();
    expect(parseNumericInput('--1')).toBeNull();
    expect(parseNumericInput('0x10')).toBeNull();
    expect(parseNumericInput('1e3')).toBeNull();
    expect(parseNumericInput('Infinity')).toBeNull();
    expect(parseNumericInput('NaN')).toBeNull();
    expect(parseNumericInput('abc')).toBeNull();
  });

  it('isPartialNumericInput 으로 통과한 완성 입력은 parseNumericInput 도 파싱한다', () => {
    // UI 콜러는 isPartialNumericInput 게이트를 거치므로 완성 입력 회귀가 없어야 한다.
    const completeInputs = ['0', '3', '-1.5', '.5', '1.', '-.5', '100'];
    for (const v of completeInputs) {
      expect(isPartialNumericInput(v)).toBe(true);
      expect(parseNumericInput(v)).not.toBeNull();
    }
  });
});
