/**
 * 회신 전달 — 회신 주소 조회와 웹훅 장부의 실 DB 왕복.
 *
 * 「어느 발송 회차·템플릿의 회신 주소가 전달 주소 후보인가」는 SQL 이 판정의 일부라(기간·삭제 여부·빈 값·
 * 대소문자) 모킹으로는 못 본다. 서비스 진입점 테스트(`reply-forward.test.ts`)는 이 조회를 대역으로 둔다.
 *
 * 실행: `pnpm db:isolated <이름>` 이 찍어 주는 URL 로 RUN_REALDB=1 vitest. 로컬 DB 가 아니면 통째로 건너뛴다.
 * 보낸이 계정은 테스트마다 새로 지어 다른 스위트의 행과 섞이지 않는다.
 */
import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import { surveys as surveysTable } from '@/db/schema';
import { mailCampaigns, mailTemplates, webhookEvents } from '@/db/schema/mail';
import { loadAccountReplyAddresses } from '@/server/mail/services/reply-address-lookup';
import {
  isWebhookEventRecorded,
  recordReplyForwardEvent,
} from '@/server/mail/services/reply-forward-ledger';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const SEND_DOMAIN = 'send.example.co.kr';
const NOW = new Date('2026-11-12T03:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

describe.skipIf(!isLocalDb)('회신 주소 조회 (real local DB)', () => {
  const surveyIds: string[] = [];
  const eventIds: string[] = [];
  let runNumber = 0;

  afterAll(async () => {
    // 설문을 지우면 발송 회차·템플릿은 FK cascade 로 함께 지워진다.
    if (surveyIds.length > 0) await db.delete(surveysTable).where(inArray(surveysTable.id, surveyIds));
    if (eventIds.length > 0) await db.delete(webhookEvents).where(inArray(webhookEvents.id, eventIds));
  });

  const newAccount = () => `rf${randomUUID().replace(/-/g, '').slice(0, 12)}`;

  async function seedSurvey(): Promise<string> {
    const [survey] = await db
      .insert(surveysTable)
      .values({ title: '회신 전달 조회 테스트 설문' })
      .returning({ id: surveysTable.id });
    if (!survey) throw new Error('survey 삽입 실패');
    surveyIds.push(survey.id);
    return survey.id;
  }

  async function seedCampaign(
    surveyId: string,
    values: {
      fromLocal: string;
      replyTo: string | null;
      createdAt: Date;
      kind?: 'bulk' | 'single' | 'fallback';
      isTest?: boolean;
      archivedAt?: Date | null;
    },
  ): Promise<void> {
    runNumber += 1;
    await db.insert(mailCampaigns).values({
      surveyId,
      runNumber,
      title: `회차 ${runNumber}`,
      kind: values.kind ?? 'bulk',
      isTest: values.isTest ?? false,
      subjectSnapshot: '제목',
      bodyHtmlSnapshot: '<p>본문</p>',
      fromLocalSnapshot: values.fromLocal,
      fromNameSnapshot: '설문팀',
      replyToSnapshot: values.replyTo,
      archivedAt: values.archivedAt ?? null,
      createdAt: values.createdAt,
    });
  }

  async function seedTemplate(
    surveyId: string,
    values: { fromLocal: string; replyTo: string | null; deletedAt?: Date | null; updatedAt?: Date },
  ): Promise<void> {
    await db.insert(mailTemplates).values({
      surveyId,
      name: '안내 메일',
      fromLocal: values.fromLocal,
      fromName: '설문팀',
      replyTo: values.replyTo,
      deletedAt: values.deletedAt ?? null,
      ...(values.updatedAt ? { updatedAt: values.updatedAt } : {}),
    });
  }

  const lookup = (account: string) =>
    loadAccountReplyAddresses(account, { sendDomain: SEND_DOMAIN, now: NOW });

  it('그 계정의 최근 1년 발송 회차 회신 주소 전부를 중복 없이, 최근 것부터 돌려준다', async () => {
    const account = newAccount();
    const other = newAccount();
    const surveyA = await seedSurvey();
    const surveyB = await seedSurvey();
    await seedCampaign(surveyA, { fromLocal: account, replyTo: 'abc@example.co.kr', createdAt: daysAgo(30) });
    await seedCampaign(surveyA, { fromLocal: account, replyTo: 'abc@example.co.kr', createdAt: daysAgo(20) });
    await seedCampaign(surveyB, { fromLocal: account, replyTo: 'cba@example.co.kr', createdAt: daysAgo(10) });
    await seedCampaign(surveyB, { fromLocal: other, replyTo: 'other@example.co.kr', createdAt: daysAgo(1) });

    expect(await lookup(account)).toEqual({
      source: 'campaign',
      addresses: ['cba@example.co.kr', 'abc@example.co.kr'],
    });
  });

  it('보낸이 계정은 대소문자를 무시하고, 대소문자만 다른 회신 주소는 한 번만 돌려준다', async () => {
    const account = newAccount();
    const surveyId = await seedSurvey();
    await seedCampaign(surveyId, {
      fromLocal: account.toUpperCase(),
      replyTo: 'Help@Example.co.kr',
      createdAt: daysAgo(5),
    });
    await seedCampaign(surveyId, { fromLocal: account, replyTo: 'help@example.co.kr', createdAt: daysAgo(9) });

    expect(await lookup(account)).toEqual({ source: 'campaign', addresses: ['Help@Example.co.kr'] });
  });

  it('단건·대체 발송·테스트 파티션·보관된 회차도 본다', async () => {
    const account = newAccount();
    const surveyId = await seedSurvey();
    await seedCampaign(surveyId, { fromLocal: account, replyTo: 'single@example.co.kr', createdAt: daysAgo(1), kind: 'single' });
    await seedCampaign(surveyId, { fromLocal: account, replyTo: 'fallback@example.co.kr', createdAt: daysAgo(2), kind: 'fallback' });
    await seedCampaign(surveyId, { fromLocal: account, replyTo: 'test@example.co.kr', createdAt: daysAgo(3), isTest: true });
    await seedCampaign(surveyId, { fromLocal: account, replyTo: 'archived@example.co.kr', createdAt: daysAgo(4), archivedAt: daysAgo(1) });

    expect((await lookup(account)).addresses).toEqual([
      'single@example.co.kr',
      'fallback@example.co.kr',
      'test@example.co.kr',
      'archived@example.co.kr',
    ]);
  });

  it('1년이 넘은 발송 회차는 보지 않는다', async () => {
    const account = newAccount();
    const surveyId = await seedSurvey();
    await seedCampaign(surveyId, { fromLocal: account, replyTo: 'old@example.co.kr', createdAt: daysAgo(367) });
    await seedCampaign(surveyId, { fromLocal: account, replyTo: 'recent@example.co.kr', createdAt: daysAgo(364) });

    expect(await lookup(account)).toEqual({ source: 'campaign', addresses: ['recent@example.co.kr'] });
  });

  it('회신 주소가 빈 발송 회차와 발송 전용 도메인의 주소는 전달 주소가 되지 않는다', async () => {
    const account = newAccount();
    const surveyId = await seedSurvey();
    await seedCampaign(surveyId, { fromLocal: account, replyTo: null, createdAt: daysAgo(1) });
    await seedCampaign(surveyId, { fromLocal: account, replyTo: '  ', createdAt: daysAgo(2) });
    await seedCampaign(surveyId, { fromLocal: account, replyTo: `${account}@${SEND_DOMAIN}`, createdAt: daysAgo(3) });
    await seedCampaign(surveyId, { fromLocal: account, replyTo: 'help@example.co.kr', createdAt: daysAgo(4) });

    expect(await lookup(account)).toEqual({ source: 'campaign', addresses: ['help@example.co.kr'] });
  });

  it('발송 회차가 없으면 그 계정을 쓰는 삭제되지 않은 템플릿의 회신 주소로 물러난다', async () => {
    const account = newAccount();
    const surveyId = await seedSurvey();
    await seedTemplate(surveyId, { fromLocal: account, replyTo: 'tpl@example.co.kr' });
    await seedTemplate(surveyId, { fromLocal: account, replyTo: 'deleted@example.co.kr', deletedAt: daysAgo(1) });
    await seedTemplate(surveyId, { fromLocal: newAccount(), replyTo: 'other@example.co.kr' });

    expect(await lookup(account)).toEqual({ source: 'template', addresses: ['tpl@example.co.kr'] });
  });

  it('발송 회차가 있어도 쓸 회신 주소가 하나도 없으면 템플릿으로 물러난다', async () => {
    const account = newAccount();
    const surveyId = await seedSurvey();
    await seedCampaign(surveyId, { fromLocal: account, replyTo: null, createdAt: daysAgo(1) });
    await seedCampaign(surveyId, { fromLocal: account, replyTo: 'old@example.co.kr', createdAt: daysAgo(400) });
    await seedTemplate(surveyId, { fromLocal: account, replyTo: 'tpl@example.co.kr' });

    expect(await lookup(account)).toEqual({ source: 'template', addresses: ['tpl@example.co.kr'] });
  });

  it('발송 회차에 회신 주소가 있으면 템플릿은 보지 않는다', async () => {
    const account = newAccount();
    const surveyId = await seedSurvey();
    await seedCampaign(surveyId, { fromLocal: account, replyTo: 'campaign@example.co.kr', createdAt: daysAgo(1) });
    await seedTemplate(surveyId, { fromLocal: account, replyTo: 'tpl@example.co.kr' });

    expect(await lookup(account)).toEqual({ source: 'campaign', addresses: ['campaign@example.co.kr'] });
  });

  it('쓴 적 없는 보낸이 계정은 전달 주소가 없다', async () => {
    expect(await lookup(newAccount())).toEqual({ source: null, addresses: [] });
    expect(await lookup('')).toEqual({ source: null, addresses: [] });
  });

  it('웹훅 장부: 적기 전에는 없고, 적은 뒤에는 있다 — 결과를 갈라 적는다', async () => {
    const forwardedId = `rf-test-${randomUUID()}`;
    const skippedId = `rf-test-${randomUUID()}`;
    eventIds.push(forwardedId, skippedId);

    expect(await isWebhookEventRecorded(forwardedId)).toBe(false);
    await recordReplyForwardEvent(forwardedId, 'forwarded');
    await recordReplyForwardEvent(skippedId, 'skipped');
    expect(await isWebhookEventRecorded(forwardedId)).toBe(true);

    const rows = await db
      .select({ id: webhookEvents.id, source: webhookEvents.source, eventType: webhookEvents.eventType })
      .from(webhookEvents)
      .where(inArray(webhookEvents.id, [forwardedId, skippedId]));
    expect(new Map(rows.map((row) => [row.id, row]))).toEqual(
      new Map([
        [forwardedId, { id: forwardedId, source: 'resend', eventType: 'email.received:forwarded' }],
        [skippedId, { id: skippedId, source: 'resend', eventType: 'email.received:skipped' }],
      ]),
    );
  });

  it('웹훅 장부: 같은 알림을 두 번 적어도 오류 없이 먼저 적은 것이 남는다', async () => {
    const eventId = `rf-test-${randomUUID()}`;
    eventIds.push(eventId);

    await recordReplyForwardEvent(eventId, 'forwarded');
    await expect(recordReplyForwardEvent(eventId, 'skipped')).resolves.toBeUndefined();

    const [row] = await db
      .select({ eventType: webhookEvents.eventType })
      .from(webhookEvents)
      .where(eq(webhookEvents.id, eventId));
    expect(row?.eventType).toBe('email.received:forwarded');
  });
});
