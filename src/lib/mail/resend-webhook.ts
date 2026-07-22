import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { mailCampaigns, mailRecipients, webhookEvents } from '@/db/schema/mail';
import type { MailRecipientStatus } from '@/db/schema/mail';
import {
  applyRecipientTransition,
  mapResendWebhookType,
} from '@/lib/mail/recipient-status-transition';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function applyResendEvent(
  tx: Tx,
  resendMessageId: string,
  eventType: string,
  createdAtRaw: string,
  tags?: Record<string, string>,
): Promise<void> {
  const newStatus = mapResendWebhookType(eventType);
  if (!newStatus) return;

  const eventAt = new Date(createdAtRaw);
  if (Number.isNaN(eventAt.getTime())) eventAt.setTime(Date.now());

  const rows = await tx
    .select({
      id: mailRecipients.id,
      campaignId: mailRecipients.campaignId,
      resendMessageId: mailRecipients.resendMessageId,
    })
    .from(mailRecipients)
    .where(eq(mailRecipients.resendMessageId, resendMessageId));
  let candidate = rows[0];
  if (!candidate && tags?.['recipient_id'] && tags['campaign_id']) {
    const taggedRows = await tx
      .select({
        id: mailRecipients.id,
        campaignId: mailRecipients.campaignId,
        resendMessageId: mailRecipients.resendMessageId,
      })
      .from(mailRecipients)
      .where(
        and(
          eq(mailRecipients.id, tags['recipient_id']),
          eq(mailRecipients.campaignId, tags['campaign_id']),
        ),
      );
    candidate = taggedRows[0];
  }
  if (!candidate) return;

  const [campaign] = await tx
    .select({ id: mailCampaigns.id })
    .from(mailCampaigns)
    .where(eq(mailCampaigns.id, candidate.campaignId))
    .for('update');
  if (!campaign) return;

  const [row] = await tx
    .select({
      id: mailRecipients.id,
      campaignId: mailRecipients.campaignId,
      status: mailRecipients.status,
      archivedAt: mailRecipients.archivedAt,
      resendMessageId: mailRecipients.resendMessageId,
    })
    .from(mailRecipients)
    .where(eq(mailRecipients.id, candidate.id))
    .for('update');
  if (!row || row.campaignId !== candidate.campaignId) return;

  if (row.resendMessageId !== resendMessageId) {
    if (row.resendMessageId !== null || row.status !== 'sending') return;
    await tx
      .update(mailRecipients)
      .set({ resendMessageId, updatedAt: new Date() })
      .where(
        and(
          eq(mailRecipients.id, row.id),
          isNull(mailRecipients.resendMessageId),
        ),
      );
  }

  await applyRecipientTransition(tx, {
    recipientId: row.id,
    campaignId: row.campaignId,
    prevStatus: row.status as MailRecipientStatus,
    newStatus,
    eventAt,
    recipientArchivedAt: row.archivedAt,
  });
}

/** 검증된 Resend 이벤트를 recipient 상태와 campaign 집계에 반영한다. */
export async function processResendEvent(
  resendMessageId: string,
  eventType: string,
  createdAtRaw: string,
  tags?: Record<string, string>,
): Promise<void> {
  await db.transaction((tx) => (
    applyResendEvent(tx, resendMessageId, eventType, createdAtRaw, tags)
  ));
}

export interface VerifiedResendWebhookEvent {
  id: string;
  type: string;
  createdAt: string;
  resendMessageId?: string;
  tags?: Record<string, string>;
}

/**
 * webhook dedupe 기록과 recipient 전이를 한 transaction으로 커밋한다.
 * 전이 실패 시 dedupe insert도 rollback되어 provider retry가 이벤트를 다시 처리할 수 있다.
 */
export async function processResendWebhookEvent(
  event: VerifiedResendWebhookEvent,
): Promise<'processed' | 'deduped' | 'ignored'> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(webhookEvents)
      .values({ id: event.id, source: 'resend', eventType: event.type })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id });
    if (inserted.length === 0) return 'deduped';
    if (!event.resendMessageId || !mapResendWebhookType(event.type)) return 'ignored';

    await applyResendEvent(
      tx,
      event.resendMessageId,
      event.type,
      event.createdAt,
      event.tags,
    );
    return 'processed';
  });
}
