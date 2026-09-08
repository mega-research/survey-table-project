import { describe, expect, it } from 'vitest';

import type { Question } from '@/types/survey';

import { collectNumericIssues } from './numeric-validation';

function textQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    type: 'text',
    title: '연락처',
    required: false,
    order: 0,
    ...overrides,
  } as Question;
}

describe('collectNumericIssues — 입력 형식', () => {
  it('형식이 맞으면 이슈가 없다', () => {
    const q = textQuestion({ inputType: 'mobile' });
    expect(collectNumericIssues(q, '010-1234-5678')).toEqual([]);
    expect(collectNumericIssues(q, '01012345678')).toEqual([]);
  });

  it('형식이 틀리면 kind format 이슈가 나오고 사유별 문구가 실린다', () => {
    const issues = collectNumericIssues(textQuestion({ inputType: 'mobile' }), '02-1234-5678');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.kind).toBe('format');
    expect(issues[0]?.message).toBe('휴대전화 번호가 아닙니다');

    const bizIssues = collectNumericIssues(
      textQuestion({ inputType: 'biz_number' }),
      '111-11-11111',
    );
    expect(bizIssues[0]?.message).toBe('사업자번호 확인번호가 맞지 않습니다. 다시 확인해 주세요');
  });

  it('빈 값은 형식 검사 대상이 아니다 — 미입력 차단은 필수 판정 소관', () => {
    const q = textQuestion({ inputType: 'email', required: true });
    expect(collectNumericIssues(q, '')).toEqual([]);
    expect(collectNumericIssues(q, '   ')).toEqual([]);
    expect(collectNumericIssues(q, undefined)).toEqual([]);
  });

  it('형식을 지정하지 않은 단답형은 어떤 값도 막지 않는다', () => {
    expect(collectNumericIssues(textQuestion(), '아무 말')).toEqual([]);
    expect(collectNumericIssues(textQuestion({ inputType: 'text' }), '010-1')).toEqual([]);
  });

  it('숫자 모드는 형식 검사를 타지 않는다 — 범위 검증 그대로', () => {
    const q = textQuestion({ inputType: 'number', numberFormat: { min: 10 } });
    expect(collectNumericIssues(q, '5')[0]?.kind).toBe('range');
    expect(collectNumericIssues(q, '50')).toEqual([]);
  });
});
