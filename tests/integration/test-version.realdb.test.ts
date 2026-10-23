/**
 * 테스트 버전 — 저장본으로 만든 스냅샷을 테스트 화면에 준다. 실DB 왕복으로 확인한다.
 *
 * - 저장본이 같으면 같은 테스트 버전을 쓰고, 바뀌면 새 테스트 버전을 만들고 직전 것의 스냅샷을 비운다
 * - 두 테스터가 동시에 들어와도 테스트 버전은 하나만 만든다
 * - 배포 번호·정리는 테스트 버전을 모른다
 *
 * 실행: pnpm test:integration (로컬 supabase 54322 필요)
 */
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { randomUUID } from 'node:crypto';

import { db } from '@/db';
import {
  questions,
  r2DeletionCandidates,
  surveyResponses,
  surveys,
  surveyVersions,
} from '@/db/schema';
import { getSurveyVersions } from '@/server/read-models/responses';
import { publishSurvey } from '@/server/survey-builder/services/survey-publish';
import { getSurveyForResponse } from '@/server/survey-builder/services/survey-read';
import { ensureTestVersion } from '@/server/survey-builder/services/test-version';

const isLocalDb =
  (process.env['DATABASE_URL'] ?? '').includes('127.0.0.1') ||
  (process.env['DATABASE_URL'] ?? '').includes('localhost');

const createdSurveyIds: string[] = [];
const CDN = 'https://cdn-dev.megaresearch.co.kr';
process.env['CLOUDFLARE_R2_PUBLIC_URL'] ??= CDN;
const usedKeys: string[] = [];

async function seedSurvey() {
  const [survey] = await db.insert(surveys).values({ title: '테스트 버전 왕복' }).returning();
  if (!survey) throw new Error('설문 시드 실패');
  createdSurveyIds.push(survey.id);
  const [question] = await db
    .insert(questions)
    .values({ surveyId: survey.id, type: 'text', title: '처음 문구', order: 0 })
    .returning();
  if (!question) throw new Error('문항 시드 실패');
  return { surveyId: survey.id, questionId: question.id };
}

async function versionRows(surveyId: string) {
  return db
    .select({
      id: surveyVersions.id,
      status: surveyVersions.status,
      versionNumber: surveyVersions.versionNumber,
      hasSnapshot: surveyVersions.snapshot,
      fingerprints: surveyVersions.fingerprints,
    })
    .from(surveyVersions)
    .where(eq(surveyVersions.surveyId, surveyId));
}

async function testVersionIdOf(surveyId: string) {
  const [row] = await db
    .select({ testVersionId: surveys.testVersionId })
    .from(surveys)
    .where(eq(surveys.id, surveyId));
  return row?.testVersionId ?? null;
}

