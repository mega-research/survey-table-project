'use server';

import { revalidatePath } from 'next/cache';

import { eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { contactAttempts, contactTargets, contactUploads, surveys } from '@/db/schema';
import type {
  ContactColumnDef,
  ContactColumnScheme,
  ContactMethod,
  ContactResultCode,
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
 * 엑셀 풀 파싱 + 통째 교체 (시나리오 B).
 *
 * 기존 contact_targets 를 모두 DELETE 한 뒤 신규 INSERT.
 * - survey_responses.contact_target_id 는 SET NULL (응답 본체 보존, 매칭만 끊김)
 * - contact_attempts 는 CASCADE 로 함께 삭제 (회차 기록 사라짐)
 * - 기존 invite_token 도 함께 사라짐 (발송된 메일 링크 무효화)
 *
 * 클라이언트가 경고 카드로 사용자 confirm 후 호출 — 서버는 가드 없음.
 *
 * 트랜잭션: 단일 트랜잭션. 행 단위 INSERT 에러는 SAVEPOINT 격리.
 * 컬럼 스킴: 매핑된 selectedAttrsKeys 기준으로 매번 재생성.
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
    // 시나리오 B: 기존 컨택 통째 DELETE.
    // FK 동작: survey_responses 는 SET NULL (응답 보존), contact_attempts 는 CASCADE.
    // 클라이언트가 경고 confirm 후 호출 — 서버는 가드 없이 실행.
    await tx.delete(contactTargets).where(eq(contactTargets.surveyId, surveyId));

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
        await tx.transaction(async (sp) => {
          const groupValue = row[groupKey] || null;
          const email = emailKey ? row[emailKey] || null : null;
          const biz = bizKey ? row[bizKey] || null : null;

          const residRows = (await sp.execute(
            sql`SELECT next_contact_resid(${surveyId}::uuid) AS resid`,
          )) as unknown as Array<{ resid: number }>;
          const resid = residRows[0]?.resid;
          if (resid == null) throw new Error('next_contact_resid 호출 실패');

          await sp.insert(contactTargets).values({
            surveyId,
            resid,
            groupValue,
            email,
            bizNumber: biz,
            attrs: row,
            uploadId: upload.id,
          });
          uploadedRows += 1;
        });
      } catch (e) {
        errorRows += 1;
        console.error(`[ingestContactUpload] row error: ${(e as Error).message}`);
      }
    }

    await tx
      .update(contactUploads)
      .set({ uploadedRows, mergedRows, errorRows })
      .where(eq(contactUploads.id, upload.id));

    // 통째 교체 후엔 컬럼 스킴도 새 매핑 기준으로 재생성.
    const scheme = autoGenerateColumnScheme(headerKeys, mapping);
    await tx.update(surveys).set({ contactColumns: scheme }).where(eq(surveys.id, surveyId));

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

  // 시스템 컬럼 (resid 항상 1번, 표시 필수)
  columns.push({ key: 'resid', label: '#', source: 'system.resid', order: order++ });

  // 모든 attrs 헤더 키를 컬럼으로 등록.
  // 사용자가 매핑 모달에서 토글한 키만 hidden:false, 나머지는 hidden:true.
  const selected = new Set(mapping.selectedAttrsKeys);
  for (const key of headerKeys) {
    columns.push({
      key,
      label: key,
      source: `attrs.${key}`,
      order: order++,
      hidden: !selected.has(key),
    });
  }

  // 운영 컬럼 (read 만, 본 슬라이스)
  columns.push({ key: 'contact_result', label: '컨택결과', source: 'system.contact_result', order: order++ });
  columns.push({ key: 'email_count', label: '메일', source: 'system.email_count', order: order++ });
  columns.push({ key: 'web', label: 'web', source: 'system.web', order: order++ });
  columns.push({ key: 'contact_owner', label: '컨택원', source: 'system.contact_owner', order: order++ });

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

/**
 * 업로드 마법사 경고 카드용 — 기존 컨택 행 수.
 * 0 이면 신규 업로드, > 0 이면 통째 교체 경고 필요.
 */
