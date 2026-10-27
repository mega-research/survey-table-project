import { describe, expect, it } from 'vitest';

import { type FormatFailure, formatFailureMessage } from './input-format';

describe('formatFailureMessage — 현재 언어', () => {
  it('언어를 주지 않으면 지금 한국어 문구다(조사 은/는 포함)', () => {
    expect(formatFailureMessage('mobile', 'not_a_number')).toBe('휴대전화는 숫자로 입력해 주세요');
    expect(formatFailureMessage('biz_number', 'wrong_length')).toBe('사업자번호는 10자리입니다');
    expect(formatFailureMessage('email', 'malformed')).toBe('이메일 형식이 아닙니다');
  });

  it('중국어 문구를 낸다', () => {
    expect(formatFailureMessage('email', 'malformed', 'zh')).toBe('电子邮箱格式不正确');
    expect(formatFailureMessage('mobile', 'unknown_prefix', 'zh')).toBe('不是有效的手机号码');
    expect(formatFailureMessage('phone', 'wrong_length', 'zh')).toBe('电话号码位数不正确');
  });

  it('영어 문구를 낸다', () => {
    expect(formatFailureMessage('email', 'malformed', 'en')).toBe(
      'This is not a valid email address',
    );
    expect(formatFailureMessage('email', 'non_ascii', 'en')).toBe(
      'Please use only English letters and numbers in the email address',
    );
    expect(formatFailureMessage('biz_number', 'wrong_length', 'en')).toBe(
      'The business registration number must be 10 digits',
    );
  });

  it('모든 형식·사유에서 중국어·영어 문구에 한글이 없다', () => {
    const formats = ['mobile', 'phone', 'biz_number', 'corp_number', 'email'] as const;
    const reasons: FormatFailure[] = [
      'not_a_number',
      'wrong_length',
      'unknown_prefix',
      'checksum_mismatch',
      'malformed',
      'non_ascii',
    ];
    for (const format of formats) {
      for (const reason of reasons) {
        for (const locale of ['zh', 'en'] as const) {
          expect(
            formatFailureMessage(format, reason, locale),
            `${format}/${reason}/${locale}`,
          ).not.toMatch(/[가-힣]/);
        }
      }
    }
  });
});
