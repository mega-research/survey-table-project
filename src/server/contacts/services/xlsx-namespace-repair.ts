import { inflateRawSync } from 'node:zlib';

/**
 * 접두사 네임스페이스로 저장된 xlsx 복구 (읽기 실패 폴백 전용).
 *
 * OpenXML SDK / ClosedXML 계열 도구는 스프레드시트 파트를 접두사와 함께 쓴다:
 *
 *   <x:workbook xmlns:x="…/spreadsheetml/2006/main"><x:sheets><x:sheet …/></x:sheets></x:workbook>
 *
 * OOXML 스펙상 유효하지만 exceljs 4.4 의 SAX xform 은 태그명을 접두사 없는
 * 리터럴('workbook'/'sheets'/'sheet')로만 매칭한다. 그래서 루트가 한 번도 열리지
 * 않고 parseWorkbook() 이 undefined 를 반환하며, 곧바로 `workbook.sheets` 접근에서
 * `Cannot read properties of undefined (reading 'sheets')` 로 터진다
 * (exceljs/lib/xlsx/xlsx.js 의 load).
 *
 * 그래서 이 모듈은 zip 을 풀어 스프레드시트 네임스페이스에 묶인 접두사만 벗기고
 * 다시 묶는다. 정상 파일에는 절대 개입하지 않는다 — 파싱이 실패한 뒤에만 호출되고,
 * 벗길 접두사가 없으면 null 을 돌려 폴백을 포기한다.
 *
 * zip 처리를 직접 하는 이유는 의존성을 늘리지 않기 위해서다. 재포장은 무압축
 * (stored) 으로 하며, 이 산출물은 exceljs 에 즉시 먹이고 버리는 임시본이다.
 */

const SPREADSHEETML_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

/** 압축 해제 총량 상한 — 업로드 상한(20MB)의 zip 폭탄 여유를 둔 값. */
const MAX_INFLATED_BYTES = 200 * 1024 * 1024;

const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

interface ZipEntry {
  name: string;
  data: Buffer;
}

/**
 * zip 엔트리 전체를 압축 해제해 반환. 스펙 밖(zip64·미지원 압축 방식·구조 손상)이면
 * null — 폴백을 포기하고 원래 에러를 사용자에게 보여주는 쪽이 맞다.
 */
function readZipEntries(buf: Buffer): ZipEntry[] | null {
  // EOCD 는 파일 끝에 있고 주석(최대 64KB)이 뒤에 붙을 수 있어 역방향 탐색한다.
  let eocd = -1;
  const minStart = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= minStart; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  // zip64 센티널 — 이 모듈은 32bit 헤더만 읽는다.
  if (count === 0xffff || cdOffset === 0xffffffff) return null;

  const entries: ZipEntry[] = [];
  let inflated = 0;
  let p = cdOffset;

  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL_HEADER_SIG) return null;

    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    if (compressedSize === 0xffffffff || localOffset === 0xffffffff) return null;

    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');

    // 로컬 헤더의 name/extra 길이는 중앙 디렉터리와 다를 수 있어 따로 읽는다.
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LOCAL_HEADER_SIG) {
      return null;
    }
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + compressedSize > buf.length) return null;
    const raw = buf.subarray(dataStart, dataStart + compressedSize);

    let data: Buffer;
    if (method === 0) {
      data = Buffer.from(raw);
    } else if (method === 8) {
      try {
        data = inflateRawSync(raw);
      } catch {
        return null;
      }
    } else {
      return null;
    }

    inflated += data.length;
    if (inflated > MAX_INFLATED_BYTES) return null;

    entries.push({ name, data });
    p += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
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

/** 무압축(stored) zip 재포장. exceljs 에 바로 먹일 임시본이라 압축 이득이 필요 없다. */
function writeStoredZip(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(LOCAL_HEADER_SIG, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0x21, 12); // mod date: 1980-01-01 (재현 가능한 고정값)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra len
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(CENTRAL_HEADER_SIG, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(0, 10); // method: stored
    central.writeUInt16LE(0, 12); // mod time
    central.writeUInt16LE(0x21, 14); // mod date
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra len
    central.writeUInt16LE(0, 32); // comment len
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    parts.push(local, entry.data);
    centrals.push(central);
    offset += local.length + size;
  }

  const centralDirectory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4); // this disk
  eocd.writeUInt16LE(0, 6); // disk with CD
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // comment len

  return Buffer.concat([...parts, centralDirectory, eocd]);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 스프레드시트 네임스페이스에 묶인 접두사만 제거. 그 네임스페이스를 접두사로
 * 선언하지 않은 파트는 null (건드릴 이유가 없다).
 *
 * `r:id` 같은 다른 네임스페이스 접두사는 그대로 둔다 — exceljs 는 그쪽은 접두사째로
 * 읽는다. 속성명에는 접두사가 붙지 않으므로(기본 네임스페이스는 속성에 적용되지 않음)
 * 태그 여는/닫는 위치만 바꾼다.
 */
function stripSpreadsheetPrefix(xml: string): string | null {
  const declaration = new RegExp(
    `xmlns:([A-Za-z_][A-Za-z0-9_.-]*)="${escapeRegExp(SPREADSHEETML_NS)}"`,
  ).exec(xml);
  if (!declaration) return null;

  const prefix = declaration[1]!;
  return xml
    .replace(new RegExp(`<${escapeRegExp(prefix)}:`, 'g'), '<')
    .replace(new RegExp(`</${escapeRegExp(prefix)}:`, 'g'), '</')
    .replace(
      new RegExp(`xmlns:${escapeRegExp(prefix)}="${escapeRegExp(SPREADSHEETML_NS)}"`, 'g'),
      `xmlns="${SPREADSHEETML_NS}"`,
    );
}

/**
 * 접두사 네임스페이스 xlsx → exceljs 가 읽을 수 있는 형태로 재포장.
 *
 * @returns 복구본 Buffer, 또는 복구 대상이 아니거나 구조를 다룰 수 없으면 null.
 */
export function repairPrefixedXlsx(input: Buffer | ArrayBuffer): Buffer | null {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(new Uint8Array(input));
  const entries = readZipEntries(buf);
  if (!entries) return null;
  // 최소한 workbook 파트는 있어야 xlsx 다.
  if (!entries.some((e) => e.name === 'xl/workbook.xml')) return null;

  let repairedAny = false;
  const rewritten = entries.map((entry) => {
    if (!/\.(xml|rels)$/i.test(entry.name)) return entry;
    const text = entry.data.toString('utf8');
    const stripped = stripSpreadsheetPrefix(text);
    if (stripped === null) return entry;
    repairedAny = true;
    return { name: entry.name, data: Buffer.from(stripped, 'utf8') };
  });

  if (!repairedAny) return null;
  return writeStoredZip(rewritten);
}
