import type { Question, TableCell, TableColumn, TableRow } from '@/types/survey';

import { generateAllOptionCodes } from './option-code-generator';
import { sanitizeSpssVarName } from './spss-var-name';

/** 입력 가능한 셀 타입 (SPSS 변수 생성 대상 — ranking_opt 는 Case 2 옵션 소스로 숫자코드/변수타입 설정 필요) */
export const INTERACTIVE_CELL_TYPES = new Set(['checkbox', 'radio', 'select', 'input', 'ranking_opt', 'choice_opt']);

/**
 * ranking 셀(Case 3) + 질문 레벨 ranking(Case 1) 의 SPSS 변수 접미사 기본 템플릿.
 * SPSS 변수명은 대소문자 미구분이므로 소문자 'rk' 사용.
 */
export const DEFAULT_RANK_SUFFIX_PATTERN = '_rk{k}';

/**
 * ranking 셀의 SPSS 변수명을 생성한다 (접미사 패턴 기반 자동 생성).
 * 예: baseVarName='Q1_r01_c01', pattern='_rk{k}', rank=2 → 'Q1_r01_c01_rk2'
 * pattern 에 '{k}' 가 없으면 자동으로 뒤에 붙여 중복 변수명을 방지한다.
 */
export function buildRankVarName(
  baseVarName: string,
  pattern: string | undefined,
  rank: number,
): string {
  const raw = pattern && pattern.trim().length > 0 ? pattern.trim() : DEFAULT_RANK_SUFFIX_PATTERN;
  const template = raw.includes('{k}') ? raw : `${raw}{k}`;
  const suffix = template.replace(/\{k\}/g, String(rank));
  return `${baseVarName}${suffix}`;
}

/**
 * ranking 셀의 특정 rank 에 대한 SPSS 변수명을 결정한다.
 * 우선순위: rankVarNames[rank-1] 수동 오버라이드 > 패턴 기반 자동 생성.
 * 오버라이드 값은 SPSS 변수명 규격(영문/숫자/언더스코어, 최대 64자)에 맞게 sanitize.
 */
export function resolveRankVarName(
  baseVarName: string,
  pattern: string | undefined,
  overrides: string[] | undefined,
  rank: number,
): string {
  const override = overrides?.[rank - 1];
  if (typeof override === 'string') {
    const trimmed = override.trim();
    if (trimmed.length > 0) return sanitizeSpssVarName(trimmed);
  }
  return buildRankVarName(baseVarName, pattern, rank);
}

/** 셀이 자동생성 대상인지 판별 (모든 타입, hidden만 제외) */
function isAutoGeneratable(cell: TableCell): boolean {
  return !cell.isHidden;
}

/** 기존 cellCode가 있고 isCustomCellCode가 undefined이면 커스텀으로 간주 (기존 데이터 보호) */
function isEffectivelyCustom(cell: TableCell): boolean {
  if (cell.isCustomCellCode === true) return true;
  if (cell.isCustomCellCode === undefined && cell.cellCode) return true;
  return false;
}

function isEffectivelyCustomLabel(cell: TableCell): boolean {
  if (cell.isCustomExportLabel === true) return true;
  if (cell.isCustomExportLabel === undefined && cell.exportLabel) return true;
  return false;
}

// ── SPSS 변수명 폴백 생성 (내보내기용, 자릿수 패딩 포함) ──

/**
 * SPSS 내보내기 시 cellCode가 없는 셀의 폴백 변수명을 생성한다.
 * 행/열 수에 따라 자릿수를 자동 패딩하여 정렬 보장.
 *
 * 예) 행 15개, 열 3개:
 *   Q1_r01_c1, Q1_r02_c1, ..., Q1_r15_c3
 *
 * 예) 행 3개, 열 12개:
 *   Q1_r1_c01, Q1_r1_c02, ..., Q1_r3_c12
 */
