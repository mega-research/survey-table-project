import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { previewExcel, parseExcelRows, normalizeHeaderKey } from '@/lib/contacts/excel-parser';

async function loadFixture(name: string): Promise<Buffer> {
  return readFile(`tests/fixtures/contacts/${name}`);
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
    expect(result.rows[0]['이메일']).toBe('aaa@test.com');
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
    expect(rows[0]['연번']).toBe('1');
    expect(rows[0]['담당자 이메일']).toBe('grpA@test.com');
  });

  it('빈 셀 → 빈 문자열 보존 (NULL 아님)', async () => {
    const buf = await loadFixture('individual-mini.xlsx');
    const rows = await parseExcelRows(buf, { sheetName: '개별참가', headerRow: 2 });
    expect(rows[2]['이메일']).toBe('');  // Row 3 = 이메일 비어있음
    expect(rows[3]['사업자번호']).toBe('');  // Row 4 = 사업자번호 비어있음
  });

  it('숫자 셀 → 문자열로 보관', async () => {
    const buf = await loadFixture('individual-mini.xlsx');
    const rows = await parseExcelRows(buf, { sheetName: '개별참가', headerRow: 2 });
    expect(rows[0]['연 번']).toBe('1');
    expect(rows[0]['사업자번호']).toBe('1234567890');
  });
});
