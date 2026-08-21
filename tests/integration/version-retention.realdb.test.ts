/**
 * 보존 규칙 SQL 실DB 검증 (2026-07-31 spec 10 + ADR-0014 이관 출처 보호).
 * 규칙: keep = 현재 발행본 OR 살아있는 비테스트 응답 보유 OR 이관 출처로 참조됨
 *
 * 실행: pnpm test:integration (로컬 supabase 54322 + 0070 마이그레이션 적용 필요)
 */
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import { surveyResponses, surveys, surveyVersions } from '@/db/schema';
import { findPrunableVersionIds } from '@/server/survey-builder/services/versioning/version-retention.server';

const isLocalDb =
  (process.env['DATABASE_URL'] ?? '').includes('127.0.0.1') ||
  (process.env['DATABASE_URL'] ?? '').includes('localhost');

const surveyId = crypto.randomUUID();

describe.skipIf(!isLocalDb)('findPrunableVersionIds 실DB', () => {
  afterAll(async () => {
    // 응답 → 버전 → 설문 순서로 정리한다. TRUNCATE CASCADE 는 금지.
    await db.delete(surveyResponses).where(eq(surveyResponses.surveyId, surveyId));
    await db.update(surveys).set({ currentVersionId: null }).where(eq(surveys.id, surveyId));
    await db.delete(surveyVersions).where(eq(surveyVersions.surveyId, surveyId));
    await db.delete(surveys).where(eq(surveys.id, surveyId));
  });

  it('현재 발행본과 살아있는 비테스트 응답 보유 버전만 보존한다', async () => {
    await db.insert(surveys).values({
      id: surveyId,
      title: '보존 규칙 실DB 테스트',
      slug: `retention-${surveyId}`,
    });

    const snapshot = { title: 't', settings: {}, questions: [], groups: [] } as never;
    const mkVersion = async (versionNumber: number, status: string) => {
      const rows = await db
        .insert(surveyVersions)
        .values({ surveyId, versionNumber, status, snapshot })
        .returning({ id: surveyVersions.id });
      const id = rows[0]?.id;
      if (!id) throw new Error('버전 생성 실패');
      return id;
    };

    const vCurrent = await mkVersion(1, 'published');
    const vRealResponse = await mkVersion(2, 'superseded');
    const vTestOnly = await mkVersion(3, 'superseded');
    const vNoResponse = await mkVersion(4, 'superseded');
    // 재핀으로 version_id 참조를 잃었지만 이관 출처로 참조되는 버전 (ADR-0014)
    const vMigratedSource = await mkVersion(5, 'superseded');
    // 이관 출처 참조가 soft-delete 응답뿐인 버전 — 보존 근거로 치지 않는다
    const vMigratedDeleted = await mkVersion(6, 'superseded');

    await db.update(surveys).set({ currentVersionId: vCurrent }).where(eq(surveys.id, surveyId));

    await db.insert(surveyResponses).values([
      // 살아있는 비테스트 응답 — 보존 근거가 된다
      { surveyId, versionId: vRealResponse, questionResponses: {}, isTest: false },
      // 테스트 응답 — 보존 근거로 치지 않는다
      { surveyId, versionId: vTestOnly, questionResponses: {}, isTest: true },
      // soft-delete 된 비테스트 응답 — 보존 근거로 치지 않는다
      {
        surveyId,
        versionId: vNoResponse,
        questionResponses: {},
        isTest: false,
        deletedAt: new Date(),
      },
      // 재핀된 응답 — versionId 는 현재 버전, 이관 출처가 vMigratedSource 를 가리킨다
      {
        surveyId,
        versionId: vCurrent,
        questionResponses: {},
        isTest: false,
        metadata: { migratedFromVersionId: vMigratedSource },
      },
      // 이관 출처 참조가 있지만 soft-delete 된 응답 — 보존 근거로 치지 않는다
      {
        surveyId,
        versionId: vCurrent,
        questionResponses: {},
        isTest: false,
        deletedAt: new Date(),
        metadata: { migratedFromVersionId: vMigratedDeleted },
      },
    ]);

    const prunable = await findPrunableVersionIds(db, { surveyId });

    expect(prunable.sort()).toEqual([vTestOnly, vNoResponse, vMigratedDeleted].sort());
    expect(prunable).not.toContain(vCurrent);
    expect(prunable).not.toContain(vRealResponse);
    // 이관 출처로 참조되는 버전은 versionId 참조가 없어도 보존한다
    expect(prunable).not.toContain(vMigratedSource);
  });
});
