import { and, eq, sql } from 'drizzle-orm';
import 'server-only';

import { type DbOrTx, db } from '@/db';
import { contactPii, contactTargets, contactUploads, surveys } from '@/db/schema';
import { parseExcelRows, previewExcel } from '@/lib/contacts/excel-parser';
import { type GroupLevel, isGroupLevel } from '@/lib/contacts/group-levels';
import {
  type ExistingContactKeyInfo,
  buildKeyTuple,
  classifyRows,
  countEmptyOverwrites,
} from '@/lib/contacts/match-contacts';
import {
  type SchemeRouting,
  appendNewColumnsToScheme,
  getSchemeRouting,
} from '@/lib/contacts/scheme-helpers';
import { MAX_UPLOAD_ROWS, validateXlsxFile } from '@/lib/contacts/upload-limits';
import {
  type PiiInput,
  buildPiiRows,
  insertPiiRows,
  upsertPiiValue,
} from '@/lib/crypto/contact-pii-repo';
import type { PiiFieldType } from '@/lib/crypto/pii-fields';
import { logger } from '@/lib/logger';
import { RESID_DEFAULT_LABEL } from '@/lib/operations/contacts';
import { loadOperationsDataScope } from '@/lib/operations/data-scope.server';
import { generateInviteCode } from '@/lib/survey-url';
import type {
  ContactColumnDef,
  ContactColumnScheme,
  ContactUploadMapping,
  ContactUploadMode,
} from '@/shared/contracts/contacts';

import type {
  IngestContactUploadInput,
  IngestContactUploadResult,
  MatchContactUploadInput,
  MatchContactUploadResult,
  ParseExcelPreviewInput,
  ParseExcelPreviewResult,
} from '../domain/contact-upload';

interface SurveyModeRow extends Record<string, unknown> {
  test_mode_enabled: boolean;
  contact_columns: unknown;
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
 * 엑셀 풀 파싱 + 3모드 적재.
 *
 * - replace(기본, 시나리오 B): 기존 contact_targets 를 모두 DELETE 한 뒤 신규 INSERT.
 *   survey_responses.contact_target_id 는 SET NULL(응답 보존, 매칭만 끊김),
 *   contact_attempts/contact_pii 는 CASCADE(회차·PII 삭제), invite_token 도 함께 사라짐
 *   (발송된 메일 링크 무효화). 클라이언트가 경고 카드로 사용자 confirm 후 호출 — 서버는 가드 없음.
 * - merge: DELETE 없음. mergeKeys 로 기존 컨택과 매칭해 일치 행은 엑셀에 있는 컬럼만
 *   부분 갱신(attrs 얕은 병합 + PII upsert), resid/inviteCode/uploadId/이력은 보존.
 *   불일치 행은 unmatchedPolicy(insert|skip)를 따른다.
 * - append: 전 행 INSERT. mergeKeys 지정 시 기존 명단과 일치하는 행만 duplicatePolicy(insert|skip).
 *
 * 매칭은 ingest 가 자체 재계산한다 (matchPreview 결과를 신뢰하지 않음 — 업로드 사이 DB 가 바뀔 수 있음).
 * PII 라우팅: replace 는 위저드 입력만 따르고, merge/append 는 기존 스킴이 우선한다
 * (resolveEffectiveRouting — PII 평문 유출 차단).
 *
 * 트랜잭션: 단일 트랜잭션. 행 단위 INSERT/UPDATE 에러는 SAVEPOINT 격리.
 * 컬럼 스킴: replace 또는 기존 스킴이 없으면 전체 재생성, merge/append 는 신규 컬럼만 append.
 */
export async function ingestContactUpload(
  input: IngestContactUploadInput,
): Promise<IngestContactUploadResult> {
  const { surveyId, file, mapping } = input;
  const mode: ContactUploadMode = mapping.mode ?? 'replace';

  // 클라이언트 상태를 신뢰하지 않는다. 테스트 모드에서는 실제 대상자 업로드가
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
    throw new Error(`최대 ${MAX_UPLOAD_ROWS.toLocaleString('ko-KR')} 행까지 적재 가능합니다.`);
  }

