import { describe, expect, it } from 'vitest';

import type { Question, QuestionOption } from '@/types/survey';

import {
  transformSingleChoice,
  transformCheckbox,
  transformText,
  transformNumericText,
  transformMultiselect,
  transformOtherOption,
  transformTableChoiceCell,
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

describe('transformTableChoiceCell', () => {
  // Q11(설문 25393c08%) 표 radio 셀의 실제 옵션 구조를 그대로 옮긴 fixture.
  // 실제 응답은 { optionId } 객체로 저장된다 (fake-data-generator / branch-logic 참조).
  const options: QuestionOption[] = [
    makeOption({ id: 'd4646482-e25d-4b1a-94ed-3e0829e9f8c5', label: '① 그렇다', value: 'option-1', spssNumericCode: 1 }),
    makeOption({ id: '2fa36b1e-a652-4fdf-a140-6ba285bfe887', label: '② 아니다', value: 'option-2', spssNumericCode: 2 }),
    makeOption({ id: '136c7b7c-91e6-469c-aaa4-67afeed3cfb2', label: '③ 모르겠다', value: 'option-3', spssNumericCode: 3 }),
  ];

  it('radio 셀의 { optionId } 객체 응답을 옵션 숫자코드로 변환한다', () => {
    // 실데이터 형태: {"optionId":"2fa36b1e-..."} → spssNumericCode 2
    expect(transformTableChoiceCell('radio', { optionId: '2fa36b1e-a652-4fdf-a140-6ba285bfe887' }, options)).toBe(2);
    expect(transformTableChoiceCell('radio', { optionId: 'd4646482-e25d-4b1a-94ed-3e0829e9f8c5' }, options)).toBe(1);
    expect(transformTableChoiceCell('radio', { optionId: '136c7b7c-91e6-469c-aaa4-67afeed3cfb2' }, options)).toBe(3);
  });

  it('select 셀의 { optionId } 객체 응답도 숫자코드로 변환한다', () => {
    expect(transformTableChoiceCell('select', { optionId: '2fa36b1e-a652-4fdf-a140-6ba285bfe887' }, options)).toBe(2);
  });

  it('bare 문자열(optionId) 응답도 계속 변환한다 (회귀 방지)', () => {
    expect(transformTableChoiceCell('radio', '136c7b7c-91e6-469c-aaa4-67afeed3cfb2', options)).toBe(3);
    expect(transformTableChoiceCell('radio', 'option-3', options)).toBe(3);
  });

  it('옵션 목록에 없는 optionId 는 null(system-missing)', () => {
    expect(transformTableChoiceCell('radio', { optionId: 'unknown-id' }, options)).toBeNull();
  });

  it('미응답(null/undefined)은 null', () => {
    expect(transformTableChoiceCell('radio', null, options)).toBeNull();
    expect(transformTableChoiceCell('radio', undefined, options)).toBeNull();
  });

  it('옵션이 없으면(자유 입력 등) input 폴백 동작', () => {
    expect(transformTableChoiceCell('input', '텍스트', undefined)).toBe('텍스트');
  });
});

