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

// .sav 변수 라벨 = 「문항 제목 - 셀라벨」. 셀라벨은 Raw 2행·코딩북과 같은 값이다(columnCellLabel).
// 표 칸이 엑셀라벨 대신 행·열 제목이나 보기 목록을 이어 붙여, 같은 문항의 변수끼리 라벨이 겹쳤다(2026-10-30).
describe('buildLabel — 셀라벨과 같은 기준', () => {
  it('표 칸은 엑셀라벨을 쓴다 — 행·열 제목 조합이 같아도 변수끼리 구별된다', () => {
    const a = makeCol({ type: 'table-cell', tableCellType: 'input', optionLabel: '문1. 회사명 - ', cellExportLabel: '회사명' });
    const b = makeCol({ type: 'table-cell', tableCellType: 'input', optionLabel: '문1. 회사명 - ', cellExportLabel: '회사설립연도' });
    expect(buildLabel(a)).toBe('질문 제목 - 회사명');
    expect(buildLabel(b)).toBe('질문 제목 - 회사설립연도');
  });

  it('보기를 표로 그린 복수응답 보기도 엑셀라벨을 쓴다 — 「(라벨 없음)」 대신', () => {
    const col = makeCol({ type: 'checkbox-item', optionLabel: '(라벨 없음)', cellExportLabel: '① 컴퓨터 비전' });
    expect(buildLabel(col)).toBe('질문 제목 - ① 컴퓨터 비전');
  });

  it('상세 기재 열은 본 변수와 구별되게 「상세 기재」를 붙인다', () => {
    expect(buildLabel(makeCol({ type: 'option-text', optionLabel: '⑨ 기타' }))).toBe('질문 제목 - ⑨ 기타 상세 기재');
    expect(
      buildLabel(makeCol({ type: 'table-cell-option-text', optionLabel: '⑥ 기타', cellExportLabel: '사업장 형태' })),
    ).toBe('질문 제목 - 사업장 형태 상세 기재');
  });
});

// 문항코드를 넘기면 앞머리는 문항 제목 대신 문항코드 — 긴 제목이 라벨을 잡아먹지 않게(2026-10-30).
// 변수가 문항 그 자체인 열(단일 선택 등)은 앞머리 뒤에 붙일 말이 없어 문항 제목을 그대로 쓴다.
describe('buildLabel — 문항코드 앞머리', () => {
  it('셀라벨이 있는 열은 「문항코드 - 셀라벨」', () => {
    expect(buildLabel(makeCol({ type: 'table-cell', tableCellType: 'input', cellExportLabel: '회사명' }), 'SQ')).toBe('SQ - 회사명');
    expect(buildLabel(makeCol({ type: 'checkbox-item', optionLabel: '① 인공지능(AI)' }), 'A3')).toBe('A3 - ① 인공지능(AI)');
    expect(buildLabel(makeCol({ type: 'option-text', optionLabel: '⑨ 기타' }), 'A7')).toBe('A7 - ⑨ 기타 상세 기재');
    expect(buildLabel(makeCol({ type: 'choice-group', optionLabel: '회사의 관심도' }), 'C2')).toBe('C2 - 회사의 관심도');
    expect(buildLabel(makeCol({ type: 'choice-group-item', optionLabel: '그룹 - 보기A' }), 'C3')).toBe('C3 - 그룹 - 보기A');
  });

  it('순위·동의 등 고정 꼬리도 문항코드 뒤에 붙는다', () => {
    expect(buildLabel(makeCol({ type: 'ranking-rank', rankIndex: 1, optionLabel: '1순위' }), 'C6')).toBe('C6 (1순위)');
    expect(buildLabel(makeCol({ type: 'notice-agree' }), 'N1')).toBe('N1 - 동의 여부');
  });

  it('변수가 문항 그 자체인 열은 문항 제목을 쓴다', () => {
    expect(buildLabel(makeCol({ type: 'single' }), 'A4')).toBe('질문 제목');
    expect(buildLabel(makeCol({ type: 'table-cell', tableCellType: 'input' }), 'Q9')).toBe('질문 제목');
  });
});
