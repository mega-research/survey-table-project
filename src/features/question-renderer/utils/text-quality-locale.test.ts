import { describe, expect, it } from 'vitest';

import { textQualityViolation } from './text-quality';

describe('textQualityViolation — 현재 언어', () => {
  it('언어를 주지 않으면 지금 한국어 문구다', () => {
    expect(textQualityViolation({ minLength: 5 }, '가나')?.message).toBe(
      '5자 이상 입력해 주세요. (현재 2자, 공백 제외)',
    );
  });

  it('중국어·영어 문구를 낸다', () => {
    expect(textQualityViolation({ minLength: 5 }, '你好', 'zh')?.message).toBe(
      '请至少输入5个字。（当前 2个字，不含空格）',
    );
    expect(textQualityViolation({ maxLength: 3 }, 'abcd', 'en')?.message).toBe(
      'Please enter no more than 3 characters. (currently 4)',
    );
    expect(textQualityViolation({ rejectMeaningless: true }, 'ㅋㅋㅋ', 'en')?.message).toBe(
      'Answers made up only of single letters or numbers are not accepted. Please enter your answer.',
    );
  });
});