  const firstRow = allRows[0];
  const headerKeys = firstRow !== undefined ? Object.keys(firstRow) : [];
  // 분류 기준은 선택사항 — 미지정 시 모든 행의 group_value = NULL.
  // 레벨 배정(groupLevels)의 대분류(1) 헤더가 group_value 소스 — systemFields.group
  // (마법사가 동기화해 보내는 레거시 인덱스)보다 우선한다.
  // 후보만 여기서 정하고, 확정은 tx 안에서 유효 PII 라우팅(piiKeySet) 계산 후 —
  // PII 컬럼 값이 group_value 에 평문 저장되는 경로 차단 (UI 가드 우회 방어 포함).
  const level1Key = Object.entries(mapping.groupLevels ?? {}).find(([, l]) => l === 1)?.[0] ?? null;
  const groupKeyCandidate =
    (level1Key != null && headerKeys.includes(level1Key) ? level1Key : null) ??
    (mapping.systemFields.group != null ? (headerKeys[mapping.systemFields.group] ?? null) : null);
  let groupKey: string | null = null;

  let uploadedRows = 0;
  let mergedRows = 0;
  let errorRows = 0;
  const skippedBreakdown = { policy: 0, fileDuplicates: 0, multiMatches: 0, emptyKeys: 0 };

