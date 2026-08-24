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
 *
 * 헤더 셀도 데이터 셀과 같은 `cellToString` 을 거친다 — 엑셀에서 서식이 섞인 헤더는
 * richText 객체로 올라오고, String() 으로 바로 찍으면 컬럼명이 통째로 '[object Object]'
 * 가 된다 (하이퍼링크·수식 헤더도 동일).
 */
export function normalizeHeaderKey(value: unknown): string {
  if (value == null) return '';
  return cellToString(value).replace(/\s+/g, ' ').trim();
}

/** 셀 → 문자열. 숫자/null/undefined 모두 안전하게 string. */
function cellToString(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    // 수식 셀 (CellFormulaValue / CellSharedFormulaValue): 계산 결과 사용.
    // 결과가 없으면 수식 문자열이 아니라 빈 값으로 본다 (사람이 보는 값이 없다).
    if ('formula' in value || 'sharedFormula' in value) {
      return 'result' in value ? cellToString((value as { result: unknown }).result) : '';
    }
    if ('result' in value) {
      return cellToString((value as { result: unknown }).result);
    }
    // 하이퍼링크 셀 (CellHyperlinkValue): 표시 텍스트 사용.
    // text 자체가 richText 객체인 복합 셀이 있으므로 재귀 변환한다.
    if ('hyperlink' in value && 'text' in value) {
      return cellToString((value as { text: unknown }).text);
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

/**
 * 워크시트 셀 → 문자열. 값이 아니라 셀을 받는 유일한 이유는 수식 셀이다.
 *
 * xlsx 직렬화를 왕복한 수식 셀은 결과가 0 이나 false 일 때 `cell.value` 에서 `result`
 * 키가 사라지고 `cell.result` 에만 남는다. 값만 보면 `{ formula }` 뿐이라 사람이 보는
 * 값에 닿을 수 없으므로, 그 경우에 한해 `Cell.result` 를 먼저 읽는다.
 */
function cellNodeToString(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (
    value != null &&
    typeof value === 'object' &&
    ('formula' in value || 'sharedFormula' in value) &&
    !('result' in value)
  ) {
    const result = (cell as { result?: unknown }).result;
    if (result !== undefined) return cellToString(result);
  }
  return cellToString(value);
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
      obj[key] = cellNodeToString(cell);
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
      const value = cellNodeToString(row.getCell(idx + 1));
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
    let raw = normalizeHeaderKey(cellNodeToString(cell));
    if (raw === '') raw = `_col_${colNumber}`;
    const count = (seen.get(raw) ?? 0) + 1;
    seen.set(raw, count);
    headers[colNumber - 1] = count === 1 ? raw : `${raw}__${count}`;
  });

  return headers;
}
