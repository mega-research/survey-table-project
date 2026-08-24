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
  // 회귀: 서식이 섞인 헤더 셀은 richText 객체로 올라온다. String() 으로 바로 찍으면
  // 컬럼명이 통째로 '[object Object]' 가 되어 업로드 마법사의 컬럼 설정이 무너진다.
  it('richText 헤더 → run 들의 text 를 이어붙인다', () => {
    expect(normalizeHeaderKey({ richText: [{ text: '연번' }] })).toBe('연번');
    expect(
      normalizeHeaderKey({ richText: [{ text: '센터' }, { text: ' ID' }] }),
    ).toBe('센터 ID');
  });
  it('하이퍼링크 헤더 → 표시 텍스트', () => {
    expect(
      normalizeHeaderKey({ text: '개별 URL', hyperlink: 'https://example.com' }),
    ).toBe('개별 URL');
  });
  it('수식 헤더 → 계산 결과', () => {
    expect(normalizeHeaderKey({ formula: 'A1', result: '이메일' })).toBe('이메일');
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

  // 직렬화 왕복 회귀: 수식 결과가 0/false 면 xlsx 를 거친 뒤 cell.value 에서 result 키가
  // 사라지고 Cell.result 에만 남는다. 값만 보면 { formula } 뿐이라 [object Object] 가 된다.
  it('수식 결과 0 → 값에서 result 가 사라져도 0 으로 읽는다', async () => {
    const buf = await buildWorkbookBuffer((ws) => {
      ws.getCell('A1').value = '수량';
      ws.getCell('A2').value = { formula: '1-1', result: 0 };
    });
    const rows = await parseExcelRows(buf, { sheetName: 'Sheet1', headerRow: 1 });
    const row0 = rows[0];
    if (!row0) throw new Error('expected rows[0]');
    expect(row0['수량']).toBe('0');
  });

  it('수식 결과 false → false 로 읽는다', async () => {
    const buf = await buildWorkbookBuffer((ws) => {
      ws.getCell('A1').value = '여부';
      ws.getCell('A2').value = { formula: 'FALSE()', result: false };
    });
    const rows = await parseExcelRows(buf, { sheetName: 'Sheet1', headerRow: 1 });
    const row0 = rows[0];
    if (!row0) throw new Error('expected rows[0]');
    expect(row0['여부']).toBe('false');
  });

  // 수식 문자열을 값으로 내보내면 안 된다. 결과가 없으면 사람이 보는 값도 없다.
  it('결과 없는 수식 셀 → 빈 문자열', async () => {
    const buf = await buildWorkbookBuffer((ws) => {
      ws.getCell('A1').value = '미계산';
      ws.getCell('B1').value = '이름';
      ws.getCell('A2').value = { formula: 'A9' };
      ws.getCell('B2').value = '홍길동';
    });
    const rows = await parseExcelRows(buf, { sheetName: 'Sheet1', headerRow: 1 });
    const row0 = rows[0];
    if (!row0) throw new Error('expected rows[0]');
    expect(row0['미계산']).toBe('');
    expect(row0['이름']).toBe('홍길동');
  });
});

describe('헤더 셀 직렬화 왕복 - richText·하이퍼링크·수식', () => {
  it('richText 헤더 → 사람이 읽는 컬럼명', async () => {
    const buf = await buildWorkbookBuffer((ws) => {
      ws.getCell('A1').value = { richText: [{ text: '센터' }, { text: ' ID' }] };
      ws.getCell('A2').value = 'v';
    });
    const result = await previewExcel(buf, { sheetName: 'Sheet1', headerRow: 1, maxRows: 1 });
    expect(result.headers[0]).toBe('센터 ID');
  });

  // richText 를 품은 하이퍼링크 셀 — text 가 문자열이 아니라 richText 객체다.
  it('richText 를 품은 하이퍼링크 헤더 → 중첩 text 까지 풀어낸다', async () => {
    const buf = await buildWorkbookBuffer((ws) => {
      ws.getCell('A1').value = {
        text: { richText: [{ text: '개별' }, { text: ' URL' }] },
        hyperlink: 'https://example.com',
      } as unknown as ExcelJS.CellValue;
      ws.getCell('A2').value = 'v';
    });
    const result = await previewExcel(buf, { sheetName: 'Sheet1', headerRow: 1, maxRows: 1 });
    expect(result.headers[0]).toBe('개별 URL');
  });

  it('수식 결과가 0 인 헤더 → 0 으로 읽는다', async () => {
    const buf = await buildWorkbookBuffer((ws) => {
      ws.getCell('A1').value = { formula: '1-1', result: 0 };
      ws.getCell('A2').value = 'v';
    });
    const result = await previewExcel(buf, { sheetName: 'Sheet1', headerRow: 1, maxRows: 1 });
    expect(result.headers[0]).toBe('0');
  });

  it('어떤 헤더도 [object Object] 로 떨어지지 않는다', async () => {
    const buf = await buildWorkbookBuffer((ws) => {
      ws.getCell('A1').value = { richText: [{ text: '연번' }] };
      ws.getCell('B1').value = {
        text: { richText: [{ text: '개별 URL' }] },
        hyperlink: 'https://example.com',
      } as unknown as ExcelJS.CellValue;
      ws.getCell('C1').value = { formula: '1-1', result: 0 };
      ws.getCell('D1').value = { formula: 'FALSE()', result: false };
      ws.getCell('A2').value = 'v';
    });
    const result = await previewExcel(buf, { sheetName: 'Sheet1', headerRow: 1, maxRows: 1 });
    expect(result.headers.some((h) => h.includes('[object Object]'))).toBe(false);
  });
});
