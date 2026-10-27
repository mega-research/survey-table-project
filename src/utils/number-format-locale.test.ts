import { describe, expect, it } from 'vitest';

import { formatKoreanUnitReading, formatUnitReading, rangeViolationMessage } from '@/utils/number-format';

describe('rangeViolationMessage — 현재 언어', () => {
  const format = { min: 10, max: 100 };

  it('언어를 주지 않으면 지금 한국어 문구다', () => {
    expect(rangeViolationMessage('5', format)).toBe('10 이상 입력해주세요');
    expect(rangeViolationMessage('500', format)).toBe('100 이하로 입력해주세요');
  });

  it('중국어·영어 문구를 낸다', () => {
    expect(rangeViolationMessage('5', format, 'zh')).toBe('请输入10或以上的数值');
    expect(rangeViolationMessage('500', format, 'en')).toBe('Please enter 100 or less');
  });
});

describe('formatUnitReading — 현재 언어의 금액 읽기', () => {
  it('언어를 주지 않거나 한국어면 한글 환산 읽기 그대로다', () => {
    expect(formatUnitReading('1111111', 'tenThousand', '원')).toBe(formatKoreanUnitReading('1111111', 'tenThousand', '원'));
    expect(formatUnitReading('123456', 'one', undefined, 'ko')).toBe('12만 3,456');
    expect(formatUnitReading('1234567', undefined, '원', 'ko')).toBe('1,234,567원');
  });

  it('중국어는 万·亿 로 끊고 묶음 안은 숫자 그대로 읽는다', () => {
    expect(formatUnitReading('1111111', 'one', '元', 'zh')).toBe('111万1111元');
    expect(formatUnitReading('160000', 'one', '元', 'zh')).toBe('16万元');
    expect(formatUnitReading('123456789', 'one', '元', 'zh')).toBe('1亿2345万6789元');
    expect(formatUnitReading('30000000', 'one', '元', 'zh')).toBe('3000万元');
    expect(formatUnitReading('1500000000000', 'one', '元', 'zh')).toBe('1万5000亿元');
    expect(formatUnitReading('12.5', 'tenThousand', '元', 'zh')).toBe('12万5000元');
    // 만 미만은 콤마 숫자 + 어절 (한국어와 같은 규칙)
    expect(formatUnitReading('9999', 'one', '元', 'zh')).toBe('9,999元');
    expect(formatUnitReading('-1111111', 'one', '元', 'zh')).toBe('-111万1111元');
  });

  it('영어는 million·billion·trillion 으로 소수 둘째 자리까지 읽고 통화 앞을 띄운다', () => {
    expect(formatUnitReading('1111111', 'one', 'USD', 'en')).toBe('1.11 million USD');
    expect(formatUnitReading('1500000', 'one', 'USD', 'en')).toBe('1.5 million USD');
    expect(formatUnitReading('2000000000', 'one', 'USD', 'en')).toBe('2 billion USD');
    expect(formatUnitReading('3200000000000', 'one', 'USD', 'en')).toBe('3.2 trillion USD');
    // 백만 미만은 콤마 숫자 + 어절
    expect(formatUnitReading('23000', 'one', 'USD', 'en')).toBe('23,000 USD');
    expect(formatUnitReading('23000', undefined, 'USD', 'en')).toBe('23,000 USD');
    expect(formatUnitReading('-2500000', 'one', 'USD', 'en')).toBe('-2.5 million USD');
  });

  it('0·빈 값·부분 입력·percent 는 언어와 무관하게 null', () => {
    for (const locale of ['zh', 'en'] as const) {
      expect(formatUnitReading('0', 'one', '元', locale)).toBeNull();
      expect(formatUnitReading('', 'one', '元', locale)).toBeNull();
      expect(formatUnitReading('-', 'one', '元', locale)).toBeNull();
      expect(formatUnitReading('50', 'percent', '%', locale)).toBeNull();
      expect(formatUnitReading('50', undefined, undefined, locale)).toBeNull();
    }
  });
});
