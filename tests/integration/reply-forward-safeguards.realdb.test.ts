/**
 * 회신 전달의 운영 안전장치 — 시간당 상한과 「집계를 건드리지 않는다」의 실 DB 왕복.
 *
 * - 시간당 상한이 세는 것은 웹훅 장부의 「넘김」 줄뿐이다(종류·시각 조건이 SQL 이라 모킹으로는 못 본다).
 * - 회신 전달 한 통과 그 전달 메일의 상태 알림(반송·실패 포함)이 발송 회차 집계·수신자 상태·메일 비용 집계를
 *   하나도 바꾸지 않는 것을 못박는다.
 *
 * 외부 경계(Resend 클라이언트·원본 내려받기·Sentry·Inngest)만 대역이고 조회·장부·웹훅 처리는 진짜다.
 * 실행: `pnpm db:isolated <이름>` 이 찍어 주는 URL 로 RUN_REALDB=1 vitest. 로컬 DB 가 아니면 통째로 건너뛴다.
 */
import { randomUUID } from 'node:crypto';

import { asc, eq, inArray, like } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db';
import { surveys as surveysTable } from '@/db/schema';
import { mailCampaigns, mailRecipients, webhookEvents } from '@/db/schema/mail';
import { REPLY_FORWARD_HOURLY_CAP } from '@/server/mail/domain/reply-forward';
import { computeCycleBreakdown } from '@/server/mail/services/billing-cycle-summary';
import { ReplyForwardCapExceeded, forwardReceivedReply } from '@/server/mail/services/reply-forward';
import { countForwardedRepliesSince } from '@/server/mail/services/reply-forward-ledger';
import { processResendWebhookEvent } from '@/server/mail/services/resend-webhook';

const { getMock, sendMock, sentryMessageMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  sendMock: vi.fn(),
  sentryMessageMock: vi.fn(),
}));

vi.mock('@/server/mail/services/resend-client', () => ({
  getResend: () => ({ emails: { receiving: { get: getMock }, send: sendMock } }),
}));
vi.mock('@sentry/nextjs', () => ({ captureMessage: sentryMessageMock, captureException: vi.fn() }));
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: vi.fn(async () => undefined) } }));

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const SEND_DOMAIN = 'send.example.co.kr';
/** 이 스위트가 장부에 적는 알림 id 의 접두 — 앞뒤로 이것만 지운다. */
const EVENT_PREFIX = 'rf04-safeguard-';
const MINUTE_MS = 60 * 1000;

const RAW_EMAIL = [
  'From: =?UTF-8?B?6rmA7J2R64u1?= <kim@corp.co.kr>',
  'To: survey@send.example.co.kr',
  'Subject: reply',
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'scan attached',
  '',
].join('\r\n');