export function buildTableCellVarName(
  q: Question,
  row: TableRow,
  colIdx: number,
  columns: TableColumn[],
  rows: TableRow[],
): string {
  const qCode = q.questionCode || q.id.slice(0, 8);

  // rowCode가 있으면 그대로 사용, 없으면 행 인덱스 기반 패딩 생성
  let rCode = row.rowCode;
  if (!rCode) {
    const rowIdx = rows.indexOf(row);
    const rowPad = rows.length >= 100 ? 3 : rows.length >= 10 ? 2 : 1;
    rCode = `r${String((rowIdx === -1 ? 0 : rowIdx) + 1).padStart(rowPad, '0')}`;
  }

  // columnCode가 있으면 그대로 사용, 없으면 열 인덱스 기반 패딩 생성
  let cCode = columns[colIdx]?.columnCode;
  if (!cCode) {
    const colPad = columns.length >= 100 ? 3 : columns.length >= 10 ? 2 : 1;
    cCode = `c${String(colIdx + 1).padStart(colPad, '0')}`;
  }

  return `${qCode}_${rCode}_${cCode}`;
}

// ── 셀코드 생성 ──

/** 셀코드 자동생성: questionCode_rowCode_columnCode */
export function generateCellCode(
  questionCode: string | undefined,
  rowCode: string | undefined,
  columnCode: string | undefined,
): string | undefined {
  if (!questionCode || !rowCode || !columnCode) return undefined;
  return `${questionCode}_${rowCode}_${columnCode}`;
}

/** exportLabel 자동생성: questionCode(질문 SPSS 변수명)_columnLabel_rowLabel */
export function generateExportLabel(
  questionCode: string | undefined,
  columnLabel: string | undefined,
  rowLabel: string | undefined,
): string | undefined {
  if (!questionCode || !columnLabel || !rowLabel) return undefined;
  return `${questionCode}_${columnLabel}_${rowLabel}`;
}

// ── SPSS 변수 타입 / 측정 수준 자동 판단 ──

/** 셀 타입 기반 SPSS 변수 타입 자동 판단 */
export function inferSpssVarType(
  cellType: TableCell['type'],
): TableCell['spssVarType'] {
  switch (cellType) {
    case 'checkbox':
    case 'radio':
    case 'select':
      return 'Numeric';
    case 'input':
      return 'String';
    default:
      return undefined;
  }
}

/** 셀 타입 기반 SPSS 측정 수준 자동 판단 */
export function inferSpssMeasure(
  cellType: TableCell['type'],
): TableCell['spssMeasure'] {
  switch (cellType) {
    case 'checkbox':
    case 'radio':
    case 'select':
      return 'Nominal';
    case 'input':
      return 'Continuous';
    default:
      return undefined;
  }
}

// ── 일괄 생성 함수들 ──

/** 단일 셀에 자동생성값 적용 (변경 없으면 원본 참조 반환) */
function applyAutoCodeToCell(
  cell: TableCell,
  questionCode: string | undefined,
  questionTitle: string | undefined,
  rowCode: string | undefined,
  rowLabel: string | undefined,
  columnCode: string | undefined,
  columnLabel: string | undefined,
): TableCell {
  if (!isAutoGeneratable(cell)) return cell;
  if (isEffectivelyCustom(cell) && isEffectivelyCustomLabel(cell)) return cell;

  let hasChanges = false;
  const updates: Partial<TableCell> = {};

  if (!isEffectivelyCustom(cell)) {
    const newCellCode = generateCellCode(questionCode, rowCode, columnCode);
    if (cell.cellCode !== newCellCode || cell.isCustomCellCode !== false) {
      updates.cellCode = newCellCode;
      updates.isCustomCellCode = false;
      hasChanges = true;
    }
  }

  if (!isEffectivelyCustomLabel(cell)) {
    const newExportLabel = generateExportLabel(questionCode, columnLabel, rowLabel);
    if (cell.exportLabel !== newExportLabel || cell.isCustomExportLabel !== false) {
      updates.exportLabel = newExportLabel;
      updates.isCustomExportLabel = false;
      hasChanges = true;
    }
  }

  // 변수 타입/측정 수준이 아직 없으면 자동 설정 (interactive 셀만)
  if (!cell.spssVarType && INTERACTIVE_CELL_TYPES.has(cell.type)) {
    updates.spssVarType = inferSpssVarType(cell.type);
    hasChanges = true;
  }
  if (!cell.spssMeasure && INTERACTIVE_CELL_TYPES.has(cell.type)) {
    updates.spssMeasure = inferSpssMeasure(cell.type);
    hasChanges = true;
  }

  // 셀 내부 옵션(checkbox/radio/select)에 optionCode/spssNumericCode 자동 할당
  if (cell.checkboxOptions && cell.checkboxOptions.length > 0) {
    const updated = generateAllOptionCodes(cell.checkboxOptions);
    if (updated !== cell.checkboxOptions) {
      updates.checkboxOptions = updated;
      hasChanges = true;
    }
  }
  if (cell.radioOptions && cell.radioOptions.length > 0) {
    const updated = generateAllOptionCodes(cell.radioOptions);
    if (updated !== cell.radioOptions) {
      updates.radioOptions = updated;
      hasChanges = true;
    }
  }
  if (cell.selectOptions && cell.selectOptions.length > 0) {
    const updated = generateAllOptionCodes(cell.selectOptions);
    if (updated !== cell.selectOptions) {
      updates.selectOptions = updated;
      hasChanges = true;
    }
  }

  if (!hasChanges) return cell;
  return { ...cell, ...updates };
}

