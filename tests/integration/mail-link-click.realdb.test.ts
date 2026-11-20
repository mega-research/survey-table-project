import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { db } from '@/db';
import {
  contactTargets,
  mailCampaigns,
  mailLinkClicks,
  mailRecipients,
  surveys,
} from '@/db/schema';
import { saltedHash } from '@/lib/duplicate-detection/salted-hash.server';
import {
  listCampaignRecipients,
  listCampaignsForSurvey,
} from '@/server/mail/services/campaigns-read';
import { MAX_CLICKS_PER_RECIPIENT } from '@/server/mail/domain/link-click';
import { processResendWebhookEvent } from '@/server/mail/services/resend-webhook';
import type { MailRecipientStatus } from '@/shared/contracts/mail';

vi.mock('@/lib/inngest/client', () => ({ inngest: { send: vi.fn(async () => undefined) } }));

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');
const run = process.env['RUN_REALDB'] === '1' && isLocalDb ? describe : describe.skip;

const APP = 'https://survey.example.co.kr';
process.env['NEXT_PUBLIC_APP_URL'] = APP;

const SURVEY_LINK = `${APP}/survey/만족도-조사`;
const REPORT_LINK = 'https://spri.kr/posts?code=stat_sw_ai_reports';
const UNSUBSCRIBE_LINK = `${APP}/unsubscribe/3f0c6c1e-0000-4000-8000-000000000001`;

/**
 * 링크 클릭 (CONTEXT.md 「링크 클릭」, ADR 0042) — 발송 서비스의 클릭 알림을 넣고, 담당자가 보는 화면의
 * 읽기 서비스로 확인한다. 클릭 표를 직접 들여다보는 단언은 화면에 나오지 않는 칸에만 둔다.
 */
