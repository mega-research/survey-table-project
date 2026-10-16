import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db';
import { contactPii, contactTargets, mailCampaigns, mailRecipients, surveys } from '@/db/schema';
import { encryptPii } from '@/lib/crypto/aes';
import { blindIndex } from '@/lib/crypto/blind';
import { requestRecipientFallbacks } from '@/server/mail/services/campaign-fallback';
import { processResendEvent } from '@/server/mail/services/resend-webhook';
import type { ContactColumnScheme } from '@/shared/contracts/contacts';

const { inngestSend } = vi.hoisted(() => ({ inngestSend: vi.fn(async () => undefined) }));
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: inngestSend } }));

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');
const run = process.env['RUN_REALDB'] === '1' && isLocalDb ? describe : describe.skip;

/**
 * 대체 발송 — 실패·반송된 수신자를 발송 주소 순서의 다음 이메일 열로 자동 재발송한다.
 * 0135 의 CHECK·부분 유일 인덱스·발번 함수와 서비스 판정을 실 Postgres 로 왕복한다.
 */
run('대체 발송 (mail fallback)', () => {
  const surveyId = randomUUID();
  const scheme: ContactColumnScheme = {
    version: 1,
    headerRow: 1,
    columns: [
      { key: 'ceo', label: '대표자 e-mail', source: 'pii.ceo', piiType: 'email', order: 1, mailOrder: 1 },
      { key: 'staff', label: '실무자 e-mail', source: 'pii.staff', piiType: 'email', order: 2, mailOrder: 2 },
      { key: 'staff2', label: '실무자 e-mail 2', source: 'pii.staff2', piiType: 'email', order: 3, mailOrder: 3 },
    ],
  };
  let resid = 0;
  let parentRun = 0;

  beforeAll(async () => {
    await db.insert(surveys).values({ id: surveyId, title: '대체 발송 실DB 테스트', contactColumns: scheme });
  });

  afterAll(async () => {
    await db.delete(surveys).where(eq(surveys.id, surveyId));
  });

  beforeEach(() => inngestSend.mockClear());

  async function seedContact(
    emails: Partial<Record<'ceo' | 'staff' | 'staff2', string>>,
    opts: { respondedAt?: Date } = {},
  ): Promise<string> {
    const id = randomUUID();
    resid += 1;
    await db.insert(contactTargets).values({
      id,
      surveyId,
      resid,
      inviteCode: `fb-${id}`,
      ...(opts.respondedAt ? { respondedAt: opts.respondedAt } : {}),
    });
    for (const [columnKey, email] of Object.entries(emails)) {
      await db.insert(contactPii).values({
        contactTargetId: id,
        fieldType: 'email',
        columnKey,
        cipher: encryptPii(email),
        blindIndex: blindIndex('email', email),
      });
    }
    return id;
  }

  /** 원래 회차 + 발송된(sent) 수신자 하나. 반송은 webhook 으로 일으킨다. */
  async function seedSentRecipient(contactId: string, email: string, columnKey: string | null) {
    const campaignId = randomUUID();
    const recipientId = randomUUID();
    const messageId = `msg-${recipientId}`;
    parentRun += 1;
    await db.insert(mailCampaigns).values({
      id: campaignId,
      surveyId,
      runNumber: parentRun,
      title: `${parentRun}차 안내`,
      subjectSnapshot: '제목',
      bodyHtmlSnapshot: '<p>본문</p>',
      fromLocalSnapshot: 'survey',
      fromNameSnapshot: '조사',
      status: 'sending',
      recipientCount: 1,
      sentCount: 1,
    });
    await db.insert(mailRecipients).values({
      id: recipientId,
      campaignId,
      contactTargetId: contactId,
      emailSnapshot: email,
      emailColumnKey: columnKey,
      status: 'sent',
      resendMessageId: messageId,
    });
    return { campaignId, recipientId, messageId };
  }

  async function fallbackOf(parentCampaignId: string) {
    const [campaign] = await db
      .select()
      .from(mailCampaigns)
      .where(and(eq(mailCampaigns.parentCampaignId, parentCampaignId), eq(mailCampaigns.kind, 'fallback')));
    if (!campaign) return null;
    const recipients = await db
      .select()
      .from(mailRecipients)
      .where(eq(mailRecipients.campaignId, campaign.id));
    return { campaign, recipients };
  }

  it('반송되면 다음 순위 열 주소로 대체 회차를 만들어 큐에 넣는다', async () => {
    const contactId = await seedContact({ ceo: 'ceo@a.com', staff: 'staff@a.com', staff2: 'staff2@a.com' });
    const { campaignId, recipientId, messageId } = await seedSentRecipient(contactId, 'ceo@a.com', 'ceo');

    await processResendEvent(messageId, 'email.bounced', new Date().toISOString());

    const fb = await fallbackOf(campaignId);
    expect(fb?.campaign).toMatchObject({
      kind: 'fallback',
      status: 'queued',
      recipientCount: 1,
      queuedCount: 1,
      title: `${parentRun}차 안내 · 대체 발송`,
      subjectSnapshot: '제목',
    });
    expect(fb!.campaign.runNumber).toBeGreaterThan(2_000_000);
    expect(fb?.recipients).toEqual([
      expect.objectContaining({
        contactTargetId: contactId,
        emailSnapshot: 'staff@a.com',
        emailColumnKey: 'staff',
        sourceRecipientId: recipientId,
        status: 'queued',
      }),
    ]);
    expect(inngestSend).toHaveBeenCalledWith({
      name: 'mail/campaign.queued',
      data: { campaignId: fb!.campaign.id, surveyId },
    });

    // 같은 수신자로 다시 불려도(webhook 재전송·재시도) 한 줄만
    await requestRecipientFallbacks([recipientId]);
    expect((await fallbackOf(campaignId))?.recipients).toHaveLength(1);

    // 대체 발송도 반송되면 3순위로 — 대체의 대체 회차(2차)
    const fbRecipient = fb!.recipients[0]!;
    await db
      .update(mailRecipients)
      .set({ status: 'sent', resendMessageId: `msg-${fbRecipient.id}` })
      .where(eq(mailRecipients.id, fbRecipient.id));
    await processResendEvent(`msg-${fbRecipient.id}`, 'email.bounced', new Date().toISOString());
    const fb2 = await fallbackOf(fb!.campaign.id);
    expect(fb2?.campaign.title).toBe(`${parentRun}차 안내 · 대체 발송 2차`);
    expect(fb2?.recipients).toEqual([
      expect.objectContaining({ emailSnapshot: 'staff2@a.com', emailColumnKey: 'staff2' }),
    ]);

    // 마지막 순위까지 반송되면 더 만들지 않는다
    const fb2Recipient = fb2!.recipients[0]!;
    await db
      .update(mailRecipients)
      .set({ status: 'bounced' })
      .where(eq(mailRecipients.id, fb2Recipient.id));
    await requestRecipientFallbacks([fb2Recipient.id]);
    expect(await fallbackOf(fb2!.campaign.id)).toBeNull();
  });

  it('쓴 열을 모르는 옛 수신자도 주소 값으로 쓴 열을 찾아 다음 순위로 보낸다', async () => {
    const contactId = await seedContact({ ceo: 'old@a.com', staff: 'next@a.com' });
    const { campaignId, recipientId } = await seedSentRecipient(contactId, 'old@a.com', null);
    await db.update(mailRecipients).set({ status: 'failed' }).where(eq(mailRecipients.id, recipientId));

    await requestRecipientFallbacks([recipientId]);

    expect((await fallbackOf(campaignId))?.recipients).toEqual([
      expect.objectContaining({ emailSnapshot: 'next@a.com', emailColumnKey: 'staff' }),
    ]);
  });

  it('응답을 마쳤거나 수신거부한 사람, 다음 순위가 없는 사람에게는 보내지 않는다', async () => {
    const responded = await seedContact({ ceo: 'r@a.com', staff: 'r2@a.com' }, { respondedAt: new Date() });
    const r1 = await seedSentRecipient(responded, 'r@a.com', 'ceo');
    const unsubscribed = await seedContact({ ceo: 'u@a.com', staff: 'u2@a.com' });
    await db.update(contactTargets).set({ unsubscribedAt: new Date() }).where(eq(contactTargets.id, unsubscribed));
    const r2 = await seedSentRecipient(unsubscribed, 'u@a.com', 'ceo');
    const single = await seedContact({ ceo: 'only@a.com' });
    const r3 = await seedSentRecipient(single, 'only@a.com', 'ceo');
    const sameAddress = await seedContact({ ceo: 'dup@a.com', staff: 'DUP@a.com' });
    const r4 = await seedSentRecipient(sameAddress, 'dup@a.com', 'ceo');

    for (const r of [r1, r2, r3, r4]) {
      await processResendEvent(r.messageId, 'email.bounced', new Date().toISOString());
    }

    for (const r of [r1, r2, r3, r4]) expect(await fallbackOf(r.campaignId)).toBeNull();
    expect(inngestSend).not.toHaveBeenCalled();
  });

  it('스팸 신고·전달 완료는 대체 발송을 일으키지 않는다', async () => {
    const contactId = await seedContact({ ceo: 'c@a.com', staff: 'c2@a.com' });
    const complained = await seedSentRecipient(contactId, 'c@a.com', 'ceo');
    await processResendEvent(complained.messageId, 'email.complained', new Date().toISOString());
    const other = await seedContact({ ceo: 'd@a.com', staff: 'd2@a.com' });
    const delivered = await seedSentRecipient(other, 'd@a.com', 'ceo');
    await processResendEvent(delivered.messageId, 'email.delivered', new Date().toISOString());

    expect(await fallbackOf(complained.campaignId)).toBeNull();
    expect(await fallbackOf(delivered.campaignId)).toBeNull();
  });

  it('이미 끝난 대체 회차에 늦게 온 반송이 들어오면 회차를 다시 연다', async () => {
    const a = await seedContact({ ceo: 'la@a.com', staff: 'la2@a.com' });
    const b = await seedContact({ ceo: 'lb@a.com', staff: 'lb2@a.com' });
    const first = await seedSentRecipient(a, 'la@a.com', 'ceo');
    const secondRecipientId = randomUUID();
    await db.insert(mailRecipients).values({
      id: secondRecipientId,
      campaignId: first.campaignId,
      contactTargetId: b,
      emailSnapshot: 'lb@a.com',
      emailColumnKey: 'ceo',
      status: 'bounced',
    });

    await processResendEvent(first.messageId, 'email.bounced', new Date().toISOString());
    const fb = await fallbackOf(first.campaignId);
    await db
      .update(mailCampaigns)
      .set({ status: 'completed', queuedCount: 0, completedAt: new Date() })
      .where(eq(mailCampaigns.id, fb!.campaign.id));

    await requestRecipientFallbacks([secondRecipientId]);

    const reopened = await fallbackOf(first.campaignId);
    expect(reopened?.campaign).toMatchObject({ status: 'queued', completedAt: null, recipientCount: 2, queuedCount: 1 });
    expect(reopened?.recipients.map((r) => r.emailSnapshot).sort()).toEqual(['la2@a.com', 'lb2@a.com']);
  });
});
