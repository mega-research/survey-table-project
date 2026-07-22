import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  contactTargets,
  mailCampaigns,
  mailRecipients,
  surveyResponses,
  surveys,
  testResponseAttempts,
} from '@/db/schema';
import { deleteContactTarget } from '@/features/contacts/server/services/contact-targets.service';
import { terminalizeUnresolvedCampaignDispatch } from '@/lib/mail/campaign-dispatch';
import { archiveTestWorkspaceMail } from '@/lib/mail/test-mail-archive.server';
import { computeCycleBreakdown } from '@/lib/operations/mail-billing.server';
import { processResendEvent } from '@/lib/mail/resend-webhook';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');
const run = process.env['RUN_REALDB'] === '1' && isLocalDb ? describe : describe.skip;

function campaignValues(surveyId: string, runNumber: number, title: string) {
  return {
    id: randomUUID(),
    surveyId,
    runNumber,
    isTest: true,
    title,
    subjectSnapshot: '개인화 제목',
    bodyHtmlSnapshot: '<p>개인화 본문</p>',
    fromLocalSnapshot: 'qa',
    fromNameSnapshot: '테스트 담당자',
    replyToSnapshot: 'qa@example.com',
    attachmentsSnapshot: [],
    filterSnapshot: {},
    status: 'sending' as const,
    recipientCount: 1,
    queuedCount: 1,
  };
}