describe.skipIf(!isLocalDb)('테스트 버전 실DB 왕복', () => {
  afterAll(async () => {
    if (usedKeys.length > 0) {
      await db.delete(r2DeletionCandidates).where(inArray(r2DeletionCandidates.key, usedKeys));
    }
    if (createdSurveyIds.length === 0) return;
    await db.delete(surveyResponses).where(inArray(surveyResponses.surveyId, createdSurveyIds));
    await db.delete(surveys).where(inArray(surveys.id, createdSurveyIds));
  });

  it('처음 들어오면 저장본으로 테스트 버전을 만들고, 저장본이 같으면 그대로 쓴다', async () => {
    const { surveyId, questionId } = await seedSurvey();

    const first = await ensureTestVersion(surveyId);
    const again = await ensureTestVersion(surveyId);

    expect(first?.versionId).toBeTruthy();
    expect(again?.versionId).toBe(first?.versionId);
    expect(await testVersionIdOf(surveyId)).toBe(first?.versionId);
    const rows = await versionRows(surveyId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('test');
    expect(rows[0]?.versionNumber).toBeLessThan(0);
    expect(rows[0]?.fingerprints?.questions[questionId]).toBeTruthy();
    expect(first?.snapshot.questions.map((q) => q.title)).toEqual(['처음 문구']);
  });

  it('저장본이 바뀌면 새 테스트 버전을 만들고 직전 것의 스냅샷만 비운다 — 응답이 가리키면 지문은 남긴다', async () => {
    const { surveyId, questionId } = await seedSurvey();
    const first = await ensureTestVersion(surveyId);
    await db.insert(surveyResponses).values({
      surveyId,
      versionId: first!.versionId,
      sessionId: `tv-${randomUUID()}`,
      isTest: true,
      questionResponses: {},
    });

    await db.update(questions).set({ title: '고친 문구' }).where(eq(questions.id, questionId));
    const second = await ensureTestVersion(surveyId);

    expect(second?.versionId).not.toBe(first?.versionId);
    expect(second?.snapshot.questions.map((q) => q.title)).toEqual(['고친 문구']);
    expect(await testVersionIdOf(surveyId)).toBe(second?.versionId);
    const old = (await versionRows(surveyId)).find((r) => r.id === first?.versionId);
    expect(old?.hasSnapshot).toBeNull();
    expect(old?.fingerprints?.questions[questionId]).toBeTruthy();
  });

  it('두 테스터가 동시에 들어와도 바뀐 저장본의 테스트 버전은 하나만 만든다', async () => {
    const { surveyId, questionId } = await seedSurvey();
    await ensureTestVersion(surveyId);
    await db.update(questions).set({ title: '동시에 본 문구' }).where(eq(questions.id, questionId));

    const [a, b] = await Promise.all([ensureTestVersion(surveyId), ensureTestVersion(surveyId)]);

    expect(a?.versionId).toBe(b?.versionId);
    const live = (await versionRows(surveyId)).filter((r) => r.hasSnapshot !== null);
    expect(live).toHaveLength(1);
  });

  it('배포 번호는 테스트 버전을 세지 않고, 배포가 지금 테스트 버전의 스냅샷을 비우지 않는다', async () => {
    const { surveyId } = await seedSurvey();
    const test = await ensureTestVersion(surveyId);

    const published = await publishSurvey({ surveyId });
    await publishSurvey({ surveyId });

    expect(published.versionNumber).toBe(1);
    const testRow = (await versionRows(surveyId)).find((r) => r.id === test?.versionId);
    expect(testRow?.hasSnapshot).not.toBeNull();
    const published2 = await db
      .select({ n: surveyVersions.versionNumber })
      .from(surveyVersions)
      .where(and(eq(surveyVersions.surveyId, surveyId), eq(surveyVersions.status, 'published')));
    expect(published2.map((r) => r.n)).toEqual([2]);
  });

  it('테스트 링크와 관리자 미리보기는 저장본을, 실응답과 공개 미리보기는 배포본을 본다', async () => {
    const { surveyId, questionId } = await seedSurvey();
    await db
      .update(surveys)
      .set({ testModeEnabled: true, testToken: 'tv-token', isPublic: true })
      .where(eq(surveys.id, surveyId));
    const published = await publishSurvey({ surveyId });
    await db.update(questions).set({ title: '배포 안 한 문구' }).where(eq(questions.id, questionId));

    const real = await getSurveyForResponse({ surveyId });
    const publicPreview = await getSurveyForResponse({ surveyId }, { requirePublished: true });
    const testLink = await getSurveyForResponse({ surveyId, testToken: 'tv-token' });
    const adminPreview = await getSurveyForResponse({ surveyId }, { useTestVersion: true });
    const wrongToken = await getSurveyForResponse({ surveyId, testToken: 'wrong' });

    const titles = (r: typeof real) => r?.survey.questions.map((q) => q.title);
    expect(titles(real)).toEqual(['처음 문구']);
    expect(real?.versionId).toBe(published.id);
    expect(titles(publicPreview)).toEqual(['처음 문구']);
    expect(titles(wrongToken)).toEqual(['처음 문구']);
    expect(titles(testLink)).toEqual(['배포 안 한 문구']);
    expect(testLink?.versionId).toBe(await testVersionIdOf(surveyId));
    expect(titles(adminPreview)).toEqual(['배포 안 한 문구']);
    expect(adminPreview?.versionId).toBe(testLink?.versionId);
  });

  it('한 번도 배포하지 않은 설문도 테스트 링크는 버전이 있는 테스트 버전을 본다', async () => {
    const { surveyId } = await seedSurvey();
    await db
      .update(surveys)
      .set({ testModeEnabled: true, testToken: 'tv-token-2' })
      .where(eq(surveys.id, surveyId));

    const testLink = await getSurveyForResponse({ surveyId, testToken: 'tv-token-2' });

    expect(testLink?.versionId).toBe(await testVersionIdOf(surveyId));
    expect(testLink?.versionId).not.toBeNull();
  });

  it('직전 테스트 버전을 비울 때 새 스냅샷에도 있는 이미지는 유예 삭제에 올리지 않고 빠진 이미지만 올린다', async () => {
    const { surveyId, questionId } = await seedSurvey();
    const kept = `survey/image/tv-kept-${randomUUID()}.png`;
    const dropped = `survey/image/tv-dropped-${randomUUID()}.png`;
    usedKeys.push(kept, dropped);
    const img = (key: string) => `<p><img src="${CDN}/${key}"></p>`;
    await db.update(questions).set({ description: img(kept) }).where(eq(questions.id, questionId));
    const [second] = await db
      .insert(questions)
      .values({ surveyId, type: 'text', title: '두 번째', order: 1, description: img(dropped) })
      .returning();
    await ensureTestVersion(surveyId);

    await db.update(questions).set({ description: null }).where(eq(questions.id, second!.id));
    await ensureTestVersion(surveyId);

    const candidates = await db
      .select({ key: r2DeletionCandidates.key })
      .from(r2DeletionCandidates)
      .where(inArray(r2DeletionCandidates.key, [kept, dropped]));
    expect(candidates.map((c) => c.key)).toEqual([dropped]);
  });

  it('아무 응답도 가리키지 않는 옛 테스트 버전 행은 지우고, 응답이 가리키는 행은 지문과 함께 남긴다', async () => {
    const { surveyId, questionId } = await seedSurvey();
    const first = await ensureTestVersion(surveyId);
    await db.insert(surveyResponses).values({
      surveyId,
      versionId: first!.versionId,
      sessionId: `tv-${randomUUID()}`,
      isTest: true,
      questionResponses: {},
    });
    await db.update(questions).set({ title: '두 번째 문구' }).where(eq(questions.id, questionId));
    const second = await ensureTestVersion(surveyId);
    await db.update(questions).set({ title: '세 번째 문구' }).where(eq(questions.id, questionId));
    const third = await ensureTestVersion(surveyId);

    const ids = (await versionRows(surveyId)).map((r) => r.id).sort();
    expect(ids).toEqual([first!.versionId, third!.versionId].sort());
    expect(ids).not.toContain(second!.versionId);
  });

  it('버전 목록에는 테스트 버전이 나오지 않는다', async () => {
    const { surveyId } = await seedSurvey();
    await ensureTestVersion(surveyId);
    await publishSurvey({ surveyId });

    const listed = await getSurveyVersions(surveyId);
    expect(listed.map((v) => v.status)).toEqual(['published']);
  });

  it('없는 설문이면 null', async () => {
    expect(await ensureTestVersion('00000000-0000-4000-8000-000000000000')).toBeNull();
  });
});
