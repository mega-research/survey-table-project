import { describe, expect, it } from 'vitest';

import {
  exceedsDecimalPlaces,
  exceedsMax,
  formatKoreanUnitReading,
  formatWithComma,
  rangeViolationMessage,
  stripComma,
} from '@/utils/number-format';

describe('formatWithComma / stripComma', () => {
  it('정수부에만 천단위 콤마를 넣는다', () => {
    expect(formatWithComma('1000')).toBe('1,000');
    expect(formatWithComma('1234567')).toBe('1,234,567');
    expect(formatWithComma('1234.5678')).toBe('1,234.5678');
    expect(formatWithComma('-1234567')).toBe('-1,234,567');
  });

  it('부분 입력과 3자리 이하는 그대로 둔다', () => {
    expect(formatWithComma('')).toBe('');
    expect(formatWithComma('-')).toBe('-');
    expect(formatWithComma('.')).toBe('.');
    expect(formatWithComma('123')).toBe('123');
    expect(formatWithComma('1234.')).toBe('1,234.');
  });

  it('숫자 진행 상태가 아닌 문자열은 변형하지 않는다', () => {
    expect(formatWithComma('abc')).toBe('abc');
  });

  it('stripComma 는 콤마만 제거한다', () => {
    expect(stripComma('1,234,567.89')).toBe('1234567.89');
    expect(stripComma('-1,000')).toBe('-1000');
  });
});

describe('exceedsMax', () => {
  it('완성 숫자가 max 를 넘으면 true', () => {
    expect(exceedsMax('101', 100)).toBe(true);
    expect(exceedsMax('100', 100)).toBe(false);
    expect(exceedsMax('100.5', 100)).toBe(true);
  });

  it('부분 입력과 max 미설정은 false', () => {
    expect(exceedsMax('-', 100)).toBe(false);
    expect(exceedsMax('', 100)).toBe(false);
    expect(exceedsMax('999', undefined)).toBe(false);
  });
});

describe('exceedsDecimalPlaces', () => {
  it('0 이면 소수점 자체를 거부한다', () => {
    expect(exceedsDecimalPlaces('1.', 0)).toBe(true);
    expect(exceedsDecimalPlaces('12', 0)).toBe(false);
  });

  it('소수 자릿수 초과만 거부한다', () => {
    expect(exceedsDecimalPlaces('1.23', 2)).toBe(false);
    expect(exceedsDecimalPlaces('1.234', 2)).toBe(true);
    expect(exceedsDecimalPlaces('1.234', undefined)).toBe(false);
  });
});

describe('rangeViolationMessage', () => {
  const format = { min: 10, max: 100 };

  it('min 미달·max 초과 메시지, 충족은 null', () => {
    expect(rangeViolationMessage('5', format)).toBe('10 이상 입력해주세요');
    expect(rangeViolationMessage('500', format)).toBe('100 이하로 입력해주세요');
    expect(rangeViolationMessage('50', format)).toBeNull();
  });

  it('빈 값·부분 입력·format 미설정은 null', () => {
    expect(rangeViolationMessage('', format)).toBeNull();
    expect(rangeViolationMessage('-', format)).toBeNull();
    expect(rangeViolationMessage('5', undefined)).toBeNull();
    expect(rangeViolationMessage('5', {})).toBeNull();
  });
});

describe('formatKoreanUnitReading', () => {
  it('천만 단위 스펙 예시를 만족한다', () => {
    expect(formatKoreanUnitReading('1', 'tenMillion')).toBe('1천만');
    expect(formatKoreanUnitReading('10', 'tenMillion')).toBe('1억');
    expect(formatKoreanUnitReading('123', 'tenMillion')).toBe('12억 3천만');
    expect(formatKoreanUnitReading('12.5', 'tenMillion')).toBe('1억 2천 5백만');
  });

  it('백만/천 단위 환산', () => {
    expect(formatKoreanUnitReading('123', 'million')).toBe('1억 2천 3백만');
    expect(formatKoreanUnitReading('1.5', 'thousand')).toBe('1천 5백');
    expect(formatKoreanUnitReading('5', 'thousand')).toBe('5천');
  });

  it('음수는 - 접두', () => {
    expect(formatKoreanUnitReading('-3', 'tenMillion')).toBe('-3천만');
  });

  it('0·빈 값·부분 입력·percent·기본 단위는 null', () => {
    expect(formatKoreanUnitReading('0', 'tenMillion')).toBeNull();
    expect(formatKoreanUnitReading('', 'tenMillion')).toBeNull();
    expect(formatKoreanUnitReading('-', 'tenMillion')).toBeNull();
    expect(formatKoreanUnitReading('50', 'percent')).toBeNull();
    expect(formatKoreanUnitReading('50', undefined)).toBeNull();
  });
});
