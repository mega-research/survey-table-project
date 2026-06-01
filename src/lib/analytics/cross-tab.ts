import type { SurveyResponse } from '@/db/schema';
import type { Question } from '@/types/survey';
import { resolveChoiceOptions } from '@/utils/choice-source';

// ========================
// 교차분석 타입
// ========================

export interface CrossTabCell {
  count: number;
  rowPercent: number; // 행 기준 비율
  colPercent: number; // 열 기준 비율
  totalPercent: number; // 전체 기준 비율
}

export interface CrossTabRow {
  label: string;
  value: string;
  cells: CrossTabCell[];
  total: number;
  rowPercent: number; // 행 합계의 전체 대비 비율
}

export interface CrossTabColumn {
  label: string;
  value: string;
  total: number;
  colPercent: number; // 열 합계의 전체 대비 비율
}

export interface CrossTabResult {
  rowQuestion: {
    id: string;
    title: string;
  };
  colQuestion: {
    id: string;
    title: string;
  };
  rows: CrossTabRow[];
  columns: CrossTabColumn[];
  grandTotal: number;
  // 메타데이터
  hasLowSampleWarning: boolean; // n < 30 경고
  minCellCount: number;
}

export type PercentageBase = 'row' | 'column' | 'total';

// ========================
// 교차분석 함수
// ========================

/**
 * 질문에서 선택지 옵션 추출
 */
function getQuestionOptions(question: Question): { label: string; value: string }[] {
  if (question.type === 'radio' || question.type === 'select') {
    return resolveChoiceOptions(question).map((opt) => ({
      label: opt.label,
      value: opt.value,
    }));
  }

  if (question.type === 'checkbox') {
    return resolveChoiceOptions(question).map((opt) => ({
      label: opt.label,
      value: opt.value,
    }));
  }

  if (question.type === 'multiselect' && question.selectLevels) {
    // 첫 번째 레벨만 사용
    const firstLevel = question.selectLevels[0];
    return (firstLevel?.options || []).map((opt) => ({
      label: opt.label,
      value: opt.value,
    }));
  }

  return [];
}

/**
 * 응답에서 해당 질문의 값 추출
 */
function getResponseValue(response: SurveyResponse, questionId: string): string | string[] | null {
  const questionResponses = response.questionResponses as Record<string, unknown>;
  const value = questionResponses[questionId];

  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map(String);
  }

  if (typeof value === 'object') {
    // multiselect의 경우 첫 번째 레벨 값 사용
    const objValue = value as Record<string, unknown>;
    const firstValue = Object.values(objValue)[0];
    return firstValue ? String(firstValue) : null;
  }

  return String(value);
}

/**
 * 교차분석 수행
 */
