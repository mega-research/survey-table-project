/**
 * 전역 참조 재확인 — 실DB 왕복 (이슈 07).
 *
 * 발행 스냅샷·보관함·복제본(다른 설문의 동일 URL)·라이브 템플릿의 참조가
 * 발견되고, soft-delete 된 메일 템플릿 행의 참조는 세지 않는다.
 */
import { eq, inArray } from 'drizzle-orm';
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

  it('정리된 버전의 스냅샷 키는 참조로 잡히지 않는다', async () => {
    const key = `survey/rt-${uid()}.png`;
    const url = `${CDN}/${key}`;

    const [survey] = await db
      .insert(surveysTable)
      .values({ title: '정리 버전 스캔 제외 테스트' })
      .returning({ id: surveysTable.id });
    if (!survey) throw new Error('설문 시드 실패');
    createdSurveyIds.push(survey.id);

    // changeNote 에도 같은 URL 을 심어둔다 — snapshot 을 비운 뒤에도 행
    // 자체는 LIKE prefilter 를 통과하도록 만들어, "행이 prefilter 를
    // 통과하느냐"가 아니라 "extraWhere(snapshot IS NOT NULL) 가 실제로
    // 그 행을 걸러내느냐"를 검증한다. changeNote 까지 함께 비우면 prefilter
    // 자체가 행을 떨어뜨려 extraWhere 유무와 무관하게 항상 통과하므로
    // 무의미한 테스트가 된다.
    const [version] = await db
      .insert(surveyVersions)
      .values({
        surveyId: survey.id,
        versionNumber: 1,
        status: 'superseded',
        snapshot: { questions: [{ imageUrl: url }] } as never,
        changeNote: `정리 전 스냅샷 참조 기록용 ${url}`,
      })
      .returning({ id: surveyVersions.id });
    if (!version) throw new Error('버전 시드 실패');

    // 비우기 전에는 참조로 잡힌다
    expect((await findReferencedKeys([key])).has(key), '정리 전에는 참조').toBe(true);

    await db
      .update(surveyVersions)
      .set({ snapshot: null, prunedAt: new Date() })
      .where(eq(surveyVersions.id, version.id));

    // snapshot 은 비웠지만 changeNote 는 그대로라 행 자체는 여전히
    // LIKE prefilter 를 통과한다 — 그럼에도 extraWhere(snapshot IS NOT NULL)
    // 가 행을 걸러내 스캔 표면에서 제외됨을 검증한다.
    expect((await findReferencedKeys([key])).has(key), '정리 후에는 제외').toBe(false);
  });
});
