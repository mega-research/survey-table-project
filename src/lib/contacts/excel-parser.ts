import ExcelJS from 'exceljs';

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
  if (typeof value === 'object' && 'result' in value) {
    return String((value as { result: unknown }).result ?? '');
  }
  if (value instanceof Date) return value.toISOString();
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
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  await wb.xlsx.load(buf);

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
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  await wb.xlsx.load(buf);
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
