import { describe, expect, it } from 'vitest';

import type { Question } from '@/types/survey';

import { collectNumericIssues } from './numeric-validation';

function q(type: 'text' | 'textarea', overrides: Partial<Question> = {}): Question {
  return { id: 'q1', type, title: '의견', required: false, order: 0, ...overrides } as Question;
}

describe('collectNumericIssues — 응답 품질 검사', () => {
  it('최소 글자 수 미달이면 text-quality 이슈가 난다 — 단답형·장문형 모두', () => {
    for (const type of ['text', 'textarea'] as const) {
      const issues = collectNumericIssues(q(type, { textValidation: { minLength: 10 } }), '짧다');
      expect(issues).toHaveLength(1);
      expect(issues[0]?.kind).toBe('text-quality');
      expect(issues[0]?.message).toBe('10자 이상 입력해 주세요. (현재 2자, 공백 제외)');
    }
  });

  it('의미 없는 입력 거부가 켜지면 ㅋㅋㅋ·숫자만인 값을 막고 내용이 있으면 통과한다', () => {
    const question = q('textarea', { textValidation: { rejectMeaningless: true } });
    expect(collectNumericIssues(question, 'ㅋㅋㅋ')[0]?.kind).toBe('text-quality');
    expect(collectNumericIssues(question, '123124')[0]?.kind).toBe('text-quality');
    expect(collectNumericIssues(question, '특별한 의견 없음')).toEqual([]);
  });

  it('설정이 없거나 빈 값이면 막지 않는다 — 미입력 차단은 필수 판정 소관', () => {
    expect(collectNumericIssues(q('textarea'), 'ㅋㅋㅋ')).toEqual([]);
    expect(collectNumericIssues(q('textarea', { textValidation: { minLength: 10 } }), '')).toEqual([]);
    expect(collectNumericIssues(q('textarea', { textValidation: { minLength: 10 } }), undefined)).toEqual([]);
  });

  it('숫자 모드·입력 형식 단답형은 품질 검사를 타지 않는다 — 배타', () => {
    const numeric = q('text', { inputType: 'number', textValidation: { minLength: 10 } });
    expect(collectNumericIssues(numeric, '5')).toEqual([]);
    const mobile = q('text', { inputType: 'mobile', textValidation: { minLength: 20 } });
    expect(collectNumericIssues(mobile, '010-1234-5678')).toEqual([]);
  });

  it('토큰 prefill 단답형은 대상이 아니다 — 응답자가 못 고치는 칸', () => {
    const prefilled = q('text', {
      defaultValueTemplate: '{{company}}',
      textValidation: { minLength: 10 },
    });
    expect(collectNumericIssues(prefilled, '메가')).toEqual([]);
  });
});
