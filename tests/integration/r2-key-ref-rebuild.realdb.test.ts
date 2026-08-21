/**
 * 파생 참조 인덱스 재구축 — 표면 일치 계약 실DB 검증.
 *
 * 계약: rebuild 가 만드는 인덱스는 집행 직전 스캔(findReferencedKeys)이 보는
 * 표면과 **정확히 같아야** 한다. 인덱스가 스캔보다 넓으면 인덱스 히트가 후보를
 * '보존됨'(종결 상태)으로 닫아, 스캔이라면 허용했을 삭제를 영구히 막는다 —
 * fetchDueCandidates 는 pending/failed 만 다시 집으므로 재시도 경로가 없다.
 *
 * 표면 술어 2개를 실제로 판별하는 픽스처를 쓴다:
 *  - soft delete 된 mail_templates 행
 *  - 보존 정책으로 정리된 survey_versions 행 (snapshot NULL). 정리된 행은
 *    ::text prefilter 를 통과하지 못하므로, 술어가 실제 판별자가 되도록
 *    changeNote 에 R2 URL 을 남겨 행이 참조를 주장하게 만든다.
 *
 * 함께 검증: 설문 hard delete 가 소멸하는 버전의 인덱스 행을 같은 트랜잭션에서
 * 거두는지 (r2_key_refs 에는 FK 가 없어 CASCADE 가 닿지 않는다).
 *
 * 실행: pnpm test:integration (로컬 supabase 54322 + 0070·0071 적용 필요)
 */
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  mailTemplates,
  r2DeletionCandidates,
  r2KeyRefs,
  surveys,
  surveyVersions,
} from '@/db/schema';
import { deleteSurvey } from '@/server/survey-builder/services/surveys.service';
import { rebuildAllKeyRefs } from '@/lib/r2-lifecycle/key-ref-index.server';
import { findReferencedKeys } from '@/lib/r2-lifecycle/reference-scan.server';

const isLocalDb =
  (process.env['DATABASE_URL'] ?? '').includes('127.0.0.1') ||
  (process.env['DATABASE_URL'] ?? '').includes('localhost');

const CDN = 'https://cdn-dev.megaresearch.co.kr';
const run = crypto.randomUUID();
const surveyId = crypto.randomUUID();
const deletedSurveyId = crypto.randomUUID();

const liveVersionKey = `survey/idx-live-${run}.png`;
const prunedVersionKey = `survey/idx-pruned-${run}.png`;
const liveTemplateKey = `mail/idx-live-tpl-${run}.png`;
const softDeletedTemplateKey = `mail/idx-dead-tpl-${run}.png`;
const deletedSurveyVersionKey = `survey/idx-cascade-${run}.png`;

const allKeys = [
  liveVersionKey,
  prunedVersionKey,
  liveTemplateKey,
  softDeletedTemplateKey,
  deletedSurveyVersionKey,
];

async function indexedKeys(): Promise<Set<string>> {
  const rows = await db
    .select({ key: r2KeyRefs.key })
    .from(r2KeyRefs)
    .where(inArray(r2KeyRefs.key, allKeys));
  return new Set(rows.map((row) => row.key));
}

describe.skipIf(!isLocalDb)('r2_key_refs 재구축 — 스캔 표면과 일치', () => {
  afterAll(async () => {
    await db.update(surveys).set({ currentVersionId: null }).where(eq(surveys.id, surveyId));
    await db.delete(surveyVersions).where(eq(surveyVersions.surveyId, surveyId));
    await db.delete(mailTemplates).where(eq(mailTemplates.surveyId, surveyId));
    await db.delete(surveys).where(inArray(surveys.id, [surveyId, deletedSurveyId]));
    await db.delete(r2KeyRefs).where(inArray(r2KeyRefs.key, allKeys));
    await db.delete(r2DeletionCandidates).where(inArray(r2DeletionCandidates.key, allKeys));
  });

  it('rebuild 결과가 스캔이 인정하는 참조와 정확히 일치한다', async () => {
    await db.insert(surveys).values({
      id: surveyId,
      title: '인덱스 표면 일치 테스트',
      slug: `key-ref-rebuild-${run}`,
    });

    await db.insert(surveyVersions).values([
      {
        surveyId,
        versionNumber: 1,
        status: 'published',
        snapshot: { questions: [{ imageUrl: `${CDN}/${liveVersionKey}` }] } as never,
      },
      {
        // 보존 정책으로 정리된 버전 — snapshot 은 비었지만 changeNote 에 URL 이 남아
        // 술어가 없으면 이 행이 참조를 주장한다
        surveyId,
        versionNumber: 2,
        status: 'superseded',
        snapshot: null,
        prunedAt: new Date(),
        changeNote: `이미지 교체: ${CDN}/${prunedVersionKey}`,
      },
    ]);

    await db.insert(mailTemplates).values([
      {
        surveyId,
        name: '살아있는 템플릿',
        bodyHtml: `<img src="${CDN}/${liveTemplateKey}">`,
      },
      {
        surveyId,
        name: 'soft delete 된 템플릿',
        bodyHtml: `<img src="${CDN}/${softDeletedTemplateKey}">`,
        deletedAt: new Date(),
      },
    ]);

    await rebuildAllKeyRefs();

    const indexed = await indexedKeys();
    const scanned = await findReferencedKeys(allKeys);

    // 인덱스와 스캔이 같은 답을 낸다 — 이것이 계약의 본체
    expect([...indexed].sort()).toEqual([...scanned].sort());
    expect(indexed).toEqual(new Set([liveVersionKey, liveTemplateKey]));
  });

  it('설문 hard delete 가 소멸한 버전의 인덱스 행을 함께 거둔다', async () => {
    await db.insert(surveys).values({
      id: deletedSurveyId,
      title: '삭제 대상 설문',
      slug: `key-ref-cascade-${run}`,
    });
    const versionRows = await db
      .insert(surveyVersions)
      .values({
        surveyId: deletedSurveyId,
        versionNumber: 1,
        status: 'published',
        snapshot: { questions: [{ imageUrl: `${CDN}/${deletedSurveyVersionKey}` }] } as never,
      })
      .returning({ id: surveyVersions.id });
    const versionId = versionRows[0]?.id;
    if (!versionId) throw new Error('버전 생성 실패');

    await db
      .insert(r2KeyRefs)
      .values({
        key: deletedSurveyVersionKey,
        sourceTable: 'survey_versions',
        sourceId: versionId,
      })
      .onConflictDoNothing();

    await deleteSurvey({ surveyId: deletedSurveyId });

    const leftovers = await db
      .select({ key: r2KeyRefs.key })
      .from(r2KeyRefs)
      .where(
        and(
          eq(r2KeyRefs.sourceTable, 'survey_versions'),
          eq(r2KeyRefs.sourceId, versionId),
        ),
      );
    expect(leftovers).toEqual([]);

    // 후보는 등록됐고, 인덱스가 비었으므로 집행이 '보존됨'으로 닫히지 않는다
    const candidates = await db
      .select({ key: r2DeletionCandidates.key, status: r2DeletionCandidates.status })
      .from(r2DeletionCandidates)
      .where(eq(r2DeletionCandidates.key, deletedSurveyVersionKey));
    expect(candidates).toContainEqual({ key: deletedSurveyVersionKey, status: 'pending' });
  });
});
