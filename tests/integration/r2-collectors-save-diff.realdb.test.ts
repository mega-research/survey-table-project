/**
 * 수집원(저장 diff 5경로) + 부활 취소 — 실DB 왕복 계약 테스트 (이슈 06).
 *
 * - 설문 저장(diff)·단건 질문 update·보관함 update·템플릿 update·설문
 *   update(로고)에서 빠진 키가 등록된다
 * - 부분 update 에서 미포함 필드는 오등록되지 않는다
 * - 대기 후보의 키가 저장 콘텐츠에 재등장하면 '취소됨'으로 전이된다
 * - 지웠다 undo 복원 후 저장(동일 콘텐츠 재저장)은 아무것도 등록하지 않는다
 *
 * 실행: pnpm test:integration (로컬 supabase 54322 + 0065 적용 필요)
 */
import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  mailTemplates,
  questions as questionsTable,
  r2DeletionCandidates,
  savedQuestions,
  surveys as surveysTable,
} from '@/db/schema';
import { updateSavedQuestion } from '@/server/library/services/saved-questions.service';
import { updateMailTemplate } from '@/server/mail/services/mail-templates.service';
import { updateQuestion } from '@/server/survey-builder/services/questions.service';
import { saveSurveyDiff } from '@/server/survey-builder/services/survey-save.service';
import { updateSurvey } from '@/server/survey-builder/services/surveys.service';
import { registerDeletionCandidates } from '@/server/shared/r2-lifecycle/deletion-queue.server';

const isLocalDb =
  (process.env['DATABASE_URL'] ?? '').includes('127.0.0.1') ||
  (process.env['DATABASE_URL'] ?? '').includes('localhost');

const CDN = 'https://cdn-dev.megaresearch.co.kr';
// promote 유틸이 URL 분류에 publicUrl 을 요구한다 — 이 테스트의 콘텐츠는 전부
// 영구 prefix URL 이라 R2 호출은 발생하지 않지만 env 부재 시 throw 하므로 고정.
process.env['CLOUDFLARE_R2_PUBLIC_URL'] ??= CDN;
const uid = () => crypto.randomUUID();
const usedKeys: string[] = [];
const key = (ns: string) => {
  const k = `${ns}/sd-${uid()}.png`;
  usedKeys.push(k);
  return k;
};
const createdSurveyIds: string[] = [];
const createdSavedQuestionIds: string[] = [];

async function candidateRows(keys: string[]) {
  return db
    .select({ key: r2DeletionCandidates.key, status: r2DeletionCandidates.status })
    .from(r2DeletionCandidates)
    .where(inArray(r2DeletionCandidates.key, keys));
}

async function seedSurvey(title: string): Promise<string> {
  const [s] = await db.insert(surveysTable).values({ title }).returning({ id: surveysTable.id });
  if (!s) throw new Error('설문 시드 실패');
  createdSurveyIds.push(s.id);
  return s.id;
}

