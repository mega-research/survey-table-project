/**
 * Cleaning Export Primitives
 *
 * 순수 Excel 저수준 유틸리티 + 공통 레이아웃 메커니즘.
 * - Cell / Row / Sheet 이름 유틸
 * - 열 너비 auto-fit
 * - 열 번호 ↔ 열 문자 변환
 * - 헤더 스타일, autofilter, freeze, merge, 숨김 컬럼 등 모든 sheet builder가 공유하는 레이아웃
 *
 * 이 파일의 의존성은 cleaning-export-types만이며, 어떤 렌더러/sheet builder에도 의존하지 않는다.
 */
import ExcelJS from 'exceljs';

import {
  HEADER_BORDER,
  HEADER_FILL,
  HEADER_FONT,
  HEADER_ROW_COUNT,
} from './cleaning-export-types';

// ============================================================
// Excel Cell / Row Helpers
// ============================================================

/**
 * XML 1.0에서 허용하지 않는 제어 문자를 제거한다.
 */
export function stripInvalidXmlChars(value: string): string {
   
  return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\uFFFE\uFFFF]/g, '');
}

/** ws.addRow() 래퍼 — 문자열 값의 XML 무효 문자를 자동 제거 */
export function addRow(ws: ExcelJS.Worksheet, values: (string | number | null | undefined)[]): ExcelJS.Row {
  return ws.addRow(values.map((v) => (typeof v === 'string' ? stripInvalidXmlChars(v) : v)));
}

/** 셀에 문자열 값 설정 — XML 무효 문자 자동 제거 */
export function setCellValue(cell: ExcelJS.Cell, value: string | number | null | undefined) {
  cell.value = typeof value === 'string' ? stripInvalidXmlChars(value) : (value ?? null);
}

const EXCEL_MAX_CELL_CHARS = 32767;

/**
 * Excel 셀 문자열 제한(32,767자) 초과 시 여러 셀에 분할 기록.
 */
export function setCellValueChunked(row: ExcelJS.Row, startCol: number, value: string) {
  if (value.length <= EXCEL_MAX_CELL_CHARS) {
    setCellValue(row.getCell(startCol), value);
    return;
  }
  let offset = 0;
  let col = startCol;
  while (offset < value.length) {
    setCellValue(row.getCell(col), value.slice(offset, offset + EXCEL_MAX_CELL_CHARS));
    offset += EXCEL_MAX_CELL_CHARS;
    col++;
  }
}

export function sanitizeSheetName(name: string, existingNames: Set<string>): string {
  let safe = name.replace(/[\\/?*[\]]/g, '');
  if (safe.length > 31) safe = safe.slice(0, 28) + '...';
  let final = safe;
  let counter = 2;
  while (existingNames.has(final)) {
    const suffix = `(${counter})`;
    final = safe.slice(0, 31 - suffix.length) + suffix;
    counter++;
  }
  existingNames.add(final);
  return final;
}

// ============================================================
// Column Width Auto-fit
// ============================================================

/** 텍스트의 표시 너비를 추정 (CJK 문자 1.8배) */
function getTextWidth(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const str = String(value);
  let width = 0;
  for (const char of str) {
    const code = char.codePointAt(0) ?? 0;
    if (
      (code >= 0x1100 && code <= 0x11FF) ||
      (code >= 0x3000 && code <= 0x9FFF) ||
      (code >= 0xAC00 && code <= 0xD7AF) ||
      (code >= 0xF900 && code <= 0xFAFF) ||
      (code >= 0xFF00 && code <= 0xFFEF)
    ) {
      width += 1.8;
    } else {
      width += 1;
    }
  }
  return width;
}

const AUTO_FIT_MIN_WIDTH = 4;
const AUTO_FIT_MAX_WIDTH = 50;
const AUTO_FIT_PADDING = 2;
const AUTO_FIT_SAMPLE_ROWS = 200;

export function autoFitColumnWidths(ws: ExcelJS.Worksheet): void {
  const colCount = ws.columnCount;
  const maxWidths = new Array<number>(colCount).fill(0);

  for (let r = 1; r <= Math.min(HEADER_ROW_COUNT, ws.rowCount); r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= colCount; c++) {
      if (!ws.getColumn(c).hidden) {
        maxWidths[c - 1] = Math.max(maxWidths[c - 1], getTextWidth(row.getCell(c).value));
      }
    }
  }

  const dataEnd = Math.min(ws.rowCount, HEADER_ROW_COUNT + AUTO_FIT_SAMPLE_ROWS);
  for (let r = HEADER_ROW_COUNT + 1; r <= dataEnd; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= colCount; c++) {
      if (!ws.getColumn(c).hidden) {
        maxWidths[c - 1] = Math.max(maxWidths[c - 1], getTextWidth(row.getCell(c).value));
      }
    }
  }

  for (let c = 1; c <= colCount; c++) {
    if (!ws.getColumn(c).hidden) {
      ws.getColumn(c).width = Math.min(
        AUTO_FIT_MAX_WIDTH,
        Math.max(AUTO_FIT_MIN_WIDTH, maxWidths[c - 1] + AUTO_FIT_PADDING),
      );
    }
  }
}

// ============================================================
// Excel Column Letter
// ============================================================

/** Excel 열 번호(1-based)를 열 문자(A, B, ..., AA, AB, ...)로 변환 */
export function getExcelColumnLetter(colNum: number): string {
  let result = '';
  let n = colNum;
  while (n > 0) {
    n--;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

// ============================================================
// Shared Sheet Layout (header style, autofilter, freeze, merge, hidden)
// ============================================================

export function applyHeaderStyle(ws: ExcelJS.Worksheet, colCount: number, rowOffset = 0) {
  for (let r = 1 + rowOffset; r <= HEADER_ROW_COUNT + rowOffset; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= colCount; c++) {
      const cell = row.getCell(c);
      cell.fill = HEADER_FILL;
      cell.font = HEADER_FONT;
      cell.border = HEADER_BORDER;
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    }
    row.height = 24;
  }
}

export function setupHiddenColumns(ws: ExcelJS.Worksheet, hiddenStartCol: number, count: number, rowOffset = 0) {
  const labels = ['__cell_ids__', '__cell_ids_2__', '__question_id__', '__row_index__'];
  for (let i = 0; i < count; i++) {
    setCellValue(ws.getRow(1 + rowOffset).getCell(hiddenStartCol + i), labels[i]);
    setCellValue(ws.getRow(2 + rowOffset).getCell(hiddenStartCol + i), labels[i]);
    setCellValue(ws.getRow(3 + rowOffset).getCell(hiddenStartCol + i), labels[i]);
    ws.getColumn(hiddenStartCol + i).hidden = true;
  }
}

export function applyAutoFilterAndFreeze(ws: ExcelJS.Worksheet, colCount: number, freezeXSplit: number, rowOffset = 0) {
  const headerEnd = HEADER_ROW_COUNT + rowOffset;
  const lastRow = ws.rowCount;
  if (lastRow > headerEnd) {
    ws.autoFilter = { from: { row: headerEnd, column: 1 }, to: { row: lastRow, column: colCount } };
  }
  ws.views = [{ state: 'frozen', xSplit: freezeXSplit, ySplit: headerEnd }];
}

/** 헤더의 특정 열을 세로 병합하여 한 번만 표시 */
export function mergeHeaderCells(ws: ExcelJS.Worksheet, col: number, rowOffset = 0): void {
  ws.mergeCells(1 + rowOffset, col, HEADER_ROW_COUNT + rowOffset, col);
  ws.getRow(1 + rowOffset).getCell(col).alignment = { vertical: 'middle', horizontal: 'center' };
}
