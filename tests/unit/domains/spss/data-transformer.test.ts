import { describe, expect, it } from 'vitest';

import type { Question, QuestionOption } from '@/types/survey';

import {
  transformSingleChoice,
  transformCheckbox,
  transformText,
  transformNumericText,
  transformMultiselect,
  transformOtherOption,
} from '@/lib/spss/data-transformer';

// 옵션 헬퍼
function makeOption(overrides: Partial<QuestionOption> & { id: string; label: string; value: string }): QuestionOption {
  return { ...overrides };
}

// 질문 헬퍼
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

describe('transformSingleChoice', () => {
  const question = makeQuestion({
    type: 'radio',
    order: 1,
    questionCode: 'Q1',
    options: [
      makeOption({ id: 'o1', label: '남성', value: 'o1', spssNumericCode: 1 }),
      makeOption({ id: 'o2', label: '여성', value: 'o2', spssNumericCode: 2 }),
    ],
  });

  it('선택된 옵션의 숫자코드를 반환한다', () => {
    const result = transformSingleChoice(question, 'o1');
    expect(result).toBe(1);
  });

  it('두 번째 옵션 선택 시 해당 숫자코드를 반환한다', () => {
    const result = transformSingleChoice(question, 'o2');
    expect(result).toBe(2);
  });

  it('미응답(null/undefined)이면 null을 반환한다', () => {
    expect(transformSingleChoice(question, null)).toBeNull();
    expect(transformSingleChoice(question, undefined)).toBeNull();
  });

  it('존재하지 않는 옵션 값이면 null을 반환한다', () => {
    expect(transformSingleChoice(question, 'nonexistent')).toBeNull();
  });

  it('spssNumericCode가 없으면 1-based 인덱스를 사용한다', () => {
    const qNoCode = makeQuestion({
      type: 'radio',
      order: 1,
      questionCode: 'Q1',
      options: [
        makeOption({ id: 'o1', label: '남성', value: 'o1' }),
        makeOption({ id: 'o2', label: '여성', value: 'o2' }),
      ],
    });
    expect(transformSingleChoice(qNoCode, 'o2')).toBe(2);
  });
});

describe('transformCheckbox', () => {
  const question = makeQuestion({
    type: 'checkbox',
    order: 2,
    questionCode: 'Q2',
    options: [
      makeOption({ id: 'o1', label: '제제목', value: 'o1', spssNumericCode: 1 }),
      makeOption({ id: 'o2', label: '합판', value: 'o2', spssNumericCode: 2 }),
      makeOption({ id: 'o3', label: '섬유판', value: 'o3', spssNumericCode: 3 }),
      makeOption({ id: 'o4', label: '파티클보드', value: 'o4', spssNumericCode: 4 }),
    ],
  });

  it('선택된 옵션은 숫자코드, 미선택은 null로 분리한다', () => {
    const result = transformCheckbox(question, ['o1', 'o3', 'o4']);
    expect(result).toEqual([
      { varName: 'Q2_1', value: 1 },
      { varName: 'Q2_2', value: null },
      { varName: 'Q2_3', value: 3 },
      { varName: 'Q2_4', value: 4 },
    ]);
  });

  it('전체 미응답이면 모두 null을 반환한다', () => {
    const result = transformCheckbox(question, null);
    expect(result).toEqual([
      { varName: 'Q2_1', value: null },
      { varName: 'Q2_2', value: null },
      { varName: 'Q2_3', value: null },
      { varName: 'Q2_4', value: null },
    ]);
  });

  it('빈 배열이면 모두 null을 반환한다', () => {
    const result = transformCheckbox(question, []);
    expect(result).toEqual([
      { varName: 'Q2_1', value: null },
      { varName: 'Q2_2', value: null },
      { varName: 'Q2_3', value: null },
      { varName: 'Q2_4', value: null },
    ]);
  });

  it('spssNumericCode가 없으면 1-based 인덱스를 사용한다', () => {
    const qNoCode = makeQuestion({
      type: 'checkbox',
      order: 2,
      questionCode: 'Q2',
      options: [
        makeOption({ id: 'o1', label: 'A', value: 'o1' }),
        makeOption({ id: 'o2', label: 'B', value: 'o2' }),
      ],
    });
    const result = transformCheckbox(qNoCode, ['o2']);
    expect(result).toEqual([
      { varName: 'Q2_1', value: null },
      { varName: 'Q2_2', value: 2 },
    ]);
  });
});

describe('transformText', () => {
  it('텍스트 값을 그대로 반환한다', () => {
    expect(transformText('안녕하세요')).toBe('안녕하세요');
  });

  it('미응답이면 null을 반환한다', () => {
    expect(transformText(null)).toBeNull();
    expect(transformText(undefined)).toBeNull();
    expect(transformText('')).toBeNull();
  });
});

describe('transformMultiselect', () => {
  it('레벨별 선택값을 밑줄로 합산한다', () => {
    const result = transformMultiselect(['서울', '강남구', '역삼동']);
    expect(result).toBe('서울_강남구_역삼동');
  });

  it('단일 레벨이면 그대로 반환한다', () => {
    expect(transformMultiselect(['서울'])).toBe('서울');
  });

  it('미응답이면 null을 반환한다', () => {
    expect(transformMultiselect(null)).toBeNull();
    expect(transformMultiselect([])).toBeNull();
  });
});

describe('transformOtherOption', () => {
  it('기타 응답의 텍스트를 반환한다', () => {
    const result = transformOtherOption({ hasOther: true, otherValue: '직접 입력' });
    expect(result).toBe('직접 입력');
  });

  it('기타가 아니면 null을 반환한다', () => {
    expect(transformOtherOption({ hasOther: false })).toBeNull();
    expect(transformOtherOption(null)).toBeNull();
  });

  it('기타이지만 텍스트가 없으면 빈 문자열을 반환한다', () => {
    const result = transformOtherOption({ hasOther: true, otherValue: '' });
    expect(result).toBe('');
  });
});

describe('transformNumericText', () => {
  it('빈값/공백/비숫자는 null, 실제 0 은 0 으로 변환', () => {
    expect(transformNumericText('')).toBeNull();
    expect(transformNumericText('   ')).toBeNull();
    expect(transformNumericText('abc')).toBeNull();
    expect(transformNumericText(null)).toBeNull();
    expect(transformNumericText('0')).toBe(0);
    expect(transformNumericText('12.5')).toBe(12.5);
    expect(transformNumericText('-3')).toBe(-3);
  });
});

