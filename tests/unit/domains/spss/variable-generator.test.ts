import { describe, expect, it } from 'vitest';

import type { Question } from '@/types/survey';

import {
  generateSpssVarNames,
  regenerateAfterReorder,
  regenerateAfterDelete,
} from '@/lib/spss/variable-generator';

// 테스트 헬퍼: 최소 Question 객체 생성
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

describe('generateSpssVarNames', () => {
  it('radio 질문에 Q{순번} 변수명을 생성한다', () => {
    const questions: Question[] = [
      makeQuestion({ type: 'radio', order: 1 }),
      makeQuestion({ type: 'radio', order: 2 }),
    ];

    const result = generateSpssVarNames(questions);

    const r0 = result[0];
    const r1 = result[1];
    if (!r0) throw new Error('result[0] undefined');
    if (!r1) throw new Error('result[1] undefined');
    expect(r0.questionCode).toBe('Q1');
    expect(r1.questionCode).toBe('Q2');
  });

  it('select 질문에 Q{순번} 변수명을 생성한다', () => {
    const questions: Question[] = [
      makeQuestion({ type: 'select', order: 1 }),
    ];

    const result = generateSpssVarNames(questions);
    const r0 = result[0];
    if (!r0) throw new Error('result[0] undefined');
    expect(r0.questionCode).toBe('Q1');
  });

  it('text/textarea 질문에 Q{순번} 변수명을 생성한다', () => {
    const questions: Question[] = [
      makeQuestion({ type: 'text', order: 1 }),
      makeQuestion({ type: 'textarea', order: 2 }),
    ];

    const result = generateSpssVarNames(questions);
    const r0 = result[0];
    const r1 = result[1];
    if (!r0) throw new Error('result[0] undefined');
    if (!r1) throw new Error('result[1] undefined');
    expect(r0.questionCode).toBe('Q1');
    expect(r1.questionCode).toBe('Q2');
  });

  it('multiselect 질문에 Q{순번} 변수명을 생성한다', () => {
    const questions: Question[] = [
      makeQuestion({ type: 'multiselect', order: 1 }),
    ];

    const result = generateSpssVarNames(questions);
    const r0 = result[0];
    if (!r0) throw new Error('result[0] undefined');
    expect(r0.questionCode).toBe('Q1');
  });

  it('notice 타입은 순번에서 제외한다', () => {
    const questions: Question[] = [
      makeQuestion({ type: 'radio', order: 1 }),
      makeQuestion({ type: 'notice', order: 2 }),
      makeQuestion({ type: 'radio', order: 3 }),
    ];

    const result = generateSpssVarNames(questions);

    const r0 = result[0];
    const r1 = result[1];
    const r2 = result[2];
    if (!r0) throw new Error('result[0] undefined');
    if (!r1) throw new Error('result[1] undefined');
    if (!r2) throw new Error('result[2] undefined');
    // notice는 변수명 없음
    expect(r0.questionCode).toBe('Q1');
    expect(r1.questionCode).toBeUndefined();
    expect(r2.questionCode).toBe('Q2'); // notice 건너뛰고 Q2
  });

  it('isCustomSpssVarName이 true인 질문은 기존 변수명을 보존한다', () => {
    const questions: Question[] = [
      makeQuestion({
        type: 'radio',
        order: 1,
        questionCode: 'Q1_CUSTOM',
        isCustomSpssVarName: true,
      }),
      makeQuestion({ type: 'radio', order: 2 }),
    ];

    const result = generateSpssVarNames(questions);

    const r0 = result[0];
    const r1 = result[1];
    if (!r0) throw new Error('result[0] undefined');
    if (!r1) throw new Error('result[1] undefined');
    expect(r0.questionCode).toBe('Q1_CUSTOM'); // 보존
    expect(r1.questionCode).toBe('Q1'); // 자동 (커스텀이 Q1_CUSTOM이므로 Q1 사용 가능)
  });

  it('대문자로 변수명을 생성한다', () => {
    const questions: Question[] = [
      makeQuestion({ type: 'radio', order: 1 }),
    ];

    const result = generateSpssVarNames(questions);
    const r0 = result[0];
    if (!r0) throw new Error('result[0] undefined');
    expect(r0.questionCode).toBe('Q1');
    expect(r0.questionCode).toMatch(/^[A-Z]/);
  });

  it('order 순서대로 정렬 후 순번을 부여한다', () => {
    const questions: Question[] = [
      makeQuestion({ type: 'radio', order: 3 }),
      makeQuestion({ type: 'text', order: 1 }),
      makeQuestion({ type: 'checkbox', order: 2 }),
    ];

    const result = generateSpssVarNames(questions);

    // order 1 → Q1, order 2 → Q2, order 3 → Q3
    const sorted = [...result].sort((a, b) => a.order - b.order);
    const s0 = sorted[0];
    const s1 = sorted[1];
    const s2 = sorted[2];
    if (!s0) throw new Error('sorted[0] undefined');
    if (!s1) throw new Error('sorted[1] undefined');
    if (!s2) throw new Error('sorted[2] undefined');
    expect(s0.questionCode).toBe('Q1');
    expect(s1.questionCode).toBe('Q2');
    expect(s2.questionCode).toBe('Q3');
  });
});

