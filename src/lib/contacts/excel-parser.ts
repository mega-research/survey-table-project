import ExcelJS from 'exceljs';

import { repairPrefixedXlsx } from './xlsx-namespace-repair';

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

/**
 * 엑셀을 읽을 수 없을 때의 사용자향 에러. procedure 가 typed error 로 바꿔
 * 마법사 화면에 문구를 그대로 띄운다 — 이게 없으면 oRPC 가 운영에서 메시지를
 * 'Internal server error' 로 갈아끼워, 사용자는 왜 실패했는지 알 수 없다.
 */
export class ExcelReadError extends Error {
  override readonly name = 'ExcelReadError';

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

export const EXCEL_UNREADABLE_MESSAGE =
  '엑셀 파일을 읽을 수 없습니다. 파일이 손상됐거나 xlsx 형식이 아닐 수 있습니다. ' +
  'Excel 에서 파일을 열어 "다른 이름으로 저장"(.xlsx)한 뒤 다시 업로드해 주세요.';

/**
 * 워크북 로드 단일 창구.
 *
 * exceljs 4.4 는 접두사 네임스페이스로 저장된 파트(<x:workbook> — OpenXML SDK /
 * ClosedXML 계열 출력)를 파싱하지 못하고 `Cannot read properties of undefined
 * (reading 'sheets')` 로 죽는다. 실패하면 접두사만 벗겨 한 번 재시도하고
 * (xlsx-namespace-repair 참조), 그래도 안 되면 사용자향 문구로 바꿔 던진다.
 *
 * 정상 파일은 첫 시도에서 끝나므로 이 폴백 비용을 지지 않는다.
 */
async function loadWorkbook(buffer: Buffer | ArrayBuffer): Promise<ExcelJS.Workbook> {
  const source = toArrayBuffer(buffer);
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(source);
    return wb;
  } catch (error) {
    const repaired = repairPrefixedXlsx(source);
    if (repaired) {
      try {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(toArrayBuffer(repaired));
        return wb;
      } catch {
        // 복구본도 실패 — 원래 에러를 원인으로 남긴다.
      }
    }
    throw new ExcelReadError(EXCEL_UNREADABLE_MESSAGE, { cause: error });
  }
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
  const wb = await loadWorkbook(buffer);

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
  const wb = await loadWorkbook(buffer);
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

// ── 3단 병합 헤더 (추적조사 이월 응답 임포트) ──

export interface GridOptions {
  sheetName: string;
  /** 헤더로 읽을 행 수 (1~3). 3 이면 파트/문항코드/세부라벨. */
  headerRowCount: number;
}

export interface GridPreviewResult {
  sheetNames: string[];
  /** 헤더 행들. 컬럼 인덱스 순서 그대로이며 병합 종속 칸은 빈 문자열이다. */
  headerRows: string[][];
  /** 데이터 행들. 컬럼 인덱스 순서 그대로. */
  rows: string[][];
  totalRows: number;
}

/**
 * 병합 종속 칸을 빈 문자열로 읽는다.
 *
 * exceljs 는 병합 종속 칸에서 master 의 값을 되돌려준다. 그대로 두면 "값이 있는 칸부터
 * 다음 값이 나오기 전까지"라는 컬럼 블록 규칙이 성립하지 않으므로, master 칸에만 값을
 * 남긴다. 병합이 없는 파일은 이 처리가 무해하다.
 */
function headerCellText(cell: ExcelJS.Cell): string {
  const master = (cell as { master?: ExcelJS.Cell }).master;
  if (master && master.address !== cell.address) return '';
  return cellNodeToString(cell);
}

function readGridRow(
  ws: ExcelJS.Worksheet,
  rowNumber: number,
  columnCount: number,
  asHeader: boolean,
): string[] {
  const row = ws.getRow(rowNumber);
  const values: string[] = [];
  for (let col = 1; col <= columnCount; col++) {
    const cell = row.getCell(col);
    values.push(asHeader ? headerCellText(cell) : cellNodeToString(cell));
  }
  return values;
}

/**
 * 격자의 컬럼 폭.
 *
 * `ws.columnCount` 는 서식만 있는 후행 빈 열까지 세어, 그 열들이 마지막 블록에 흡수된다.
 * 헤더 행들이 실제로 글자를 가진 마지막 칸까지만 본다 (기존 readHeaders 와 같은 취지).
 */
function resolveGridColumnCount(ws: ExcelJS.Worksheet, headerRowCount: number): number {
  let width = 0;
  for (let r = 1; r <= headerRowCount; r++) {
    const row = ws.getRow(r);
    for (let col = 1; col <= ws.columnCount; col++) {
      if (cellNodeToString(row.getCell(col)) !== '') width = Math.max(width, col);
    }
  }
  return width;
}

/**
 * 3단 헤더 격자 파싱 — 헤더 행 + 병합 여부 + 데이터 행.
 *
 * `maxRows` 를 주면 표본만(미리보기), 주지 않으면 전량(적재) 읽는다. 한 번의 워크북
 * 로드로 둘 다 내주는 이유는 적재 경로가 헤더와 데이터를 함께 필요로 하기 때문이다 —
 * 나눠 부르면 같은 파일을 두 번 파싱한다.
 */
export async function previewExcelGrid(
  buffer: Buffer | ArrayBuffer,
  opts: GridOptions & { maxRows?: number },
): Promise<GridPreviewResult> {
  const wb = await loadWorkbook(buffer);
  const sheetNames = wb.worksheets.map((w) => w.name);
  const ws = wb.getWorksheet(opts.sheetName) ?? wb.worksheets[0];
  if (!ws) {
    return { sheetNames, headerRows: [], rows: [], totalRows: 0 };
  }

  const columnCount = resolveGridColumnCount(ws, opts.headerRowCount);
  const headerRows: string[][] = [];
  for (let r = 1; r <= opts.headerRowCount; r++) {
    headerRows.push(readGridRow(ws, r, columnCount, true));
  }

  const startRow = opts.headerRowCount + 1;
  const endRow =
    opts.maxRows === undefined
      ? ws.rowCount
      : Math.min(ws.rowCount, startRow + opts.maxRows - 1);
  const rows: string[][] = [];
  for (let r = startRow; r <= endRow; r++) {
    const values = readGridRow(ws, r, columnCount, false);
    // 전량 읽기(적재)에서는 완전히 빈 행을 버린다 — 시트 끝의 서식만 남은 행이 흔하다.
    if (opts.maxRows !== undefined || values.some((value) => value !== '')) rows.push(values);
  }

  return {
    sheetNames,
    headerRows,
    rows,
    totalRows: Math.max(0, ws.rowCount - opts.headerRowCount),
  };
}

