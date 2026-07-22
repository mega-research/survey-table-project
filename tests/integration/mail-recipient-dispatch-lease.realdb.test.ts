import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import { contactTargets, mailCampaigns, mailRecipients, surveys } from '@/db/schema';
import {
  dispatchCampaignChunk,
  prepareCampaignDispatch,
  terminalizeUnresolvedCampaignDispatch,
} from '@/lib/mail/campaign-dispatch';
import { processResendEvent } from '@/lib/mail/resend-webhook';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');
const run = process.env['RUN_REALDB'] === '1' && isLocalDb ? describe : describe.skip;

process.env['NEXT_PUBLIC_APP_URL'] = 'https://example.com';
process.env['RESEND_FROM_DOMAIN'] = 'mail.example.com';

run('mail recipient durable dispatch lease', () => {
  const surveyId = randomUUID();

  beforeAll(async () => {
    await db.insert(surveys).values({ id: surveyId, title: '발송 lease 실DB 테스트' });
  });

  afterAll(async () => {
    await db.delete(surveys).where(eq(surveys.id, surveyId));
  });

  it('attempt 시각과 lease token/만료 시각을 실제 DB에 왕복 저장한다', async () => {
    const campaignId = randomUUID();
    const recipientId = randomUUID();
    const leaseToken = randomUUID();
    const attemptedAt = new Date('2026-07-22T00:00:00.000Z');
    const leaseExpiresAt = new Date('2026-07-22T00:00:30.000Z');
    const sendPayloadSnapshot = {
      from: 'Survey <survey@mail.example.com>',
      replyTo: 'reply@example.com',
      to: 'lease@example.com',
      subject: '제목',
      html: '<p>본문</p>',
      attachments: [],
    };

    await db.insert(mailCampaigns).values({
      id: campaignId,
      surveyId,
      runNumber: 1,
      title: '발송 lease 테스트',
      subjectSnapshot: '제목',
      bodyHtmlSnapshot: '<p>본문</p>',
      fromLocalSnapshot: 'survey',
      fromNameSnapshot: '조사',
    });
    await db.insert(mailRecipients).values({
      id: recipientId,
      campaignId,
      emailSnapshot: 'lease@example.com',
      status: 'sending',
      sendAttemptedAt: attemptedAt,
      sendLeaseToken: leaseToken,
      sendLeaseExpiresAt: leaseExpiresAt,
      sendPayloadSnapshot,
    });

    const [row] = await db
      .select({
        sendAttemptedAt: mailRecipients.sendAttemptedAt,
        sendLeaseToken: mailRecipients.sendLeaseToken,
        sendLeaseExpiresAt: mailRecipients.sendLeaseExpiresAt,
        sendPayloadSnapshot: mailRecipients.sendPayloadSnapshot,
      })
      .from(mailRecipients)
      .where(eq(mailRecipients.id, recipientId));

    expect(row).toEqual({
      sendAttemptedAt: attemptedAt,
      sendLeaseToken: leaseToken,
      sendLeaseExpiresAt: leaseExpiresAt,
      sendPayloadSnapshot,
    });
  });

  it('claim 전 contact가 삭제된 queued row를 failed로 종결하고 counter를 맞춘다', async () => {
    const campaignId = randomUUID();
    const recipientId = randomUUID();
    const contactTargetId = randomUUID();

    await db.insert(contactTargets).values({
      id: contactTargetId,
      surveyId,
      resid: 1,
      inviteCode: `deleted-${randomUUID()}`,
    });
    await db.insert(mailCampaigns).values({
      id: campaignId,
      surveyId,
      runNumber: 2,
      title: '삭제 contact 발송 테스트',
      subjectSnapshot: '제목',
      bodyHtmlSnapshot: '<p>본문</p>',
      fromLocalSnapshot: 'survey',
      fromNameSnapshot: '조사',
      status: 'sending',
      recipientCount: 1,
      queuedCount: 1,
    });
    await db.insert(mailRecipients).values({
      id: recipientId,
      campaignId,
      contactTargetId,
      emailSnapshot: 'deleted@example.com',
      status: 'queued',
    });
    await db.delete(contactTargets).where(eq(contactTargets.id, contactTargetId));

    await expect(dispatchCampaignChunk(campaignId, [recipientId])).resolves.toEqual({
      sent: 0,
      failed: 1,
    });

    const [recipient] = await db
      .select({ status: mailRecipients.status })
      .from(mailRecipients)
      .where(eq(mailRecipients.id, recipientId));
    const [campaign] = await db
      .select({
        status: mailCampaigns.status,
        queuedCount: mailCampaigns.queuedCount,
        failedCount: mailCampaigns.failedCount,
      })
      .from(mailCampaigns)
      .where(eq(mailCampaigns.id, campaignId));

    expect(recipient?.status).toBe('failed');
    expect(campaign).toEqual({ status: 'partial', queuedCount: 0, failedCount: 1 });
  });

  it('recipient가 0명인 queued campaign은 prepare에서 completed로 종결한다', async () => {
    const campaignId = randomUUID();
    await db.insert(mailCampaigns).values({
      id: campaignId,
      surveyId,
      runNumber: 3,
      title: '빈 발송 테스트',
      subjectSnapshot: '제목',
      bodyHtmlSnapshot: '<p>본문</p>',
      fromLocalSnapshot: 'survey',
      fromNameSnapshot: '조사',
      status: 'queued',
    });

    await expect(prepareCampaignDispatch(campaignId)).resolves.toEqual({ recipientIds: [] });

    const [campaign] = await db
      .select({ status: mailCampaigns.status })
      .from(mailCampaigns)
      .where(eq(mailCampaigns.id, campaignId));
    expect(campaign?.status).toBe('completed');
  });

  it('보관·취소된 campaign의 stale sending도 PII snapshot을 지우고 counter를 보존한다', async () => {
    const campaignId = randomUUID();
    const recipientId = randomUUID();
    const acceptedRecipientId = randomUUID();
    await db.insert(mailCampaigns).values({
      id: campaignId,
      surveyId,
      runNumber: 4,
      title: '비활성 발송 cleanup 테스트',
      subjectSnapshot: '제목',
      bodyHtmlSnapshot: '<p>본문</p>',
      fromLocalSnapshot: 'survey',
      fromNameSnapshot: '조사',
      status: 'cancelled',
      archivedAt: new Date('2026-07-22T01:00:00Z'),
      queuedCount: 1,
    });
    await db.insert(mailRecipients).values({
      id: recipientId,
      campaignId,
      emailSnapshot: 'ambiguous@example.com',
      status: 'sending',
      sendAttemptedAt: new Date('2026-07-22T00:00:00Z'),
      sendLeaseToken: randomUUID(),
      sendLeaseExpiresAt: new Date('2026-07-22T00:01:00Z'),
      sendPayloadSnapshot: {
        from: 'Survey <survey@mail.example.com>',
        replyTo: 'reply@example.com',
        to: 'ambiguous@example.com',
        subject: '제목',
        html: '<p>본문</p>',
        attachments: [],
      },
    });
    await db.insert(mailRecipients).values({
      id: acceptedRecipientId,
      campaignId,
      emailSnapshot: 'accepted@example.com',
      status: 'sending',
      resendMessageId: 'message-accepted',
      sendAttemptedAt: new Date('2026-07-22T00:00:00Z'),
      sendLeaseExpiresAt: new Date('2026-07-22T00:01:00Z'),
      sendPayloadSnapshot: {
        from: 'Survey <survey@mail.example.com>',
        replyTo: 'reply@example.com',
        to: 'accepted@example.com',
        subject: '제목',
        html: '<p>본문</p>',
        attachments: [],
      },
    });

    await expect(terminalizeUnresolvedCampaignDispatch(
      campaignId,
      new Date('2026-07-23T00:00:00Z'),
    )).resolves.toEqual({ terminalized: 2, busyUntil: null });

    const [recipient] = await db
      .select({
        status: mailRecipients.status,
        sendLeaseToken: mailRecipients.sendLeaseToken,
        sendLeaseExpiresAt: mailRecipients.sendLeaseExpiresAt,
        sendPayloadSnapshot: mailRecipients.sendPayloadSnapshot,
      })
      .from(mailRecipients)
      .where(eq(mailRecipients.id, recipientId));
    const [acceptedRecipient] = await db
      .select({
        status: mailRecipients.status,
        resendMessageId: mailRecipients.resendMessageId,
        sendPayloadSnapshot: mailRecipients.sendPayloadSnapshot,
      })
      .from(mailRecipients)
      .where(eq(mailRecipients.id, acceptedRecipientId));
    const [campaign] = await db
      .select({ status: mailCampaigns.status, queuedCount: mailCampaigns.queuedCount })
      .from(mailCampaigns)
      .where(eq(mailCampaigns.id, campaignId));

    expect(recipient).toEqual({
      status: 'failed',
      sendLeaseToken: null,
      sendLeaseExpiresAt: null,
      sendPayloadSnapshot: null,
    });
    expect(acceptedRecipient).toEqual({
      status: 'sent',
      resendMessageId: 'message-accepted',
      sendPayloadSnapshot: null,
    });
    expect(campaign).toEqual({ status: 'cancelled', queuedCount: 1 });
  });

  it('stale sending의 contact가 수신거부되면 복구 창 동안 새 send를 시작하지 않는다', async () => {
    const campaignId = randomUUID();
    const recipientId = randomUUID();
    const contactTargetId = randomUUID();
    await db.insert(contactTargets).values({
      id: contactTargetId,
      surveyId,
      resid: 2,
      inviteCode: `unsubscribed-${randomUUID()}`,
      unsubscribedAt: new Date('2026-07-22T00:00:30Z'),
    });
    await db.insert(mailCampaigns).values({
      id: campaignId,
      surveyId,
      runNumber: 5,
      title: '수신거부 recovery 테스트',
      subjectSnapshot: '제목',
      bodyHtmlSnapshot: '<p>본문</p>',
      fromLocalSnapshot: 'survey',
      fromNameSnapshot: '조사',
      status: 'sending',
      recipientCount: 1,
      queuedCount: 1,
    });
    await db.insert(mailRecipients).values({
      id: recipientId,
      campaignId,
      contactTargetId,
      emailSnapshot: 'unsubscribed@example.com',
      status: 'sending',
      sendAttemptedAt: new Date(),
      sendLeaseExpiresAt: new Date(Date.now() - 1_000),
      sendPayloadSnapshot: {
        from: 'Survey <survey@mail.example.com>',
        replyTo: 'reply@example.com',
        to: 'unsubscribed@example.com',
        subject: '제목',
        html: '<p>본문</p>',
        attachments: [],
      },
    });

    await expect(dispatchCampaignChunk(campaignId, [recipientId])).rejects.toThrow(
      'contact가 삭제 또는 수신거부되어 webhook 복구를 기다립니다.',
    );

    const [recipient] = await db
      .select({
        status: mailRecipients.status,
        sendPayloadSnapshot: mailRecipients.sendPayloadSnapshot,
      })
      .from(mailRecipients)
      .where(eq(mailRecipients.id, recipientId));
    expect(recipient).toMatchObject({
      status: 'sending',
      sendPayloadSnapshot: expect.any(Object),
    });
  });

  it('inactive cleanup과 webhook 교차경합이 deadlock 없이 같은 terminal 상태로 수렴한다', async () => {
    const campaignId = randomUUID();
    const recipientId = randomUUID();
    const archivedAt = new Date('2026-07-22T01:00:00Z');
    await db.insert(mailCampaigns).values({
      id: campaignId,
      surveyId,
      runNumber: 6,
      title: 'cleanup webhook 교차경합 테스트',
      subjectSnapshot: '제목',
      bodyHtmlSnapshot: '<p>본문</p>',
      fromLocalSnapshot: 'survey',
      fromNameSnapshot: '조사',
      status: 'cancelled',
      archivedAt,
    });
    await db.insert(mailRecipients).values({
      id: recipientId,
      campaignId,
      archivedAt,
      emailSnapshot: 'race@example.com',
      status: 'sending',
      resendMessageId: 'message-race',
      sendAttemptedAt: new Date('2026-07-22T00:00:00Z'),
      sendLeaseExpiresAt: new Date('2026-07-22T00:01:00Z'),
      sendPayloadSnapshot: {
        from: 'Survey <survey@mail.example.com>',
        replyTo: 'reply@example.com',
        to: 'race@example.com',
        subject: '제목',
        html: '<p>본문</p>',
        attachments: [],
      },
    });

    const race = Promise.all([
      terminalizeUnresolvedCampaignDispatch(
        campaignId,
        new Date('2026-07-23T00:00:00Z'),
      ),
      processResendEvent(
        'message-race',
        'email.delivered',
        '2026-07-22T01:01:00Z',
      ),
    ]);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      await expect(Promise.race([
        race,
        new Promise((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error('cleanup/webhook deadlock timeout')),
            3_000,
          );
        }),
      ])).resolves.toBeDefined();
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }

    const [recipient] = await db
      .select({
        status: mailRecipients.status,
        resendMessageId: mailRecipients.resendMessageId,
        sendPayloadSnapshot: mailRecipients.sendPayloadSnapshot,
      })
      .from(mailRecipients)
      .where(eq(mailRecipients.id, recipientId));
    expect(recipient).toEqual({
      status: 'delivered',
      resendMessageId: 'message-race',
      sendPayloadSnapshot: null,
    });
  });
});