describe('regenerateAfterReorder', () => {
  it('순서 변경 후 자동 변수명을 재할당한다', () => {
    const questions: Question[] = [
      makeQuestion({ type: 'radio', order: 1, questionCode: 'Q1' }),
      makeQuestion({ type: 'text', order: 2, questionCode: 'Q2' }),
      makeQuestion({ type: 'radio', order: 3, questionCode: 'Q3' }),
    ];

    const q0 = questions[0];
    const q1 = questions[1];
    const q2 = questions[2];
    if (!q0) throw new Error('questions[0] undefined');
    if (!q1) throw new Error('questions[1] undefined');
    if (!q2) throw new Error('questions[2] undefined');

    // Q3이 1번으로 이동
    const reordered: Question[] = [
      { ...q2, order: 1 },
      { ...q0, order: 2 },
      { ...q1, order: 3 },
    ];

    const result = regenerateAfterReorder(reordered);
    const sorted = [...result].sort((a, b) => a.order - b.order);

    const s0 = sorted[0];
    const s1 = sorted[1];
    const s2 = sorted[2];
    if (!s0) throw new Error('sorted[0] undefined');
    if (!s1) throw new Error('sorted[1] undefined');
    if (!s2) throw new Error('sorted[2] undefined');
    expect(s0.questionCode).toBe('Q1');
    expect(s1.questionCode).toBe('Q2');
    expect(s2.questionCode).toBe('Q3');
  });

  it('수동 편집 변수명은 재할당하지 않는다', () => {
    const questions: Question[] = [
      makeQuestion({
        type: 'radio',
        order: 1,
        questionCode: 'SQ_GENDER',
        isCustomSpssVarName: true,
      }),
      makeQuestion({ type: 'text', order: 2, questionCode: 'Q2' }),
      makeQuestion({ type: 'radio', order: 3, questionCode: 'Q3' }),
    ];

    const result = regenerateAfterReorder(questions);
    const sorted = [...result].sort((a, b) => a.order - b.order);

    const s0 = sorted[0];
    const s1 = sorted[1];
    const s2 = sorted[2];
    if (!s0) throw new Error('sorted[0] undefined');
    if (!s1) throw new Error('sorted[1] undefined');
    if (!s2) throw new Error('sorted[2] undefined');
    expect(s0.questionCode).toBe('SQ_GENDER'); // 보존
    expect(s0.isCustomSpssVarName).toBe(true);
    expect(s1.questionCode).toBe('Q1'); // 자동 재할당
    expect(s2.questionCode).toBe('Q2'); // 자동 재할당
  });
});

describe('regenerateAfterDelete', () => {
  it('삭제 후 빈 번호 없이 연속 순번을 재할당한다', () => {
    const questions: Question[] = [
      makeQuestion({ type: 'radio', order: 1, questionCode: 'Q1' }),
      // Q2 삭제됨
      makeQuestion({ type: 'text', order: 3, questionCode: 'Q3' }),
      makeQuestion({ type: 'radio', order: 4, questionCode: 'Q4' }),
    ];

    const result = regenerateAfterDelete(questions);
    const sorted = [...result].sort((a, b) => a.order - b.order);

    const s0 = sorted[0];
    const s1 = sorted[1];
    const s2 = sorted[2];
    if (!s0) throw new Error('sorted[0] undefined');
    if (!s1) throw new Error('sorted[1] undefined');
    if (!s2) throw new Error('sorted[2] undefined');
    expect(s0.questionCode).toBe('Q1');
    expect(s1.questionCode).toBe('Q2'); // Q3→Q2
    expect(s2.questionCode).toBe('Q3'); // Q4→Q3
  });

  it('수동 편집 변수명은 삭제 후에도 보존한다', () => {
    const questions: Question[] = [
      makeQuestion({
        type: 'radio',
        order: 1,
        questionCode: 'CUSTOM_1',
        isCustomSpssVarName: true,
      }),
      makeQuestion({ type: 'text', order: 3, questionCode: 'Q3' }),
    ];

    const result = regenerateAfterDelete(questions);
    const sorted = [...result].sort((a, b) => a.order - b.order);

    const s0 = sorted[0];
    const s1 = sorted[1];
    if (!s0) throw new Error('sorted[0] undefined');
    if (!s1) throw new Error('sorted[1] undefined');
    expect(s0.questionCode).toBe('CUSTOM_1'); // 보존
    expect(s1.questionCode).toBe('Q1'); // 자동 재할당
  });
});
