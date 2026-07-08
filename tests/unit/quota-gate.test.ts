import { describe, expect, it } from 'vitest';

import { allQuotaQuestionsAnswered } from '@/lib/quota/gate';

describe('allQuotaQuestionsAnswered', () => {
  it('빈 게이트는 false (발동 안 함)', () => {
    expect(allQuotaQuestionsAnswered([], { q1: 'a' })).toBe(false);
  });
  it('모든 게이트 문항에 답이 있으면 true', () => {
    expect(allQuotaQuestionsAnswered(['q1', 'q2'], { q1: 'male', q2: '25' })).toBe(true);
  });
  it('하나라도 누락이면 false', () => {
    expect(allQuotaQuestionsAnswered(['q1', 'q2'], { q1: 'male' })).toBe(false);
  });
  it('빈 문자열/빈 배열은 미답변', () => {
    expect(allQuotaQuestionsAnswered(['q1'], { q1: '' })).toBe(false);
    expect(allQuotaQuestionsAnswered(['q1'], { q1: [] })).toBe(false);
  });
  it('객체 답(래퍼)은 답변으로 인정', () => {
    expect(allQuotaQuestionsAnswered(['q1'], { q1: { selectedValue: 'x' } })).toBe(true);
  });
});
