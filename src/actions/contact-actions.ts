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
import { sanitizeAttrsAgainstPii } from '@/lib/contacts/scheme-helpers';
import {
  buildPiiRows,
  insertPiiRows,
  upsertPiiValue,
  type PiiInput,
} from '@/lib/crypto/contact-pii-repo';
import type { PiiFieldType } from '@/lib/crypto/pii-fields';

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
  // 분류 기준은 선택사항 — 미지정 시 모든 행의 group_value = NULL
  const groupKey =
    mapping.systemFields.group != null ? (headerKeys[mapping.systemFields.group] ?? null) : null;

  // 매핑된 PII 컬럼만 추출. 헤더에 없는 키는 자동 드롭.
  const piiEntries: Array<{ columnKey: string; fieldType: PiiFieldType }> = [];
  const piiMapping = mapping.piiMapping ?? {};
  for (const [columnKey, fieldType] of Object.entries(piiMapping)) {
    if (headerKeys.includes(columnKey)) {
      piiEntries.push({ columnKey, fieldType });
    }
  }
  const piiKeySet = new Set(piiEntries.map((e) => e.columnKey));

  let uploadedRows = 0;
  let mergedRows = 0;
  let errorRows = 0;

  const result = await db.transaction(async (tx) => {
    // 시나리오 B: 기존 컨택 통째 DELETE.
    // FK 동작: survey_responses 는 SET NULL (응답 보존), contact_attempts/contact_pii 는 CASCADE.
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
          const groupValue = groupKey ? (row[groupKey] || null) : null;

          // attrs 에서 PII 키 제외 — PII 는 contact_pii 사이드 테이블에만 저장
          const cleanAttrs: Record<string, string> = {};
          for (const [k, v] of Object.entries(row)) {
            if (!piiKeySet.has(k)) cleanAttrs[k] = v;
          }

          const residRows = (await sp.execute(
            sql`SELECT next_contact_resid(${surveyId}::uuid) AS resid`,
          )) as unknown as Array<{ resid: number }>;
          const resid = residRows[0]?.resid;
          if (resid == null) throw new Error('next_contact_resid 호출 실패');

          const [target] = await sp
            .insert(contactTargets)
            .values({
              surveyId,
              resid,
              groupValue,
              attrs: cleanAttrs,
              uploadId: upload.id,
            })
            .returning({ id: contactTargets.id });
          if (!target) throw new Error('contact_targets INSERT 실패');

          // PII 추출 + 암호화 저장 (buildPiiRows 가 빈 값/정규화 후 빈 값 자동 스킵)
          if (piiEntries.length > 0) {
            const piiInputs: PiiInput[] = piiEntries.map((e) => ({
              columnKey: e.columnKey,
              fieldType: e.fieldType,
              plain: row[e.columnKey] ?? '',
            }));
            const piiRows = buildPiiRows(target.id, piiInputs);
            await insertPiiRows(sp, piiRows);
          }

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

  // 모든 헤더 키를 컬럼으로 등록.
  // - piiMapping 에 매핑된 헤더 → source 'pii.<key>' + piiType 명시 → contact_pii 테이블 조인 후 표시
  // - 그 외 → source 'attrs.<key>' → contact_targets.attrs JSONB 에서 표시
  // 사용자가 매핑 모달에서 토글한 키만 hidden:false, 나머지는 hidden:true.
  const selected = new Set(mapping.selectedAttrsKeys);
  const piiMapping = mapping.piiMapping ?? {};
  const labelOverrides = mapping.labelOverrides ?? {};

  for (const key of headerKeys) {
    const piiType = piiMapping[key];
    const label = labelOverrides[key] ?? key;
    if (piiType) {
      columns.push({
        key,
        label,
        source: `pii.${key}`,
        order: order++,
        hidden: !selected.has(key),
        piiType,
      });
    } else {
      columns.push({
        key,
        label,
        source: `attrs.${key}`,
        order: order++,
        hidden: !selected.has(key),
      });
    }
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

export interface PiiUpdate {
  /** ContactColumnDef.source 가 'pii.<columnKey>' 인 컬럼의 columnKey */
  columnKey: string;
  fieldType: PiiFieldType;
  /** 평문값. 빈 문자열이면 기존 PII row 삭제. */
  plain: string;
}


export interface AddContactTargetInput {
  surveyId: string;
  attrs: Record<string, string>;
  /** PII 컬럼 값 (재암호화 후 contact_pii 에 저장) */
  piiUpdates?: PiiUpdate[];
  memo?: string | null;
  contactMethod?: ContactMethod | null;
  /** 시스템 필드는 attrs 의 어느 키에 있는지 — 컬럼 스킴의 systemFields 맵 활용 */
  systemFieldKeys?: {
    group?: string;
  };
}

export interface ContactTargetRow {
  id: string;
  resid: number;
}

/**
 * 컨택리스트의 "+ 컨택 추가" 모달 저장 액션.
 * resid 는 next_contact_resid() 로 자동 발번.
 * PII 컬럼은 piiUpdates 로 별도 전달 → contact_pii 에 암호화 저장.
 */
export async function addContactTarget(
  input: AddContactTargetInput,
): Promise<ContactTargetRow> {
  await requireAuth();
  const { surveyId, attrs: rawAttrs, piiUpdates, memo, contactMethod, systemFieldKeys } = input;

  // UI 우회로 PII 키가 attrs 에 섞여 들어오는 경우 차단 — 평문 누적 방지.
  const attrs = await sanitizeAttrsAgainstPii(surveyId, rawAttrs);

  const groupValue = systemFieldKeys?.group ? (attrs[systemFieldKeys.group] || null) : null;

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
        attrs,
        memo: memo ?? null,
        contactMethod: contactMethod ?? null,
      })
      .returning({ id: contactTargets.id, resid: contactTargets.resid });
    if (!row) throw new Error('contact_targets INSERT 실패');

    if (piiUpdates && piiUpdates.length > 0) {
      for (const p of piiUpdates) {
        await upsertPiiValue(tx, row.id, p.columnKey, p.fieldType, p.plain);
      }
    }

    return row;
  });

  revalidatePath(`/admin/surveys/${surveyId}/operations/contacts`);
  return result;
}