run('링크 클릭 (mail link click)', () => {
  const surveyId = randomUUID();
  let resid = 0;
  let runNumber = 0;

  beforeAll(async () => {
    await db.insert(surveys).values({ id: surveyId, title: '링크 클릭 실DB 테스트' });
  });

  afterAll(async () => {
    await db.delete(surveys).where(eq(surveys.id, surveyId));
  });

  async function seedContact(): Promise<string> {
    const id = randomUUID();
    resid += 1;
    await db.insert(contactTargets).values({ id, surveyId, resid, inviteCode: `lc-${id}` });
    return id;
  }

  async function seedCampaign(): Promise<string> {
    const id = randomUUID();
    runNumber += 1;
    await db.insert(mailCampaigns).values({
      id,
      surveyId,
      runNumber,
      title: `${runNumber}차 안내`,
      subjectSnapshot: '제목',
      bodyHtmlSnapshot: '<p>본문</p>',
      fromLocalSnapshot: 'survey',
      fromNameSnapshot: '조사',
      status: 'completed',
    });
    return id;
  }

  /** 회차의 수신자 하나 — 집계 열도 그 상태에 맞춰 올린다. */
  async function seedRecipient(
    campaignId: string,
    contactId: string,
    status: MailRecipientStatus = 'delivered',
  ): Promise<{ recipientId: string; messageId: string }> {
    const recipientId = randomUUID();
    const messageId = `msg-${recipientId}`;
    await db.insert(mailRecipients).values({
      id: recipientId,
      campaignId,
      contactTargetId: contactId,
      emailSnapshot: 'someone@example.com',
      status,
      resendMessageId: messageId,
    });
    return { recipientId, messageId };
  }

  async function click(
    messageId: string,
    link: string,
    opts: { id?: string; at?: string; ip?: string; ua?: string; tags?: Record<string, string> } = {},
  ) {
    return processResendWebhookEvent({
      id: opts.id ?? `evt-${randomUUID()}`,
      type: 'email.clicked',
      createdAt: '2026-11-20T05:00:00.000Z',
      resendMessageId: messageId,
      ...(opts.tags ? { tags: opts.tags } : {}),
      click: {
        link,
        timestamp: opts.at ?? '2026-11-20T05:03:10.000Z',
        ipAddress: opts.ip ?? '203.0.113.7',
        userAgent: opts.ua ?? 'Mozilla/5.0 (test)',
      },
    });
  }

  async function campaignRow(campaignId: string) {
    const { rows } = await listCampaignsForSurvey({ surveyId, scope: 'real', pageSize: 100 });
    const row = rows.find((r) => r.id === campaignId);
    if (!row) throw new Error('회차가 목록에 없다');
    return row;
  }

  async function recipientStatus(campaignId: string, recipientId: string) {
    const { rows } = await listCampaignRecipients({
      surveyId,
      campaignId,
      scope: 'real',
      pageSize: 100,
    });
    return rows.find((r) => r.id === recipientId)?.status;
  }

  /** 화면에 나오지 않는 칸(주소 유무·IP 해시·브라우저 정보)만 여기로 본다. */
  async function storedClicks(recipientId: string) {
    return db
      .select({
        linkKind: mailLinkClicks.linkKind,
        linkUrl: mailLinkClicks.linkUrl,
        ipHash: mailLinkClicks.ipHash,
        userAgent: mailLinkClicks.userAgent,
        clickedAt: mailLinkClicks.clickedAt,
      })
      .from(mailLinkClicks)
      .where(eq(mailLinkClicks.recipientId, recipientId));
  }

  describe('발송 회차 목록의 「클릭」', () => {
    it('설문 링크를 누르면 그 회차의 클릭이 1이 되고 수신 상황이 열람으로 오른다', async () => {
      const campaignId = await seedCampaign();
      const { messageId } = await seedRecipient(campaignId, await seedContact());

      expect(await click(messageId, SURVEY_LINK)).toBe('processed');

      const row = await campaignRow(campaignId);
      expect(row.clickedCount).toBe(1);
      expect(row.openedCount).toBe(1);
    });

    it('그 밖의 링크나 수신거부 링크만 누른 회차는 클릭이 0이다', async () => {
      const campaignId = await seedCampaign();
      const a = await seedRecipient(campaignId, await seedContact());
      const b = await seedRecipient(campaignId, await seedContact());

      await click(a.messageId, REPORT_LINK);
      await click(b.messageId, UNSUBSCRIBE_LINK);

      const row = await campaignRow(campaignId);
      expect(row.clickedCount).toBe(0);
      // 눌렀다는 것은 열었다는 것이다 — 링크 종류와 무관하게 열람으로 오른다.
      expect(row.openedCount).toBe(2);
    });

    it('같은 사람이 설문 링크를 여러 번 눌러도 사람 수로 센다', async () => {
      const campaignId = await seedCampaign();
      const a = await seedRecipient(campaignId, await seedContact());
      const b = await seedRecipient(campaignId, await seedContact());

      await click(a.messageId, SURVEY_LINK);
      await click(a.messageId, SURVEY_LINK, { at: '2026-11-21T01:00:00.000Z' });
      await click(b.messageId, `${APP}/i/AbCdEf1234`);

      const row = await campaignRow(campaignId);
      expect(row.clickedCount).toBe(2);
      expect(row.openedCount).toBe(2);
    });

    it('같은 알림이 두 번 와도 한 번만 반영한다', async () => {
      const campaignId = await seedCampaign();
      const { recipientId, messageId } = await seedRecipient(campaignId, await seedContact());
      const id = `evt-${randomUUID()}`;

      expect(await click(messageId, SURVEY_LINK, { id })).toBe('processed');
      expect(await click(messageId, SURVEY_LINK, { id })).toBe('deduped');

      expect((await campaignRow(campaignId)).openedCount).toBe(1);
      expect(await storedClicks(recipientId)).toHaveLength(1);
    });

    it('이미 반송된 수신자가 눌러도 기록은 남고 수신 상황은 그대로다', async () => {
      const campaignId = await seedCampaign();
      const { recipientId, messageId } = await seedRecipient(
        campaignId,
        await seedContact(),
        'bounced',
      );

      await click(messageId, SURVEY_LINK);

      const row = await campaignRow(campaignId);
      expect(row.clickedCount).toBe(1);
      expect(row.openedCount).toBe(0);
      expect(await recipientStatus(campaignId, recipientId)).toBe('bounced');
    });

    it('회신 전달·답장 중계 메일의 클릭은 기록하지 않는다', async () => {
      const campaignId = await seedCampaign();
      const { recipientId, messageId } = await seedRecipient(campaignId, await seedContact());

      await click(messageId, SURVEY_LINK, { tags: { kind: 'reply-forward' } });
      await click(messageId, SURVEY_LINK, { tags: { kind: 'reply-relay' } });

      const row = await campaignRow(campaignId);
      expect(row.clickedCount).toBe(0);
      expect(row.openedCount).toBe(0);
      expect(await recipientStatus(campaignId, recipientId)).toBe('delivered');
    });

    it('수신자 한 명의 클릭 줄은 상한을 넘지 않는다', async () => {
      const campaignId = await seedCampaign();
      const { recipientId, messageId } = await seedRecipient(campaignId, await seedContact());
      await db.insert(mailLinkClicks).values(
        Array.from({ length: MAX_CLICKS_PER_RECIPIENT }, () => ({
          recipientId,
          linkKind: 'other' as const,
          linkUrl: REPORT_LINK,
          clickedAt: new Date('2026-11-20T05:00:00.000Z'),
        })),
      );

      expect(await click(messageId, SURVEY_LINK)).toBe('processed');

      expect(await storedClicks(recipientId)).toHaveLength(MAX_CLICKS_PER_RECIPIENT);
      expect((await campaignRow(campaignId)).clickedCount).toBe(0);
    });

    it('클릭 정보가 빠진 알림은 줄 없이 열람으로만 올린다', async () => {
      const campaignId = await seedCampaign();
      const { recipientId, messageId } = await seedRecipient(campaignId, await seedContact());

      const result = await processResendWebhookEvent({
        id: `evt-${randomUUID()}`,
        type: 'email.clicked',
        createdAt: '2026-11-20T05:00:00.000Z',
        resendMessageId: messageId,
        click: null,
      });

      expect(result).toBe('processed');
      expect(await storedClicks(recipientId)).toHaveLength(0);
      expect(await recipientStatus(campaignId, recipientId)).toBe('opened');
    });

    it('보관된 수신자의 클릭은 세지 않는다', async () => {
      const campaignId = await seedCampaign();
      const { recipientId, messageId } = await seedRecipient(campaignId, await seedContact());
      await click(messageId, SURVEY_LINK);
      expect((await campaignRow(campaignId)).clickedCount).toBe(1);

      await db
        .update(mailRecipients)
        .set({ archivedAt: new Date() })
        .where(eq(mailRecipients.id, recipientId));

      expect((await campaignRow(campaignId)).clickedCount).toBe(0);
    });
  });

  describe('남기는 것과 남기지 않는 것', () => {
    it('설문·수신거부 주소는 남기지 않고 그 밖의 링크만 주소를 남긴다', async () => {
      const campaignId = await seedCampaign();
      const { recipientId, messageId } = await seedRecipient(campaignId, await seedContact());

      await click(messageId, `${SURVEY_LINK}?invite=3f0c6c1e-0000-4000-8000-000000000009`);
      await click(messageId, UNSUBSCRIBE_LINK);
      await click(messageId, REPORT_LINK);

      const stored = await storedClicks(recipientId);
      expect(
        stored
          .map((c) => ({ kind: c.linkKind, url: c.linkUrl }))
          .sort((a, b) => a.kind.localeCompare(b.kind)),
      ).toEqual([
        { kind: 'other', url: REPORT_LINK },
        { kind: 'survey', url: null },
        { kind: 'unsubscribe', url: null },
      ]);
    });

    it('IP 는 원문 없이 응답과 같은 식의 해시로 남고, 클릭 시각과 브라우저 정보를 남긴다', async () => {
      const campaignId = await seedCampaign();
      const { recipientId, messageId } = await seedRecipient(campaignId, await seedContact());

      await click(messageId, SURVEY_LINK, {
        ip: '198.51.100.23',
        ua: 'Mozilla/5.0 (Windows NT 10.0)',
        at: '2026-11-20T05:03:10.000Z',
      });

      const [stored] = await storedClicks(recipientId);
      // 응답의 ip_hash 가 쓰는 식(saltedHash) — 같은 IP 로 시작한 응답과 맞춰 볼 수 있어야 한다.
      expect(stored?.ipHash).toBe(saltedHash('198.51.100.23'));
      expect(stored?.ipHash).not.toContain('198.51.100.23');
      expect(stored?.userAgent).toBe('Mozilla/5.0 (Windows NT 10.0)');
      expect(stored?.clickedAt.toISOString()).toBe('2026-11-20T05:03:10.000Z');
    });
  });
});
