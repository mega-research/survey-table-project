import * as Sentry from '@sentry/nextjs';
import { and, eq, isNull } from 'drizzle-orm';
import 'server-only';

import { type DbTransaction as Tx, db } from '@/db';
import { mailCampaigns, mailRecipients, webhookEvents } from '@/db/schema/mail';
import { logger } from '@/lib/logger';
import { hasReplyForwardTag, isReplyForwardDeliveryFailure } from '../domain/reply-forward';
import { hasReplyRelayTag } from '../domain/reply-relay';
import { requestRecipientFallbacks } from './campaign-fallback';
import {
  applyRecipientTransition,
  mapResendWebhookType,
  triggersFallback,
} from './recipient-status-transition';
import type { MailRecipientStatus } from '@/shared/contracts/mail';

async function applyResendEvent(
  tx: Tx,
  resendMessageId: string,
  eventType: string,
  createdAtRaw: string,
  tags?: Record<string, string>,
): Promise<string | null> {
  const newStatus = mapResendWebhookType(eventType);
  if (!newStatus) return null;
  // 전달 메일(회신 전달)과 중계 메일(답장 중계)은 수신자 기록이 없는 메일이다 — 수신자 상태·발송 회차 집계를 건드리지 않는다.
  if (hasReplyForwardTag(tags) || hasReplyRelayTag(tags)) return null;

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
  if (!candidate) return null;

  const [campaign] = await tx
    .select({ id: mailCampaigns.id })
    .from(mailCampaigns)
    .where(eq(mailCampaigns.id, candidate.campaignId))
    .for('update');
  if (!campaign) return null;

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
  if (!row || row.campaignId !== candidate.campaignId) return null;

  if (row.resendMessageId !== resendMessageId) {
    if (row.resendMessageId !== null || row.status !== 'sending') return null;
    await tx
      .update(mailRecipients)
      .set({ resendMessageId, updatedAt: new Date() })
      .where(and(eq(mailRecipients.id, row.id), isNull(mailRecipients.resendMessageId)));
  }

  const applied = await applyRecipientTransition(tx, {
    recipientId: row.id,
    campaignId: row.campaignId,
    prevStatus: row.status as MailRecipientStatus,
    newStatus,
    eventAt,
    recipientArchivedAt: row.archivedAt,
  });
  // 반송·실패로 바뀐 수신자 — 커밋 뒤 다음 순위 주소로 대체 발송을 건다.
  return applied && triggersFallback(newStatus) ? row.id : null;
}

/** 검증된 Resend 이벤트를 recipient 상태와 campaign 집계에 반영한다. */
export async function processResendEvent(
  resendMessageId: string,
  eventType: string,
  createdAtRaw: string,
  tags?: Record<string, string>,
): Promise<void> {
  const fallbackRecipientId = await db.transaction((tx) =>
    applyResendEvent(tx, resendMessageId, eventType, createdAtRaw, tags),
  );
  if (fallbackRecipientId) await requestRecipientFallbacks([fallbackRecipientId]);
}

export interface VerifiedResendWebhookEvent {
  id: string;
  type: string;
  createdAt: string;
  resendMessageId?: string;
  tags?: Record<string, string>;
}

/**
 * 전달 메일(회신 전달)이 회신 주소에 닿지 못했다 — 회신 주소 오타·메일함 폐쇄·수신 거부 목록·스팸 신고
 * (`isReplyForwardDeliveryFailure`). 알림 종류는 태그 `eventType` 으로 갈린다.
 * 수신자 기록이 없어 화면 어디에도 드러나지 않으므로 Sentry 경고로 알린다. 주소·제목은 싣지 않는다(식별자만).
 */
function reportReplyForwardDeliveryFailure(event: VerifiedResendWebhookEvent): void {
  logger.warn(
    { resendMessageId: event.resendMessageId, eventType: event.type },
    '[reply-forward] 전달 메일 반송·실패',
  );
  Sentry.captureMessage('회신 전달 메일 반송·실패', {
    level: 'warning',
    tags: { operation: 'reply_forward_bounce', eventType: event.type },
    extra: { messageId: event.resendMessageId, svixId: event.id },
  });
}

/**
 * 중계 메일(답장 중계)이 응답자에게 닿지 못했다 — 응답자 주소가 죽었거나 수신 거부 목록에 있거나 스팸으로 신고됐다.
 * 담당자는 답장이 갔다고 믿는다. 화면 어디에도 드러나지 않으므로 Sentry 경고로 알린다(회신 전달의 경고와 문구·태그가 갈린다).
 * 주소·제목은 싣지 않는다(식별자만).
 */
function reportReplyRelayDeliveryFailure(event: VerifiedResendWebhookEvent): void {
  logger.warn(
    { resendMessageId: event.resendMessageId, eventType: event.type },
    '[reply-relay] 중계 메일 반송·실패',
  );
  Sentry.captureMessage('답장 중계 메일 반송·실패', {
    level: 'warning',
    tags: { operation: 'reply_relay_bounce', kind: 'reply-relay', eventType: event.type },
    extra: { messageId: event.resendMessageId, svixId: event.id },
  });
}

/**
 * webhook dedupe 기록과 recipient 전이를 한 transaction으로 커밋한다.
 * 전이 실패 시 dedupe insert도 rollback되어 provider retry가 이벤트를 다시 처리할 수 있다.
 *
 * 전달 메일(`kind=reply-forward` 태그)과 중계 메일(`kind=reply-relay` 태그)의 상태 알림은 장부에만 적고 전이하지 않는다.
 * 그 가운데 닿지 못했다는 알림(반송·실패·보내지 않음·스팸 신고)은 커밋 뒤 Sentry 경고를 낸다 — 수신자 전이로 옮길 수
 * 없는 종류(`email.failed`·`email.suppressed`)도 낸다. 장부에 적힌 알림이 다시 오면 경고도 다시 내지 않는다.
 */
export async function processResendWebhookEvent(
  event: VerifiedResendWebhookEvent,
): Promise<'processed' | 'deduped' | 'ignored'> {
  const outcome = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(webhookEvents)
      .values({ id: event.id, source: 'resend', eventType: event.type })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id });
    if (inserted.length === 0) return { result: 'deduped' as const, fallbackRecipientId: null };
    if (!event.resendMessageId || !mapResendWebhookType(event.type)) {
      return { result: 'ignored' as const, fallbackRecipientId: null };
    }

    const fallbackRecipientId = await applyResendEvent(
      tx,
      event.resendMessageId,
      event.type,
      event.createdAt,
      event.tags,
    );
    return { result: 'processed' as const, fallbackRecipientId };
  });
  if (outcome.result !== 'deduped' && isReplyForwardDeliveryFailure(event.type)) {
    if (hasReplyForwardTag(event.tags)) reportReplyForwardDeliveryFailure(event);
    else if (hasReplyRelayTag(event.tags)) reportReplyRelayDeliveryFailure(event);
  }
  if (outcome.fallbackRecipientId) await requestRecipientFallbacks([outcome.fallbackRecipientId]);
  return outcome.result;
}