export interface UpdateContactTargetInput {
  id: string;
  surveyId: string;
  attrs: Record<string, string>;
  /** PII 컬럼 값 변경분 (재암호화 후 upsert). 변경 없는 컬럼은 보내지 말 것. */
  piiUpdates?: PiiUpdate[];
  memo?: string | null;
  contactMethod?: ContactMethod | null;
  systemFieldKeys?: {
    group?: string;
  };
}

export async function updateContactTarget(
  input: UpdateContactTargetInput,
): Promise<void> {
  await requireAuth();
  const { id, surveyId, attrs: rawAttrs, piiUpdates, memo, contactMethod, systemFieldKeys } = input;

  // UI 우회로 PII 키가 attrs 에 섞여 들어오는 경우 차단 — 평문 누적 방지.
  const attrs = await sanitizeAttrsAgainstPii(surveyId, rawAttrs);

  const groupValue = systemFieldKeys?.group ? (attrs[systemFieldKeys.group] || null) : null;

  await db.transaction(async (tx) => {
    await tx
      .update(contactTargets)
      .set({
        attrs,
        groupValue,
        memo: memo ?? null,
        contactMethod: contactMethod ?? null,
        updatedAt: new Date(),
      })
      .where(eq(contactTargets.id, id));

    if (piiUpdates && piiUpdates.length > 0) {
      for (const p of piiUpdates) {
        await upsertPiiValue(tx, id, p.columnKey, p.fieldType, p.plain);
      }
    }
  });

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
