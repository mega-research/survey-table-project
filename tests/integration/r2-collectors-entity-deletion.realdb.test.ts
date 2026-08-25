/**
 * 수집원(엔티티 삭제) — 실DB 왕복 계약 테스트 (이슈 05).
 *
 * - 설문 삭제: CASCADE 소멸 범위 전체(질문·responseHeader·버전 스냅샷·소속
 *   템플릿·캠페인 스냅샷)의 키가 삭제 전에 큐에 등록된다
 * - 보관함 질문·셀 삭제, 단건 질문 삭제가 콘텐츠 키를 등록한다
 * - 메일 템플릿 삭제 이원화: 비테스트 발송 이력 있으면 soft, 없으면 hard,
 *   테스트 발송만 있으면 "발송한 적 없음"
 *
 * 실행: pnpm test:integration (로컬 supabase 54322 + 0065 적용 필요)
 */
import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  mailCampaigns,
  mailTemplates,
  questions as questionsTable,
  r2DeletionCandidates,
  savedCells,
  savedQuestions,
  surveys as surveysTable,
  surveyVersions,
} from '@/db/schema';
import { deleteSavedCell } from '@/server/library/services/saved-cells.service';
import { deleteSavedQuestion } from '@/server/library/services/saved-questions.service';
import { deleteMailTemplate } from '@/server/mail/services/templates';
import { deleteQuestion } from '@/server/survey-builder/services/questions.service';
import { deleteSurvey } from '@/server/survey-builder/services/surveys.service';

const isLocalDb =
  (process.env['DATABASE_URL'] ?? '').includes('127.0.0.1') ||
  (process.env['DATABASE_URL'] ?? '').includes('localhost');

const CDN = 'https://cdn-dev.megaresearch.co.kr';
const uid = () => crypto.randomUUID();
const usedKeys: string[] = [];
const key = (ns: string) => {
  const k = `${ns}/ent-${uid()}.png`;
  usedKeys.push(k);
  return k;
};
const createdSurveyIds: string[] = [];

async function pendingKeys(): Promise<Set<string>> {
  const rows = await db
    .select({ key: r2DeletionCandidates.key, status: r2DeletionCandidates.status })
    .from(r2DeletionCandidates)
    .where(inArray(r2DeletionCandidates.key, usedKeys));
  return new Set(rows.filter((r) => r.status === 'pending').map((r) => r.key));
}

