import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets, contactUploads, surveys } from '@/db/schema';
import type {
  ContactColumnDef,
  ContactColumnScheme,
  ContactUploadMapping,
} from '@/db/schema/schema-types';
import { parseExcelRows, previewExcel } from '@/lib/contacts/excel-parser';
import { MAX_UPLOAD_ROWS, validateXlsxFile } from '@/lib/contacts/upload-limits';
import { buildPiiRows, insertPiiRows, type PiiInput } from '@/lib/crypto/contact-pii-repo';
import type { PiiFieldType } from '@/lib/crypto/pii-fields';
import { generateInviteCode } from '@/lib/survey-url';
import { loadOperationsDataScope } from '@/lib/operations/data-scope.server';

import type {
  IngestContactUploadInput,
  IngestContactUploadResult,
  ParseExcelPreviewInput,
  ParseExcelPreviewResult,
} from '../../domain/contact-upload';

interface SurveyModeRow extends Record<string, unknown> {
  test_mode_enabled: boolean;
}

function ensureXlsx(file: File): void {
  const err = validateXlsxFile(file);
  if (err) throw new Error(err);
}

/**
 * 매핑 모달용 미리보기. 인증은 authed 미들웨어가 담당.
 */
export async function parseExcelPreview(
  input: ParseExcelPreviewInput,
): Promise<ParseExcelPreviewResult> {
  ensureXlsx(input.file);

  const buffer = Buffer.from(await input.file.arrayBuffer());
  const result = await previewExcel(buffer, {
    sheetName: input.sheetName ?? '',
    headerRow: input.headerRow ?? 1,
    maxRows: 5,
  });

  if (result.totalRows > MAX_UPLOAD_ROWS) {
    throw new Error(
      `최대 ${MAX_UPLOAD_ROWS.toLocaleString('ko-KR')} 행까지 적재 가능합니다 (현재 ${result.totalRows.toLocaleString('ko-KR')} 행).`,
    );
  }

  return {
    sheetNames: result.sheetNames,
    headers: result.headers,
    rows: result.rows,
    totalRows: result.totalRows,
  };
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
  const { surveyId, file, mapping } = input;

  // 클라이언트 상태를 신뢰하지 않는다. 테스트 모드에서는 실제 대상자 전체 교체가
  // 위험하므로, 파일을 읽기 전에 현재 DB 모드로 먼저 fail-closed 한다.
  if ((await loadOperationsDataScope(surveyId)) === 'test') {
    throw new Error('테스트 모드에서는 실제 조사대상자를 업로드할 수 없습니다.');
  }

  ensureXlsx(file);

  const buffer = Buffer.from(await file.arrayBuffer());
  const allRows = await parseExcelRows(buffer, {
    sheetName: mapping.sheetName,
    headerRow: mapping.headerRow,
  });

  if (allRows.length > MAX_UPLOAD_ROWS) {
    throw new Error(
      `최대 ${MAX_UPLOAD_ROWS.toLocaleString('ko-KR')} 행까지 적재 가능합니다.`,
    );
  }

  const firstRow = allRows[0];
  const headerKeys = firstRow !== undefined ? Object.keys(firstRow) : [];
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
  const mergedRows = 0;
  let errorRows = 0;

  const result = await db.transaction(async (tx) => {
    // 파싱 중 모드가 바뀐 race도 삭제 직전에 다시 막는다. 설문 행을 잠가 모드 전환과
    // 직렬화하고, 실제 대상자만 교체한다.
    const scopeRows = await tx.execute<SurveyModeRow>(sql`
      SELECT test_mode_enabled
      FROM surveys
      WHERE id = ${surveyId}::uuid
      FOR UPDATE
    `);
    const survey = scopeRows[0];
    if (!survey) throw new Error('설문을 찾을 수 없습니다.');
    if (survey.test_mode_enabled) {
      throw new Error('테스트 모드에서는 실제 조사대상자를 업로드할 수 없습니다.');
    }

    // 시나리오 B: 기존 컨택 통째 DELETE.
    // FK 동작: survey_responses 는 SET NULL (응답 보존), contact_attempts/contact_pii 는 CASCADE.
    await tx
      .delete(contactTargets)
      .where(and(eq(contactTargets.surveyId, surveyId), eq(contactTargets.isTest, false)));

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
          // 빈 셀('')만 NULL 처리. '0' 등 falsy 문자열 group 라벨은 보존 (|| 사용 금지).
          const rawGroup = groupKey ? row[groupKey] : undefined;
          const groupValue = rawGroup != null && rawGroup !== '' ? rawGroup : null;

          // attrs 에서 PII 키 제외 — PII 는 contact_pii 사이드 테이블에만 저장
          const cleanAttrs: Record<string, string> = {};
          for (const [k, v] of Object.entries(row)) {
            if (!piiKeySet.has(k)) cleanAttrs[k] = v;
          }

          const residRows = (await sp.execute(
            sql`SELECT next_contact_resid(${surveyId}::uuid, false) AS resid`,
          )) as unknown as Array<{ resid: number }>;
          const resid = residRows[0]?.resid;
          if (resid == null) throw new Error('next_contact_resid 호출 실패');

          const [target] = await sp
            .insert(contactTargets)
            .values({
              surveyId,
              resid,
              isTest: false,
              groupValue,
              attrs: cleanAttrs,
              uploadId: upload.id,
              inviteCode: generateInviteCode(),
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

  return result;
}

/**
 * 매핑 + 헤더키 → 컬럼 스킴 순수 변환. ingestContactUpload 전용 module-private 헬퍼.
 */
function autoGenerateColumnScheme(
  headerKeys: string[],
  mapping: ContactUploadMapping,
): ContactColumnScheme {
  const columns: ContactColumnDef[] = [];
  let order = 1;

  // 시스템 컬럼 (resid 항상 1번, 표시 필수)
  columns.push({ key: 'resid', label: '번호', source: 'system.resid', order: order++ });

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
