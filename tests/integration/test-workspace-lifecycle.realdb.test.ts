import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
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
import { getControlState } from '@/features/operations/server/services/control.service';
import { disableTestWorkspace } from '@/features/operations/server/services/test-workspace.service';
import { terminalizeUnresolvedCampaignDispatch } from '@/lib/mail/campaign-dispatch';
import { processResendEvent } from '@/lib/mail/resend-webhook';
import { archiveTestWorkspaceMail } from '@/lib/mail/test-mail-archive.server';
import { computeCycleBreakdown } from '@/lib/operations/mail-billing.server';

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
    await db.insert(mailCampaigns).values([queuedCampaign, sentCampaign, sendingCampaign]);
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
      db
        .select({
          id: mailCampaigns.id,
          status: mailCampaigns.status,
          recipientCount: mailCampaigns.recipientCount,
          queuedCount: mailCampaigns.queuedCount,
          sentCount: mailCampaigns.sentCount,
        })
        .from(mailCampaigns)
        .where(inArray(mailCampaigns.id, [queuedCampaign.id, sentCampaign.id, sendingCampaign.id])),
      db
        .select({ id: surveyResponses.id })
        .from(surveyResponses)
        .where(eq(surveyResponses.id, responseId)),
      db
        .select({ id: testResponseAttempts.id })
        .from(testResponseAttempts)
        .where(eq(testResponseAttempts.id, attemptId)),
      db
        .select({ id: contactTargets.id })
        .from(contactTargets)
        .where(eq(contactTargets.id, targetId)),
      db
        .select({ testContactColumns: surveys.testContactColumns })
        .from(surveys)
        .where(eq(surveys.id, surveyId)),
    ]);
    expect(campaignCounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'completed',
          recipientCount: 0,
          queuedCount: 0,
          sentCount: 0,
        }),
        expect.objectContaining({
          status: 'completed',
          recipientCount: 0,
          queuedCount: 0,
          sentCount: 0,
        }),
        expect.objectContaining({
          status: 'completed',
          recipientCount: 0,
          queuedCount: 0,
          sentCount: 0,
        }),
      ]),
    );
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
    await terminalizeUnresolvedCampaignDispatch(campaign.id, new Date('2026-07-23T00:00:01Z'));

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

