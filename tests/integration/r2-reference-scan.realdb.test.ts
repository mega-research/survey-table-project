/**
 * 전역 참조 재확인 — 실DB 왕복 (이슈 07).
 *
 * 발행 스냅샷·보관함·복제본(다른 설문의 동일 URL)·라이브 템플릿의 참조가
 * 발견되고, soft-delete 된 메일 템플릿 행의 참조는 세지 않는다.
 */
import { inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  mailTemplates,
  questions as questionsTable,
  savedQuestions,
  surveys as surveysTable,
  surveyVersions,
} from '@/db/schema';
import { findReferencedKeys } from '@/lib/r2-lifecycle/reference-scan.server';

const isLocalDb =
  (process.env['DATABASE_URL'] ?? '').includes('127.0.0.1') ||
  (process.env['DATABASE_URL'] ?? '').includes('localhost');

const CDN = 'https://cdn-dev.megaresearch.co.kr';
const uid = () => crypto.randomUUID();
const createdSurveyIds: string[] = [];
const createdSavedQuestionIds: string[] = [];

describe.skipIf(!isLocalDb)('전역 참조 재확인 실DB 왕복', () => {
  afterAll(async () => {
    if (createdSurveyIds.length > 0) {
      await db.delete(surveysTable).where(inArray(surveysTable.id, createdSurveyIds));
    }
    if (createdSavedQuestionIds.length > 0) {
      await db.delete(savedQuestions).where(inArray(savedQuestions.id, createdSavedQuestionIds));
    }
  });

  it('스냅샷·보관함·복제본·라이브 템플릿 참조는 발견되고 soft-delete 템플릿·무참조 키는 아니다', async () => {
    const snapshotKey = `survey/ref-${uid()}.png`;
    const libraryKey = `survey/ref-${uid()}.png`;
    const duplicateKey = `survey/ref-${uid()}.png`;
    const liveTplKey = `mail/ref-${uid()}.png`;
    const softDeletedTplKey = `mail/ref-${uid()}.png`;
    const unreferencedKey = `mail/ref-${uid()}.png`;

    const [survey] = await db
      .insert(surveysTable)
      .values({ title: '재확인-스냅샷' })
      .returning({ id: surveysTable.id });
    if (!survey) throw new Error('설문 시드 실패');
    createdSurveyIds.push(survey.id);

    // 발행 스냅샷 참조
    await db.insert(surveyVersions).values({
      surveyId: survey.id,
      versionNumber: 1,
      snapshot: { questions: [{ imageUrl: `${CDN}/${snapshotKey}` }] } as never,
    });

    // 보관함 참조
    const [sq] = await db
      .insert(savedQuestions)
      .values({
        name: '재확인-보관함',
        category: '기타',
        question: { type: 'notice', title: 'x', imageUrl: `${CDN}/${libraryKey}` } as never,
      })
      .returning({ id: savedQuestions.id });
    if (!sq) throw new Error('보관함 시드 실패');
    createdSavedQuestionIds.push(sq.id);

    // 복제본 참조 시뮬레이션 — 다른 설문의 질문이 같은 URL 공유
    const [copySurvey] = await db
      .insert(surveysTable)
      .values({ title: '재확인-복제본' })
      .returning({ id: surveysTable.id });
    if (!copySurvey) throw new Error('복제본 시드 실패');
    createdSurveyIds.push(copySurvey.id);
    await db.insert(questionsTable).values({
      id: uid(),
      surveyId: copySurvey.id,
      type: 'text',
      title: '복제본 질문',
      order: 1,
      imageUrl: `${CDN}/${duplicateKey}`,
    });

    // 라이브 템플릿 vs soft-delete 템플릿
    await db.insert(mailTemplates).values([
      { surveyId: survey.id, name: '라이브', bodyHtml: `<img src="${CDN}/${liveTplKey}">` },
      {
        surveyId: survey.id,
        name: 'soft 삭제됨',
        bodyHtml: `<img src="${CDN}/${softDeletedTplKey}">`,
        deletedAt: new Date(),
      },
    ]);

    const referenced = await findReferencedKeys([
      snapshotKey,
      libraryKey,
      duplicateKey,
      liveTplKey,
      softDeletedTplKey,
      unreferencedKey,
    ]);

    expect(referenced.has(snapshotKey), '발행 스냅샷 참조').toBe(true);
    expect(referenced.has(libraryKey), '보관함 참조').toBe(true);
    expect(referenced.has(duplicateKey), '복제본 참조').toBe(true);
    expect(referenced.has(liveTplKey), '라이브 템플릿 참조').toBe(true);
    expect(referenced.has(softDeletedTplKey), 'soft-delete 템플릿은 제외').toBe(false);
    expect(referenced.has(unreferencedKey), '무참조 키').toBe(false);
  });
});
