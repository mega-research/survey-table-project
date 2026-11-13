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
import { mailCampaigns, mailRecipients, mailTemplates, webhookEvents } from '@/db/schema/mail';
import {
  findReplyAddressByRespondent,
  loadAccountReplyAddresses,
} from '@/server/mail/services/reply-address-lookup';
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
  ): Promise<string> {
    runNumber += 1;
    const [campaign] = await db.insert(mailCampaigns).values({
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
    }).returning({ id: mailCampaigns.id });
    if (!campaign) throw new Error('campaign 삽입 실패');
    return campaign.id;
  }

  /** 수신자 한 줄 — 조사 대상 없이 발송 스냅샷 주소만 심는다(조회가 보는 것은 주소와 보낸 시각뿐이다). */
  async function seedRecipient(
    campaignId: string,
    values: { email: string | null; sentAt?: Date | null; createdAt?: Date; archivedAt?: Date | null },
  ): Promise<void> {
    await db.insert(mailRecipients).values({
      campaignId,
      emailSnapshot: values.email,
      status: values.sentAt ? 'sent' : 'queued',
      sentAt: values.sentAt ?? null,
      archivedAt: values.archivedAt ?? null,
      ...(values.createdAt ? { createdAt: values.createdAt } : {}),
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

  it('발송 회차의 회신 주소에 그 계정을 쓰는 템플릿의 회신 주소를 합친다 — 회차 것이 앞, 중복 없이', async () => {
    const account = newAccount();
    const surveyA = await seedSurvey();
    const surveyB = await seedSurvey();
    await seedCampaign(surveyA, { fromLocal: account, replyTo: 'campaign@example.co.kr', createdAt: daysAgo(1) });
    await seedCampaign(surveyA, { fromLocal: account, replyTo: 'older@example.co.kr', createdAt: daysAgo(30) });
    // 회차를 아직 만들지 않은(「테스트 발송」만 한) 새 설문의 템플릿 — 회신 주소가 다르다.
    await seedTemplate(surveyB, { fromLocal: account, replyTo: 'tpl@example.co.kr', updatedAt: daysAgo(2) });
    // 회차와 같은 회신 주소(대소문자만 다름) · 삭제된 템플릿 · 다른 계정의 템플릿 · 발송 전용 도메인 · 빈 값은 더하지 않는다.
    await seedTemplate(surveyA, { fromLocal: account, replyTo: 'Campaign@Example.co.kr', updatedAt: daysAgo(1) });
    await seedTemplate(surveyA, { fromLocal: account, replyTo: 'deleted@example.co.kr', deletedAt: daysAgo(1) });
    await seedTemplate(surveyB, { fromLocal: newAccount(), replyTo: 'other@example.co.kr' });
    await seedTemplate(surveyB, { fromLocal: account, replyTo: `${account}@${SEND_DOMAIN}` });
    await seedTemplate(surveyB, { fromLocal: account, replyTo: null });

    expect(await lookup(account)).toEqual({
      source: 'campaign',
      addresses: ['campaign@example.co.kr', 'older@example.co.kr', 'tpl@example.co.kr'],
    });
  });

  it('1년이 넘은 발송 회차의 회신 주소도 그 템플릿이 남아 있으면 템플릿 쪽에서 후보가 된다', async () => {
    const account = newAccount();
    const surveyId = await seedSurvey();
    await seedCampaign(surveyId, { fromLocal: account, replyTo: 'recent@example.co.kr', createdAt: daysAgo(10) });
    await seedCampaign(surveyId, { fromLocal: account, replyTo: 'old@example.co.kr', createdAt: daysAgo(400) });
    await seedTemplate(surveyId, { fromLocal: account, replyTo: 'old@example.co.kr' });

    expect(await lookup(account)).toEqual({
      source: 'campaign',
      addresses: ['recent@example.co.kr', 'old@example.co.kr'],
    });
  });

  it('쓴 적 없는 보낸이 계정은 전달 주소가 없다', async () => {
    expect(await lookup(newAccount())).toEqual({ source: null, addresses: [] });
    expect(await lookup('')).toEqual({ source: null, addresses: [] });
  });

  // ── 응답자 주소로 찾기 ────────────────────────────────────────────────────────

  const lookupByRespondent = (account: string, respondentAddress: string) =>
    findReplyAddressByRespondent(account, respondentAddress, { sendDomain: SEND_DOMAIN });
  const NOT_FOUND = { source: null, addresses: [] };

  it('응답자 주소: 같은 보낸이 계정이 설문마다 다른 회신 주소를 쓰면 그 응답자에게 보낸 회차의 회신 주소 하나만 돌려준다', async () => {
    const account = newAccount();
    const surveyA = await seedSurvey();
    const surveyB = await seedSurvey();
    const campaignA = await seedCampaign(surveyA, { fromLocal: account, replyTo: 'abc@example.co.kr', createdAt: daysAgo(10) });
    const campaignB = await seedCampaign(surveyB, { fromLocal: account, replyTo: 'cba@example.co.kr', createdAt: daysAgo(5) });
    await seedRecipient(campaignA, { email: 'kim@corp.co.kr', sentAt: daysAgo(10) });
    await seedRecipient(campaignB, { email: 'lee@corp.co.kr', sentAt: daysAgo(5) });

    expect(await lookupByRespondent(account, 'kim@corp.co.kr')).toEqual({
      source: 'respondent',
      addresses: ['abc@example.co.kr'],
    });
    expect(await lookupByRespondent(account, 'lee@corp.co.kr')).toEqual({
      source: 'respondent',
      addresses: ['cba@example.co.kr'],
    });
  });

  it('응답자 주소: 대체 발송·단건·테스트 회차와 보관된 회차·보관된 수신자도 본다', async () => {
    const account = newAccount();
    const surveyId = await seedSurvey();
    const cases = [
      { address: 'fallback@corp.co.kr', replyTo: 'r-fallback@example.co.kr', kind: 'fallback' as const },
      { address: 'single@corp.co.kr', replyTo: 'r-single@example.co.kr', kind: 'single' as const },
      { address: 'test@corp.co.kr', replyTo: 'r-test@example.co.kr', isTest: true },
      { address: 'archived@corp.co.kr', replyTo: 'r-archived@example.co.kr', archivedAt: daysAgo(1) },
    ];
    for (const item of cases) {
      const campaignId = await seedCampaign(surveyId, {
        fromLocal: account,
        replyTo: item.replyTo,
        createdAt: daysAgo(3),
        ...(item.kind ? { kind: item.kind } : {}),
        ...(item.isTest ? { isTest: true } : {}),
        ...(item.archivedAt ? { archivedAt: item.archivedAt } : {}),
      });
      await seedRecipient(campaignId, {
        email: item.address,
        sentAt: daysAgo(3),
        archivedAt: item.archivedAt ?? null,
      });
    }

    for (const item of cases) {
      expect(await lookupByRespondent(account, item.address)).toEqual({
        source: 'respondent',
        addresses: [item.replyTo],
      });
    }
  });

  it('응답자 주소: 1년이 넘은 발송 회차의 수신자도 찾는다 — 기간 제한은 계정 기준에만 있다', async () => {
    const account = newAccount();
    const surveyId = await seedSurvey();
    const campaignId = await seedCampaign(surveyId, { fromLocal: account, replyTo: 'old@example.co.kr', createdAt: daysAgo(500) });
    await seedRecipient(campaignId, { email: 'kim@corp.co.kr', sentAt: daysAgo(500), createdAt: daysAgo(500) });

    expect(await lookupByRespondent(account, 'kim@corp.co.kr')).toEqual({
      source: 'respondent',
      addresses: ['old@example.co.kr'],
    });
  });

  it('응답자 주소: 칸 안 여러 주소는 주소 나누기 규칙으로 나눠 하나하나와 비교한다', async () => {
    const account = newAccount();
    const surveyId = await seedSurvey();
    const campaignId = await seedCampaign(surveyId, { fromLocal: account, replyTo: 'help@example.co.kr', createdAt: daysAgo(2) });
    await seedRecipient(campaignId, { email: 'ceo@corp.co.kr / staff@corp.co.kr', sentAt: daysAgo(2) });
    await seedRecipient(campaignId, { email: 'a@two.co.kr, b@two.co.kr;c@two.co.kr', sentAt: daysAgo(2) });
    await seedRecipient(campaignId, { email: 'first@line.co.kr\nsecond@line.co.kr', sentAt: daysAgo(2) });
    // 주소 가운데서 줄이 바뀐 칸 — 발송 때 한 주소로 붙여 보낸다.
    await seedRecipient(campaignId, { email: 'broken@\nwrap.co.kr', sentAt: daysAgo(2) });

    const found = { source: 'respondent', addresses: ['help@example.co.kr'] };
    for (const address of [
      'ceo@corp.co.kr',
      'staff@corp.co.kr',
      'a@two.co.kr',
      'b@two.co.kr',
      'c@two.co.kr',
      'first@line.co.kr',
      'second@line.co.kr',
      'broken@wrap.co.kr',
    ]) {
      expect(await lookupByRespondent(account, address), address).toEqual(found);
    }
  });

  it('응답자 주소: 보낸이 계정과 주소의 대소문자를 무시한다', async () => {
    const account = newAccount();
    const surveyId = await seedSurvey();
    const campaignId = await seedCampaign(surveyId, {
      fromLocal: account.toUpperCase(),
      replyTo: 'help@example.co.kr',
      createdAt: daysAgo(2),
    });
    await seedRecipient(campaignId, { email: 'Kim.Eungdap@Corp.co.kr', sentAt: daysAgo(2) });

    const found = { source: 'respondent', addresses: ['help@example.co.kr'] };
    expect(await lookupByRespondent(account, 'kim.eungdap@corp.co.kr')).toEqual(found);
    expect(await lookupByRespondent(account.toUpperCase(), ' KIM.EUNGDAP@CORP.CO.KR ')).toEqual(found);
  });

  it('응답자 주소: 부분 문자열로는 일치하지 않는다', async () => {
    const account = newAccount();
    const surveyId = await seedSurvey();
    const campaignId = await seedCampaign(surveyId, { fromLocal: account, replyTo: 'help@example.co.kr', createdAt: daysAgo(2) });
    await seedRecipient(campaignId, { email: 'akim@x.com', sentAt: daysAgo(2) });
    await seedRecipient(campaignId, { email: 'kim@x.com.au', sentAt: daysAgo(2) });
    await seedRecipient(campaignId, { email: 'lee@y.com / parkkim@x.com', sentAt: daysAgo(2) });

    expect(await lookupByRespondent(account, 'kim@x.com')).toEqual(NOT_FOUND);
    expect(await lookupByRespondent(account, 'akim@x.com')).toEqual({
      source: 'respondent',
      addresses: ['help@example.co.kr'],
    });
  });

  it('응답자 주소: 주소 속 밑줄·퍼센트는 글자 그대로 비교한다', async () => {
    const account = newAccount();
    const surveyId = await seedSurvey();
    const campaignId = await seedCampaign(surveyId, { fromLocal: account, replyTo: 'help@example.co.kr', createdAt: daysAgo(2) });
    await seedRecipient(campaignId, { email: 'kimXlee@x.com', sentAt: daysAgo(2) });

    expect(await lookupByRespondent(account, 'kim_lee@x.com')).toEqual(NOT_FOUND);
    expect(await lookupByRespondent(account, 'kim%lee@x.com')).toEqual(NOT_FOUND);
    expect(await lookupByRespondent(account, '%@x.com')).toEqual(NOT_FOUND);
  });

  it('응답자 주소: 여러 회차에 걸리면 가장 최근에 보낸 수신자의 회차를 쓴다 — 회차를 만든 순서가 아니다', async () => {
    const account = newAccount();
    const surveyA = await seedSurvey();
    const surveyB = await seedSurvey();
    // 설문 B 의 회차를 나중에 만들었지만, 이 응답자에게는 설문 A 의 회차가 더 최근에 보냈다.
    const campaignA = await seedCampaign(surveyA, { fromLocal: account, replyTo: 'abc@example.co.kr', createdAt: daysAgo(30) });
    const campaignB = await seedCampaign(surveyB, { fromLocal: account, replyTo: 'cba@example.co.kr', createdAt: daysAgo(20) });
    await seedRecipient(campaignA, { email: 'kim@corp.co.kr', sentAt: daysAgo(3), createdAt: daysAgo(30) });
    await seedRecipient(campaignB, { email: 'kim@corp.co.kr', sentAt: daysAgo(15), createdAt: daysAgo(20) });

    expect(await lookupByRespondent(account, 'kim@corp.co.kr')).toEqual({
      source: 'respondent',
      addresses: ['abc@example.co.kr'],
    });
  });

  it('응답자 주소: 아직 보내지 않은 수신자는 보낸 수신자보다 뒤에 본다', async () => {
    const account = newAccount();
    const surveyA = await seedSurvey();
    const surveyB = await seedSurvey();
    const sent = await seedCampaign(surveyA, { fromLocal: account, replyTo: 'abc@example.co.kr', createdAt: daysAgo(30) });
    const queued = await seedCampaign(surveyB, { fromLocal: account, replyTo: 'cba@example.co.kr', createdAt: daysAgo(1) });
    await seedRecipient(sent, { email: 'kim@corp.co.kr', sentAt: daysAgo(30), createdAt: daysAgo(30) });
    await seedRecipient(queued, { email: 'kim@corp.co.kr', sentAt: null, createdAt: daysAgo(1) });
    await seedRecipient(queued, { email: 'only-queued@corp.co.kr', sentAt: null, createdAt: daysAgo(1) });

    // 응답자가 받은 메일은 설문 A 의 것뿐이다.
    expect(await lookupByRespondent(account, 'kim@corp.co.kr')).toEqual({
      source: 'respondent',
      addresses: ['abc@example.co.kr'],
    });
    // 보낸 기록이 하나도 없으면 대기 중인 수신자의 회차라도 쓴다.
    expect(await lookupByRespondent(account, 'only-queued@corp.co.kr')).toEqual({
      source: 'respondent',
      addresses: ['cba@example.co.kr'],
    });
  });

  it('응답자 주소: 걸린 회차의 회신 주소가 비었거나 발송 전용 도메인이면 건너뛰고 다음으로 최근 것을 본다', async () => {
    const account = newAccount();
    const surveyId = await seedSurvey();
    const replies: Array<[string | null, number]> = [
      [null, 1],
      ['   ', 2],
      [`${account}@${SEND_DOMAIN}`, 3],
      ['help@example.co.kr', 4],
      ['older@example.co.kr', 5],
    ];
    for (const [replyTo, days] of replies) {
      const campaignId = await seedCampaign(surveyId, { fromLocal: account, replyTo, createdAt: daysAgo(days) });
      await seedRecipient(campaignId, { email: 'kim@corp.co.kr', sentAt: daysAgo(days) });
    }

    expect(await lookupByRespondent(account, 'kim@corp.co.kr')).toEqual({
      source: 'respondent',
      addresses: ['help@example.co.kr'],
    });
  });

  it('응답자 주소: 걸린 회차에 쓸 회신 주소가 하나도 없으면 못 찾은 것이다', async () => {
    const account = newAccount();
    const surveyId = await seedSurvey();
    const empty = await seedCampaign(surveyId, { fromLocal: account, replyTo: null, createdAt: daysAgo(1) });
    const looped = await seedCampaign(surveyId, { fromLocal: account, replyTo: `${account}@${SEND_DOMAIN.toUpperCase()}`, createdAt: daysAgo(2) });
    await seedRecipient(empty, { email: 'kim@corp.co.kr', sentAt: daysAgo(1) });
    await seedRecipient(looped, { email: 'kim@corp.co.kr', sentAt: daysAgo(2) });

    expect(await lookupByRespondent(account, 'kim@corp.co.kr')).toEqual(NOT_FOUND);
  });

  it('응답자 주소: 다른 보낸이 계정의 발송 회차는 보지 않는다', async () => {
    const account = newAccount();
    const other = newAccount();
    const surveyId = await seedSurvey();
    const mine = await seedCampaign(surveyId, { fromLocal: account, replyTo: 'mine@example.co.kr', createdAt: daysAgo(9) });
    const theirs = await seedCampaign(surveyId, { fromLocal: other, replyTo: 'theirs@example.co.kr', createdAt: daysAgo(1) });
    await seedRecipient(mine, { email: 'kim@corp.co.kr', sentAt: daysAgo(9) });
    await seedRecipient(theirs, { email: 'kim@corp.co.kr', sentAt: daysAgo(1) });
    await seedRecipient(theirs, { email: 'lee@corp.co.kr', sentAt: daysAgo(1) });

    // 다른 계정이 더 최근에 보냈어도 이 계정의 회차만 본다.
    expect(await lookupByRespondent(account, 'kim@corp.co.kr')).toEqual({
      source: 'respondent',
      addresses: ['mine@example.co.kr'],
    });
    // 다른 계정의 수신자일 뿐이면 못 찾는다.
    expect(await lookupByRespondent(account, 'lee@corp.co.kr')).toEqual(NOT_FOUND);
  });

  it('응답자 주소: 수신자 기록에 없는 주소·주소 모양이 아닌 값·빈 계정은 못 찾은 것이다', async () => {
    const account = newAccount();
    const surveyId = await seedSurvey();
    const campaignId = await seedCampaign(surveyId, { fromLocal: account, replyTo: 'help@example.co.kr', createdAt: daysAgo(2) });
    await seedRecipient(campaignId, { email: 'kim@corp.co.kr', sentAt: daysAgo(2) });
    await seedRecipient(campaignId, { email: null, sentAt: null });

    expect(await lookupByRespondent(account, 'stranger@corp.co.kr')).toEqual(NOT_FOUND);
    expect(await lookupByRespondent(account, '')).toEqual(NOT_FOUND);
    expect(await lookupByRespondent(account, 'corp.co.kr')).toEqual(NOT_FOUND);
    expect(await lookupByRespondent('', 'kim@corp.co.kr')).toEqual(NOT_FOUND);
  });

  it('응답자 주소: 부분 문자열로만 걸리는 수신자가 한 쪽을 넘게 앞에 있어도 그 뒤의 정확한 수신자를 찾는다', async () => {
    const account = newAccount();
    const surveyId = await seedSurvey();
    const noise = await seedCampaign(surveyId, { fromLocal: account, replyTo: 'noise@example.co.kr', createdAt: daysAgo(1) });
    const real = await seedCampaign(surveyId, { fromLocal: account, replyTo: 'help@example.co.kr', createdAt: daysAgo(40) });
    await db.insert(mailRecipients).values(
      Array.from({ length: 230 }, (_, index) => ({
        campaignId: noise,
        emailSnapshot: `p${index}kim@x.com`,
        status: 'sent' as const,
        sentAt: daysAgo(1),
      })),
    );
    await seedRecipient(real, { email: 'kim@x.com', sentAt: daysAgo(40), createdAt: daysAgo(40) });

    expect(await lookupByRespondent(account, 'kim@x.com')).toEqual({
      source: 'respondent',
      addresses: ['help@example.co.kr'],
    });
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
