import { describe, expect, it } from 'vitest';

import type { Question } from '@/types/survey';

import {
  generateVariableLabels,
  generateValueLabels,
  generateVariableLevel,
  generateMrsets,
  generateFullSyntax,
} from '@/lib/spss/spss-syntax-generator';

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

describe('generateVariableLabels', () => {
  it('단일선택 질문의 VARIABLE LABELS를 생성한다', () => {
    const questions = [
      makeQuestion({
        type: 'radio',
        order: 1,
        questionCode: 'Q1',
        title: '성별을 선택하세요',
      }),
    ];
    const result = generateVariableLabels(questions);
    expect(result).toContain("Q1 '성별을 선택하세요'");
    expect(result).toContain('VARIABLE LABELS');
  });

  it('복수선택 질문은 옵션별 하위 변수 라벨을 생성한다', () => {
    const questions = [
      makeQuestion({
        type: 'checkbox',
        order: 2,
        questionCode: 'Q2',
        title: '생산품목을 선택하세요',
        options: [
          { id: 'o1', label: '제제목', value: 'o1' },
          { id: 'o2', label: '합판', value: 'o2' },
        ],
      }),
    ];
    const result = generateVariableLabels(questions);
    expect(result).toContain("Q2_1 '생산품목을 선택하세요 - 1. 제제목'");
    expect(result).toContain("Q2_2 '생산품목을 선택하세요 - 2. 합판'");
  });

  it('notice 타입은 제외한다', () => {
    const questions = [
      makeQuestion({ type: 'notice', order: 1, questionCode: undefined, title: '안내문' }),
    ];
    const result = generateVariableLabels(questions);
    expect(result).not.toContain('안내문');
  });

  it('여러 질문의 라벨을 마침표로 끝낸다', () => {
    const questions = [
      makeQuestion({ type: 'radio', order: 1, questionCode: 'Q1', title: '질문1' }),
      makeQuestion({ type: 'text', order: 2, questionCode: 'Q2', title: '질문2' }),
    ];
    const result = generateVariableLabels(questions);
    expect(result.trim()).toMatch(/\.$/);
  });
});

describe('generateValueLabels', () => {
  it('단일선택 질문의 VALUE LABELS를 생성한다', () => {
    const questions = [
      makeQuestion({
        type: 'radio',
        order: 1,
        questionCode: 'Q1',
        options: [
          { id: 'o1', label: '남성', value: 'o1', spssNumericCode: 1 },
          { id: 'o2', label: '여성', value: 'o2', spssNumericCode: 2 },
        ],
      }),
    ];
    const result = generateValueLabels(questions);
    expect(result).toContain('VALUE LABELS');
    expect(result).toContain("Q1 1 '남성' 2 '여성'");
  });

  it('복수선택 질문은 각 하위 변수의 값 라벨을 생성한다', () => {
    const questions = [
      makeQuestion({
        type: 'checkbox',
        order: 2,
        questionCode: 'Q2',
        options: [
          { id: 'o1', label: '제제목', value: 'o1', spssNumericCode: 1 },
          { id: 'o2', label: '합판', value: 'o2', spssNumericCode: 2 },
        ],
      }),
    ];
    const result = generateValueLabels(questions);
    expect(result).toContain("Q2_1 1 '선택'");
    expect(result).toContain("Q2_2 2 '선택'");
  });

  it('텍스트 질문은 값 라벨이 없다', () => {
    const questions = [
      makeQuestion({ type: 'text', order: 1, questionCode: 'Q1' }),
    ];
    const result = generateValueLabels(questions);
    expect(result).not.toContain('Q1');
  });

  it('spssNumericCode가 없으면 1-based 인덱스를 사용한다', () => {
    const questions = [
      makeQuestion({
        type: 'radio',
        order: 1,
        questionCode: 'Q1',
        options: [
          { id: 'o1', label: 'A', value: 'o1' },
          { id: 'o2', label: 'B', value: 'o2' },
        ],
      }),
    ];
    const result = generateValueLabels(questions);
    expect(result).toContain("Q1 1 'A' 2 'B'");
  });
});

describe('generateVariableLevel', () => {
  it('단일선택/복수선택은 NOMINAL로 설정한다', () => {
    const questions = [
      makeQuestion({ type: 'radio', order: 1, questionCode: 'Q1' }),
      makeQuestion({
        type: 'checkbox',
        order: 2,
        questionCode: 'Q2',
        options: [
          { id: 'o1', label: 'A', value: 'o1' },
        ],
      }),
    ];
    const result = generateVariableLevel(questions);
    expect(result).toContain('VARIABLE LEVEL');
    expect(result).toContain('NOMINAL');
    expect(result).toContain('Q1');
    expect(result).toContain('Q2_1');
  });

  it('텍스트는 SCALE로 설정한다', () => {
    const questions = [
      makeQuestion({ type: 'text', order: 1, questionCode: 'Q1' }),
    ];
    const result = generateVariableLevel(questions);
    expect(result).toContain('SCALE');
    expect(result).toContain('Q1');
  });
});

describe('generateMrsets', () => {
  it('복수선택 질문의 MRSETS를 생성한다', () => {
    const questions = [
      makeQuestion({
        type: 'checkbox',
        order: 2,
        questionCode: 'Q2',
        title: '생산품목',
        options: [
          { id: 'o1', label: 'A', value: 'o1' },
          { id: 'o2', label: 'B', value: 'o2' },
          { id: 'o3', label: 'C', value: 'o3' },
        ],
      }),
    ];
    const result = generateMrsets(questions);
    expect(result).toContain('MRSETS');
    expect(result).toContain("$Q2 LABEL='생산품목'");
    expect(result).toContain('VARIABLES=Q2_1 Q2_2 Q2_3');
  });

  it('복수선택이 없으면 빈 문자열을 반환한다', () => {
    const questions = [
      makeQuestion({ type: 'radio', order: 1, questionCode: 'Q1' }),
    ];
    const result = generateMrsets(questions);
    expect(result).toBe('');
  });
});

describe('generateFullSyntax', () => {
  it('전체 SPSS 신택스를 생성한다', () => {
    const questions = [
      makeQuestion({
        type: 'radio',
        order: 1,
        questionCode: 'Q1',
        title: '성별',
        options: [
          { id: 'o1', label: '남성', value: 'o1', spssNumericCode: 1 },
          { id: 'o2', label: '여성', value: 'o2', spssNumericCode: 2 },
        ],
      }),
      makeQuestion({
        type: 'checkbox',
        order: 2,
        questionCode: 'Q2',
        title: '품목',
        options: [
          { id: 'o1', label: 'A', value: 'o1', spssNumericCode: 1 },
          { id: 'o2', label: 'B', value: 'o2', spssNumericCode: 2 },
        ],
      }),
    ];
    const result = generateFullSyntax(questions);
    expect(result).toContain('VARIABLE LABELS');
    expect(result).toContain('VALUE LABELS');
    expect(result).toContain('VARIABLE LEVEL');
    expect(result).toContain('MRSETS');
  });

  it('SPSS 주석을 포함한다', () => {
    const questions = [
      makeQuestion({ type: 'text', order: 1, questionCode: 'Q1', title: '이름' }),
    ];
    const result = generateFullSyntax(questions);
    expect(result).toContain('*');
  });
});
