import 'server-only';

import ExcelJS from 'exceljs';
import { and, inArray } from 'drizzle-orm';

import { db } from '@/db';
import { contactPii } from '@/db/schema';
import { decryptPii } from '@/lib/crypto/aes';

import {
  formatExportCell,
  type ContactExportRowData,
  type ExportColumn,
} from './contacts-export';

/** inArray 파라미터 폭주 방지용 청크 크기 */
const PII_QUERY_CHUNK = 5000;

/**
 * 선택된 PII 컬럼들을 대상 전체에 대해 일괄 복호화.
 * 반환: contactTargetId → (columnKey → 평문). 복호화 실패 항목은 빈 문자열.
 */
export async function decryptPiiForExport(
  targetIds: string[],
  columnKeys: string[],
): Promise<Map<string, Record<string, string>>> {
  const result = new Map<string, Record<string, string>>();
  if (targetIds.length === 0 || columnKeys.length === 0) return result;

  let failedCount = 0;
  for (let i = 0; i < targetIds.length; i += PII_QUERY_CHUNK) {
    const chunk = targetIds.slice(i, i + PII_QUERY_CHUNK);
    const rows = await db
      .select({
        contactTargetId: contactPii.contactTargetId,
        columnKey: contactPii.columnKey,
        cipher: contactPii.cipher,
      })
      .from(contactPii)
      .where(
        and(
          inArray(contactPii.contactTargetId, chunk),
          inArray(contactPii.columnKey, columnKeys),
        ),
      );

    for (const row of rows) {
      let plain = '';
      try {
        plain = decryptPii(row.cipher);
      } catch {
        // 키 로테이션 등으로 복호화 실패 — 행 전체를 죽이지 않고 빈 값 처리
        plain = '';
        failedCount += 1;
      }
      const entry = result.get(row.contactTargetId) ?? {};
      entry[row.columnKey] = plain;
      result.set(row.contactTargetId, entry);
    }
  }
  if (failedCount > 0) {
    // cipher/평문/대상 id 는 로그 금지 — 건수만 남긴다 (키 로테이션 사고 탐지용)
    console.error(`decryptPiiForExport: 복호화 실패 ${failedCount}건`);
  }
  return result;
}

/** 선택 컬럼 라벨 헤더(볼드) + 포맷된 데이터 행으로 단일 시트 워크북 생성 */
export function buildContactsExportWorkbook(
  columns: ExportColumn[],
  rows: ContactExportRowData[],
  inviteBaseUrl: string,
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('조사 대상');

  const header = ws.addRow(columns.map((c) => c.label));
  header.font = { bold: true };

  for (const row of rows) {
    ws.addRow(columns.map((c) => formatExportCell(c.source, row, inviteBaseUrl)));
  }
  return workbook;
}
