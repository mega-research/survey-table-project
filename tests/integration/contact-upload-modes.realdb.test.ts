/**
 * ingestContactUpload 모드별(merge) 실 DB 왕복 integration test.
 *
 * 목적: replace 모드는 무회귀 유지하면서 merge 모드가
 * - DELETE 없이 부분 갱신(엑셀 컬럼만 덮어쓰기, resid/inviteCode/uploadId 보존)
 * - unmatchedPolicy(insert/skip) 분기
 * - 파일 내 키 중복·키 빈 값 자동 skip 집계
 * 를 실제로 수행하는지 CI 에 고정한다.
 *
 * 실행 조건: DATABASE_URL 이 127.0.0.1 또는 localhost 를 포함할 때만 동작.
 * `pnpm test:integration` (RUN_REALDB=1 + 로컬 DATABASE_URL 강제)으로 실행할 것.
 */

import ExcelJS from 'exceljs';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  contactPii as contactPiiTable,
  contactTargets as contactTargetsTable,
  surveys as surveysTable,
} from '@/db/schema';
import type { ContactUploadMapping } from '@/db/schema/schema-types';
import { ingestContactUpload } from '@/features/contacts/server/services/contact-uploads.service';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

/** 헤더 1행 + 데이터 행으로 xlsx File 생성 */
async function makeXlsx(headers: string[], rows: string[][]): Promise<File> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  const buf = await wb.xlsx.writeBuffer();
  return new File([buf], 'test.xlsx');
}

function mapping(overrides: Partial<ContactUploadMapping> = {}): ContactUploadMapping {
  return {
    systemFields: {},
    selectedAttrsKeys: ['idx', '회사'],
    headerRow: 1,
    sheetName: 'Sheet1',
    ...overrides,
  };
}