  const result = await db.transaction(async (tx) => {
    // 설문 행 잠금 — 모드 전환·동시 업로드와 직렬화. 스킴도 같은 쿼리로 확보.
    const scopeRows = await tx.execute<SurveyModeRow>(sql`
      SELECT test_mode_enabled, contact_columns
      FROM surveys
      WHERE id = ${surveyId}::uuid
      FOR UPDATE
    `);
    const survey = scopeRows[0];
    if (!survey) throw new Error('설문을 찾을 수 없습니다.');
    if (survey.test_mode_enabled) {
      throw new Error('테스트 모드에서는 실제 조사대상자를 업로드할 수 없습니다.');
    }
    const existingScheme = (survey.contact_columns as ContactColumnScheme | null) ?? null;

    // 유효 PII 라우팅: replace 는 위저드 입력만, merge/append 는 기존 스킴 우선
    const schemeRouting =
      mode === 'replace'
        ? { piiByKey: {}, knownAttrKeys: new Set<string>() }
        : getSchemeRouting(existingScheme);
    const { piiEntries, piiKeySet } = resolveEffectiveRouting(schemeRouting, mapping, headerKeys);
    // groupKey 확정 — 유효 PII 컬럼은 분류 기준이 될 수 없다 (평문 노출 차단)
    groupKey =
      groupKeyCandidate != null && !piiKeySet.has(groupKeyCandidate) ? groupKeyCandidate : null;

    if (mode === 'replace') {
      // 시나리오 B: 기존 컨택 통째 DELETE.
      // FK 동작: survey_responses 는 SET NULL (응답 보존), contact_attempts/contact_pii 는 CASCADE.
      await tx
        .delete(contactTargets)
        .where(and(eq(contactTargets.surveyId, surveyId), eq(contactTargets.isTest, false)));
    }

    const [upload] = await tx
      .insert(contactUploads)
      .values({
        surveyId,
        filename: file.name,
        uploadedRows: 0,
        mergedRows: 0,
        errorRows: 0,
        skippedRows: 0,
        mode,
        mapping,
      })
      .returning({ id: contactUploads.id });
    if (!upload) throw new Error('contact_uploads INSERT 실패');
    const uploadId = upload.id;

    /** 행 하나를 신규 컨택으로 INSERT (SAVEPOINT 내부에서 호출) */
    async function insertContactRow(sp: typeof tx, row: Record<string, string>): Promise<void> {
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
          uploadId,
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
        await insertPiiRows(sp, buildPiiRows(target.id, piiInputs));
      }
    }

    /** 키 일치 행을 부분 갱신 (SAVEPOINT 내부에서 호출) */
    async function mergeContactRow(
      sp: typeof tx,
      row: Record<string, string>,
      targetId: string,
      existingAttrs: Record<string, string>,
    ): Promise<void> {
      const cleanAttrs: Record<string, string> = {};
      for (const [k, v] of Object.entries(row)) {
        if (!piiKeySet.has(k)) cleanAttrs[k] = v;
      }
      // 분류 기준 컬럼이 파일에 없으면 groupValue 는 건드리지 않는다.
      const rawGroup = groupKey ? row[groupKey] : undefined;
      const groupPatch =
        groupKey != null
          ? { groupValue: rawGroup != null && rawGroup !== '' ? rawGroup : null }
          : {};

      await sp
        .update(contactTargets)
        .set({
          attrs: { ...existingAttrs, ...cleanAttrs },
          ...groupPatch,
          updatedAt: new Date(),
        })
        .where(eq(contactTargets.id, targetId));

      // PII 는 컬럼 단위 upsert — 빈 값이면 기존 행 삭제 (스펙: 빈 셀도 덮어씀)
      for (const e of piiEntries) {
        await upsertPiiValue(sp, targetId, e.columnKey, e.fieldType, row[e.columnKey] ?? '');
      }
    }

    if (mode === 'merge') {
      const mergeKeys = mapping.mergeKeys ?? [];
      validateMergeKeys(mergeKeys, headerKeys, piiKeySet);
      const unmatchedPolicy = mapping.unmatchedPolicy ?? 'skip';

      const { existing, existingAttrsById } = await loadExistingContactsTx(tx, surveyId);
      const classified = classifyRows(allRows, mergeKeys, existing);
      skippedBreakdown.fileDuplicates = classified.fileDuplicates.length;
      skippedBreakdown.multiMatches = classified.multiMatches.length;
      skippedBreakdown.emptyKeys = classified.emptyKeys.length;

      for (const { rowIndex, targetId } of classified.matched) {
        const row = allRows[rowIndex];
        if (!row) continue;
        try {
          await tx.transaction(async (sp) => {
            await mergeContactRow(sp, row, targetId, existingAttrsById.get(targetId) ?? {});
          });
          mergedRows += 1;
        } catch (e) {
          errorRows += 1;
          // attrs/PII 값 로그 금지 — 식별자와 err 만 (err serializer 가 쿼리 params 차단)
          logger.error(
            { surveyId, uploadId, rowIndex, err: e },
            '[ingestContactUpload] merge row 실패',
          );
        }
      }

      for (const rowIndex of classified.unmatched) {
        const row = allRows[rowIndex];
        if (!row) continue;
        if (unmatchedPolicy === 'skip') {
          skippedBreakdown.policy += 1;
          continue;
        }
        try {
          await tx.transaction(async (sp) => insertContactRow(sp, row));
          uploadedRows += 1;
        } catch (e) {
          errorRows += 1;
          logger.error(
            { surveyId, uploadId, rowIndex, err: e },
            '[ingestContactUpload] insert row 실패',
          );
        }
      }
    } else {
      // replace / append 공통: 전 행 INSERT. append+중복검사는 중복 행만 policy 적용.
      const duplicateRowIndexes = new Set<number>();
      if (mode === 'append' && (mapping.mergeKeys?.length ?? 0) > 0) {
        const mergeKeys = mapping.mergeKeys ?? [];
        validateMergeKeys(mergeKeys, headerKeys, piiKeySet);
        const { existing } = await loadExistingContactsTx(tx, surveyId);
        // append 의 중복 판정은 "기존 명단과의 일치" 만 기준으로 한다 (파일 내 중복 행끼리의
        // 판정은 classifyRows 의 fileDuplicates 우선순위를 따르면 안 됨 — 파일 내 같은 키가
        // 여러 행이어도 기존 명단에 있으면 각 행이 duplicatePolicy 를 따라야 한다).
        const existingTuples = new Set(
          existing
            .map((e) => buildKeyTuple(e.attrs, mergeKeys))
            .filter((t): t is string => t != null),
        );
        allRows.forEach((row, rowIndex) => {
          const tuple = buildKeyTuple(row, mergeKeys);
          if (tuple != null && existingTuples.has(tuple)) {
            duplicateRowIndexes.add(rowIndex);
          }
        });
      }
      const duplicatePolicy = mapping.duplicatePolicy ?? 'skip';

      for (const [rowIndex, row] of allRows.entries()) {
        if (duplicateRowIndexes.has(rowIndex) && duplicatePolicy === 'skip') {
          skippedBreakdown.policy += 1;
          continue;
        }
        try {
          await tx.transaction(async (sp) => insertContactRow(sp, row));
          uploadedRows += 1;
        } catch (e) {
          errorRows += 1;
          logger.error({ surveyId, uploadId, rowIndex, err: e }, '[ingestContactUpload] row 실패');
        }
      }
    }

    const skippedRows =
      skippedBreakdown.policy +
      skippedBreakdown.fileDuplicates +
      skippedBreakdown.multiMatches +
      skippedBreakdown.emptyKeys;

    await tx
      .update(contactUploads)
      .set({ uploadedRows, mergedRows, errorRows, skippedRows })
      .where(eq(contactUploads.id, upload.id));

    // 스킴 갱신: replace 는 전체 재생성, merge/append 는 신규 컬럼만 append
    const scheme =
      mode === 'replace' || existingScheme == null
        ? autoGenerateColumnScheme(headerKeys, mapping, piiKeySet)
        : appendNewColumnsToScheme(existingScheme, headerKeys, mapping);
    await tx.update(surveys).set({ contactColumns: scheme }).where(eq(surveys.id, surveyId));

    return {
      uploadId: upload.id,
      uploadedRows,
      mergedRows,
      errorRows,
      skippedRows,
      skippedBreakdown,
    };
  });

  return result;
}

