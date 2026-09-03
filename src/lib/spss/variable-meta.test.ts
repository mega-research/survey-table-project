import { describe, expect, it } from 'vitest';
import { VariableMeasure, VariableType } from 'sav-writer';

import type { SPSSExportColumn } from '@/lib/analytics/spss-excel-export';
import { buildLabel, resolveMeasure, resolveVarType } from '@/lib/spss/variable-meta';
import type { Question } from '@/types/survey';

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

describe('resolveVarType 폴백 체인', () => {
  it('셀 오버라이드가 최우선이다', () => {
    const col = makeCol({ type: 'table-cell', cellSpssVarType: 'String' });
    expect(resolveVarType(col, makeQuestion({ spssVarType: 'Numeric' }))).toBe(VariableType.String);
  });

  it('질문 오버라이드가 2순위다', () => {
    expect(resolveVarType(makeCol({}), makeQuestion({ spssVarType: 'Date' }))).toBe(VariableType.Date);
  });

  it('single은 Numeric으로 폴백한다', () => {
    expect(resolveVarType(makeCol({}), makeQuestion({}))).toBe(VariableType.Numeric);
  });

  it('숫자 단답형 text 컬럼은 Numeric이다', () => {
    const col = makeCol({ type: 'text', numericText: true });
    expect(resolveVarType(col, makeQuestion({ type: 'text' }))).toBe(VariableType.Numeric);
  });
});

describe('resolveMeasure 폴백 체인', () => {
  // radio-group은 sav-builder 구현상 Ordinal이므로 이 묶음에서 제외한다.
  // radio-group (Likert 등 매트릭스 단일선택)은 순서척도가 분석 기본값
  it('categorical 컬럼 기본은 Nominal이다 — Scale로 새면 CTABLES가 카테고리를 안 그린다', () => {
    for (const type of ['single', 'checkbox-item', 'table-cell'] as const) {
      expect(resolveMeasure(makeCol({ type }), makeQuestion({}))).toBe(VariableMeasure.Nominal);
    }
  });

  it('radio-group 기본은 Ordinal이다 — Likert 매트릭스 단일선택', () => {
    expect(resolveMeasure(makeCol({ type: 'radio-group' }), makeQuestion({}))).toBe(VariableMeasure.Ordinal);
  });

  it('순위 컬럼은 Ordinal이다', () => {
    expect(resolveMeasure(makeCol({ type: 'ranking-rank' }), makeQuestion({ type: 'ranking' })))
      .toBe(VariableMeasure.Ordinal);
  });

  it('셀 spssMeasure 오버라이드가 최우선이다', () => {
    const col = makeCol({ type: 'table-cell', cellSpssMeasure: 'Ordinal' });
    expect(resolveMeasure(col, makeQuestion({}))).toBe(VariableMeasure.Ordinal);
  });

  it('질문 spssMeasure 오버라이드가 2순위다', () => {
    const col = makeCol({ type: 'single' });
    expect(resolveMeasure(col, makeQuestion({ spssMeasure: 'Continuous' }))).toBe(VariableMeasure.Continuous);
  });

  it('numericText text 컬럼은 Continuous이다', () => {
    const col = makeCol({ type: 'text', numericText: true });
    expect(resolveMeasure(col, makeQuestion({ type: 'text' }))).toBe(VariableMeasure.Continuous);
  });
});

describe('buildLabel 폴백', () => {
  it('checkbox-item은 질문 제목과 옵션 라벨을 합친다', () => {
    const col = makeCol({ type: 'checkbox-item', optionLabel: '보기A' });
    expect(buildLabel(col)).toBe('질문 제목 - 보기A');
  });

  it('기본값은 질문 제목이다', () => {
    expect(buildLabel(makeCol({ type: 'text' }))).toBe('질문 제목');
  });
});