describe.skipIf(!isLocalDb)('수집원 — 엔티티 삭제 실DB 왕복', () => {
  afterAll(async () => {
    if (createdSurveyIds.length > 0) {
      await db.delete(surveysTable).where(inArray(surveysTable.id, createdSurveyIds));
    }
    if (usedKeys.length > 0) {
      await db.delete(r2DeletionCandidates).where(inArray(r2DeletionCandidates.key, usedKeys));
    }
  });

  it('설문 삭제: cascade 범위 전체의 키가 큐에 등록된다', async () => {
    const qImgKey = key('survey');
    const noticeAttKey = key('notice-attachment');
    const headerLogoKey = key('survey');
    const versionSnapKey = key('survey');
    const tplBodyKey = key('mail');
    const tplAttKey = key('mail-attachment');
    const campSnapKey = key('mail');

    const [survey] = await db
      .insert(surveysTable)
      .values({
        title: '수집원-설문삭제-원본',
        responseHeader: {
          kind: 'logo-title',
          logo: { imageUrl: `${CDN}/${headerLogoKey}` },
        } as never,
      })
      .returning({ id: surveysTable.id });
    if (!survey) throw new Error('설문 시드 실패');
    createdSurveyIds.push(survey.id);

    await db.insert(questionsTable).values({
      id: uid(),
      surveyId: survey.id,
      type: 'notice',
      title: '이미지 질문',
      order: 1,
      imageUrl: `${CDN}/${qImgKey}`,
      noticeContent: `<a data-file-attachment="true" data-key="${noticeAttKey}" href="${CDN}/${noticeAttKey}">파일</a>`,
    });

    await db.insert(surveyVersions).values({
      surveyId: survey.id,
      versionNumber: 1,
      snapshot: {
        questions: [{ imageUrl: `${CDN}/${versionSnapKey}` }],
      } as never,
    });

    const [tpl] = await db
      .insert(mailTemplates)
      .values({
        surveyId: survey.id,
        name: '수집원 템플릿',
        bodyHtml: `<img src="${CDN}/${tplBodyKey}">`,
        attachments: [
          { key: tplAttKey, filename: 'f.pdf', size: 1, mime: 'application/pdf' },
        ] as never,
      })
      .returning({ id: mailTemplates.id });
    if (!tpl) throw new Error('템플릿 시드 실패');

    await db.insert(mailCampaigns).values({
      surveyId: survey.id,
      mailTemplateId: tpl.id,
      runNumber: 1,
      title: '수집원 캠페인',
      subjectSnapshot: '제목',
      bodyHtmlSnapshot: `<img src="${CDN}/${campSnapKey}">`,
      fromLocalSnapshot: 'noreply',
      fromNameSnapshot: '발신자',
    });

    await deleteSurvey({ surveyId: survey.id });

    const [gone] = await db.select().from(surveysTable).where(eq(surveysTable.id, survey.id));
    expect(gone).toBeUndefined();

    const pending = await pendingKeys();
    for (const k of [
      qImgKey,
      noticeAttKey,
      headerLogoKey,
      versionSnapKey,
      tplBodyKey,
      tplAttKey,
      campSnapKey,
    ]) {
      expect(pending.has(k), `누락된 수집 키: ${k}`).toBe(true);
    }
  });

  it('단건 질문 삭제가 콘텐츠 키를 등록한다', async () => {
    const cellImgKey = key('survey');
    const [survey] = await db
      .insert(surveysTable)
      .values({ title: '수집원-질문삭제' })
      .returning({ id: surveysTable.id });
    if (!survey) throw new Error('설문 시드 실패');
    createdSurveyIds.push(survey.id);

    const questionId = uid();
    await db.insert(questionsTable).values({
      id: questionId,
      surveyId: survey.id,
      type: 'table',
      title: '테이블 질문',
      order: 1,
      tableRowsData: [{ cells: [{ id: 'c1', imageUrl: `${CDN}/${cellImgKey}` }] }] as never,
    });

    await deleteQuestion(questionId, survey.id);

    const pending = await pendingKeys();
    expect(pending.has(cellImgKey)).toBe(true);
  });

  it('보관함 질문·셀 삭제가 콘텐츠 키를 등록한다', async () => {
    const sqKey = key('survey');
    const cellKey = key('survey');

    const [sq] = await db
      .insert(savedQuestions)
      .values({
        name: '보관함 질문',
        category: '기타',
        question: { type: 'notice', title: 'x', imageUrl: `${CDN}/${sqKey}` } as never,
      })
      .returning({ id: savedQuestions.id });
    if (!sq) throw new Error('보관함 질문 시드 실패');
    await deleteSavedQuestion(sq.id);

    const [sc] = await db
      .insert(savedCells)
      .values({
        name: '보관함 셀',
        cellType: 'image',
        cell: { id: 'c1', imageUrl: `${CDN}/${cellKey}` } as never,
      })
      .returning({ id: savedCells.id });
    if (!sc) throw new Error('보관함 셀 시드 실패');
    await deleteSavedCell(sc.id);

    const pending = await pendingKeys();
    expect(pending.has(sqKey)).toBe(true);
    expect(pending.has(cellKey)).toBe(true);
  });

  it('템플릿 이원화: 발송 이력 없으면 hard delete + 키 등록', async () => {
    const bodyKey = key('mail');
    const [survey] = await db
      .insert(surveysTable)
      .values({ title: '수집원-템플릿-hard' })
      .returning({ id: surveysTable.id });
    if (!survey) throw new Error('설문 시드 실패');
    createdSurveyIds.push(survey.id);

    const [tpl] = await db
      .insert(mailTemplates)
      .values({ surveyId: survey.id, name: 'hard 대상', bodyHtml: `<img src="${CDN}/${bodyKey}">` })
      .returning({ id: mailTemplates.id });
    if (!tpl) throw new Error('템플릿 시드 실패');

    await deleteMailTemplate({ surveyId: survey.id, templateId: tpl.id });

    const rows = await db.select().from(mailTemplates).where(eq(mailTemplates.id, tpl.id));
    expect(rows.length).toBe(0);
    expect((await pendingKeys()).has(bodyKey)).toBe(true);
  });

  it('템플릿 이원화: 비테스트 발송 이력 있으면 soft delete + 캠페인 이력 무손상', async () => {
    const bodyKey = key('mail');
    const [survey] = await db
      .insert(surveysTable)
      .values({ title: '수집원-템플릿-soft' })
      .returning({ id: surveysTable.id });
    if (!survey) throw new Error('설문 시드 실패');
    createdSurveyIds.push(survey.id);

    const [tpl] = await db
      .insert(mailTemplates)
      .values({ surveyId: survey.id, name: 'soft 대상', bodyHtml: `<img src="${CDN}/${bodyKey}">` })
      .returning({ id: mailTemplates.id });
    if (!tpl) throw new Error('템플릿 시드 실패');

    const [camp] = await db
      .insert(mailCampaigns)
      .values({
        surveyId: survey.id,
        mailTemplateId: tpl.id,
        runNumber: 1,
        isTest: false,
        startedAt: new Date(),
        title: '실발송 캠페인',
        subjectSnapshot: '제목',
        bodyHtmlSnapshot: '',
        fromLocalSnapshot: 'noreply',
        fromNameSnapshot: '발신자',
      })
      .returning({ id: mailCampaigns.id });
    if (!camp) throw new Error('캠페인 시드 실패');

    await deleteMailTemplate({ surveyId: survey.id, templateId: tpl.id });

    const [row] = await db.select().from(mailTemplates).where(eq(mailTemplates.id, tpl.id));
    expect(row).toBeDefined();
    expect(row?.deletedAt).not.toBeNull();

    const [campAfter] = await db
      .select()
      .from(mailCampaigns)
      .where(eq(mailCampaigns.id, camp.id));
    expect(campAfter?.mailTemplateId).toBe(tpl.id);
    expect((await pendingKeys()).has(bodyKey)).toBe(true);
  });

  it('템플릿 이원화: 테스트 발송만 있으면 발송한 적 없음으로 판정되어 hard delete', async () => {
    const bodyKey = key('mail');
    const [survey] = await db
      .insert(surveysTable)
      .values({ title: '수집원-템플릿-테스트만' })
      .returning({ id: surveysTable.id });
    if (!survey) throw new Error('설문 시드 실패');
    createdSurveyIds.push(survey.id);

    const [tpl] = await db
      .insert(mailTemplates)
      .values({ surveyId: survey.id, name: '테스트만 발송', bodyHtml: `<img src="${CDN}/${bodyKey}">` })
      .returning({ id: mailTemplates.id });
    if (!tpl) throw new Error('템플릿 시드 실패');

    const [camp] = await db
      .insert(mailCampaigns)
      .values({
        surveyId: survey.id,
        mailTemplateId: tpl.id,
        runNumber: 1,
        isTest: true,
        startedAt: new Date(),
        title: '테스트 캠페인',
        subjectSnapshot: '제목',
        bodyHtmlSnapshot: '',
        fromLocalSnapshot: 'noreply',
        fromNameSnapshot: '발신자',
      })
      .returning({ id: mailCampaigns.id });
    if (!camp) throw new Error('캠페인 시드 실패');

    await deleteMailTemplate({ surveyId: survey.id, templateId: tpl.id });

    const rows = await db.select().from(mailTemplates).where(eq(mailTemplates.id, tpl.id));
    expect(rows.length).toBe(0);

    // hard delete 후 테스트 캠페인의 템플릿 참조는 FK SET NULL
    const [campAfter] = await db
      .select()
      .from(mailCampaigns)
      .where(eq(mailCampaigns.id, camp.id));
    expect(campAfter?.mailTemplateId).toBeNull();
  });
});