/**
 * 매핑 + 헤더키 → 컬럼 스킴 순수 변환. ingestContactUpload 전용 module-private 헬퍼.
 */
/**
 * 마법사가 보낸 레벨 배정 정리 — 유효 PII 컬럼(piiKeySet: 위저드 매핑 + 기존 스킴 잠금
 * 포함) 제외, 유효 레벨(1..4)만, 레벨당 헤더 1개. (UI 가드 우회 API 호출 방어)
 */
function sanitizeGroupLevels(
  groupLevels: Record<string, number> | undefined,
  piiKeySet: ReadonlySet<string>,
): Map<string, GroupLevel> {
  const byLevel = new Map<GroupLevel, string>();
  for (const [key, level] of Object.entries(groupLevels ?? {})) {
    if (piiKeySet.has(key)) continue;
    if (!isGroupLevel(level)) continue;
    if (!byLevel.has(level)) byLevel.set(level, key);
  }
  const byKey = new Map<string, GroupLevel>();
  for (const [level, key] of byLevel.entries()) byKey.set(key, level);
  return byKey;
}

function autoGenerateColumnScheme(
  headerKeys: string[],
  mapping: ContactUploadMapping,
  piiKeySet: ReadonlySet<string>,
): ContactColumnScheme {
  const columns: ContactColumnDef[] = [];
  let order = 1;

  // 시스템 컬럼 (resid 항상 1번, 표시 필수)
  columns.push({
    key: 'resid',
    label: RESID_DEFAULT_LABEL,
    source: 'system.resid',
    order: order++,
  });

  // 모든 헤더 키를 컬럼으로 등록.
  // - piiMapping 에 매핑된 헤더 → source 'pii.<key>' + piiType 명시 → contact_pii 테이블 조인 후 표시
  // - 그 외 → source 'attrs.<key>' → contact_targets.attrs JSONB 에서 표시
  // 사용자가 매핑 모달에서 토글한 키만 hidden:false, 나머지는 hidden:true.
  const selected = new Set(mapping.selectedAttrsKeys);
  const piiMapping = mapping.piiMapping ?? {};
  const labelOverrides = mapping.labelOverrides ?? {};
  const groupLevels = sanitizeGroupLevels(mapping.groupLevels, piiKeySet);

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
      const level = groupLevels.get(key);
      columns.push({
        key,
        label,
        source: `attrs.${key}`,
        order: order++,
        hidden: !selected.has(key),
        ...(level != null ? { groupLevel: level } : {}),
      });
    }
  }

  // 운영 컬럼 (read 만, 본 슬라이스)
  columns.push({
    key: 'contact_result',
    label: '컨택결과',
    source: 'system.contact_result',
    order: order++,
  });
  columns.push({ key: 'email_count', label: '메일', source: 'system.email_count', order: order++ });
  columns.push({ key: 'web', label: 'web', source: 'system.web', order: order++ });
  columns.push({
    key: 'contact_owner',
    label: '컨택원',
    source: 'system.contact_owner',
    order: order++,
  });

  return { version: 1, headerRow: mapping.headerRow, columns };
}

