import { describe, expect, it } from 'vitest';
import { VariableMeasure, VariableType } from 'sav-writer';

import type { SPSSExportColumn } from '@/lib/analytics/spss-excel-export';
import { toSavVariable } from '@/lib/spss/sav-builder';
import type { Question } from '@/types/survey';

// 회귀: 숫자 단답형(numericText) 변수는 Continuous 라 응답 1.5 가 float 레코드에
// 그대로 저장되지만, decimal:0(F8.0) 이면 SPSS 변수보기가 2 로 반올림 표시해 오해를 준다.
// numericText 만 소수 자릿수를 갖고, 나머지 정수 코드 변수는 decimal:0 을 유지해야 한다.

function makeCol(overrides: Partial<SPSSExportColumn>): SPSSExportColumn {
  return {
    spssVarName: 'Q1',
    questionText: '질문 제목',
    optionLabel: '',
    questionId: 'q1',
    type: 'single',
    ...overrides,
  };
}

function makeQuestion(overrides: Partial<Question>): Question {
  return {
    id: 'q1',
    type: 'radio',
    title: '질문 제목',
    required: false,
    order: 1,
    ...overrides,
  } as Question;
}

describe('toSavVariable decimal', () => {
  it('숫자 단답형(numericText) 변수는 소수 자릿수를 부여한다', () => {
    const col = makeCol({ type: 'text', numericText: true });
    const v = toSavVariable(col, makeQuestion({ type: 'text' }), 0, 'Q1');

    expect(v.type).toBe(VariableType.Numeric);
    expect(v.measure).toBe(VariableMeasure.Continuous);
    expect(v.decimal).toBeGreaterThan(0);
  });

  it('문자 단답형 text 변수는 decimal:0 을 유지한다', () => {
    const col = makeCol({ type: 'text', numericText: false });
    const v = toSavVariable(col, makeQuestion({ type: 'text' }), 16, 'Q1');

    expect(v.type).toBe(VariableType.String);
    expect(v.decimal).toBe(0);
  });

  it('정수 코드 변수(single/checkbox-item/ranking-rank)는 decimal:0 을 유지한다', () => {
    for (const type of ['single', 'checkbox-item', 'ranking-rank'] as const) {
      const v = toSavVariable(makeCol({ type }), makeQuestion({}), 0, 'Q1');
      expect(v.decimal).toBe(0);
    }
  });

  it('numericText decimal 은 정규화된 numeric width(8) 보다 작아 sav-writer 제약을 만족한다', () => {
    const col = makeCol({ type: 'text', numericText: true });
    const v = toSavVariable(col, makeQuestion({ type: 'text' }), 0, 'Q1');

    // sav-writer 는 numeric width 가 0 이면 8 로 정규화하고 width <= decimal 이면 throw 한다.
    const normalizedWidth = v.width || 8;
    expect(normalizedWidth).toBeGreaterThan(v.decimal);
  });
});
