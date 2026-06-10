import { describe, expect, it } from 'vitest';

import type { Question } from '@/types/survey';

import {
  validateSpssVarName,
  validateNoDuplicates,
  validateNoSubVarConflicts,
} from '@/lib/spss/variable-validator';

// 테스트 헬퍼
function makeQuestion(
  overrides: Partial<Question> & { type: Question['type']; order: number },
): Question {
  return {
    id: `q-${overrides.order}`,
    title: `문제${overrides.order}`,
    required: false,
    ...overrides,
  } as Question;
}

describe('validateSpssVarName', () => {
  it('유효한 변수명을 통과시킨다', () => {
    expect(validateSpssVarName('Q1')).toEqual({ valid: true, errors: [] });
    expect(validateSpssVarName('Q1_U1_R0_C0')).toEqual({ valid: true, errors: [] });
    expect(validateSpssVarName('SQ_GENDER')).toEqual({ valid: true, errors: [] });
    expect(validateSpssVarName('abc123')).toEqual({ valid: true, errors: [] });
  });

  it('영문자로 시작하지 않으면 실패한다', () => {
    const result = validateSpssVarName('1Q');
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: 'INVALID_START_CHAR' }),
    );
  });

  it('숫자로 시작하면 실패한다', () => {
    const result = validateSpssVarName('123');
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: 'INVALID_START_CHAR' }),
    );
  });

  it('허용되지 않는 특수문자가 포함되면 실패한다', () => {
    const result = validateSpssVarName('Q1@2');
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: 'INVALID_CHARS' }),
    );
  });

  it('공백이 포함되면 실패한다', () => {
    const result = validateSpssVarName('Q 1');
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: 'INVALID_CHARS' }),
    );
  });

  it('64자를 초과하면 실패한다', () => {
    const longName = 'Q' + 'a'.repeat(64);
    const result = validateSpssVarName(longName);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: 'TOO_LONG' }),
    );
  });

  it('64자 이하는 통과한다', () => {
    const maxName = 'Q' + 'a'.repeat(63);
    expect(maxName.length).toBe(64);
    const result = validateSpssVarName(maxName);
    expect(result.valid).toBe(true);
  });

  it('빈 문자열은 실패한다', () => {
    const result = validateSpssVarName('');
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: 'EMPTY' }),
    );
  });

  it('SPSS 예약어를 거부한다', () => {
    const reserved = ['ALL', 'AND', 'BY', 'EQ', 'GE', 'GT', 'LE', 'LT', 'NE', 'NOT', 'OR', 'TO', 'WITH'];
    for (const word of reserved) {
      const result = validateSpssVarName(word);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'RESERVED_WORD' }),
      );
    }
  });

  it('예약어를 대소문자 구분 없이 거부한다', () => {
    const result = validateSpssVarName('and');
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: 'RESERVED_WORD' }),
    );
  });

  it('예약어를 포함하는 변수명은 허용한다', () => {
    // "AND"는 예약어지만, "ANDROID"는 허용
    expect(validateSpssVarName('ANDROID').valid).toBe(true);
    expect(validateSpssVarName('TOTAL').valid).toBe(true);
    expect(validateSpssVarName('NOTIFY').valid).toBe(true);
  });

  it('밑줄은 허용하고 대시는 거부한다', () => {
    expect(validateSpssVarName('Q1_SUB')).toEqual({ valid: true, errors: [] });
    const result = validateSpssVarName('Q1-4');
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: 'INVALID_CHARS' }),
    );
  });

  it('여러 오류를 동시에 반환한다', () => {
    // 숫자 시작 + 특수문자
    const result = validateSpssVarName('1Q@');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe('validateNoDuplicates', () => {
  it('중복 없는 변수명을 통과시킨다', () => {
    const questions = [
      makeQuestion({ type: 'radio', order: 1, questionCode: 'Q1' }),
      makeQuestion({ type: 'radio', order: 2, questionCode: 'Q2' }),
      makeQuestion({ type: 'text', order: 3, questionCode: 'Q3' }),
    ];
    const errors = validateNoDuplicates(questions);
    expect(errors).toHaveLength(0);
  });

  it('중복 변수명을 검출한다', () => {
    const questions = [
      makeQuestion({ type: 'radio', order: 1, questionCode: 'Q1' }),
      makeQuestion({ type: 'radio', order: 2, questionCode: 'Q1' }),
    ];
    const errors = validateNoDuplicates(questions);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors).toContainEqual(
      expect.objectContaining({ code: 'DUPLICATE' }),
    );
  });

  it('대소문자를 구분하지 않고 중복을 검출한다', () => {
    const questions = [
      makeQuestion({ type: 'radio', order: 1, questionCode: 'Q1' }),
      makeQuestion({ type: 'radio', order: 2, questionCode: 'q1' }),
    ];
    const errors = validateNoDuplicates(questions);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors).toContainEqual(
      expect.objectContaining({ code: 'DUPLICATE' }),
    );
  });

  it('questionCode가 없는 질문은 무시한다', () => {
    const questions = [
      makeQuestion({ type: 'notice', order: 1 }),
      makeQuestion({ type: 'radio', order: 2, questionCode: 'Q1' }),
    ];
    const errors = validateNoDuplicates(questions);
    expect(errors).toHaveLength(0);
  });
});

describe('validateNoSubVarConflicts', () => {
  it('충돌 없는 변수명을 통과시킨다', () => {
    const questions = [
      makeQuestion({ type: 'radio', order: 1, questionCode: 'Q1' }),
      makeQuestion({ type: 'radio', order: 2, questionCode: 'Q3' }),
    ];
    const errors = validateNoSubVarConflicts(questions);
    expect(errors).toHaveLength(0);
  });

  it('checkbox 하위 변수명과 다른 질문 변수명의 충돌을 검출한다', () => {
    // Q2는 checkbox이므로 Q2_1, Q2_2... 하위 변수를 생성
    // 다른 질문이 Q2_1을 변수명으로 사용하면 충돌
    const questions = [
      makeQuestion({
        type: 'checkbox',
        order: 1,
        questionCode: 'Q2',
        options: [
          { id: 'o1', label: '옵션1', value: 'o1' },
          { id: 'o2', label: '옵션2', value: 'o2' },
        ],
      }),
      makeQuestion({
        type: 'radio',
        order: 2,
        questionCode: 'Q2_1',
        isCustomSpssVarName: true,
      }),
    ];
    const errors = validateNoSubVarConflicts(questions);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors).toContainEqual(
      expect.objectContaining({ code: 'SUB_VAR_CONFLICT' }),
    );
  });

  it('checkbox가 아닌 질문은 하위 변수 충돌 검사를 하지 않는다', () => {
    const questions = [
      makeQuestion({ type: 'radio', order: 1, questionCode: 'Q1' }),
      makeQuestion({ type: 'radio', order: 2, questionCode: 'Q1_1', isCustomSpssVarName: true }),
    ];
    const errors = validateNoSubVarConflicts(questions);
    expect(errors).toHaveLength(0);
  });
});
