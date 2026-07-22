import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { mailRecipients } from '@/db/schema/mail';
import type { MailRecipientStatus } from '@/db/schema/mail';

/**
 * newStatus 기준 역행 가드. webhook(eventType->status)과 reconcile(last_event->status)이
 * 동일한 newStatus에 대해 동일한 allowedPrev를 공유하기 위한 단일 출처.
 */
export const STATUS_ALLOWED_PREV: Partial<Record<MailRecipientStatus, MailRecipientStatus[]>> = {
  sent: ['queued', 'sending'],
  delivered: ['queued', 'sending', 'sent'],
  opened: ['queued', 'sending', 'sent', 'delivered'],
  bounced: ['queued', 'sending', 'sent', 'delivered', 'opened'],
  complained: ['queued', 'sending', 'sent', 'delivered', 'opened'],
  failed: ['queued', 'sending', 'sent'],
};

/** prev -> next 전이가 허용되는지(역행/중복이면 false). */
export function canTransition(
  prev: MailRecipientStatus,
  next: MailRecipientStatus,
): boolean {
  return STATUS_ALLOWED_PREV[next]?.includes(prev) ?? false;
}

/** Resend webhook payload type -> 우리 status. 미매핑(delivery_delayed 등)은 null. */
export function mapResendWebhookType(eventType: string): MailRecipientStatus | null {
  switch (eventType) {
    case 'email.sent':
      return 'sent';
    case 'email.delivered':
      return 'delivered';
    case 'email.opened':
      return 'opened';
    case 'email.bounced':
      return 'bounced';
    case 'email.complained':
      return 'complained';
    default:
      return null;
  }
}

/** Resend GetEmail last_event -> 우리 status. 미전달/대기 상태는 null(변동 없음). */
export function mapResendLastEvent(lastEvent: string): MailRecipientStatus | null {
  switch (lastEvent) {
    case 'sent':
      return 'sent';
    case 'delivered':
      return 'delivered';
    case 'opened':
    case 'clicked':
      return 'opened';
    case 'bounced':
      return 'bounced';
    case 'complained':
      return 'complained';
    case 'failed':
    case 'canceled':
      return 'failed';
    case 'suppressed':
      return 'bounced';
    default:
      // queued, scheduled, delivery_delayed -> 아직 발송 미확정, 변동 없음
      return null;
  }
}

/** status별 타임스탬프 컬럼 채움. */
export function buildTimestampUpdate(
  status: MailRecipientStatus,
  at: Date,
): Partial<typeof mailRecipients.$inferInsert> {
  switch (status) {
    case 'sent':
      return { sentAt: at };
    case 'delivered':
      return { deliveredAt: at };
    case 'opened':
      return { openedAt: at };
    case 'bounced':
      return { bouncedAt: at };
    case 'complained':
      return { complainedAt: at };
    default:
      return {};
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 캠페인이 종료 조건(미발송·발신중 0건)에 도달했으면 status를 finalize한다.
 *   - status='sending' AND queued_count=0 AND sent_count=0 일 때만 동작
 *   - bounced/failed/complained 가 하나라도 있으면 'partial', 아니면 'completed'
 *
 * webhook/reconcile(applyRecipientTransition)뿐 아니라 dispatch에서 전건 failed로
 * 끝난 캠페인(webhook 미도착)도 직접 종결시키기 위한 공용 진입점이다.
 */
export async function finalizeCampaignIfDone(tx: Tx, campaignId: string): Promise<void> {
  await tx.execute(sql`
    UPDATE mail_campaigns
    SET status = CASE
            WHEN bounced_count + failed_count + complained_count > 0 THEN 'partial'
            ELSE 'completed'
          END,
        completed_at = COALESCE(completed_at, now()),
        updated_at = now()
    WHERE id = ${campaignId}
      AND status = 'sending'
      AND archived_at IS NULL
      AND queued_count = 0
      AND sent_count = 0
  `);
}

/**
 * 단일 트랜잭션 안에서 recipient status를 newStatus로 전이하고 campaign 카운터를
 * atomic delta로 갱신한 뒤 finalize를 판정한다. 호출자는 row를 FOR UPDATE로 잠근 뒤
 * prevStatus를 넘겨야 한다. 역행/중복(canTransition=false)이면 no-op하고 false 반환.
 *
 * webhook 핸들러(resend route)와 reconcile이 공유한다.
 */
export async function applyRecipientTransition(
  tx: Tx,
  args: {
    recipientId: string;
    campaignId: string;
    prevStatus: MailRecipientStatus;
    newStatus: MailRecipientStatus;
    eventAt: Date;
    recipientArchivedAt: Date | null;
  },
): Promise<boolean> {
  const {
    recipientId,
    campaignId,
    prevStatus,
    newStatus,
    eventAt,
    recipientArchivedAt,
  } = args;
  if (!canTransition(prevStatus, newStatus)) return false;

  await tx
    .update(mailRecipients)
    .set({
      status: newStatus,
      ...buildTimestampUpdate(newStatus, eventAt),
      ...(prevStatus === 'sending'
        ? {
            sendAttemptedAt: null,
            sendLeaseToken: null,
            sendLeaseExpiresAt: null,
            sendPayloadSnapshot: null,
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(mailRecipients.id, recipientId));

  if (recipientArchivedAt !== null) return true;

  await tx.execute(sql`
    UPDATE mail_campaigns
    SET
      queued_count    = queued_count    - CASE WHEN ${prevStatus} IN ('queued', 'sending') THEN 1 ELSE 0 END,
      sent_count      = sent_count      - CASE WHEN ${prevStatus} = 'sent'      THEN 1 ELSE 0 END
                                        + CASE WHEN ${newStatus} = 'sent'        THEN 1 ELSE 0 END,
      delivered_count = delivered_count - CASE WHEN ${prevStatus} = 'delivered' THEN 1 ELSE 0 END
                                        + CASE WHEN ${newStatus} = 'delivered'   THEN 1 ELSE 0 END,
      opened_count     = opened_count     + CASE WHEN ${newStatus} = 'opened'     THEN 1 ELSE 0 END,
      bounced_count    = bounced_count    + CASE WHEN ${newStatus} = 'bounced'    THEN 1 ELSE 0 END,
      complained_count = complained_count + CASE WHEN ${newStatus} = 'complained' THEN 1 ELSE 0 END,
      failed_count     = failed_count     + CASE WHEN ${newStatus} = 'failed'     THEN 1 ELSE 0 END,
      updated_at = now()
    WHERE id = ${campaignId}
  `);

  await finalizeCampaignIfDone(tx, campaignId);

  return true;
}
