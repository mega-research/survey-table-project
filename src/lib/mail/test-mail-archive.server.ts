import 'server-only';

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets, mailCampaigns, mailRecipients } from '@/db/schema';
import type { MailRecipientStatus } from '@/db/schema/mail';
import { finalizeCampaignIfDone } from '@/lib/mail/recipient-status-transition';

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const RETAINED_TEST_RECIPIENT_STATUSES: readonly MailRecipientStatus[] = [
  'sending',
  'sent',
  'delivered',
  'opened',
  'bounced',
  'complained',
];

const retainedStatusSet = new Set<MailRecipientStatus>(RETAINED_TEST_RECIPIENT_STATUSES);

interface LockedRecipientRow {
  id: string;
  campaignId: string;
  status: MailRecipientStatus;
}

async function lockCampaigns(
  tx: DbTransaction,
  campaignIds: string[],
): Promise<void> {
  if (campaignIds.length === 0) return;
  await tx
    .select({ id: mailCampaigns.id })
    .from(mailCampaigns)
    .where(inArray(mailCampaigns.id, campaignIds))
    .orderBy(asc(mailCampaigns.id))
    .for('update');
}

async function recalculateLockedCampaignCounters(
  tx: DbTransaction,
  campaignIds: string[],
): Promise<void> {
  for (const campaignId of campaignIds) {
    await tx.execute(sql`
      UPDATE mail_campaigns mc SET
        recipient_count = x.recipient_count,
        queued_count = x.queued_count,
        sent_count = x.sent_count,
        delivered_count = x.delivered_count,
        opened_count = x.opened_count,
        bounced_count = x.bounced_count,
        complained_count = x.complained_count,
        failed_count = x.failed_count,
        skipped_unsubscribed_count = x.skipped_count,
        updated_at = now()
      FROM (
        SELECT
          count(*)::int AS recipient_count,
          count(*) FILTER (WHERE status IN ('queued', 'sending'))::int AS queued_count,
          count(*) FILTER (WHERE status = 'sent')::int AS sent_count,
          count(*) FILTER (WHERE status = 'delivered')::int AS delivered_count,
          count(*) FILTER (WHERE status = 'opened')::int AS opened_count,
          count(*) FILTER (WHERE status = 'bounced')::int AS bounced_count,
          count(*) FILTER (WHERE status = 'complained')::int AS complained_count,
          count(*) FILTER (WHERE status = 'failed')::int AS failed_count,
          count(*) FILTER (WHERE status = 'skipped_unsubscribed')::int AS skipped_count
        FROM mail_recipients
        WHERE campaign_id = ${campaignId}::uuid
          AND archived_at IS NULL
      ) x
      WHERE mc.id = ${campaignId}::uuid
    `);
  }
}

async function archiveLockedRecipients(
  tx: DbTransaction,
  affected: LockedRecipientRow[],
  now: Date,
): Promise<LockedRecipientRow[]> {
  const retained = affected.filter((row) => retainedStatusSet.has(row.status));
  const removedIds = affected
    .filter((row) => !retainedStatusSet.has(row.status))
    .map((row) => row.id);
  const retainedIds = retained.map((row) => row.id);
  const terminalIds = retained
    .filter((row) => row.status !== 'sending')
    .map((row) => row.id);

  if (removedIds.length > 0) {
    await tx.delete(mailRecipients).where(inArray(mailRecipients.id, removedIds));
  }
  if (retainedIds.length > 0) {
    await tx
      .update(mailRecipients)
      .set({
        contactTargetId: null,
        emailSnapshot: null,
        inviteTokenSnapshot: null,
        errorReason: null,
        archivedAt: now,
        updatedAt: now,
      })
      .where(inArray(mailRecipients.id, retainedIds));
  }
  if (terminalIds.length > 0) {
    await tx
      .update(mailRecipients)
      .set({
        sendAttemptedAt: null,
        sendLeaseToken: null,
        sendLeaseExpiresAt: null,
        sendPayloadSnapshot: null,
        updatedAt: now,
      })
      .where(inArray(mailRecipients.id, terminalIds));
  }
  return retained;
}

/** archived recipient를 제외한 운영 counter cache를 transaction 안에서 다시 계산한다. */
export async function recalculateActiveCampaignCounters(
  tx: DbTransaction,
  campaignIds: string[],
): Promise<void> {
  const uniqueIds = [...new Set(campaignIds)].sort();
  await lockCampaigns(tx, uniqueIds);
  await recalculateLockedCampaignCounters(tx, uniqueIds);
}

/**
 * 테스트 대상자에 연결된 메일 이력을 비식별 보관한다.
 *
 * 잠금 순서는 Task 10 발송 경로와 같은 campaign → contact → recipient다. caller는 같은
 * transaction에서 대상자의 survey scope를 검증하고 survey 행을 FOR UPDATE로 먼저 잠가
 * 새 campaign/recipient 생성을 차단해야 한다. ambiguous sending은 provider 결과가 확정될
 * 때까지 durable payload/lease를 유지하고, webhook 또는 23시간 cleanup이 terminal로
 * 전이할 때 지운다.
 */