const SAMPLE_LIMIT = 50;

/**
 * 위저드 piiMapping 과 기존 스킴 라우팅을 병합한 유효 PII 라우팅.
 * 기존 스킴에 등록된 키는 스킴이 우선 (그릴링 결정 — attrs 평문 유출 차단).
 * 위저드 piiMapping 은 스킴에 없는 신규 컬럼에만 적용된다.
 */
function resolveEffectiveRouting(
  schemeRouting: SchemeRouting,
  mapping: ContactUploadMapping,
  headerKeys: string[],
): { piiEntries: Array<{ columnKey: string; fieldType: PiiFieldType }>; piiKeySet: Set<string> } {
  const piiEntries: Array<{ columnKey: string; fieldType: PiiFieldType }> = [];
  const wizardPii = mapping.piiMapping ?? {};
  for (const key of headerKeys) {
    const schemePii = schemeRouting.piiByKey[key];
    if (schemePii) {
      piiEntries.push({ columnKey: key, fieldType: schemePii });
    } else if (schemeRouting.knownAttrKeys.has(key)) {
      // 기존 attrs 컬럼 — 위저드가 PII 로 지정해도 무시 (스킴 우선)
    } else if (wizardPii[key]) {
      piiEntries.push({ columnKey: key, fieldType: wizardPii[key] });
    }
  }
  return { piiEntries, piiKeySet: new Set(piiEntries.map((e) => e.columnKey)) };
}

/** merge/append 공통: 매칭 키 검증. 반환값 없이 throw 만 한다. */
function validateMergeKeys(
  mergeKeys: string[],
  headerKeys: string[],
  piiKeySet: Set<string>,
): void {
  if (mergeKeys.length === 0) throw new Error('매칭 키를 1개 이상 선택해주세요.');
  for (const key of mergeKeys) {
    if (!headerKeys.includes(key)) {
      throw new Error(`매칭 키 '${key}' 가 엑셀 헤더에 없습니다.`);
    }
    if (piiKeySet.has(key)) {
      throw new Error(`개인정보 컬럼 '${key}' 은 매칭 키로 사용할 수 없습니다.`);
    }
  }
}

/** 기존 실컨택 (id + attrs) 로드 — 트랜잭션/전역 db 겸용 */
async function loadExistingContactsTx(
  dbc: DbOrTx,
  surveyId: string,
): Promise<{
  existing: ExistingContactKeyInfo[];
  existingAttrsById: Map<string, Record<string, string>>;
}> {
  const targets = await dbc
    .select({ id: contactTargets.id, attrs: contactTargets.attrs })
    .from(contactTargets)
    .where(and(eq(contactTargets.surveyId, surveyId), eq(contactTargets.isTest, false)));
  const existing: ExistingContactKeyInfo[] = targets.map((t) => ({
    targetId: t.id,
    attrs: t.attrs ?? {},
  }));
  return { existing, existingAttrsById: new Map(existing.map((e) => [e.targetId, e.attrs])) };
}