export function calculateCrossTab(
  rowQuestion: Question,
  colQuestion: Question,
  responses: SurveyResponse[],
): CrossTabResult {
  const rowOptions = getQuestionOptions(rowQuestion);
  const colOptions = getQuestionOptions(colQuestion);

  // 2차원 카운트 매트릭스 초기화
  const matrix: Record<string, Record<string, number>> = {};
  const rowTotals: Record<string, number> = {};
  const colTotals: Record<string, number> = {};

  rowOptions.forEach((row) => {
    matrix[row.value] = {};
    rowTotals[row.value] = 0;
    colOptions.forEach((col) => {
      matrix[row.value][col.value] = 0;
    });
  });

  colOptions.forEach((col) => {
    colTotals[col.value] = 0;
  });

  let grandTotal = 0;

  // 응답 집계
  responses.forEach((response) => {
    const rowValue = getResponseValue(response, rowQuestion.id);
    const colValue = getResponseValue(response, colQuestion.id);

    if (rowValue === null || colValue === null) return;

    // 단일 선택 (radio, select)
    const rowValues = Array.isArray(rowValue) ? rowValue : [rowValue];
    const colValues = Array.isArray(colValue) ? colValue : [colValue];

    // 다중 선택의 경우 모든 조합 카운트
    rowValues.forEach((rv) => {
      colValues.forEach((cv) => {
        if (matrix[rv] && matrix[rv][cv] !== undefined) {
          matrix[rv][cv]++;
          rowTotals[rv]++;
          colTotals[cv]++;
          grandTotal++;
        }
      });
    });
  });

  // 최소 셀 카운트 확인
  let minCellCount = Infinity;
  Object.values(matrix).forEach((row) => {
    Object.values(row).forEach((count) => {
      if (count > 0 && count < minCellCount) {
        minCellCount = count;
      }
    });
  });
  if (minCellCount === Infinity) minCellCount = 0;

  // 결과 구성
  const rows: CrossTabRow[] = rowOptions.map((rowOpt) => ({
    label: rowOpt.label,
    value: rowOpt.value,
    cells: colOptions.map((colOpt) => {
      const count = matrix[rowOpt.value][colOpt.value];
      const rowTotal = rowTotals[rowOpt.value] || 0;
      const colTotal = colTotals[colOpt.value] || 0;

      return {
        count,
        rowPercent: rowTotal > 0 ? (count / rowTotal) * 100 : 0,
        colPercent: colTotal > 0 ? (count / colTotal) * 100 : 0,
        totalPercent: grandTotal > 0 ? (count / grandTotal) * 100 : 0,
      };
    }),
    total: rowTotals[rowOpt.value] || 0,
    rowPercent: grandTotal > 0 ? ((rowTotals[rowOpt.value] || 0) / grandTotal) * 100 : 0,
  }));

  const columns: CrossTabColumn[] = colOptions.map((colOpt) => ({
    label: colOpt.label,
    value: colOpt.value,
    total: colTotals[colOpt.value] || 0,
    colPercent: grandTotal > 0 ? ((colTotals[colOpt.value] || 0) / grandTotal) * 100 : 0,
  }));

  return {
    rowQuestion: {
      id: rowQuestion.id,
      title: rowQuestion.title,
    },
    colQuestion: {
      id: colQuestion.id,
      title: colQuestion.title,
    },
    rows,
    columns,
    grandTotal,
    hasLowSampleWarning: minCellCount < 30 && minCellCount > 0,
    minCellCount,
  };
}

/**
 * 교차분석 가능한 질문인지 확인
 */
export function isCrossTabableQuestion(question: Question): boolean {
  return ['radio', 'select', 'checkbox', 'multiselect'].includes(question.type);
}

/**
 * 차트용 데이터 변환 (그룹 막대차트)
 */
export interface CrossTabChartData {
  name: string; // 행 라벨
  [key: string]: string | number; // 열 값들
}

export function toCrossTabChartData(
  result: CrossTabResult,
  percentageBase: PercentageBase = 'row',
): CrossTabChartData[] {
  return result.rows.map((row) => {
    const dataItem: CrossTabChartData = { name: row.label };

    row.cells.forEach((cell, index) => {
      const colLabel = result.columns[index].label;
      switch (percentageBase) {
        case 'row':
          dataItem[colLabel] = Math.round(cell.rowPercent * 10) / 10;
          break;
        case 'column':
          dataItem[colLabel] = Math.round(cell.colPercent * 10) / 10;
          break;
        case 'total':
          dataItem[colLabel] = Math.round(cell.totalPercent * 10) / 10;
          break;
      }
    });

    return dataItem;
  });
}

/**
 * 히트맵용 데이터 변환
 */
export interface HeatmapCell {
  rowLabel: string;
  colLabel: string;
  value: number;
  count: number;
}

export function toHeatmapData(
  result: CrossTabResult,
  percentageBase: PercentageBase = 'row',
): HeatmapCell[] {
  const cells: HeatmapCell[] = [];

  result.rows.forEach((row) => {
    row.cells.forEach((cell, colIndex) => {
      let value: number;
      switch (percentageBase) {
        case 'row':
          value = cell.rowPercent;
          break;
        case 'column':
          value = cell.colPercent;
          break;
        case 'total':
          value = cell.totalPercent;
          break;
      }

      cells.push({
        rowLabel: row.label,
        colLabel: result.columns[colIndex].label,
        value,
        count: cell.count,
      });
    });
  });

  return cells;
}

/**
 * 퍼센트 기준 라벨
 */
export function getPercentageBaseLabel(base: PercentageBase): string {
  const labels: Record<PercentageBase, string> = {
    row: '행 기준 %',
    column: '열 기준 %',
    total: '전체 기준 %',
  };
  return labels[base];
}
