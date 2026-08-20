import { VariableMeasure, VariableType } from 'sav-writer';

import type { SPSSExportColumn } from '@/lib/analytics/spss-excel-export';
import { resolveMeasure, resolveVarType } from '@/lib/spss/variable-meta';
import type { Question } from '@/types/survey';

const WIDE_NUMERIC_WIDTH = 20;
const PERCENT_WIDTH = 12;
const DEFAULT_NUMERIC_DECIMALS = 2;

// numberFormat 미설정 변수의 기본 소수 자릿수 — numberFormat 은 opt-in 이라
// 설정하지 않은 변수는 종전 .sav/코딩북 출력(F8 계열)을 그대로 유지해야 한다.
// 숫자 단답형(Continuous)만 소수를 표시한다: 응답자가 1.5 를 입력하면 float
// 레코드엔 1.5 가 그대로 저장되지만, decimal:0(F8.0) 이면 SPSS 변수보기 표시값이
// 2 로 반올림돼 오해를 준다. 그 외(테이블 input/calc 포함)는 decimal:0 을 유지한다.
const NUMERIC_TEXT_DECIMAL = 2;

function clampDecimals(value: number | undefined): number {
  if (value === undefined) return DEFAULT_NUMERIC_DECIMALS;
  return Math.max(0, Math.min(16, Math.trunc(value)));
}

function isNumericInputColumn(col: SPSSExportColumn): boolean {
  if (col.type === 'text') return col.numericText === true;
  return (
    col.type === 'table-cell' && (col.tableCellType === 'input' || col.tableCellType === 'calc')
  );
}

export interface SavNumericFormat {
  width: number;
  columns: number;
  decimal: number;
}

/** sav-writer가 지원하는 F 계열의 폭/소수 자릿수. 코드형 숫자는 기존 F8.0을 유지한다. */
export function resolveSavNumericFormat(
  col: SPSSExportColumn,
  question: Question | undefined,
): SavNumericFormat {
  if (resolveVarType(col, question) !== VariableType.Numeric || !isNumericInputColumn(col)) {
    return { width: 0, columns: 8, decimal: 0 };
  }

  if (!col.numberFormat) {
    return {
      width: 0,
      columns: 8,
      decimal: col.type === 'text' ? NUMERIC_TEXT_DECIMAL : 0,
    };
  }

  return {
    width: WIDE_NUMERIC_WIDTH,
    columns: WIDE_NUMERIC_WIDTH,
    decimal: clampDecimals(col.numberFormat.decimalPlaces),
  };
}

/** 코딩북 및 SPS FORMATS 명령에 쓰는 최종 표시 형식. */
export function resolveSpssDisplayFormat(
  col: SPSSExportColumn,
  question: Question | undefined,
): string {
  const varType = resolveVarType(col, question);
  // 'A(가변)' 은 SPSS 표준 표기가 아닌 코딩북용 설명 문자열이다. 실제 폭 A{n} 은
  // 응답 데이터의 최대 길이로 정해지는데(computeMaxStringWidths) 코딩북은 질문
  // 정의만으로 만들어져 그 폭을 알 수 없다.
  if (varType === VariableType.String) return 'A(가변)';
  if (varType === VariableType.Date) return 'DATE10';
  if (varType === VariableType.DateTime) return 'DATETIME20';
  if (!isNumericInputColumn(col)) return 'F8.0';
  if (!col.numberFormat) return col.type === 'text' ? `F8.${NUMERIC_TEXT_DECIMAL}` : 'F8.0';

  const decimals = clampDecimals(col.numberFormat.decimalPlaces);
  if (col.numberFormat.unit === 'percent') return `PCT${PERCENT_WIDTH}.${decimals}`;
  if (col.numberFormat.thousandSeparator) return `COMMA${WIDE_NUMERIC_WIDTH}.${decimals}`;
  return `F${WIDE_NUMERIC_WIDTH}.${decimals}`;
}

export interface CodebookVariableMetadata {
  variableType: 'Numeric' | 'String' | 'Date' | 'DateTime';
  measure: 'Nominal' | 'Ordinal' | 'Scale';
  displayFormat: string;
}

export function buildCodebookVariableMetadata(
  col: SPSSExportColumn,
  question: Question | undefined,
): CodebookVariableMetadata {
  const varType = resolveVarType(col, question);
  const measure = resolveMeasure(col, question);
  const variableType =
    varType === VariableType.Numeric
      ? 'Numeric'
      : varType === VariableType.Date
        ? 'Date'
        : varType === VariableType.DateTime
          ? 'DateTime'
          : 'String';
  const measureLabel =
    measure === VariableMeasure.Continuous
      ? 'Scale'
      : measure === VariableMeasure.Ordinal
        ? 'Ordinal'
        : 'Nominal';

  return {
    variableType,
    measure: measureLabel,
    displayFormat: resolveSpssDisplayFormat(col, question),
  };
}
