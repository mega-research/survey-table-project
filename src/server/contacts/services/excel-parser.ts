import ExcelJS from 'exceljs';

/**
 * Buffer / ArrayBuffer 입력을 exceljs 가 받는 ArrayBuffer 로 정규화.
 * Node Buffer 는 Uint8Array view — 독립 ArrayBuffer 로 복사 (slice 만으로는
 * pool buffer 의 일부일 수 있어 exceljs 가 잘못 파싱).
 */
function toArrayBuffer(input: Buffer | ArrayBuffer): ArrayBuffer {
  if (input instanceof ArrayBuffer) return input;
  const ab = new ArrayBuffer(input.byteLength);
  new Uint8Array(ab).set(input);
  return ab;
}

/**
 * 엑셀 컬럼명 정규화. 줄바꿈 → 공백, 연속 공백 → 1개, trim.
 * attrs key 로 사용되므로 일관성 중요.
 */
export function normalizeHeaderKey(value: unknown): string {
  if (value == null) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

/** 셀 → 문자열. 숫자/null/undefined 모두 안전하게 string. */
function cellToString(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    // 수식 셀 (CellFormulaValue / CellSharedFormulaValue): 계산 결과 사용
    if ('result' in value) {
      return cellToString((value as { result: unknown }).result);
    }
    // 하이퍼링크 셀 (CellHyperlinkValue): 표시 텍스트 사용
    if ('hyperlink' in value && 'text' in value) {
      return String((value as { text: unknown }).text ?? '');
    }
    // 리치 텍스트 셀 (CellRichTextValue): run 들의 text 를 이어붙임
    if ('richText' in value && Array.isArray((value as { richText: unknown }).richText)) {
      return (value as { richText: Array<{ text?: unknown }> }).richText
        .map((run) => String(run?.text ?? ''))
        .join('');
    }
    // 에러 셀 (CellErrorValue): 에러 코드 문자열 사용
    if ('error' in value) {
      return String((value as { error: unknown }).error ?? '');
    }
  }
  return String(value);
}

export interface PreviewOptions {
  sheetName: string;
  /** 1-based 헤더 행 번호. 디폴트 1. */
  headerRow: number;
  /** 미리보기에서 가져올 데이터 행 최대 개수. 디폴트 5. */
  maxRows?: number;
}

export interface PreviewResult {
  sheetNames: string[];
  headers: string[];
  rows: Array<Record<string, string>>;
  totalRows: number;
}

/**
 * 매핑 모달 미리보기용 파싱 — 시트 목록 + 헤더 + maxRows 데이터 행.
 */
export async function previewExcel(
  buffer: Buffer | ArrayBuffer,
  opts: PreviewOptions,
): Promise<PreviewResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(toArrayBuffer(buffer));

  const sheetNames = wb.worksheets.map((w) => w.name);
  const ws = wb.getWorksheet(opts.sheetName) ?? wb.worksheets[0];
  if (!ws) {
    return { sheetNames, headers: [], rows: [], totalRows: 0 };
  }

  const headers = readHeaders(ws, opts.headerRow);
  const maxRows = opts.maxRows ?? 5;
  const rows: Array<Record<string, string>> = [];
  const startRow = opts.headerRow + 1;
  const endRow = Math.min(ws.rowCount, startRow + maxRows - 1);

  for (let r = startRow; r <= endRow; r++) {
    const row = ws.getRow(r);
    const obj: Record<string, string> = {};
    headers.forEach((key, idx) => {
      const cell = row.getCell(idx + 1);
      obj[key] = cellToString(cell.value);
    });
    rows.push(obj);
  }

  return {
    sheetNames,
    headers,
    rows,
    totalRows: ws.rowCount - opts.headerRow,
  };
}

export interface ParseRowsOptions {
  sheetName: string;
  headerRow: number;
}

/** 풀 파싱 — 적재용. 5,000행 한계는 호출자가 가드. */
export async function parseExcelRows(
  buffer: Buffer | ArrayBuffer,
  opts: ParseRowsOptions,
): Promise<Array<Record<string, string>>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(toArrayBuffer(buffer));
  const ws = wb.getWorksheet(opts.sheetName) ?? wb.worksheets[0];
  if (!ws) return [];

  const headers = readHeaders(ws, opts.headerRow);
  const rows: Array<Record<string, string>> = [];
  for (let r = opts.headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const obj: Record<string, string> = {};
    let allEmpty = true;
    headers.forEach((key, idx) => {
      const value = cellToString(row.getCell(idx + 1).value);
      if (value !== '') allEmpty = false;
      obj[key] = value;
    });
    if (!allEmpty) rows.push(obj);
  }
  return rows;
}

function readHeaders(ws: ExcelJS.Worksheet, headerRow: number): string[] {
  const headerRowObj = ws.getRow(headerRow);
  const headers: string[] = [];
  const seen = new Map<string, number>();

  headerRowObj.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    let raw = normalizeHeaderKey(cell.value);
    if (raw === '') raw = `_col_${colNumber}`;
    const count = (seen.get(raw) ?? 0) + 1;
    seen.set(raw, count);
    headers[colNumber - 1] = count === 1 ? raw : `${raw}__${count}`;
  });

  return headers;
}