run('test workspace mail archive realdb', () => {
  const surveyId = randomUUID();

  beforeAll(async () => {
    await db.insert(surveys).values({
      id: surveyId,
      title: '테스트 메일 archive 실DB',
      testModeEnabled: true,
      testContactColumns: { version: 1, headerRow: 1, columns: [] },
    });
  });

  afterAll(async () => {
    await db.delete(surveys).where(eq(surveys.id, surveyId));
  });

  it('개별 test target은 queued를 지우고 sent/sending을 복구 계약에 맞게 보관한다', async () => {
    const targetId = randomUUID();
    const responseId = randomUUID();
    const attemptId = randomUUID();
    const queuedCampaign = campaignValues(surveyId, 1, 'queued campaign');
    const sentCampaign = campaignValues(surveyId, 2, 'sent campaign');
    const sendingCampaign = campaignValues(surveyId, 3, 'sending campaign');
    const queuedRecipientId = randomUUID();
    const sentRecipientId = randomUUID();
    const sendingRecipientId = randomUUID();
    const attemptedAt = new Date('2026-07-22T00:00:00Z');
    const payload = {
      from: 'Survey <qa@example.com>',
      replyTo: 'qa@example.com',
      to: 'inflight@example.com',
      subject: '개인화 제목',
      html: '<p>개인화 본문</p>',
      attachments: [],
    };

    await db.insert(contactTargets).values({
      id: targetId,
      surveyId,
      resid: 1,
      isTest: true,
      inviteCode: `archive-${randomUUID()}`,
    });
    await db.insert(surveyResponses).values({
      id: responseId,
      surveyId,
      questionResponses: {},
      isTest: true,
      contactTargetId: targetId,
    });
    await db.insert(testResponseAttempts).values({
      id: attemptId,
      responseId,
      sessionId: `attempt-${randomUUID()}`,
      status: 'active',
    });
    await db.insert(mailCampaigns).values([
      queuedCampaign,
      sentCampaign,
      sendingCampaign,
    ]);
    await db.insert(mailRecipients).values([
      {
        id: queuedRecipientId,
        campaignId: queuedCampaign.id,
        contactTargetId: targetId,
        emailSnapshot: 'queued@example.com',
        status: 'queued',
      },
      {
        id: sentRecipientId,
        campaignId: sentCampaign.id,
        contactTargetId: targetId,
        emailSnapshot: 'sent@example.com',
        status: 'sent',
        resendMessageId: 'message-sent-archive',
        sentAt: attemptedAt,
      },
      {
        id: sendingRecipientId,
        campaignId: sendingCampaign.id,
        contactTargetId: targetId,
        emailSnapshot: 'inflight@example.com',
        status: 'sending',
        sendAttemptedAt: attemptedAt,
        sendLeaseToken: randomUUID(),
        sendLeaseExpiresAt: new Date('2026-07-22T00:00:30Z'),
        sendPayloadSnapshot: payload,
      },
    ]);

    await deleteContactTarget({ surveyId, id: targetId });

    const recipients = await db
      .select({
        id: mailRecipients.id,
        status: mailRecipients.status,
        contactTargetId: mailRecipients.contactTargetId,
        emailSnapshot: mailRecipients.emailSnapshot,
        inviteTokenSnapshot: mailRecipients.inviteTokenSnapshot,
        errorReason: mailRecipients.errorReason,
        archivedAt: mailRecipients.archivedAt,
        sendAttemptedAt: mailRecipients.sendAttemptedAt,
        sendLeaseToken: mailRecipients.sendLeaseToken,
        sendLeaseExpiresAt: mailRecipients.sendLeaseExpiresAt,
        sendPayloadSnapshot: mailRecipients.sendPayloadSnapshot,
      })
      .from(mailRecipients)
      .where(inArray(mailRecipients.id, [queuedRecipientId, sentRecipientId, sendingRecipientId]));
    expect(recipients.find((row) => row.id === queuedRecipientId)).toBeUndefined();
    expect(recipients.find((row) => row.id === sentRecipientId)).toMatchObject({
      status: 'sent',
      contactTargetId: null,
      emailSnapshot: null,
      inviteTokenSnapshot: null,
      errorReason: null,
      archivedAt: expect.any(Date),
      sendAttemptedAt: null,
      sendLeaseToken: null,
      sendLeaseExpiresAt: null,
      sendPayloadSnapshot: null,
    });
    expect(recipients.find((row) => row.id === sendingRecipientId)).toMatchObject({
      status: 'sending',
      contactTargetId: null,
      emailSnapshot: null,
      archivedAt: expect.any(Date),
      sendAttemptedAt: attemptedAt,
      sendPayloadSnapshot: payload,
    });

    const [campaignCounts, responseRows, attemptRows, targetRows, surveyRows] = await Promise.all([
      db.select({
        id: mailCampaigns.id,
        status: mailCampaigns.status,
        recipientCount: mailCampaigns.recipientCount,
        queuedCount: mailCampaigns.queuedCount,
        sentCount: mailCampaigns.sentCount,
      }).from(mailCampaigns).where(inArray(mailCampaigns.id, [
        queuedCampaign.id,
        sentCampaign.id,
        sendingCampaign.id,
      ])),
      db.select({ id: surveyResponses.id }).from(surveyResponses).where(eq(surveyResponses.id, responseId)),
      db.select({ id: testResponseAttempts.id }).from(testResponseAttempts).where(eq(testResponseAttempts.id, attemptId)),
      db.select({ id: contactTargets.id }).from(contactTargets).where(eq(contactTargets.id, targetId)),
      db.select({ testContactColumns: surveys.testContactColumns }).from(surveys).where(eq(surveys.id, surveyId)),
    ]);
    expect(campaignCounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'completed', recipientCount: 0, queuedCount: 0, sentCount: 0 }),
      expect.objectContaining({ status: 'completed', recipientCount: 0, queuedCount: 0, sentCount: 0 }),
      expect.objectContaining({ status: 'completed', recipientCount: 0, queuedCount: 0, sentCount: 0 }),
    ]));
    expect(responseRows).toEqual([]);
    expect(attemptRows).toEqual([]);
    expect(targetRows).toEqual([]);
    expect(surveyRows[0]?.testContactColumns).toEqual({ version: 1, headerRow: 1, columns: [] });

    await processResendEvent(
      'message-inflight-archive',
      'email.delivered',
      '2026-07-22T00:01:00Z',
      { recipient_id: sendingRecipientId, campaign_id: sendingCampaign.id },
    );
    const [terminal] = await db
      .select({
        status: mailRecipients.status,
        sendAttemptedAt: mailRecipients.sendAttemptedAt,
        sendLeaseToken: mailRecipients.sendLeaseToken,
        sendLeaseExpiresAt: mailRecipients.sendLeaseExpiresAt,
        sendPayloadSnapshot: mailRecipients.sendPayloadSnapshot,
      })
      .from(mailRecipients)
      .where(eq(mailRecipients.id, sendingRecipientId));
    expect(terminal).toEqual({
      status: 'delivered',
      sendAttemptedAt: null,
      sendLeaseToken: null,
      sendLeaseExpiresAt: null,
      sendPayloadSnapshot: null,
    });
  });

  it('workspace helper는 retained campaign만 비식별 정산 행으로 남긴다', async () => {
    const targetId = randomUUID();
    const dropCampaign = campaignValues(surveyId, 10, '삭제 캠페인');
    const retainedCampaign = campaignValues(surveyId, 11, '보존 캠페인');
    const retainedRecipientId = randomUUID();
    await db.insert(contactTargets).values({
      id: targetId,
      surveyId,
      resid: 10,
      isTest: true,
      inviteCode: `workspace-${randomUUID()}`,
    });
    await db.insert(mailCampaigns).values([dropCampaign, retainedCampaign]);
    await db.insert(mailRecipients).values([
      {
        campaignId: dropCampaign.id,
        contactTargetId: targetId,
        emailSnapshot: 'drop@example.com',
        status: 'failed',
      },
      {
        id: retainedRecipientId,
        campaignId: retainedCampaign.id,
        contactTargetId: targetId,
        emailSnapshot: 'retained@example.com',
        status: 'delivered',
        resendMessageId: 'message-workspace-retained',
      },
    ]);

    await db.transaction(async (tx) => {
      await tx
        .select({ id: surveys.id })
        .from(surveys)
        .where(eq(surveys.id, surveyId))
        .for('update');
      await archiveTestWorkspaceMail(tx, surveyId);
    });

    const campaignRows = await db
      .select()
      .from(mailCampaigns)
      .where(inArray(mailCampaigns.id, [dropCampaign.id, retainedCampaign.id]));
    expect(campaignRows.find((row) => row.id === dropCampaign.id)).toBeUndefined();
    expect(campaignRows.find((row) => row.id === retainedCampaign.id)).toMatchObject({
      title: '삭제된 테스트 발송',
      subjectSnapshot: '',
      bodyHtmlSnapshot: '',
      fromLocalSnapshot: '',
      fromNameSnapshot: '',
      replyToSnapshot: null,
      attachmentsSnapshot: [],
      filterSnapshot: {},
      createdBy: null,
      status: 'cancelled',
      archivedAt: expect.any(Date),
      recipientCount: 0,
    });
    const recipientRows = await db
      .select({
        id: mailRecipients.id,
        contactTargetId: mailRecipients.contactTargetId,
        emailSnapshot: mailRecipients.emailSnapshot,
        archivedAt: mailRecipients.archivedAt,
      })
      .from(mailRecipients)
      .where(eq(mailRecipients.id, retainedRecipientId));
    expect(recipientRows[0]).toEqual({
      id: retainedRecipientId,
      contactTargetId: null,
      emailSnapshot: null,
      archivedAt: expect.any(Date),
    });
  });

  it('archived sending cleanup은 errorReason에 PII를 다시 저장하지 않는다', async () => {
    const targetId = randomUUID();
    const campaign = campaignValues(surveyId, 12, 'cleanup campaign');
    const recipientId = randomUUID();
    await db.insert(contactTargets).values({
      id: targetId,
      surveyId,
      resid: 12,
      isTest: true,
      inviteCode: `cleanup-${randomUUID()}`,
    });
    await db.insert(mailCampaigns).values(campaign);
    await db.insert(mailRecipients).values({
      id: recipientId,
      campaignId: campaign.id,
      contactTargetId: targetId,
      emailSnapshot: 'private@example.com',
      status: 'sending',
      sendAttemptedAt: new Date('2026-07-22T00:00:00Z'),
      sendPayloadSnapshot: {
        from: 'Survey <qa@example.com>',
        replyTo: 'qa@example.com',
        to: 'private@example.com',
        subject: '개인화 제목',
        html: '<p>개인화 본문</p>',
        attachments: [],
      },
    });

    await deleteContactTarget({ surveyId, id: targetId });
    await terminalizeUnresolvedCampaignDispatch(
      campaign.id,
      new Date('2026-07-23T00:00:01Z'),
    );

    const [row] = await db
      .select({
        status: mailRecipients.status,
        errorReason: mailRecipients.errorReason,
        sendPayloadSnapshot: mailRecipients.sendPayloadSnapshot,
      })
      .from(mailRecipients)
      .where(eq(mailRecipients.id, recipientId));
    expect(row).toEqual({
      status: 'failed',
      errorReason: null,
      sendPayloadSnapshot: null,
    });
  });

  it('billing은 active와 archived billable recipient를 각각 한 번 센다', async () => {
    const campaign = {
      ...campaignValues(surveyId, 13, '삭제된 테스트 발송'),
      status: 'cancelled' as const,
      startedAt: new Date('2026-07-22T03:00:00Z'),
      archivedAt: new Date('2026-07-22T04:00:00Z'),
      recipientCount: 0,
      queuedCount: 0,
    };
    await db.insert(mailCampaigns).values(campaign);
    await db.insert(mailRecipients).values([
      {
        campaignId: campaign.id,
        status: 'sent',
        sentAt: new Date('2026-07-22T03:01:00Z'),
      },
      {
        campaignId: campaign.id,
        status: 'delivered',
        sentAt: new Date('2026-07-22T03:02:00Z'),
        deliveredAt: new Date('2026-07-22T03:03:00Z'),
        archivedAt: new Date('2026-07-22T04:00:00Z'),
      },
    ]);

    const breakdown = await computeCycleBreakdown();
    const billed = breakdown.cycles
      .flatMap((cycle) => cycle.campaigns)
      .find((row) => row.campaignId === campaign.id);
    expect(billed).toMatchObject({
      billableCount: 2,
      isTest: true,
      archivedAt: expect.any(Date),
    });
  });
});
