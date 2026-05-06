'use server';

import { revalidatePath } from 'next/cache';

import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets, contactUploads, surveys } from '@/db/schema';
import type {
  ContactColumnDef,
  ContactColumnScheme,
  ContactUploadMapping,
} from '@/db/schema/schema-types';
import { requireAuth } from '@/lib/auth';
import { parseExcelRows, previewExcel } from '@/lib/contacts/excel-parser';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_ROWS = 5000;

function ensureXlsx(file: File): void {
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    throw new Error('xlsx 파일만 업로드할 수 있습니다.');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`파일 크기가 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB 를 초과합니다.`);
  }
}

export interface ParseExcelPreviewInput {
  file: File;
  sheetName?: string;
  headerRow?: number;
}

export interface ParseExcelPreviewResult {
  sheetNames: string[];
  headers: string[];
  rows: Array<Record<string, string>>;
  totalRows: number;
}

/**
 * 매핑 모달용 미리보기. admin 인증 필수.
 */
export async function parseExcelPreview(
  input: ParseExcelPreviewInput,
): Promise<ParseExcelPreviewResult> {
  await requireAuth();
  ensureXlsx(input.file);

  const buffer = Buffer.from(await input.file.arrayBuffer());
  const result = await previewExcel(buffer, {
    sheetName: input.sheetName ?? '',
    headerRow: input.headerRow ?? 1,
    maxRows: 5,
  });

  if (result.totalRows > MAX_ROWS) {
    throw new Error(
      `최대 ${MAX_ROWS.toLocaleString('ko-KR')} 행까지 적재 가능합니다 (현재 ${result.totalRows.toLocaleString('ko-KR')} 행).`,
    );
  }

  return {
    sheetNames: result.sheetNames,
    headers: result.headers,
    rows: result.rows,
    totalRows: result.totalRows,
  };
}

export interface IngestContactUploadInput {
  surveyId: string;
  file: File;
  mapping: ContactUploadMapping;
}

export interface IngestContactUploadResult {
  uploadId: string;
  uploadedRows: number;
  mergedRows: number;
  errorRows: number;
}

/**
 * 엑셀 풀 파싱 + UPSERT.
 *
 * 머지 정책 (spec 엣지케이스 #14, #16):
 * - 같은 그룹 + 머지키 일치 → shallow merge attrs (NULL/빈문자 새 값은 덮지 않음)
 * - responded_at/response_id/invite_token 은 머지에서 절대 덮지 않음
 * - 다른 그룹 → 신규 행
 *
 * 트랜잭션: 단일 트랜잭션. 행 단위 에러는 errorRows 카운트 + 트랜잭션 자체는 살림.
 *
 * 첫 업로드 시 surveys.contact_columns 가 NULL 이면 자동 생성 (시스템 필드 + 매핑된 attrs 컬럼).
 */