describe.skipIf(!isLocalDb)('회신 전달 안전장치 (real local DB)', () => {
  const surveyIds: string[] = [];
  let runNumber = 0;

  const newEventId = () => `${EVENT_PREFIX}${randomUUID()}`;
  const newAccount = () => `rf${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const clearLedger = () => db.delete(webhookEvents).where(like(webhookEvents.id, `${EVENT_PREFIX}%`));

  /** 장부에 줄을 직접 넣는다 — 시각을 정해 두고 세는 범위를 본다. */
  async function seedLedger(rows: Array<{ eventType: string; receivedAt?: Date }>): Promise<void> {
    if (rows.length === 0) return;
    await db.insert(webhookEvents).values(
      rows.map((row) => ({
        id: newEventId(),
        source: 'resend',
        eventType: row.eventType,
        ...(row.receivedAt ? { receivedAt: row.receivedAt } : {}),
      })),
    );
  }

  /** 보낸이 계정 하나로 보낸 발송 회차(회신 주소 있음)와 발송된 수신자 둘. */
  async function seedSentCampaign(account: string) {
    const [survey] = await db
      .insert(surveysTable)
      .values({ title: '회신 전달 안전장치 테스트 설문' })
      .returning({ id: surveysTable.id });
    if (!survey) throw new Error('survey 삽입 실패');
    surveyIds.push(survey.id);

    runNumber += 1;
    const campaignId = randomUUID();
    await db.insert(mailCampaigns).values({
      id: campaignId,
      surveyId: survey.id,
      runNumber,
      title: `회차 ${runNumber}`,
      subjectSnapshot: '제목',
      bodyHtmlSnapshot: '<p>본문</p>',
      fromLocalSnapshot: account,
      fromNameSnapshot: '설문팀',
      replyToSnapshot: 'help@example.co.kr',
      status: 'sending',
      recipientCount: 2,
      sentCount: 2,
      startedAt: new Date(),
    });
    const messageIds = [`msg-${randomUUID()}`, `msg-${randomUUID()}`];
    const recipientIds = [randomUUID(), randomUUID()];
    await db.insert(mailRecipients).values(
      messageIds.map((messageId, index) => ({
        id: recipientIds[index]!,
        campaignId,
        emailSnapshot: `target${index}@corp.co.kr`,
        status: 'sent' as const,
        resendMessageId: messageId,
        sentAt: new Date(),
      })),
    );
    return { surveyId: survey.id, campaignId, messageIds, recipientIds };
  }

  /** 회신 전달이 바꾸면 안 되는 것 전부 — 발송 회차 행·수신자 행·메일 비용 집계의 그 회차 줄. */
  async function aggregatesOf(surveyId: string, campaignId: string) {
    const campaigns = await db
      .select()
      .from(mailCampaigns)
      .where(eq(mailCampaigns.surveyId, surveyId))
      .orderBy(asc(mailCampaigns.id));
    const recipients = await db
      .select()
      .from(mailRecipients)
      .where(inArray(mailRecipients.campaignId, campaigns.map((campaign) => campaign.id)))
      .orderBy(asc(mailRecipients.id));
    const billingRow = (await computeCycleBreakdown()).cycles
      .flatMap((cycle) => cycle.campaigns)
      .find((row) => row.campaignId === campaignId);
    return { campaigns, recipients, billingRow };
  }

  function receivedFor(account: string, receivedEmailId: string) {
    return {
      data: {
        object: 'email',
        id: receivedEmailId,
        to: [`${account}@${SEND_DOMAIN}`],
        from: '김응답 <kim@corp.co.kr>',
        created_at: '2026-11-12T01:00:00Z',
        subject: '설문지 회신',
        bcc: null,
        cc: null,
        reply_to: null,
        received_for: [`${account}@${SEND_DOMAIN}`],
        html: null,
        text: null,
        headers: null,
        message_id: '<m1@corp.co.kr>',
        raw: { download_url: 'https://inbound.example/raw', expires_at: '2026-11-12T02:00:00Z' },
        attachments: [],
      },
      error: null,
      headers: null,
    };
  }

  beforeAll(async () => {
    process.env['RESEND_FROM_DOMAIN'] = SEND_DOMAIN;
    await clearLedger();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array(Buffer.from(RAW_EMAIL, 'utf8')), { status: 200 })),
    );
    sendMock.mockResolvedValue({ data: { id: `out-${randomUUID()}` }, error: null, headers: null });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await clearLedger();
  });

  afterAll(async () => {
    // 설문을 지우면 발송 회차·수신자는 FK cascade 로 함께 지워진다.
    if (surveyIds.length > 0) await db.delete(surveysTable).where(inArray(surveysTable.id, surveyIds));
  });

  describe('시간당 상한의 재료 — 장부의 「넘김」 줄 수', () => {
    // 다른 스위트가 지금 시각으로 적는 줄과 섞이지 않게 먼 미래의 한 시간을 본다.
    const NOW = new Date('2199-06-01T12:00:00Z');
    const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * MINUTE_MS);

    it('한 시간 안에 「넘김」으로 적힌 줄만 센다 — 넘기지 않은 건·다른 알림·한 시간이 지난 줄은 빼고', async () => {
      await seedLedger([
        { eventType: 'email.received:forwarded', receivedAt: minutesAgo(1) },
        { eventType: 'email.received:forwarded', receivedAt: minutesAgo(59) },
        { eventType: 'email.received:forwarded', receivedAt: minutesAgo(60) },
        { eventType: 'email.received:forwarded', receivedAt: minutesAgo(61) },
        { eventType: 'email.received:forwarded', receivedAt: minutesAgo(600) },
        { eventType: 'email.received:skipped', receivedAt: minutesAgo(5) },
        { eventType: 'email.received:skipped', receivedAt: minutesAgo(6) },
        // 배포 전에 온 받은 메일 알림 — 기존 경로가 종류 그대로 적었다.
        { eventType: 'email.received', receivedAt: minutesAgo(7) },
        { eventType: 'email.delivered', receivedAt: minutesAgo(8) },
        { eventType: 'email.bounced', receivedAt: minutesAgo(9) },
      ]);

      expect(await countForwardedRepliesSince(minutesAgo(60))).toBe(3);
    });

    it('넘긴 것이 없으면 0 이다', async () => {
      await seedLedger([{ eventType: 'email.received:skipped', receivedAt: minutesAgo(5) }]);

      expect(await countForwardedRepliesSince(minutesAgo(60))).toBe(0);
    });
  });

  describe('시간당 상한 — 진입점부터 장부까지', () => {
    it('넘기지 않은 건이 아무리 많아도 막히지 않고, 넘긴 건이 상한에 닿으면 넘기지 않고 장부에도 적지 않는다', async () => {
      const account = newAccount();
      await seedSentCampaign(account);
      const recent = new Date(Date.now() - 10 * MINUTE_MS);
      const stale = new Date(Date.now() - 90 * MINUTE_MS);
      // 상한보다 훨씬 많은 「넘기지 않음」과 한 시간이 지난 「넘김」 — 둘 다 세지 않는다.
      // 「넘김」은 상한 아래로 여유를 둔다(같은 DB 를 쓰는 다른 스위트가 지금 시각으로 몇 줄 적을 수 있다).
      await seedLedger([
        ...Array.from({ length: REPLY_FORWARD_HOURLY_CAP * 2 }, () => ({
          eventType: 'email.received:skipped',
          receivedAt: recent,
        })),
        ...Array.from({ length: REPLY_FORWARD_HOURLY_CAP }, () => ({
          eventType: 'email.received:forwarded',
          receivedAt: stale,
        })),
        ...Array.from({ length: REPLY_FORWARD_HOURLY_CAP - 50 }, () => ({
          eventType: 'email.received:forwarded',
          receivedAt: recent,
        })),
      ]);

      const underCapEvent = { eventId: newEventId(), receivedEmailId: `recv-${randomUUID()}` };
      getMock.mockResolvedValue(receivedFor(account, underCapEvent.receivedEmailId));
      expect(await forwardReceivedReply(underCapEvent)).toMatchObject({ outcome: 'forwarded' });
      expect(sendMock).toHaveBeenCalledTimes(1);

      // 이제 한 시간 안의 「넘김」이 상한에 닿는다.
      await seedLedger(
        Array.from({ length: 50 }, () => ({ eventType: 'email.received:forwarded', receivedAt: recent })),
      );
      const overCapEvent = { eventId: newEventId(), receivedEmailId: `recv-${randomUUID()}` };
      getMock.mockResolvedValue(receivedFor(account, overCapEvent.receivedEmailId));

      await expect(forwardReceivedReply(overCapEvent)).rejects.toBeInstanceOf(ReplyForwardCapExceeded);

      expect(sendMock).toHaveBeenCalledTimes(1);
      const recorded = await db
        .select({ id: webhookEvents.id })
        .from(webhookEvents)
        .where(eq(webhookEvents.id, overCapEvent.eventId));
      expect(recorded).toEqual([]);
      expect(sentryMessageMock).toHaveBeenCalledTimes(1);
      expect(sentryMessageMock.mock.calls[0]?.[0]).toBe('회신 전달 시간당 상한 초과');

      // 쓴 적 없는 보낸이 계정으로 온 메일은 상한을 넘긴 동안에도 「넘기지 않음」으로 끝난다.
      const spamEvent = { eventId: newEventId(), receivedEmailId: `recv-${randomUUID()}` };
      getMock.mockResolvedValue(receivedFor(newAccount(), spamEvent.receivedEmailId));
      expect(await forwardReceivedReply(spamEvent)).toEqual({
        outcome: 'skipped',
        reason: 'unused_sender_account',
      });
    });
  });

  describe('발송 회차 집계·수신자 상태·메일 비용 집계', () => {
    it('회신 전달 한 통과 그 전달 메일의 상태 알림은 아무것도 바꾸지 않는다', async () => {
      const account = newAccount();
      const { surveyId, campaignId, messageIds, recipientIds } = await seedSentCampaign(account);
      const before = await aggregatesOf(surveyId, campaignId);
      expect(before.campaigns).toHaveLength(1);
      expect(before.recipients).toHaveLength(2);
      expect(before.billingRow).toMatchObject({ campaignId, billableCount: 2 });

      // ① 그 보낸이 계정으로 온 답장을 넘긴다.
      const event = { eventId: newEventId(), receivedEmailId: `recv-${randomUUID()}` };
      getMock.mockResolvedValue(receivedFor(account, event.receivedEmailId));
      const forwardMessageId = `out-${randomUUID()}`;
      sendMock.mockResolvedValue({ data: { id: forwardMessageId }, error: null, headers: null });

      expect(await forwardReceivedReply(event)).toMatchObject({ outcome: 'forwarded', forwardCount: 1 });
      expect(sendMock.mock.calls[0]?.[0]).toMatchObject({
        to: ['help@example.co.kr'],
        tags: [{ name: 'kind', value: 'reply-forward' }],
      });

      // ② 전달 메일의 상태 알림이 차례로 온다 — 반송·실패까지.
      const forwardTags = { kind: 'reply-forward' };
      const statusTypes = [
        'email.sent',
        'email.delivered',
        'email.opened',
        'email.bounced',
        'email.failed',
        'email.complained',
      ];
      for (const type of statusTypes) {
        await processResendWebhookEvent({
          id: newEventId(),
          type,
          createdAt: new Date().toISOString(),
          resendMessageId: forwardMessageId,
          tags: forwardTags,
        });
      }
      // ③ 있을 수 없는 경우까지: 전달 메일의 알림이 실제 수신자의 메시지 id·수신자 태그를 달고 와도 전이하지 않는다.
      await processResendWebhookEvent({
        id: newEventId(),
        type: 'email.bounced',
        createdAt: new Date().toISOString(),
        resendMessageId: messageIds[0]!,
        tags: { ...forwardTags, campaign_id: campaignId, recipient_id: recipientIds[0]! },
      });

      expect(await aggregatesOf(surveyId, campaignId)).toEqual(before);

      // 반송·실패만 Sentry 경고가 된다(②의 둘 + ③의 하나).
      expect(sentryMessageMock.mock.calls.map((call) => call[0])).toEqual([
        '회신 전달 메일 반송·실패',
        '회신 전달 메일 반송·실패',
        '회신 전달 메일 반송·실패',
      ]);
      // 장부에는 전부 적혔다 — 받은 메일 알림은 「넘김」으로.
      const ledger = await db
        .select({ eventType: webhookEvents.eventType })
        .from(webhookEvents)
        .where(like(webhookEvents.id, `${EVENT_PREFIX}%`));
      expect(ledger.map((row) => row.eventType).sort()).toEqual(
        ['email.received:forwarded', ...statusTypes, 'email.bounced'].sort(),
      );

      // 대조: 태그 없는 진짜 상태 알림은 같은 재료로 집계를 바꾼다 — 위 비교가 변화를 볼 수 있다는 증거다.
      await processResendWebhookEvent({
        id: newEventId(),
        type: 'email.delivered',
        createdAt: new Date().toISOString(),
        resendMessageId: messageIds[0]!,
      });
      const after = await aggregatesOf(surveyId, campaignId);
      expect(after.campaigns[0]?.deliveredCount).toBe(1);
      expect(after).not.toEqual(before);
    });
  });
});
