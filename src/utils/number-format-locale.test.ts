import { describe, expect, it } from 'vitest';

import { rangeViolationMessage } from '@/utils/number-format';

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
