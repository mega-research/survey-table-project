import { deflateRawSync } from 'node:zlib';

import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { ExcelReadError, parseExcelRows, previewExcel } from './excel-parser';
import { repairPrefixedXlsx } from './xlsx-namespace-repair';

const SPREADSHEETML_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const PACKAGE_RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_RELS_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

interface ZipEntry {
  name: string;
  data: Buffer;
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]!;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * 테스트 픽스처용 zip 작성기. 복구 모듈의 재포장기와 달리 deflate 로 압축한다 —
 * 복구 경로가 stored 뿐 아니라 실제 xlsx 가 쓰는 deflate 엔트리도 풀어내는지 함께 본다.
 */
function makeZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const deflated = deflateRawSync(entry.data);
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    locals.push(local, deflated);
    centrals.push(central);
    offset += local.length + deflated.length;
  }

  const centralDirectory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralDirectory, eocd]);
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" /><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" /><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" /></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="${PACKAGE_RELS_NS}"><Relationship Type="${OFFICE_RELS_NS}/officeDocument" Target="/xl/workbook.xml" Id="rId1" /></Relationships>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="${PACKAGE_RELS_NS}"><Relationship Type="${OFFICE_RELS_NS}/worksheet" Target="/xl/worksheets/sheet1.xml" Id="rSheet1" /></Relationships>`;

/**
 * OpenXML SDK / ClosedXML 계열이 내보내는 접두사 네임스페이스 형태.
 * exceljs 4.4 의 SAX xform 은 태그명을 접두사 없는 리터럴로만 매칭해 이걸 못 읽는다.
 */
function prefixedWorkbookXml(prefix: string): string {
  return `<?xml version="1.0" encoding="utf-8"?><${prefix}:workbook xmlns:${prefix}="${SPREADSHEETML_NS}"><${prefix}:sheets><${prefix}:sheet name="명단" sheetId="1" r:id="rSheet1" xmlns:r="${OFFICE_RELS_NS}" /></${prefix}:sheets></${prefix}:workbook>`;
}

function prefixedSheetXml(prefix: string): string {
  const cell = (ref: string, text: string) =>
    `<${prefix}:c r="${ref}" t="inlineStr"><${prefix}:is><${prefix}:t>${text}</${prefix}:t></${prefix}:is></${prefix}:c>`;
  return (
    `<?xml version="1.0" encoding="utf-8"?><${prefix}:worksheet xmlns:${prefix}="${SPREADSHEETML_NS}"><${prefix}:sheetData>` +
    `<${prefix}:row r="1">${cell('A1', '이름')}${cell('B1', '이메일')}</${prefix}:row>` +
    `<${prefix}:row r="2">${cell('A2', '홍길동')}${cell('B2', 'hong@example.com')}</${prefix}:row>` +
    `<${prefix}:row r="3">${cell('A3', '김철수')}${cell('B3', 'kim@example.com')}</${prefix}:row>` +
    `</${prefix}:sheetData></${prefix}:worksheet>`
  );
}

function prefixedXlsx(prefix = 'x'): Buffer {
  return makeZip([
    { name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(ROOT_RELS, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(prefixedWorkbookXml(prefix), 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(WORKBOOK_RELS, 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(prefixedSheetXml(prefix), 'utf8') },
  ]);
}

/** exceljs 자신이 쓴 정상 xlsx — 복구가 개입하면 안 되는 대조군. */
async function normalXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('명단');
  ws.addRow(['이름', '이메일']);
  ws.addRow(['홍길동', 'hong@example.com']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

describe('repairPrefixedXlsx', () => {
  it('exceljs 는 접두사 네임스페이스 xlsx 를 읽지 못한다 — 복구가 필요한 이유', async () => {
    // 이 기대가 깨지면(= 업스트림이 고쳐지면) 복구 폴백은 죽은 코드가 된다.
    const wb = new ExcelJS.Workbook();
    await expect(wb.xlsx.load(toArrayBuffer(prefixedXlsx()))).rejects.toThrow(/sheets/);
  });

  it('복구본은 exceljs 가 읽는다 — 시트명과 셀 값 보존', async () => {
    const repaired = repairPrefixedXlsx(prefixedXlsx());
    expect(repaired).not.toBeNull();

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(toArrayBuffer(repaired!));
    const ws = wb.getWorksheet('명단');
    expect(ws).toBeDefined();
    expect(ws!.getCell('A1').value).toBe('이름');
    expect(ws!.getCell('B3').value).toBe('kim@example.com');
  });

  it('접두사 문자열에 의존하지 않는다 — ss: 등 다른 접두사도 복구', () => {
    expect(repairPrefixedXlsx(prefixedXlsx('ss'))).not.toBeNull();
  });

  it('정상 xlsx 는 복구 대상이 아니다 (null)', async () => {
    expect(repairPrefixedXlsx(await normalXlsx())).toBeNull();
  });

  it('xlsx 가 아닌 바이트는 복구 대상이 아니다 (null)', () => {
    expect(repairPrefixedXlsx(Buffer.from('not a zip at all'))).toBeNull();
  });
});

describe('excel-parser — 접두사 네임스페이스 폴백', () => {
  it('previewExcel 이 헤더와 미리보기 행을 돌려준다', async () => {
    const preview = await previewExcel(prefixedXlsx(), {
      sheetName: '',
      headerRow: 1,
      maxRows: 5,
    });
    expect(preview.sheetNames).toEqual(['명단']);
    expect(preview.headers).toEqual(['이름', '이메일']);
    expect(preview.rows).toHaveLength(2);
    expect(preview.rows[0]).toEqual({ 이름: '홍길동', 이메일: 'hong@example.com' });
  });

  it('parseExcelRows 가 전체 행을 돌려준다', async () => {
    const rows = await parseExcelRows(prefixedXlsx(), { sheetName: '명단', headerRow: 1 });
    expect(rows).toEqual([
      { 이름: '홍길동', 이메일: 'hong@example.com' },
      { 이름: '김철수', 이메일: 'kim@example.com' },
    ]);
  });

  it('읽을 수 없는 파일은 ExcelReadError — 마법사에 띄울 사용자향 문구', async () => {
    // 평범한 Error 로 새어나가면 oRPC 가 운영에서 'Internal server error' 로 마스킹한다.
    const attempt = previewExcel(Buffer.from('이건 엑셀이 아니다'), {
      sheetName: '',
      headerRow: 1,
      maxRows: 5,
    });
    await expect(attempt).rejects.toBeInstanceOf(ExcelReadError);
    await expect(attempt).rejects.toThrow(/다른 이름으로 저장/);
  });
});