export async function ingestContactUpload(
  input: IngestContactUploadInput,
): Promise<IngestContactUploadResult> {
  await requireAuth();
  ensureXlsx(input.file);
  const { surveyId, file, mapping } = input;

  const buffer = Buffer.from(await file.arrayBuffer());
  const allRows = await parseExcelRows(buffer, {
    sheetName: mapping.sheetName,
    headerRow: mapping.headerRow,
  });

  if (allRows.length > MAX_ROWS) {
    throw new Error(
      `최대 ${MAX_ROWS.toLocaleString('ko-KR')} 행까지 적재 가능합니다.`,
    );
  }

  const headerKeys = allRows.length > 0 ? Object.keys(allRows[0]) : [];
  const groupKey = headerKeys[mapping.systemFields.group];
  const emailKey =
    mapping.systemFields.email != null ? headerKeys[mapping.systemFields.email] : null;
  const bizKey =
    mapping.systemFields.biz != null ? headerKeys[mapping.systemFields.biz] : null;

  if (!groupKey) {
    throw new Error('그룹 컬럼이 매핑되지 않았습니다.');
  }

  let uploadedRows = 0;
  let mergedRows = 0;
  let errorRows = 0;

  const result = await db.transaction(async (tx) => {
    const [upload] = await tx
      .insert(contactUploads)
      .values({
        surveyId,
        filename: file.name,
        uploadedRows: 0,
        mergedRows: 0,
        errorRows: 0,
        mapping,
      })
      .returning({ id: contactUploads.id });

    if (!upload) throw new Error('contact_uploads INSERT 실패');

    for (const row of allRows) {
      try {
        const groupValue = row[groupKey] || null;
        const email = emailKey ? row[emailKey] || null : null;
        const biz = bizKey ? row[bizKey] || null : null;

        // 머지키 정책 (spec #13)
        const mergeFilters = [eq(contactTargets.surveyId, surveyId)];
        if (groupValue) mergeFilters.push(eq(contactTargets.groupValue, groupValue));

        let canMerge = false;
        if (mapping.mergeKey === 'email+biz') {
          if (mapping.mergeKeyPolicy === 'both' && email && biz) {
            mergeFilters.push(eq(contactTargets.email, email));
            mergeFilters.push(eq(contactTargets.bizNumber, biz));
            canMerge = true;
          } else if (mapping.mergeKeyPolicy === 'either' && (email || biz)) {
            if (email) mergeFilters.push(eq(contactTargets.email, email));
            else if (biz) mergeFilters.push(eq(contactTargets.bizNumber, biz));
            canMerge = true;
          }
        } else if (mapping.mergeKey === 'email' && email) {
          mergeFilters.push(eq(contactTargets.email, email));
          canMerge = true;
        } else if (mapping.mergeKey === 'biz' && biz) {
          mergeFilters.push(eq(contactTargets.bizNumber, biz));
          canMerge = true;
        }

        const existing = canMerge
          ? await tx
              .select({ id: contactTargets.id, attrs: contactTargets.attrs })
              .from(contactTargets)
              .where(and(...mergeFilters))
              .limit(1)
          : [];

        if (existing.length > 0 && existing[0]) {
          // shallow merge: 새 값이 비어있지 않은 키만 갱신
          const oldAttrs = (existing[0].attrs as Record<string, string>) ?? {};
          const newAttrs: Record<string, string> = { ...oldAttrs };
          for (const [k, v] of Object.entries(row)) {
            if (v != null && v !== '') newAttrs[k] = v;
          }
          await tx
            .update(contactTargets)
            .set({
              attrs: newAttrs,
              email: email ?? oldAttrs[emailKey ?? ''] ?? null,
              bizNumber: biz ?? oldAttrs[bizKey ?? ''] ?? null,
              uploadId: upload.id,
              updatedAt: new Date(),
            })
            .where(eq(contactTargets.id, existing[0].id));
          mergedRows += 1;
        } else {
          // 신규 INSERT — resid 발번 (advisory lock)
          const residResult = (await tx.execute(
            sql`SELECT next_contact_resid(${surveyId}::uuid) AS resid`,
          )) as unknown as
            | { rows?: Array<{ resid: number }> }
            | Array<{ resid: number }>;
          // pg-driver 마다 결과 형태가 다름 (postgres-js 는 array, node-postgres 는 .rows)
          const rows = Array.isArray(residResult)
            ? residResult
            : (residResult.rows ?? []);
          const residRow = rows[0];
          if (!residRow || residRow.resid == null) {
            throw new Error('next_contact_resid 호출 실패');
          }
          await tx.insert(contactTargets).values({
            surveyId,
            resid: residRow.resid,
            groupValue,
            email,
            bizNumber: biz,
            attrs: row,
            uploadId: upload.id,
          });
          uploadedRows += 1;
        }
      } catch (e) {
        errorRows += 1;
        console.error(`[ingestContactUpload] row error: ${(e as Error).message}`);
      }
    }

    await tx
      .update(contactUploads)
      .set({ uploadedRows, mergedRows, errorRows })
      .where(eq(contactUploads.id, upload.id));

    // 첫 업로드 → 컬럼 스킴 자동 생성
    const [s] = await tx
      .select({ contactColumns: surveys.contactColumns })
      .from(surveys)
      .where(eq(surveys.id, surveyId))
      .limit(1);
    if (!s?.contactColumns) {
      const scheme = autoGenerateColumnScheme(headerKeys, mapping);
      await tx.update(surveys).set({ contactColumns: scheme }).where(eq(surveys.id, surveyId));
    }

    return { uploadId: upload.id, uploadedRows, mergedRows, errorRows };
  });

  revalidatePath(`/admin/surveys/${surveyId}/operations/contacts`);
  revalidatePath(`/admin/surveys/${surveyId}/operations/contacts/upload`);
  return result;
}

function autoGenerateColumnScheme(
  headerKeys: string[],
  mapping: ContactUploadMapping,
): ContactColumnScheme {
  const columns: ContactColumnDef[] = [];
  let order = 1;

  columns.push({ key: 'resid', label: '#', source: 'system.resid', order: order++ });

  const sf = mapping.systemFields;
  const addAttrs = (idx: number | undefined) => {
    if (idx == null) return;
    const k = headerKeys[idx];
    if (!k) return;
    columns.push({ key: k, label: k, source: `attrs.${k}`, order: order++ });
  };

  addAttrs(sf.group);
  addAttrs(sf.company);
  addAttrs(sf.email);
  addAttrs(sf.biz);
  addAttrs(sf.phone);

  // 운영 컬럼 (read 만, 본 슬라이스)
  columns.push({
    key: 'contact_result',
    label: '컨택결과',
    source: 'system.contact_result',
    order: order++,
  });
  columns.push({
    key: 'email_count',
    label: '메일',
    source: 'system.email_count',
    order: order++,
  });
  columns.push({ key: 'web', label: 'web', source: 'system.web', order: order++ });
  columns.push({
    key: 'contact_owner',
    label: '컨택원',
    source: 'system.contact_owner',
    order: order++,
  });

  return { version: 1, headerRow: mapping.headerRow, columns };
}

export async function updateContactColumns(
  surveyId: string,
  scheme: ContactColumnScheme,
): Promise<void> {
  await requireAuth();
  // resid 는 hide 불가 가드 (spec 엣지케이스 #28)
  for (const c of scheme.columns) {
    if (c.source === 'system.resid' && c.hidden) {
      throw new Error('resid 컬럼은 숨길 수 없습니다.');
    }
  }
  await db.update(surveys).set({ contactColumns: scheme }).where(eq(surveys.id, surveyId));
  revalidatePath(`/admin/surveys/${surveyId}/operations/contacts`);
  revalidatePath(`/admin/surveys/${surveyId}/operations/contacts/columns`);
}
