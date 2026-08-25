import { describe, expect, it } from 'vitest';

import { answersToQuestionResponses } from '@/lib/analytics/response-adapter';

/**
 * Phase 3: 응답 어댑터 테스트
 *
 * response_answers → 기존 questionResponses 형식 변환 검증
 */

describe('answersToQuestionResponses', () => {
  it('textValue가 있는 행은 string으로 변환', () => {
    const answers = [
      { questionId: 'q-1', textValue: '홍길동', arrayValue: null, objectValue: null, questionType: 'text' },
      { questionId: 'q-2', textValue: 'option-1', arrayValue: null, objectValue: null, questionType: 'radio' },
    ];

    const result = answersToQuestionResponses(answers);

    expect(result['q-1']).toBe('홍길동');
    expect(result['q-2']).toBe('option-1');
  });

  it('arrayValue가 있는 행은 string[]로 변환', () => {
    const answers = [
      { questionId: 'q-cb', textValue: null, arrayValue: ['a', 'b', 'c'], objectValue: null, questionType: 'checkbox' },
    ];

    const result = answersToQuestionResponses(answers);

    expect(result['q-cb']).toEqual(['a', 'b', 'c']);
  });

  it('objectValue가 있는 행은 Record로 변환', () => {
    const answers = [
      {
        questionId: 'q-table',
        textValue: null,
        arrayValue: null,
        objectValue: { 'cell-1': 'val1', 'cell-2': ['opt1', 'opt2'] },
        questionType: 'table',
      },
    ];

    const result = answersToQuestionResponses(answers);

    expect(result['q-table']).toEqual({ 'cell-1': 'val1', 'cell-2': ['opt1', 'opt2'] });
  });

  it('기타(other) 응답 객체도 objectValue로 변환', () => {
    const answers = [
      {
        questionId: 'q-radio',
        textValue: null,
        arrayValue: null,
        objectValue: { hasOther: true, selectedValue: '기타', otherValue: '직접입력' },
        questionType: 'radio',
      },
    ];

    const result = answersToQuestionResponses(answers);

    expect(result['q-radio']).toEqual({
      hasOther: true,
      selectedValue: '기타',
      otherValue: '직접입력',
    });
  });

  it('모든 값이 null인 행은 건너뜀', () => {
    const answers = [
      { questionId: 'q-empty', textValue: null, arrayValue: null, objectValue: null, questionType: 'text' },
      { questionId: 'q-valid', textValue: '응답', arrayValue: null, objectValue: null, questionType: 'text' },
    ];

    const result = answersToQuestionResponses(answers);

    expect(result).not.toHaveProperty('q-empty');
    expect(result['q-valid']).toBe('응답');
  });

  it('빈 배열은 빈 객체 반환', () => {
    const result = answersToQuestionResponses([]);
    expect(result).toEqual({});
  });

  it('여러 타입 혼합 시 올바르게 변환', () => {
    const answers = [
      { questionId: 'q-text', textValue: '이름', arrayValue: null, objectValue: null, questionType: 'text' },
      { questionId: 'q-cb', textValue: null, arrayValue: ['a', 'b'], objectValue: null, questionType: 'checkbox' },
      { questionId: 'q-table', textValue: null, arrayValue: null, objectValue: { cell1: 'v1' }, questionType: 'table' },
      { questionId: 'q-ms', textValue: null, arrayValue: null, objectValue: { level1: 'seoul' }, questionType: 'multiselect' },
    ];

    const result = answersToQuestionResponses(answers);

    expect(Object.keys(result)).toHaveLength(4);
    expect(result['q-text']).toBe('이름');
    expect(result['q-cb']).toEqual(['a', 'b']);
    expect(result['q-table']).toEqual({ cell1: 'v1' });
    expect(result['q-ms']).toEqual({ level1: 'seoul' });
  });

  it('normalizeToAnswers → answersToQuestionResponses 왕복 변환 일관성', async () => {
    const { normalizeToAnswers } = await import('@/server/survey-response/services/response-normalizer');

    const originalResponses: Record<string, unknown> = {
      'q-text': '홍길동',
      'q-checkbox': ['val-1', 'val-2'],
      'q-table': { 'cell-1': 'value1' },
      'q-radio': 'option-1',
    };

    const questions = [
      { id: 'q-text', type: 'text' },
      { id: 'q-checkbox', type: 'checkbox' },
      { id: 'q-table', type: 'table' },
      { id: 'q-radio', type: 'radio' },
    ];

    const normalized = normalizeToAnswers('resp-001', originalResponses, questions);
    const restored = answersToQuestionResponses(normalized);

    expect(restored).toEqual(originalResponses);
  });
});