describe.skipIf(!isLocalDb)('ingestContactUpload 모드별 실 DB 왕복', () => {
  const createdSurveyIds: string[] = [];

  beforeAll(async () => {
    await db.execute(sql`
      DROP FUNCTION IF EXISTS next_contact_resid(uuid);
      CREATE OR REPLACE FUNCTION next_contact_resid(
        p_survey_id uuid, p_is_test boolean DEFAULT false
      ) RETURNS integer AS $$
      DECLARE next_id integer;
      BEGIN
        PERFORM pg_advisory_xact_lock(
          hashtextextended(p_survey_id::text || ':' || p_is_test::text, 0)
        );
        SELECT COALESCE(MAX(resid), 0) + 1 INTO next_id
          FROM contact_targets
          WHERE survey_id = p_survey_id AND is_test = p_is_test;
        RETURN next_id;
      END;
      $$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public;
    `);
  });

  afterAll(async () => {
    for (const id of createdSurveyIds) {
      await db.delete(contactTargetsTable).where(eq(contactTargetsTable.surveyId, id));
      await db.delete(surveysTable).where(eq(surveysTable.id, id));
    }
  });

  async function createSurvey(): Promise<string> {
    const [survey] = await db
      .insert(surveysTable)
      .values({ title: '업로드-모드-테스트' })
      .returning({ id: surveysTable.id });
    if (!survey) throw new Error('survey insert 실패');
    createdSurveyIds.push(survey.id);
    return survey.id;
  }

  it('merge: 키 일치 행은 엑셀 컬럼만 덮어쓰고 resid·미포함 attrs 를 보존한다', async () => {
    const surveyId = await createSurvey();
    // 1차: replace 로 초기 명단 적재 (idx=1, 회사=A, 메모=원본)
    const first = await makeXlsx(['idx', '회사', '메모'], [['1', 'A', '원본']]);
    await ingestContactUpload({
      surveyId,
      file: first,
      mapping: mapping({ selectedAttrsKeys: ['idx', '회사', '메모'] }),
    });
    const [before] = await db
      .select()
      .from(contactTargetsTable)
      .where(eq(contactTargetsTable.surveyId, surveyId));
    expect(before?.attrs).toMatchObject({ idx: '1', 회사: 'A', 메모: '원본' });

    // 2차: merge — 메모 컬럼 없는 보정 파일 (회사만 갱신) + 불일치 1행은 skip
    const patch = await makeXlsx(['idx', '회사'], [['1', 'B'], ['999', 'C']]);
    const result = await ingestContactUpload({
      surveyId,
      file: patch,
      mapping: mapping({ mode: 'merge', mergeKeys: ['idx'], unmatchedPolicy: 'skip' }),
    });

    expect(result.mergedRows).toBe(1);
    expect(result.uploadedRows).toBe(0);
    expect(result.skippedRows).toBe(1);
    expect(result.skippedBreakdown.policy).toBe(1);

    const [after] = await db
      .select()
      .from(contactTargetsTable)
      .where(eq(contactTargetsTable.surveyId, surveyId));
    expect(after?.id).toBe(before?.id); // DELETE 없이 갱신
    expect(after?.resid).toBe(before?.resid);
    expect(after?.attrs).toMatchObject({ idx: '1', 회사: 'B', 메모: '원본' }); // 메모 보존
    expect(after?.uploadId).toBe(before?.uploadId); // 원 소속 업로드 유지
  });

  it('merge: unmatchedPolicy=insert 는 불일치 행을 신규 resid 로 추가한다', async () => {
    const surveyId = await createSurvey();
    const first = await makeXlsx(['idx', '회사'], [['1', 'A']]);
    await ingestContactUpload({ surveyId, file: first, mapping: mapping() });

    const patch = await makeXlsx(['idx', '회사'], [['1', 'B'], ['2', 'C']]);
    const result = await ingestContactUpload({
      surveyId,
      file: patch,
      mapping: mapping({ mode: 'merge', mergeKeys: ['idx'], unmatchedPolicy: 'insert' }),
    });

    expect(result.mergedRows).toBe(1);
    expect(result.uploadedRows).toBe(1);
    const all = await db
      .select()
      .from(contactTargetsTable)
      .where(eq(contactTargetsTable.surveyId, surveyId))
      .orderBy(contactTargetsTable.resid);
    expect(all).toHaveLength(2);
    expect(all[1]?.resid).toBe(2); // 이어서 발번
  });

  it('merge: 파일 내 키 중복·키 빈 값 행은 자동 제외된다', async () => {
    const surveyId = await createSurvey();
    const first = await makeXlsx(['idx', '회사'], [['1', 'A']]);
    await ingestContactUpload({ surveyId, file: first, mapping: mapping() });

    const patch = await makeXlsx(
      ['idx', '회사'],
      [['1', 'B'], ['1', 'C'], ['', 'D']],
    );
    const result = await ingestContactUpload({
      surveyId,
      file: patch,
      mapping: mapping({ mode: 'merge', mergeKeys: ['idx'], unmatchedPolicy: 'skip' }),
    });
    expect(result.mergedRows).toBe(0);
    expect(result.skippedBreakdown.fileDuplicates).toBe(2);
    expect(result.skippedBreakdown.emptyKeys).toBe(1);
    // 중복 키 행은 갱신되지 않음
    const [row] = await db
      .select()
      .from(contactTargetsTable)
      .where(eq(contactTargetsTable.surveyId, surveyId));
    expect(row?.attrs).toMatchObject({ 회사: 'A' });
  });

  it('append: 기존 명단을 유지한 채 신규 행을 이어서 발번한다', async () => {
    const surveyId = await createSurvey();
    const first = await makeXlsx(['idx', '회사'], [['1', 'A'], ['2', 'B']]);
    await ingestContactUpload({ surveyId, file: first, mapping: mapping() });

    const more = await makeXlsx(['idx', '회사'], [['3', 'C']]);
    const result = await ingestContactUpload({
      surveyId,
      file: more,
      mapping: mapping({ mode: 'append' }),
    });
    expect(result.uploadedRows).toBe(1);
    expect(result.mergedRows).toBe(0);

    const all = await db
      .select()
      .from(contactTargetsTable)
      .where(eq(contactTargetsTable.surveyId, surveyId))
      .orderBy(contactTargetsTable.resid);
    expect(all).toHaveLength(3);
    expect(all.map((r) => r.resid)).toEqual([1, 2, 3]);
  });

  it('append: 중복 검사 시 duplicatePolicy=skip 은 기존 키 일치 행을 제외한다', async () => {
    const surveyId = await createSurvey();
    const first = await makeXlsx(['idx', '회사'], [['1', 'A']]);
    await ingestContactUpload({ surveyId, file: first, mapping: mapping() });

    const more = await makeXlsx(['idx', '회사'], [['1', 'A'], ['2', 'B']]);
    const result = await ingestContactUpload({
      surveyId,
      file: more,
      mapping: mapping({ mode: 'append', mergeKeys: ['idx'], duplicatePolicy: 'skip' }),
    });
    expect(result.uploadedRows).toBe(1);
    expect(result.skippedRows).toBe(1);
    expect(result.skippedBreakdown.policy).toBe(1);

    const all = await db
      .select()
      .from(contactTargetsTable)
      .where(eq(contactTargetsTable.surveyId, surveyId));
    expect(all).toHaveLength(2);
  });

  it('append: duplicatePolicy=insert 는 중복 행도 신규로 추가한다', async () => {
    const surveyId = await createSurvey();
    const first = await makeXlsx(['idx', '회사'], [['1', 'A']]);
    await ingestContactUpload({ surveyId, file: first, mapping: mapping() });

    const more = await makeXlsx(['idx', '회사'], [['1', 'A2']]);
    const result = await ingestContactUpload({
      surveyId,
      file: more,
      mapping: mapping({ mode: 'append', mergeKeys: ['idx'], duplicatePolicy: 'insert' }),
    });
    expect(result.uploadedRows).toBe(1);
    const all = await db
      .select()
      .from(contactTargetsTable)
      .where(eq(contactTargetsTable.surveyId, surveyId));
    expect(all).toHaveLength(2);
  });

  it('merge: 기존 스킴 pii 컬럼은 위저드 piiMapping 미지정이어도 contact_pii 로 라우팅된다', async () => {
    const surveyId = await createSurvey();
    // 1차: 이메일을 PII 로 업로드 → 스킴에 pii.이메일 등재
    const first = await makeXlsx(['idx', '이메일'], [['1', 'a@b.com']]);
    await ingestContactUpload({
      surveyId,
      file: first,
      mapping: mapping({
        selectedAttrsKeys: ['idx', '이메일'],
        piiMapping: { 이메일: 'email' },
      }),
    });

    // 2차: merge — piiMapping 없이 이메일 갱신 (스킴 라우팅 강제 검증)
    const patch = await makeXlsx(['idx', '이메일'], [['1', 'new@b.com']]);
    await ingestContactUpload({
      surveyId,
      file: patch,
      mapping: mapping({
        selectedAttrsKeys: ['idx'],
        mode: 'merge',
        mergeKeys: ['idx'],
        unmatchedPolicy: 'skip',
      }),
    });

    const [target] = await db
      .select()
      .from(contactTargetsTable)
      .where(eq(contactTargetsTable.surveyId, surveyId));
    // attrs 에 평문 이메일이 없어야 한다
    expect(target?.attrs?.['이메일']).toBeUndefined();
    const piiRows = await db
      .select()
      .from(contactPiiTable)
      .where(
        and(
          eq(contactPiiTable.contactTargetId, target?.id ?? ''),
          eq(contactPiiTable.columnKey, '이메일'),
        ),
      );
    expect(piiRows).toHaveLength(1);
  });
});