export async function archiveTestMailForTargets(
  tx: DbTransaction,
  targetIds: string[],
): Promise<void> {
  const uniqueTargetIds = [...new Set(targetIds)].sort();
  if (uniqueTargetIds.length === 0) return;

  const discovered = await tx
    .select({ campaignId: mailRecipients.campaignId })
    .from(mailRecipients)
    .where(
      and(
        inArray(mailRecipients.contactTargetId, uniqueTargetIds),
        isNull(mailRecipients.archivedAt),
      ),
    );
  const campaignIds = [...new Set(discovered.map((row) => row.campaignId))].sort();

  await lockCampaigns(tx, campaignIds);
  await tx
    .select({ id: contactTargets.id })
    .from(contactTargets)
    .where(inArray(contactTargets.id, uniqueTargetIds))
    .orderBy(asc(contactTargets.id))
    .for('update');

  const affected = await tx
    .select({
      id: mailRecipients.id,
      campaignId: mailRecipients.campaignId,
      status: mailRecipients.status,
    })
    .from(mailRecipients)
    .where(
      and(
        inArray(mailRecipients.contactTargetId, uniqueTargetIds),
        isNull(mailRecipients.archivedAt),
      ),
    )
    .orderBy(asc(mailRecipients.id))
    .for('update');

  await archiveLockedRecipients(tx, affected, new Date());
  await recalculateLockedCampaignCounters(tx, campaignIds);
  for (const campaignId of campaignIds) {
    await finalizeCampaignIfDone(tx, campaignId);
  }
}

/**
 * 실제 대상자 삭제의 기존 FK cascade 의미를 보존한다. 0057에서 대상 FK가 SET NULL로
 * 바뀌었으므로 target 삭제 전에 같은 잠금 순서로 연결 recipient를 명시 삭제한다.
 */
export async function hardDeleteMailForTargets(
  tx: DbTransaction,
  targetIds: string[],
): Promise<void> {
  const uniqueTargetIds = [...new Set(targetIds)].sort();
  if (uniqueTargetIds.length === 0) return;

  const discovered = await tx
    .select({ campaignId: mailRecipients.campaignId })
    .from(mailRecipients)
    .where(inArray(mailRecipients.contactTargetId, uniqueTargetIds));
  const campaignIds = [...new Set(discovered.map((row) => row.campaignId))].sort();

  await lockCampaigns(tx, campaignIds);
  await tx
    .select({ id: contactTargets.id })
    .from(contactTargets)
    .where(inArray(contactTargets.id, uniqueTargetIds))
    .orderBy(asc(contactTargets.id))
    .for('update');
  const affected = await tx
    .select({ id: mailRecipients.id })
    .from(mailRecipients)
    .where(inArray(mailRecipients.contactTargetId, uniqueTargetIds))
    .orderBy(asc(mailRecipients.id))
    .for('update');

  if (affected.length > 0) {
    await tx.delete(mailRecipients).where(inArray(
      mailRecipients.id,
      affected.map((row) => row.id),
    ));
  }
}

/**
 * 테스트 workspace 전체 삭제에서 메일 정산 사실만 남긴다. caller는 같은 transaction에서
 * survey 행을 먼저 잠가 새 test campaign/recipient 생성과 직렬화해야 한다.
 */
export async function archiveTestWorkspaceMail(
  tx: DbTransaction,
  surveyId: string,
): Promise<void> {
  const discoveredCampaigns = await tx
    .select({ id: mailCampaigns.id })
    .from(mailCampaigns)
    .where(
      and(
        eq(mailCampaigns.surveyId, surveyId),
        eq(mailCampaigns.isTest, true),
      ),
    );
  const campaignIds = discoveredCampaigns.map((row) => row.id).sort();
  if (campaignIds.length === 0) return;

  await lockCampaigns(tx, campaignIds);
  const recipientRefs = await tx
    .select({ contactTargetId: mailRecipients.contactTargetId })
    .from(mailRecipients)
    .where(inArray(mailRecipients.campaignId, campaignIds));
  const targetIds = [...new Set(recipientRefs
    .map((row) => row.contactTargetId)
    .filter((id): id is string => id !== null))].sort();
  if (targetIds.length > 0) {
    await tx
      .select({ id: contactTargets.id })
      .from(contactTargets)
      .where(inArray(contactTargets.id, targetIds))
      .orderBy(asc(contactTargets.id))
      .for('update');
  }

  const affected = await tx
    .select({
      id: mailRecipients.id,
      campaignId: mailRecipients.campaignId,
      status: mailRecipients.status,
    })
    .from(mailRecipients)
    .where(inArray(mailRecipients.campaignId, campaignIds))
    .orderBy(asc(mailRecipients.id))
    .for('update');

  const now = new Date();
  const retained = await archiveLockedRecipients(tx, affected, now);

  await recalculateLockedCampaignCounters(tx, campaignIds);

  const retainedCampaignIds = new Set(retained.map((row) => row.campaignId));
  const hardDeleteCampaignIds = campaignIds.filter((id) => !retainedCampaignIds.has(id));
  const archiveCampaignIds = campaignIds.filter((id) => retainedCampaignIds.has(id));
  if (hardDeleteCampaignIds.length > 0) {
    await tx.delete(mailCampaigns).where(inArray(mailCampaigns.id, hardDeleteCampaignIds));
  }
  if (archiveCampaignIds.length > 0) {
    await tx
      .update(mailCampaigns)
      .set({
        mailTemplateId: null,
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
        archivedAt: now,
        updatedAt: now,
      })
      .where(inArray(mailCampaigns.id, archiveCampaignIds));
  }
}
