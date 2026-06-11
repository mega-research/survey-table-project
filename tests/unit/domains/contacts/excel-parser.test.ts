import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { previewExcel, parseExcelRows, normalizeHeaderKey } from '@/lib/contacts/excel-parser';

async function loadFixture(name: string): Promise<Buffer> {
  return readFile(`tests/fixtures/contacts/${name}`);
}

/**
 * exceljs 워크북을 메모리에서 만들어 buffer 로 직렬화.
 * 하이퍼링크/리치텍스트/수식/에러 등 object 형태 셀 값을 회귀 테스트하기 위함.
 */
async function buildWorkbookBuffer(
  fill: (ws: ExcelJS.Worksheet) => void,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  fill(ws);
  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab as ArrayBuffer);
}

describe('normalizeHeaderKey', () => {
  it('줄바꿈 → 공백', () => {
    expect(normalizeHeaderKey('전시회명\n(영문)')).toBe('전시회명 (영문)');
  });
  it('연속 공백 → 1개', () => {
    expect(normalizeHeaderKey('연  번')).toBe('연 번');
  });
  it('trim', () => {
    expect(normalizeHeaderKey('  이메일  ')).toBe('이메일');
  });
  it('null/undefined → 빈 문자', () => {
    expect(normalizeHeaderKey(null)).toBe('');
    expect(normalizeHeaderKey(undefined)).toBe('');
  });
});

describe('previewExcel - individual-mini.xlsx (Row 0 병합, Row 1 헤더)', () => {
  it('headerRow=2 (1-based) → 헤더 정상 추출', async () => {
    const buf = await loadFixture('individual-mini.xlsx');
    const result = await previewExcel(buf, { sheetName: '개별참가', headerRow: 2, maxRows: 5 });
    expect(result.headers).toEqual([
      '연 번', '전시회명(국문)', '개최기간', '기업명', '이메일', '사업자번호',
    ]);
    expect(result.rows.length).toBeGreaterThan(0);
    const row0 = result.rows[0];
    if (!row0) throw new Error('expected rows[0]');
    expect(row0['이메일']).toBe('aaa@test.com');
  });

  it('headerRow=1 → 병합 타이틀이 헤더로 잡힘 (사용자 실수 케이스)', async () => {
    const buf = await loadFixture('individual-mini.xlsx');
    const result = await previewExcel(buf, { sheetName: '개별참가', headerRow: 1, maxRows: 3 });
    expect(result.headers[0]).toBe('기업 기본 정보');
  });

  it('시트 목록 반환', async () => {
    const buf = await loadFixture('individual-mini.xlsx');
    const result = await previewExcel(buf, { sheetName: '개별참가', headerRow: 2, maxRows: 5 });
    expect(result.sheetNames).toContain('개별참가');
  });
});

describe('parseExcelRows', () => {
  it('group-mini.xlsx 5행 모두 파싱', async () => {
    const buf = await loadFixture('group-mini.xlsx');
    const rows = await parseExcelRows(buf, { sheetName: '단체참가', headerRow: 2 });
    expect(rows).toHaveLength(5);
    const rows0 = rows[0];
    if (!rows0) throw new Error('expected rows[0]');
    expect(rows0['연번']).toBe('1');
    expect(rows0['담당자 이메일']).toBe('grpA@test.com');
  });

  it('빈 셀 → 빈 문자열 보존 (NULL 아님)', async () => {
    const buf = await loadFixture('individual-mini.xlsx');
    const rows = await parseExcelRows(buf, { sheetName: '개별참가', headerRow: 2 });
    const row2 = rows[2];
    const row3 = rows[3];
    if (!row2) throw new Error('expected rows[2]');
    if (!row3) throw new Error('expected rows[3]');
    expect(row2['이메일']).toBe('');  // Row 3 = 이메일 비어있음
    expect(row3['사업자번호']).toBe('');  // Row 4 = 사업자번호 비어있음
  });

  it('숫자 셀 → 문자열로 보관', async () => {
    const buf = await loadFixture('individual-mini.xlsx');
    const rows = await parseExcelRows(buf, { sheetName: '개별참가', headerRow: 2 });
    const row0 = rows[0];
    if (!row0) throw new Error('expected rows[0]');
    expect(row0['연 번']).toBe('1');
    expect(row0['사업자번호']).toBe('1234567890');
  });
});

describe('parseExcelRows - object 형태 셀 값 처리 (L84 회귀)', () => {
  it('하이퍼링크 셀 → text 추출 ([object Object] 아님)', async () => {
    const buf = await buildWorkbookBuffer((ws) => {
      ws.getCell('A1').value = '이메일';
      // 브라우저/Outlook 에서 붙여넣으면 자동 하이퍼링크되는 케이스
      ws.getCell('A2').value = { text: 'a@b.com', hyperlink: 'mailto:a@b.com' };
    });
    const rows = await parseExcelRows(buf, { sheetName: 'Sheet1', headerRow: 1 });
    const row0 = rows[0];
    if (!row0) throw new Error('expected rows[0]');
    expect(row0['이메일']).toBe('a@b.com');
  });

  it('리치 텍스트 셀 → run text 이어붙임', async () => {
    const buf = await buildWorkbookBuffer((ws) => {
      ws.getCell('A1').value = '이름';
      ws.getCell('A2').value = {
        richText: [
          { text: '홍', font: { bold: true } },
          { text: '길동' },
        ],
      };
    });
    const rows = await parseExcelRows(buf, { sheetName: 'Sheet1', headerRow: 1 });
    const row0 = rows[0];
    if (!row0) throw new Error('expected rows[0]');
    expect(row0['이름']).toBe('홍길동');
  });

  it('수식 셀 → result 값 사용', async () => {
    const buf = await buildWorkbookBuffer((ws) => {
      ws.getCell('A1').value = '합계';
      ws.getCell('A2').value = { formula: '1+2', result: 3 };
    });
    const rows = await parseExcelRows(buf, { sheetName: 'Sheet1', headerRow: 1 });
    const row0 = rows[0];
    if (!row0) throw new Error('expected rows[0]');
    expect(row0['합계']).toBe('3');
  });
});