/** 기존 실컨택 (id + attrs) + PII 존재 여부 로드 (matchPreview 전용, 전역 db 사용) */
async function loadExistingContacts(surveyId: string): Promise<{
  existing: ExistingContactKeyInfo[];
  existingAttrsById: Map<string, Record<string, string>>;
  piiPresenceById: Map<string, Set<string>>;
}> {
  const { existing, existingAttrsById } = await loadExistingContactsTx(db, surveyId);

  const piiRows = await db
    .select({ contactTargetId: contactPii.contactTargetId, columnKey: contactPii.columnKey })
    .from(contactPii)
    .innerJoin(contactTargets, eq(contactPii.contactTargetId, contactTargets.id))
    .where(and(eq(contactTargets.surveyId, surveyId), eq(contactTargets.isTest, false)));

  const piiPresenceById = new Map<string, Set<string>>();
  for (const r of piiRows) {
    const set = piiPresenceById.get(r.contactTargetId) ?? new Set<string>();
    set.add(r.columnKey);
    piiPresenceById.set(r.contactTargetId, set);
  }
  return { existing, existingAttrsById, piiPresenceById };
}

/**
 * 병합/중복검사 dry-run 매칭 미리보기. DB 쓰기 없음.
 * stateless — 적재 시 ingest 가 동일 계산을 재수행하므로 참고용 요약이다.
 */
export async function matchContactUpload(
  input: MatchContactUploadInput,
): Promise<MatchContactUploadResult> {
  const { surveyId, file, mapping } = input;

  if ((await loadOperationsDataScope(surveyId)) === 'test') {
    throw new Error('테스트 모드에서는 실제 조사대상자를 업로드할 수 없습니다.');
  }
  if (mapping.mode !== 'merge' && mapping.mode !== 'append') {
    throw new Error('매칭 미리보기는 병합 또는 추가 모드에서만 사용할 수 있습니다.');
  }
  ensureXlsx(file);

  const buffer = Buffer.from(await file.arrayBuffer());
  const allRows = await parseExcelRows(buffer, {
    sheetName: mapping.sheetName,
    headerRow: mapping.headerRow,
  });
  if (allRows.length > MAX_UPLOAD_ROWS) {
    throw new Error(`최대 ${MAX_UPLOAD_ROWS.toLocaleString('ko-KR')} 행까지 적재 가능합니다.`);
  }

  const firstRow = allRows[0];
  const headerKeys = firstRow !== undefined ? Object.keys(firstRow) : [];

  const [surveyRow] = await db
    .select({ contactColumns: surveys.contactColumns })
    .from(surveys)
    .where(eq(surveys.id, surveyId));
  const schemeRouting = getSchemeRouting(surveyRow?.contactColumns ?? null);
  const { piiKeySet } = resolveEffectiveRouting(schemeRouting, mapping, headerKeys);

  const mergeKeys = mapping.mergeKeys ?? [];
  validateMergeKeys(mergeKeys, headerKeys, piiKeySet);

  const { existing, existingAttrsById, piiPresenceById } = await loadExistingContacts(surveyId);
  const classified = classifyRows(allRows, mergeKeys, existing);

  const toSamples = (indices: number[]) =>
    indices.slice(0, SAMPLE_LIMIT).map((rowIndex) => ({
      excelRow: mapping.headerRow + 1 + rowIndex,
      keyValues: Object.fromEntries(mergeKeys.map((k) => [k, allRows[rowIndex]?.[k] ?? ''])),
    }));

  return {
    matched: classified.matched.length,
    unmatched: classified.unmatched.length,
    fileDuplicates: classified.fileDuplicates.length,
    multiMatches: classified.multiMatches.length,
    emptyKeys: classified.emptyKeys.length,
    unmatchedSamples: toSamples(classified.unmatched),
    fileDuplicateSamples: toSamples(classified.fileDuplicates),
    multiMatchSamples: toSamples(classified.multiMatches),
    emptyKeySamples: toSamples(classified.emptyKeys),
    emptyOverwrites: countEmptyOverwrites(
      allRows,
      classified.matched,
      headerKeys,
      existingAttrsById,
      piiPresenceById,
      piiKeySet,
    ),
  };
}
