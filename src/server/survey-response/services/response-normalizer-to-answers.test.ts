import { describe, expect, it } from 'vitest';

import { normalizeToAnswers } from './response-normalizer';

/**
 * Phase 1/2: 응답 정규화 유틸리티 테스트
 *
 * JSONB questionResponses → response_answers 행 변환 로직 검증
 */

const RESPONSE_ID = 'response-001';

// 테스트용 질문 목록 (최소 필드만)
const mockQuestions = [
  { id: 'q-text', type: 'text' as const },
  { id: 'q-textarea', type: 'textarea' as const },
  { id: 'q-radio', type: 'radio' as const },
  { id: 'q-select', type: 'select' as const },
  { id: 'q-checkbox', type: 'checkbox' as const },
  { id: 'q-table', type: 'table' as const },
  { id: 'q-multiselect', type: 'multiselect' as const },
  { id: 'q-notice', type: 'notice' as const },
];

describe('normalizeToAnswers', () => {
  it('문자열 응답은 textValue에 저장', () => {
    const responses = {
      'q-text': '안녕하세요',
      'q-radio': 'option-1',
    };

    const answers = normalizeToAnswers(RESPONSE_ID, responses, mockQuestions);

    const textAnswer = answers.find((a) => a.questionId === 'q-text');
    expect(textAnswer).toBeDefined();
    expect(textAnswer!.textValue).toBe('안녕하세요');
    expect(textAnswer!.arrayValue).toBeNull();
    expect(textAnswer!.objectValue).toBeNull();
    expect(textAnswer!.questionType).toBe('text');

    const radioAnswer = answers.find((a) => a.questionId === 'q-radio');
    expect(radioAnswer!.textValue).toBe('option-1');
    expect(radioAnswer!.questionType).toBe('radio');
  });

  it('배열 응답은 arrayValue에 저장', () => {
    const responses = {
      'q-checkbox': ['val-1', 'val-2', 'val-3'],
    };

    const answers = normalizeToAnswers(RESPONSE_ID, responses, mockQuestions);

    const answer = answers.find((a) => a.questionId === 'q-checkbox');
    expect(answer).toBeDefined();
    expect(answer!.textValue).toBeNull();
    expect(answer!.arrayValue).toEqual(['val-1', 'val-2', 'val-3']);
    expect(answer!.objectValue).toBeNull();
    expect(answer!.questionType).toBe('checkbox');
  });

  it('객체 응답은 objectValue에 저장 (테이블)', () => {
    const responses = {
      'q-table': {
        'cell-row1-col1': 'value1',
        'cell-row2-col1': ['opt1', 'opt2'],
      },
    };

    const answers = normalizeToAnswers(RESPONSE_ID, responses, mockQuestions);

    const answer = answers.find((a) => a.questionId === 'q-table');
    expect(answer).toBeDefined();
    expect(answer!.textValue).toBeNull();
    expect(answer!.arrayValue).toBeNull();
    expect(answer!.objectValue).toEqual({
      'cell-row1-col1': 'value1',
      'cell-row2-col1': ['opt1', 'opt2'],
    });
    expect(answer!.questionType).toBe('table');
  });

  it('기타(other) 응답 객체는 objectValue에 저장', () => {
    const responses = {
      'q-radio': { hasOther: true, selectedValue: '기타', otherValue: '직접입력' },
    };

    const answers = normalizeToAnswers(RESPONSE_ID, responses, mockQuestions);

    const answer = answers.find((a) => a.questionId === 'q-radio');
    expect(answer!.objectValue).toEqual({
      hasOther: true,
      selectedValue: '기타',
      otherValue: '직접입력',
    });
  });

  it('null/undefined 응답은 건너뜀', () => {
    const responses = {
      'q-text': null,
      'q-radio': undefined,
      'q-checkbox': ['val-1'],
    };

    const answers = normalizeToAnswers(
      RESPONSE_ID,
      responses as Record<string, unknown>,
      mockQuestions,
    );

    expect(answers).toHaveLength(1);
    const answer0 = answers[0];
    if (!answer0) throw new Error('answers[0] is undefined');
    expect(answer0.questionId).toBe('q-checkbox');
  });

  it('질문 목록에 없는 questionId는 건너뜀', () => {
    const responses = {
      'q-unknown': '이 질문은 존재하지 않음',
      'q-text': '유효한 응답',
    };

    const answers = normalizeToAnswers(RESPONSE_ID, responses, mockQuestions);

    expect(answers).toHaveLength(1);
    const answer0 = answers[0];
    if (!answer0) throw new Error('answers[0] is undefined');
    expect(answer0.questionId).toBe('q-text');
  });

  it('빈 응답 객체는 빈 배열 반환', () => {
    const answers = normalizeToAnswers(RESPONSE_ID, {}, mockQuestions);
    expect(answers).toEqual([]);
  });

  it('모든 answer에 responseId가 설정됨', () => {
    const responses = {
      'q-text': '응답1',
      'q-checkbox': ['a', 'b'],
      'q-table': { cell1: 'val' },
    };

    const answers = normalizeToAnswers(RESPONSE_ID, responses, mockQuestions);

    expect(answers).toHaveLength(3);
    answers.forEach((a) => {
      expect(a.responseId).toBe(RESPONSE_ID);
    });
  });

  it('multiselect 객체 응답은 objectValue에 저장', () => {
    const responses = {
      'q-multiselect': { level1: 'seoul', level2: 'gangnam' },
    };

    const answers = normalizeToAnswers(RESPONSE_ID, responses, mockQuestions);

    const answer = answers.find((a) => a.questionId === 'q-multiselect');
    expect(answer!.objectValue).toEqual({ level1: 'seoul', level2: 'gangnam' });
    expect(answer!.questionType).toBe('multiselect');
  });

  it('그룹별 선택 radio 응답(GroupedChoiceAnswer 맵)은 objectValue에 저장된다', () => {
    // grouped radio 응답은 Record<groupKey, cellId> — 일반 object 이므로 objectValue 경로
    const responses = {
      'q-radio': { rad1: 'cellA', rad2: 'cellC' },
    };

    const answers = normalizeToAnswers(RESPONSE_ID, responses, mockQuestions);

    const answer = answers.find((a) => a.questionId === 'q-radio');
    expect(answer).toBeDefined();
    expect(answer!.textValue).toBeNull();
    expect(answer!.arrayValue).toBeNull();
    expect(answer!.objectValue).toEqual({ rad1: 'cellA', rad2: 'cellC' });
    expect(answer!.questionType).toBe('radio');
  });
});
