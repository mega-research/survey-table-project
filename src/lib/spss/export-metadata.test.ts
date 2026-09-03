import { describe, expect, it } from 'vitest';

import type { SPSSExportColumn } from '@/lib/analytics/spss-excel-export';
import { resolveSavNumericFormat, resolveSpssDisplayFormat } from '@/lib/spss/export-metadata';

// 정책: numberFormat 은 opt-in 이다. 설정된 변수만 넓은 표시 폭(F20/COMMA20/PCT12)을
// 받고, 미설정 변수는 종전 형식(숫자 단답형 F8.2, 그 외 F8.0)을 그대로 유지해
// 기존 설문의 .sav/코딩북 출력이 바뀌지 않아야 한다.

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

describe('resolveSavNumericFormat - numberFormat 미설정(기존 동작 유지)', () => {
  it('calc 셀은 F8.0 을 유지한다', () => {
    const col = makeCol({ type: 'table-cell', tableCellType: 'calc' });
    expect(resolveSavNumericFormat(col, undefined)).toEqual({
      width: 0,
      columns: 8,
      decimal: 0,
    });
  });

  it('Numeric 명시 테이블 input 셀은 F8.0 을 유지한다', () => {
    const col = makeCol({
      type: 'table-cell',
      tableCellType: 'input',
      cellSpssVarType: 'Numeric',
    });
    expect(resolveSavNumericFormat(col, undefined)).toEqual({
      width: 0,
      columns: 8,
      decimal: 0,
    });
  });

  it('숫자 단답형은 F8.2 를 유지한다', () => {
    const col = makeCol({ type: 'text', numericText: true });
    expect(resolveSavNumericFormat(col, undefined)).toEqual({
      width: 0,
      columns: 8,
      decimal: 2,
    });
  });
});

describe('resolveSavNumericFormat - numberFormat 설정(넓은 폭 opt-in)', () => {
  it('설정된 소수 자릿수로 폭 20 형식을 만든다', () => {
    const col = makeCol({
      type: 'table-cell',
      tableCellType: 'input',
      cellSpssVarType: 'Numeric',
      numberFormat: { thousandSeparator: true, decimalPlaces: 3 },
    });
    expect(resolveSavNumericFormat(col, undefined)).toEqual({
      width: 20,
      columns: 20,
      decimal: 3,
    });
  });

  it('calc 셀도 numberFormat 이 있으면 넓은 폭을 받는다', () => {
    const col = makeCol({
      type: 'table-cell',
      tableCellType: 'calc',
      numberFormat: { decimalPlaces: 0 },
    });
    expect(resolveSavNumericFormat(col, undefined)).toEqual({
      width: 20,
      columns: 20,
      decimal: 0,
    });
  });
});

describe('resolveSpssDisplayFormat - numberFormat 미설정(기존 동작 유지)', () => {
  it('calc 셀은 F8.0 으로 표기한다', () => {
    const col = makeCol({ type: 'table-cell', tableCellType: 'calc' });
    expect(resolveSpssDisplayFormat(col, undefined)).toBe('F8.0');
  });

  it('숫자 단답형은 F8.2 로 표기한다', () => {
    const col = makeCol({ type: 'text', numericText: true });
    expect(resolveSpssDisplayFormat(col, undefined)).toBe('F8.2');
  });
});

describe('resolveSpssDisplayFormat - numberFormat 설정', () => {
  it('percent 단위는 PCT12 를 만든다', () => {
    const col = makeCol({
      type: 'table-cell',
      tableCellType: 'input',
      cellSpssVarType: 'Numeric',
      numberFormat: { unit: 'percent', decimalPlaces: 1 },
    });
    expect(resolveSpssDisplayFormat(col, undefined)).toBe('PCT12.1');
  });

  it('천단위 구분은 COMMA20 을 만든다', () => {
    const col = makeCol({
      type: 'table-cell',
      tableCellType: 'input',
      cellSpssVarType: 'Numeric',
      numberFormat: { thousandSeparator: true, decimalPlaces: 2 },
    });
    expect(resolveSpssDisplayFormat(col, undefined)).toBe('COMMA20.2');
  });

  it('단위·구분 없는 numberFormat 은 F20 을 만든다', () => {
    const col = makeCol({
      type: 'table-cell',
      tableCellType: 'input',
      cellSpssVarType: 'Numeric',
      numberFormat: { decimalPlaces: 1 },
    });
    expect(resolveSpssDisplayFormat(col, undefined)).toBe('F20.1');
  });
});