/** 전체 테이블의 셀코드/라벨 일괄 자동생성 (변경된 행/셀만 새 객체) */
export function generateAllCellCodes(
  questionCode: string | undefined,
  questionTitle: string | undefined,
  columns: TableColumn[],
  rows: TableRow[],
): TableRow[] {
  return rows.map((row) => {
    const newCells = row.cells.map((cell, colIdx) => {
      const col = columns[colIdx];
      return applyAutoCodeToCell(
        cell,
        questionCode,
        questionTitle,
        row.rowCode,
        row.label,
        col?.columnCode,
        col?.label,
      );
    });
    // 모든 셀이 동일 참조면 행도 원본 유지
    if (newCells.every((c, i) => c === row.cells[i])) return row;
    return { ...row, cells: newCells };
  });
}

/** 특정 행의 셀코드 재계산 (rowCode 변경 시, 변경 없으면 원본 반환) */
export function generateCellCodesForRow(
  questionCode: string | undefined,
  questionTitle: string | undefined,
  columns: TableColumn[],
  row: TableRow,
): TableRow {
  const newCells = row.cells.map((cell, colIdx) => {
    const col = columns[colIdx];
    return applyAutoCodeToCell(
      cell,
      questionCode,
      questionTitle,
      row.rowCode,
      row.label,
      col?.columnCode,
      col?.label,
    );
  });
  if (newCells.every((c, i) => c === row.cells[i])) return row;
  return { ...row, cells: newCells };
}

/** 특정 열의 셀코드 재계산 (columnCode 변경 시, 변경된 행만 새 객체) */
export function generateCellCodesForColumn(
  questionCode: string | undefined,
  questionTitle: string | undefined,
  column: TableColumn,
  colIdx: number,
  rows: TableRow[],
): TableRow[] {
  return rows.map((row) => {
    const cell = row.cells[colIdx];
    if (!cell) return row;
    const updated = applyAutoCodeToCell(
      cell,
      questionCode,
      questionTitle,
      row.rowCode,
      row.label,
      column.columnCode,
      column.label,
    );
    if (updated === cell) return row;
    const newCells = [...row.cells];
    newCells[colIdx] = updated;
    return { ...row, cells: newCells };
  });
}

/** 셀 복사/붙여넣기 시 새 위치 기준으로 셀코드 재생성 */
export function regenerateCellCodeForPaste(
  cell: TableCell,
  questionCode: string | undefined,
  questionTitle: string | undefined,
  rowCode: string | undefined,
  rowLabel: string | undefined,
  columnCode: string | undefined,
  columnLabel: string | undefined,
): TableCell {
  if (!isAutoGeneratable(cell)) return cell;

  return {
    ...cell,
    cellCode: generateCellCode(questionCode, rowCode, columnCode),
    isCustomCellCode: false,
    exportLabel: generateExportLabel(questionCode, columnLabel, rowLabel),
    isCustomExportLabel: false,
    // ranking 셀: 순위별 수동 변수명은 원본 셀 전용이므로 새 셀에서 제거 → 자동 생성 폴백
    rankVarNames: undefined,
  };
}