describe.skipIf(!isLocalDb)('수집원 — 저장 diff·부활 취소 실DB 왕복', () => {
  afterAll(async () => {
    if (createdSurveyIds.length > 0) {
      await db.delete(surveysTable).where(inArray(surveysTable.id, createdSurveyIds));
    }
    if (createdSavedQuestionIds.length > 0) {
      await db.delete(savedQuestions).where(inArray(savedQuestions.id, createdSavedQuestionIds));
    }
    if (usedKeys.length > 0) {
      await db.delete(r2DeletionCandidates).where(inArray(r2DeletionCandidates.key, usedKeys));
    }
  });

  it('설문 저장 diff: 업서트에서 교체된 이미지와 삭제된 질문의 키가 등록된다', async () => {
    const replacedKey = key('survey');
    const keptKey = key('survey');
    const deletedQKey = key('survey');
    const surveyId = await seedSurvey('저장diff-원본');

    const q1 = uid();
    const q2 = uid();
    await db.insert(questionsTable).values([
      {
        id: q1,
        surveyId,
        type: 'text',
        title: '교체 대상',
        order: 1,
        imageUrl: `${CDN}/${replacedKey}`,
        noticeContent: `<img src="${CDN}/${keptKey}">`,
      },
      {
        id: q2,
        surveyId,
        type: 'text',
        title: '삭제 대상',
        order: 2,
        imageUrl: `${CDN}/${deletedQKey}`,
      },
    ]);

    await saveSurveyDiff({
      surveyId,
      questionChanges: {
        upserted: [
          {
            id: q1,
            type: 'text',
            title: '교체 대상',
            required: false,
            order: 1,
            imageUrl: null,
            noticeContent: `<img src="${CDN}/${keptKey}">`,
          },
        ],
        deleted: [q2],
      },
    } as never);

    const rows = await candidateRows([replacedKey, keptKey, deletedQKey]);
    const byKey = new Map(rows.map((r) => [r.key, r.status]));
    expect(byKey.get(replacedKey)).toBe('pending');
    expect(byKey.get(deletedQKey)).toBe('pending');
    expect(byKey.has(keptKey)).toBe(false);
  });

  it('단건 질문 update: 부분 payload 는 미포함 필드를 오등록하지 않고, 포함 필드의 빠진 키만 등록한다', async () => {
    const imgKey = key('survey');
    const noticeKey = key('survey');
    const surveyId = await seedSurvey('저장diff-단건질문');
    const qid = uid();
    await db.insert(questionsTable).values({
      id: qid,
      surveyId,
      type: 'text',
      title: '부분 패치 대상',
      order: 1,
      imageUrl: `${CDN}/${imgKey}`,
      noticeContent: `<img src="${CDN}/${noticeKey}">`,
    });

    // title 만 패치 — imageUrl·noticeContent 는 payload 에 없으므로 아무것도 등록되지 않는다
    await updateQuestion(qid, surveyId, { title: '제목만 수정' } as never);
    expect((await candidateRows([imgKey, noticeKey])).length).toBe(0);

    // noticeContent 를 교체 — 빠진 noticeKey 만 등록, imageUrl 은 여전히 미포함
    await updateQuestion(qid, surveyId, { noticeContent: '<p>이미지 뺌</p>' } as never);
    const rows = await candidateRows([imgKey, noticeKey]);
    expect(rows.length).toBe(1);
    expect(rows[0]?.key).toBe(noticeKey);
    expect(rows[0]?.status).toBe('pending');
  });

  it('보관함 질문 update 에서 빠진 키가 등록된다', async () => {
    const oldKey = key('survey');
    const [sq] = await db
      .insert(savedQuestions)
      .values({
        name: '보관함 수정 대상',
        category: '기타',
        question: { type: 'notice', title: 'x', imageUrl: `${CDN}/${oldKey}` } as never,
      })
      .returning({ id: savedQuestions.id });
    if (!sq) throw new Error('보관함 질문 시드 실패');
    createdSavedQuestionIds.push(sq.id);

    await updateSavedQuestion(sq.id, {
      question: { type: 'notice', title: 'x', imageUrl: null } as never,
    });

    const rows = await candidateRows([oldKey]);
    expect(rows.length).toBe(1);
    expect(rows[0]?.status).toBe('pending');
  });

  it('메일 템플릿 update 에서 빠진 본문 이미지·첨부 키가 등록된다', async () => {
    const bodyKey = key('mail');
    const attKey = key('mail-attachment');
    const surveyId = await seedSurvey('저장diff-템플릿');
    const [tpl] = await db
      .insert(mailTemplates)
      .values({
        surveyId,
        name: '수정 대상 템플릿',
        bodyHtml: `<img src="${CDN}/${bodyKey}">`,
        attachments: [
          { key: attKey, filename: 'f.pdf', size: 1, mime: 'application/pdf' },
        ] as never,
      })
      .returning({ id: mailTemplates.id });
    if (!tpl) throw new Error('템플릿 시드 실패');

    await updateMailTemplate({
      surveyId,
      templateId: tpl.id,
      input: {
        name: '수정 대상 템플릿',
        subject: '제목',
        bodyHtml: '<p>이미지 없음</p>',
        fromLocal: 'noreply',
        fromName: '발신자',
        replyTo: null,
        attachments: [],
      },
    } as never);

    const rows = await candidateRows([bodyKey, attKey]);
    expect(rows.map((r) => r.key).sort()).toEqual([attKey, bodyKey].sort());
    expect(rows.every((r) => r.status === 'pending')).toBe(true);
  });

  it('설문 update: 응답 헤더 로고 교체 시 빠진 키가 등록된다', async () => {
    const logoKey = key('survey');
    const surveyId = await seedSurvey('저장diff-로고');
    await db
      .update(surveysTable)
      .set({
        responseHeader: { kind: 'logo-title', logo: { imageUrl: `${CDN}/${logoKey}` } } as never,
      })
      .where(eq(surveysTable.id, surveyId));

    await updateSurvey({
      surveyId,
      data: { responseHeader: null },
    } as never);

    const rows = await candidateRows([logoKey]);
    expect(rows.length).toBe(1);
    expect(rows[0]?.status).toBe('pending');
  });

  it('부활 취소: 대기 후보의 키가 저장 콘텐츠에 재등장하면 취소된다', async () => {
    const revivedKey = key('survey');
    const surveyId = await seedSurvey('저장diff-부활');
    const qid = uid();
    await db.insert(questionsTable).values({
      id: qid,
      surveyId,
      type: 'text',
      title: '부활 대상',
      order: 1,
    });

    await registerDeletionCandidates(db, { keys: [revivedKey], source: 'save-diff' });

    await updateQuestion(qid, surveyId, {
      noticeContent: `<img src="${CDN}/${revivedKey}">`,
    } as never);

    const rows = await candidateRows([revivedKey]);
    expect(rows.length).toBe(1);
    expect(rows[0]?.status).toBe('cancelled');
  });

  it('undo 복원 후 저장: 동일 콘텐츠 재저장은 아무것도 등록하지 않는다', async () => {
    const stableKey = key('survey');
    const surveyId = await seedSurvey('저장diff-undo');
    const qid = uid();
    const notice = `<img src="${CDN}/${stableKey}">`;
    await db.insert(questionsTable).values({
      id: qid,
      surveyId,
      type: 'text',
      title: 'undo 대상',
      order: 1,
      noticeContent: notice,
    });

    // 지웠다 undo 로 복원한 상태의 저장 = 이전과 동일한 콘텐츠 저장
    await updateQuestion(qid, surveyId, { noticeContent: notice } as never);

    expect((await candidateRows([stableKey])).length).toBe(0);
  });
});
