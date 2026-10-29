import { describe, expect, it } from 'vitest';

import {
  DEFAULT_REQUIRED_CELL_MESSAGE,
  DEFAULT_REQUIRED_MESSAGE,
  requiredCellMessage,
  resolveRequiredMessage,
} from './required-message';

describe('필수 안내 문구', () => {
  it('언어를 주지 않으면 지금 한국어 기본 문구다', () => {
    expect(resolveRequiredMessage({})).toBe(DEFAULT_REQUIRED_MESSAGE);
    expect(resolveRequiredMessage({})).toBe('필수 질문에 답변해주세요.');
    expect(requiredCellMessage()).toBe(DEFAULT_REQUIRED_CELL_MESSAGE);
  });

  it('고른 언어의 기본 문구를 낸다', () => {
    expect(resolveRequiredMessage({}, 'zh')).toBe('请回答此必答题。');
    expect(resolveRequiredMessage({}, 'en')).toBe('Please answer this required question.');
    expect(requiredCellMessage('zh')).toBe('有必填项未填写');
    expect(requiredCellMessage('en')).toBe('A required field is empty');
  });

  it('저작자 문구는 언어와 무관하게 그대로다', () => {
    expect(resolveRequiredMessage({ requiredMessage: '성명을 적어 주세요' }, 'en')).toBe(
      '성명을 적어 주세요',
    );
  });
});
