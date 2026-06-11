import { VariableMeasure, VariableType } from 'sav-writer';

import type { SPSSExportColumn } from '@/lib/analytics/spss-excel-export';
import type { Question } from '@/types/survey';

// 이하 3개 함수는 sav-builder.ts 에서 이동. 모든 export 변수가
// 타입·측정수준·라벨을 항상 갖도록 하는 단일 폴백 체인 — .sav/코딩북이 공유한다.

/**
 * 변수 타입 결정 (오버라이드 우선 → 자동 판단)
 */
export function resolveVarType(col: SPSSExportColumn, question: Question | undefined): VariableType {
  const varTypeMap: Record<string, VariableType> = {
    Numeric: VariableType.Numeric,
    String: VariableType.String,
    Date: VariableType.Date,
    DateTime: VariableType.DateTime,
  };

  // 셀 단위 오버라이드 (테이블 셀)
  if (col.cellSpssVarType) {
    return varTypeMap[col.cellSpssVarType] ?? VariableType.Numeric;
  }

  // 질문 단위 오버라이드
  if (question?.spssVarType) {
    return varTypeMap[question.spssVarType] ?? VariableType.Numeric;
  }

  // 자동 판단
  switch (col.type) {
    case 'single':
    case 'checkbox-item':
    case 'notice-agree':
    case 'ranking-rank':
    case 'radio-group':
    case 'choice-group':
    case 'choice-group-item':
    case 'table-cell-ranking':
      return VariableType.Numeric;

    case 'text':
      // numericText 는 generateSPSSColumns 에서 question.inputType 기반으로 세팅된 SSOT
      return col.numericText ? VariableType.Numeric : VariableType.String;

    case 'other-text':
    case 'ranking-other':
    case 'multiselect':
    case 'notice-date':
    case 'table-cell-ranking-other':
      return VariableType.String;

    case 'table-cell':
      return col.tableCellType === 'input' ? VariableType.String : VariableType.Numeric;

    default:
      return VariableType.String;
  }
}

/**
 * 측정 수준 결정 (셀 단위 오버라이드 → 질문 단위 오버라이드 → 기본 Nominal)
 */
export function resolveMeasure(col: SPSSExportColumn, question: Question | undefined): VariableMeasure {
  const measureMap: Record<string, VariableMeasure> = {
    Nominal: VariableMeasure.Nominal,
    Ordinal: VariableMeasure.Ordinal,
    Continuous: VariableMeasure.Continuous,
  };

  // 셀 단위 오버라이드
  if (col.cellSpssMeasure) {
    return measureMap[col.cellSpssMeasure] ?? VariableMeasure.Nominal;
  }

  // 질문 단위 오버라이드
  if (question?.spssMeasure) {
    return measureMap[question.spssMeasure] ?? VariableMeasure.Nominal;
  }

  // ranking 순위 변수는 Ordinal (Kendall's W 등 순위통계 지원)
  if (col.type === 'ranking-rank' || col.type === 'table-cell-ranking') {
    return VariableMeasure.Ordinal;
  }

  // radio-group (Likert 등 매트릭스 단일선택) 디폴트 Ordinal — Continuous로 보고 싶으면 셀에서 명시
  if (col.type === 'radio-group') {
    return VariableMeasure.Ordinal;
  }

  // choice-group (질문 레벨 choiceGroups 기반 단일선택) — 명목척도
  if (col.type === 'choice-group') {
    return VariableMeasure.Nominal;
  }

  // choice-group-item (checkbox 그룹 기반 보기별 counted 변수) — 명목척도
  if (col.type === 'choice-group-item') {
    return VariableMeasure.Nominal;
  }

  // 숫자 단답형(numericText) 은 척도(Continuous)
  if (col.type === 'text' && col.numericText) {
    return VariableMeasure.Continuous;
  }

  return VariableMeasure.Nominal;
}

/**
 * 변수 라벨 생성
 */
export function buildLabel(col: SPSSExportColumn): string {
  switch (col.type) {
    case 'checkbox-item':
      return `${col.questionText} - ${col.optionLabel}`;
    case 'other-text':
      return `${col.questionText} - 기타 입력`;
    case 'option-text':
    case 'table-cell-option-text':
      return `${col.questionText} - ${col.optionLabel}`;
    case 'notice-agree':
      return `${col.questionText} - 동의 여부`;
    case 'notice-date':
      return `${col.questionText} - 동의 일시`;
    case 'ranking-rank':
      // grouped 그룹 라벨 접두: optionLabel "그룹라벨 - 1순위" → "질문제목 - 그룹라벨 - 1순위"
      return col.optionLabel && col.optionLabel !== `${col.rankIndex}순위`
        ? `${col.questionText} - ${col.optionLabel}`
        : `${col.questionText} (${col.rankIndex}순위)`;
    case 'ranking-other':
      return col.optionLabel && col.optionLabel !== `${col.rankIndex}순위 기타 입력`
        ? `${col.questionText} - ${col.optionLabel}`
        : `${col.questionText} - ${col.rankIndex}순위 기타 입력`;
    case 'table-cell-ranking': {
      const loc = col.rowLabel && col.colLabel
        ? `${col.rowLabel} > ${col.colLabel}`
        : col.optionLabel;
      return loc
        ? `${col.questionText} - ${loc} (${col.rankIndex}순위)`
        : `${col.questionText} (${col.rankIndex}순위)`;
    }
    case 'table-cell-ranking-other': {
      const loc = col.rowLabel && col.colLabel
        ? `${col.rowLabel} > ${col.colLabel}`
        : col.optionLabel;
      return loc
        ? `${col.questionText} - ${loc} - ${col.rankIndex}순위 기타 입력`
        : `${col.questionText} - ${col.rankIndex}순위 기타 입력`;
    }
    case 'table-cell':
      return col.optionLabel
        ? `${col.questionText} - ${col.optionLabel}`
        : col.questionText;
    case 'radio-group':
      return col.optionLabel
        ? `${col.questionText} - ${col.optionLabel}`
        : col.questionText;
    case 'choice-group':
      // M1 fix: 그룹 라벨이 없어 optionLabel === questionText 인 경우 이중화 방지.
      // 예) 그룹 라벨 미설정 시 optionLabel = q.title → "제목 - 제목" 방지.
      return col.optionLabel && col.optionLabel !== col.questionText
        ? `${col.questionText} - ${col.optionLabel}`
        : col.questionText;
    case 'choice-group-item':
      // optionLabel 이 "그룹라벨 - 보기라벨" 을 이미 포함하므로 그대로 반환한다.
      // (questionText prefix 를 붙이면 "질문제목 - 그룹라벨 - 보기라벨" 이 되어 장황해짐)
      return col.optionLabel || col.questionText;
    default:
      return col.questionText;
  }
}
