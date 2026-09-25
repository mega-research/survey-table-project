import { describe, expect, it } from 'vitest';

import {
  allQuotaQuestionsAnswered,
  isQuotaTargetFilled,
  shouldCheckQuota,
} from '@/features/survey-response/lib/quota-gate';

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
  it('텍스트형 표 문항은 대상 칸에 값이 있어야 답변 — 다른 칸만 채운 객체는 미답변', () => {
    const cells = { q1: ['sido', 'sigungu'] };
    expect(allQuotaQuestionsAnswered(['q1'], { q1: { name: '메가' } }, cells)).toBe(false);
    expect(allQuotaQuestionsAnswered(['q1'], { q1: { sido: ' ', sigungu: '' } }, cells)).toBe(false);
    expect(allQuotaQuestionsAnswered(['q1'], { q1: { sigungu: '성남시' } }, cells)).toBe(true);
  });
});

describe('shouldCheckQuota', () => {
  it('게이트가 없으면 발동하지 않는다', () => {
    expect(shouldCheckQuota(null, { q1: 'a' })).toBe(false);
  });
  it('문항 없는 플랜(속성형만)은 답과 무관하게 발동한다', () => {
    expect(shouldCheckQuota({ questionIds: [], checkWithoutQuestions: true }, {})).toBe(true);
  });
  it('문항 게이트는 전부 답변돼야 발동한다', () => {
    const gate = { questionIds: ['q1'], cellIdsByQuestion: { q1: ['sido'] } };
    expect(shouldCheckQuota(gate, { q1: { other: 'x' } })).toBe(false);
    expect(shouldCheckQuota(gate, { q1: { sido: '경기' } })).toBe(true);
  });
});

describe('isQuotaTargetFilled — 필수 검증에 얹는 대상 칸 조건', () => {
  const gate = { questionIds: ['q1'], cellIdsByQuestion: { q1: ['sido', 'sigungu'] } };

  it('다른 칸만 채운 표는 미충족 — 이 상태로 넘어가면 쿼터 확인 없이 미분류로 완료된다', () => {
    expect(isQuotaTargetFilled(gate, 'q1', { name: '메가리서치' })).toBe(false);
    expect(isQuotaTargetFilled(gate, 'q1', undefined)).toBe(false);
  });
  it('대상 칸 중 하나라도 값이 있으면 충족 — 발동 조건(shouldCheckQuota)과 같은 판정', () => {
    const answer = { name: '메가리서치', sigungu: '성남시' };
    expect(isQuotaTargetFilled(gate, 'q1', answer)).toBe(true);
    expect(shouldCheckQuota(gate, { q1: answer })).toBe(true);
  });
  it('대상 칸이 등재되지 않은 문항·게이트 없음은 관여하지 않는다', () => {
    expect(isQuotaTargetFilled(gate, 'q2', {})).toBe(true);
    expect(isQuotaTargetFilled({ questionIds: ['q1'] }, 'q1', {})).toBe(true);
    expect(isQuotaTargetFilled(null, 'q1', {})).toBe(true);
  });
});