export async function getExistingContactsCount(surveyId: string): Promise<number> {
  await requireAuth();
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(contactTargets)
    .where(eq(contactTargets.surveyId, surveyId));
  return row?.total ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// 행 단위 CRUD (시나리오 B — 한 번 업로드 후 명단 갱신)
// ─────────────────────────────────────────────────────────────────────────────

export interface AddContactTargetInput {
  surveyId: string;
  attrs: Record<string, string>;
  memo?: string | null;
  contactMethod?: ContactMethod | null;
  /** 시스템 필드는 attrs 의 어느 키에 있는지 — 컬럼 스킴의 systemFields 맵 활용 */
  systemFieldKeys?: {
    group?: string;
    email?: string;
    biz?: string;
  };
}

export interface ContactTargetRow {
  id: string;
  resid: number;
}

/**
 * 컨택리스트의 "+ 컨택 추가" 모달 저장 액션.
 * resid 는 next_contact_resid() 로 자동 발번.
 */
export async function addContactTarget(
  input: AddContactTargetInput,
): Promise<ContactTargetRow> {
  await requireAuth();
  const { surveyId, attrs, memo, contactMethod, systemFieldKeys } = input;

  const groupValue = systemFieldKeys?.group ? (attrs[systemFieldKeys.group] || null) : null;
  const email = systemFieldKeys?.email ? (attrs[systemFieldKeys.email] || null) : null;
  const biz = systemFieldKeys?.biz ? (attrs[systemFieldKeys.biz] || null) : null;

  const result = await db.transaction(async (tx) => {
    const residRows = (await tx.execute(
      sql`SELECT next_contact_resid(${surveyId}::uuid) AS resid`,
    )) as unknown as Array<{ resid: number }>;
    const resid = residRows[0]?.resid;
    if (resid == null) throw new Error('next_contact_resid 호출 실패');

    const [row] = await tx
      .insert(contactTargets)
      .values({
        surveyId,
        resid,
        groupValue,
        email,
        bizNumber: biz,
        attrs,
        memo: memo ?? null,
        contactMethod: contactMethod ?? null,
      })
      .returning({ id: contactTargets.id, resid: contactTargets.resid });
    if (!row) throw new Error('contact_targets INSERT 실패');
    return row;
  });

  revalidatePath(`/admin/surveys/${surveyId}/operations/contacts`);
  return result;
}

export interface UpdateContactTargetInput {
  id: string;
  surveyId: string;
  attrs: Record<string, string>;
  memo?: string | null;
  contactMethod?: ContactMethod | null;
  systemFieldKeys?: {
    group?: string;
    email?: string;
    biz?: string;
  };
}

export async function updateContactTarget(
  input: UpdateContactTargetInput,
): Promise<void> {
  await requireAuth();
  const { id, surveyId, attrs, memo, contactMethod, systemFieldKeys } = input;

  const groupValue = systemFieldKeys?.group ? (attrs[systemFieldKeys.group] || null) : null;
  const email = systemFieldKeys?.email ? (attrs[systemFieldKeys.email] || null) : null;
  const biz = systemFieldKeys?.biz ? (attrs[systemFieldKeys.biz] || null) : null;

  await db
    .update(contactTargets)
    .set({
      attrs,
      groupValue,
      email,
      bizNumber: biz,
      memo: memo ?? null,
      contactMethod: contactMethod ?? null,
      updatedAt: new Date(),
    })
    .where(eq(contactTargets.id, id));

  revalidatePath(`/admin/surveys/${surveyId}/operations/contacts`);
  revalidatePath(`/admin/surveys/${surveyId}/operations/contacts/${id}`);
}

export async function deleteContactTarget(
  surveyId: string,
  id: string,
): Promise<void> {
  await requireAuth();
  await db.delete(contactTargets).where(eq(contactTargets.id, id));
  revalidatePath(`/admin/surveys/${surveyId}/operations/contacts`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 컨택 회차 (contact_attempts) CRUD — slice 3 detail page
// ─────────────────────────────────────────────────────────────────────────────

export interface AddContactAttemptInput {
  contactTargetId: string;
  surveyId: string;
  resultCode: string;
  note?: string;
}

/**
 * 회차 추가 — attempt_no 는 MAX(attempt_no)+1 로 자동 발번.
 * UNIQUE(contact_target_id, attempt_no) 가 race 가드.
 *
 * I6: 두 사용자 동시 추가 시 23505 (UNIQUE 위반) 발생 가능 → 최대 3회 재시도.
 * 3회 모두 실패 시 user-facing error.
 */
export async function addContactAttempt(
  input: AddContactAttemptInput,
): Promise<{ id: string; attemptNo: number }> {
  await requireAuth();
  const { contactTargetId, surveyId, resultCode, note } = input;

  const MAX_RETRIES = 3;
  let lastError: unknown = null;
  let result: { id: string; attemptNo: number } | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      result = await db.transaction(async (tx) => {
        const [maxRow] = await tx
          .select({ maxNo: sql<number | null>`MAX(${contactAttempts.attemptNo})` })
          .from(contactAttempts)
          .where(eq(contactAttempts.contactTargetId, contactTargetId));
        const nextNo = (maxRow?.maxNo ?? 0) + 1;

        const [row] = await tx
          .insert(contactAttempts)
          .values({
            contactTargetId,
            attemptNo: nextNo,
            resultCode,
            note: note ?? null,
          })
          .returning({ id: contactAttempts.id, attemptNo: contactAttempts.attemptNo });
        if (!row) throw new Error('contact_attempts INSERT 실패');
        return row;
      });
      break; // 성공 시 retry loop 종료
    } catch (e) {
      lastError = e;
      if (!isUniqueViolation(e)) throw e; // 다른 에러는 즉시 전파
      // UNIQUE 위반은 retry — 다음 iteration 에서 MAX+1 재계산
    }
  }

  if (result == null) {
    console.error('[addContactAttempt] race retry exhausted:', lastError);
    throw new Error('동시 편집 충돌이 발생했습니다. 다시 시도해주세요.');
  }

  revalidatePath(`/admin/surveys/${surveyId}/operations/contacts/${contactTargetId}`);
  revalidatePath(`/admin/surveys/${surveyId}/operations/contacts`);
  return result;
}

/**
 * Postgres UNIQUE 위반 (SQLSTATE 23505) 감지.
 * drizzle-orm + postgres-js 의 error 객체에 code 필드.
 * 폴백으로 message 문자열도 검사.
 */
function isUniqueViolation(e: unknown): boolean {
  if (e == null || typeof e !== 'object') return false;
  const err = e as { code?: unknown; message?: unknown };
  if (err.code === '23505') return true;
  if (typeof err.message === 'string') {
    if (err.message.includes('23505')) return true;
    if (err.message.toLowerCase().includes('unique')) return true;
  }
  return false;
}

export interface UpdateContactAttemptInput {
  id: string;
  contactTargetId: string;
  surveyId: string;
  resultCode: string;
  note?: string;
}

export async function updateContactAttempt(input: UpdateContactAttemptInput): Promise<void> {
  await requireAuth();
  const { id, contactTargetId, surveyId, resultCode, note } = input;
  await db
    .update(contactAttempts)
    .set({ resultCode, note: note ?? null })
    .where(eq(contactAttempts.id, id));
  revalidatePath(`/admin/surveys/${surveyId}/operations/contacts/${contactTargetId}`);
  revalidatePath(`/admin/surveys/${surveyId}/operations/contacts`);
}

export async function deleteContactAttempt(
  surveyId: string,
  contactTargetId: string,
  id: string,
): Promise<void> {
  await requireAuth();
  await db.delete(contactAttempts).where(eq(contactAttempts.id, id));
  revalidatePath(`/admin/surveys/${surveyId}/operations/contacts/${contactTargetId}`);
  revalidatePath(`/admin/surveys/${surveyId}/operations/contacts`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 결과코드 set 갱신 (surveys.contact_result_codes) — slice 3 detail page
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 결과코드 set 갱신 — NULL 로 set 하면 DEFAULT_RESULT_CODES 폴백.
 * 빈 배열은 reject (최소 1개 필요).
 */
export async function updateContactResultCodes(
  surveyId: string,
  codes: ContactResultCode[] | null,
): Promise<void> {
  await requireAuth();

  if (codes && codes.length === 0) {
    throw new Error('결과코드는 최소 1개 이상이어야 합니다.');
  }

  await db
    .update(surveys)
    .set({ contactResultCodes: codes })
    .where(eq(surveys.id, surveyId));

  revalidatePath(`/admin/surveys/${surveyId}/operations/contacts`);
  revalidatePath(`/admin/surveys/${surveyId}/operations/contacts/result-codes`);
}