run('test workspace disable realdb', () => {
  const surveyId = randomUUID();
  const testTargetId = randomUUID();
  const testInviteCode = `disable-test-${randomUUID()}`;
  const testResponseId = randomUUID();
  const actualTargetId = randomUUID();
  const actualResponseId = randomUUID();
  const activeTestCampaign = campaignValues(surveyId, 1, '진행 중 테스트 발송');
  const retainedTestCampaign = campaignValues(surveyId, 2, '발송 완료 테스트 발송');
  const actualCampaign = {
    ...campaignValues(surveyId, 3, '실제 발송'),
    isTest: false,
    status: 'completed' as const,
  };

  beforeAll(async () => {
    await db.insert(surveys).values({
      id: surveyId,
      title: '테스트 workspace 종료 실DB',
      testModeEnabled: true,
      testContactColumns: { version: 1, headerRow: 1, columns: [] },
    });
    await db.insert(contactTargets).values([
      {
        id: testTargetId,
        surveyId,
        resid: 1,
        isTest: true,
        inviteCode: testInviteCode,
      },
      {
        id: actualTargetId,
        surveyId,
        resid: 2,
        isTest: false,
        inviteCode: `disable-actual-${randomUUID()}`,
      },
    ]);
    await db.insert(surveyResponses).values([
      {
        id: testResponseId,
        surveyId,
        questionResponses: {},
        isTest: true,
        contactTargetId: testTargetId,
      },
      {
        id: actualResponseId,
        surveyId,
        questionResponses: {},
        isTest: false,
        contactTargetId: actualTargetId,
      },
    ]);
    await db
      .insert(mailCampaigns)
      .values([{ ...activeTestCampaign, status: 'queued' }, retainedTestCampaign, actualCampaign]);
    await db.insert(mailRecipients).values({
      campaignId: retainedTestCampaign.id,
      contactTargetId: testTargetId,
      emailSnapshot: 'test-retained@example.com',
      status: 'delivered',
      sentAt: new Date('2026-07-22T03:01:00Z'),
      deliveredAt: new Date('2026-07-22T03:02:00Z'),
    });
  });

  afterAll(async () => {
    await db.delete(surveys).where(eq(surveys.id, surveyId));
  });

  it('keep은 mode와 진행 중 테스트 발송만 끄고 테스트 workspace를 보존한다', async () => {
    const control = await getControlState(surveyId);
    expect(control).toMatchObject({
      testModeEnabled: true,
      testResponseCount: 1,
      testTargetCount: 1,
      firstTestInviteCode: testInviteCode,
    });

    const result = await disableTestWorkspace({ surveyId, disposition: 'keep' });

    expect(result).toEqual({
      testModeEnabled: false,
      deletedResponseCount: 0,
      deletedTargetCount: 0,
      remainingResponseCount: 1,
      remainingTargetCount: 1,
    });
    const [surveyRows, targetRows, responseRows, campaignRows] = await Promise.all([
      db
        .select({
          testModeEnabled: surveys.testModeEnabled,
          testContactColumns: surveys.testContactColumns,
        })
        .from(surveys)
        .where(eq(surveys.id, surveyId)),
      db
        .select({ id: contactTargets.id })
        .from(contactTargets)
        .where(inArray(contactTargets.id, [testTargetId, actualTargetId])),
      db
        .select({ id: surveyResponses.id })
        .from(surveyResponses)
        .where(inArray(surveyResponses.id, [testResponseId, actualResponseId])),
      db
        .select({ id: mailCampaigns.id, status: mailCampaigns.status })
        .from(mailCampaigns)
        .where(inArray(mailCampaigns.id, [activeTestCampaign.id, actualCampaign.id])),
    ]);
    expect(surveyRows[0]).toEqual({
      testModeEnabled: false,
      testContactColumns: { version: 1, headerRow: 1, columns: [] },
    });
    expect(targetRows).toHaveLength(2);
    expect(responseRows).toHaveLength(2);
    expect(campaignRows).toEqual(
      expect.arrayContaining([
        { id: activeTestCampaign.id, status: 'cancelled' },
        { id: actualCampaign.id, status: 'completed' },
      ]),
    );

    await expect(disableTestWorkspace({ surveyId, disposition: 'delete' })).rejects.toThrow(
      'TEST_WORKSPACE_DISABLE_STALE',
    );
    const [retainedTarget] = await db
      .select({ id: contactTargets.id })
      .from(contactTargets)
      .where(eq(contactTargets.id, testTargetId));
    expect(retainedTarget).toEqual({ id: testTargetId });
  });

  it('delete는 테스트 workspace만 지우고 실제 응답·컨택·발송은 보존한다', async () => {
    await db.update(surveys).set({ testModeEnabled: true }).where(eq(surveys.id, surveyId));

    const result = await disableTestWorkspace({ surveyId, disposition: 'delete' });

    expect(result).toEqual({
      testModeEnabled: false,
      deletedResponseCount: 1,
      deletedTargetCount: 1,
      remainingResponseCount: 0,
      remainingTargetCount: 0,
    });
    const [
      surveyRows,
      testTargetRows,
      testResponseRows,
      actualTargetRows,
      actualResponseRows,
      campaignRows,
    ] = await Promise.all([
      db
        .select({
          testModeEnabled: surveys.testModeEnabled,
          testContactColumns: surveys.testContactColumns,
        })
        .from(surveys)
        .where(eq(surveys.id, surveyId)),
      db
        .select({ id: contactTargets.id })
        .from(contactTargets)
        .where(eq(contactTargets.id, testTargetId)),
      db
        .select({ id: surveyResponses.id })
        .from(surveyResponses)
        .where(eq(surveyResponses.id, testResponseId)),
      db
        .select({ id: contactTargets.id })
        .from(contactTargets)
        .where(eq(contactTargets.id, actualTargetId)),
      db
        .select({ id: surveyResponses.id })
        .from(surveyResponses)
        .where(eq(surveyResponses.id, actualResponseId)),
      db
        .select({
          id: mailCampaigns.id,
          title: mailCampaigns.title,
          status: mailCampaigns.status,
          archivedAt: mailCampaigns.archivedAt,
        })
        .from(mailCampaigns)
        .where(inArray(mailCampaigns.id, [retainedTestCampaign.id, actualCampaign.id])),
    ]);
    expect(surveyRows[0]).toEqual({ testModeEnabled: false, testContactColumns: null });
    expect(testTargetRows).toEqual([]);
    expect(testResponseRows).toEqual([]);
    expect(actualTargetRows).toEqual([{ id: actualTargetId }]);
    expect(actualResponseRows).toEqual([{ id: actualResponseId }]);
    expect(campaignRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: retainedTestCampaign.id,
          title: '삭제된 테스트 발송',
          status: 'cancelled',
          archivedAt: expect.any(Date),
        }),
        { id: actualCampaign.id, title: '실제 발송', status: 'completed', archivedAt: null },
      ]),
    );
  });
});
