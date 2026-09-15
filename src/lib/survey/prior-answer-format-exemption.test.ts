import { describe, expect, it } from 'vitest';

import { priorAnswerText, priorOptionText } from './prior-answers';

const prior = {
  'q-text': '010 1234 5678',
  'q-table': { c1: '02)123-4567', c2: 3 },
  __optTexts__: { 'q-choice': { o1: 'nobody@nowhere', c9: '1544-1234' } },
};

describe('priorAnswerText', () => {
  it('단답형 이월 원본을 그대로 낸다', () => {
    expect(priorAnswerText(prior, 'q-text')).toBe('010 1234 5678');
  });

  it('표 셀 이월 원본을 셀 id 로 낸다', () => {
    expect(priorAnswerText(prior, 'q-table', 'c1')).toBe('02)123-4567');
  });

  it('문자열이 아니거나 없으면 null', () => {
    expect(priorAnswerText(prior, 'q-table', 'c2')).toBeNull();
    expect(priorAnswerText(prior, 'q-table', 'c9')).toBeNull();
    expect(priorAnswerText(prior, 'q-table')).toBeNull();
    expect(priorAnswerText(prior, '없는문항')).toBeNull();
    expect(priorAnswerText(null, 'q-text')).toBeNull();
  });
});

describe('priorOptionText', () => {
  it('상세기재 사이드카의 이월 원본을 낸다', () => {
    expect(priorOptionText(prior, 'q-choice', 'o1')).toBe('nobody@nowhere');
    expect(priorOptionText(prior, 'q-choice', 'c9')).toBe('1544-1234');
  });

  it('없으면 null', () => {
    expect(priorOptionText(prior, 'q-choice', '없음')).toBeNull();
    expect(priorOptionText(prior, 'q-text', 'o1')).toBeNull();
    expect(priorOptionText(null, 'q-choice', 'o1')).toBeNull();
  });
});
