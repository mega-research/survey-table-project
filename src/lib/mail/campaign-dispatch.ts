import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { createElement } from 'react';

import { render } from '@react-email/render';
import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets } from '@/db/schema/contacts';
import { mailCampaigns, mailRecipients } from '@/db/schema/mail';
import type { MailRecipientSendPayloadSnapshot } from '@/db/schema/schema-types';
import { buildInviteUrl } from '@/lib/survey-url';
import { createCampaignProviderRateLimiter } from '@/lib/mail/campaign-send-rate-limit';
import { finalizeCampaignIfDone } from '@/lib/mail/recipient-status-transition';
import { renderForCampaignSend } from '@/lib/mail/render-for-send';
import {
  RetryableCampaignSendError,
  resolveCampaignAttachments,
  sendCampaignRecipient,
  type ResolvedBulkAttachment,
} from '@/lib/mail/send-bulk';
import { MailWrapper } from '@/lib/mail/template-wrapper';
import { UNSUBSCRIBE_SANDBOX_TOKEN } from '@/lib/mail/constants';

type CampaignDispatchState = Pick<
  typeof mailCampaigns.$inferSelect,
  'status' | 'archivedAt'
>;

const DELIVERY_LEASE_MS = 30_000;
const DELIVERY_LEASE_POLL_MS = 50;
export const IDEMPOTENCY_RECOVERY_WINDOW_MS = 23 * 60 * 60 * 1_000;

function activeRecipientErrorReason(errorReason: string | null) {
  return sql<string | null>`CASE
    WHEN ${mailRecipients.archivedAt} IS NULL THEN ${errorReason}
    ELSE NULL
  END`;
}

export interface DispatchChunkResult {
  sent: number;
  failed: number;
  cancelled?: true;
}

export interface DispatchCleanupResult {
  terminalized: number;
  busyUntil: string | null;
}

function canDispatchCampaign(campaign: CampaignDispatchState): boolean {
  return campaign.archivedAt === null
    && (campaign.status === 'queued' || campaign.status === 'sending');
}

function recipientIdempotencyKey(campaignId: string, recipientId: string): string {
  return `campaign/${campaignId}/recipient/${recipientId}`;
}

function snapshotResolvedAttachments(
  attachments: ResolvedBulkAttachment[] | undefined,
): MailRecipientSendPayloadSnapshot['attachments'] {
  return (attachments ?? []).map((attachment) => ({
    filename: attachment.filename,
    ...(attachment.contentType !== undefined
      ? { contentType: attachment.contentType }
      : {}),
    sha256: createHash('sha256')
      .update(attachment.content.toString('base64'), 'base64')
      .digest('hex'),
  }));
}

function attachmentsMatchSnapshot(
  expected: MailRecipientSendPayloadSnapshot['attachments'],
  attachments: ResolvedBulkAttachment[] | undefined,
): boolean {
  return JSON.stringify(expected) === JSON.stringify(snapshotResolvedAttachments(attachments));
}

type DeliveryClaim =
  | {
      kind: 'claimed';
      leaseToken: string;
      payload: MailRecipientSendPayloadSnapshot;
    }
  | { kind: 'busy'; retryAt: Date }
  | { kind: 'payload_missing' }
  | { kind: 'recovery_blocked' }
  | { kind: 'skipped' }
  | { kind: 'terminalized' }
  | { kind: 'unavailable' }
  | { kind: 'cancelled' };

async function claimRecipientDelivery(
  campaignId: string,
  recipientId: string,
  now: Date,
  proposedPayload: MailRecipientSendPayloadSnapshot | null,
): Promise<DeliveryClaim> {
  const leaseToken = randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + DELIVERY_LEASE_MS);

  return db.transaction(async (tx) => {
    // 잠금 순서는 campaign → contact → recipient로 통일한다. recipient의 contact FK는
    // 먼저 non-locking read로 찾고, 실제 claim 직전에 잠근 recipient 값과 다시 대조한다.
    const [recipientRef] = await tx
      .select({ id: mailRecipients.id, contactTargetId: mailRecipients.contactTargetId })
      .from(mailRecipients)
      .where(
        and(
          eq(mailRecipients.id, recipientId),
          eq(mailRecipients.campaignId, campaignId),
        ),
      );
    if (!recipientRef) return { kind: 'unavailable' };

    const [campaign] = await tx
      .select({ status: mailCampaigns.status, archivedAt: mailCampaigns.archivedAt })
      .from(mailCampaigns)
      .where(eq(mailCampaigns.id, campaignId))
      .for('update');
    if (!campaign || !canDispatchCampaign(campaign)) return { kind: 'cancelled' };

    const [lockedContact] = recipientRef.contactTargetId === null
      ? []
      : await tx
          .select({
            id: contactTargets.id,
            unsubscribedAt: contactTargets.unsubscribedAt,
          })
          .from(contactTargets)
          .where(eq(contactTargets.id, recipientRef.contactTargetId))
          .for('share');

    const [recipient] = await tx
      .select({
        id: mailRecipients.id,
        status: mailRecipients.status,
        archivedAt: mailRecipients.archivedAt,
        emailSnapshot: mailRecipients.emailSnapshot,
        resendMessageId: mailRecipients.resendMessageId,
        sendAttemptedAt: mailRecipients.sendAttemptedAt,
        sendLeaseExpiresAt: mailRecipients.sendLeaseExpiresAt,
        sendPayloadSnapshot: mailRecipients.sendPayloadSnapshot,
        contactTargetId: mailRecipients.contactTargetId,
      })
      .from(mailRecipients)
      .where(
        and(
          eq(mailRecipients.id, recipientId),
          eq(mailRecipients.campaignId, campaignId),
        ),
      )
      .for('update');
    if (!recipient || recipient.resendMessageId !== null) return { kind: 'unavailable' };

    const finishWithoutSend = async (
      status: 'failed' | 'skipped_unsubscribed',
      errorReason: string | null,
    ): Promise<DeliveryClaim> => {
      const expired = await tx
        .update(mailRecipients)
        .set({
          status,
          errorReason: activeRecipientErrorReason(errorReason),
          sendAttemptedAt: null,
          sendLeaseToken: null,
          sendLeaseExpiresAt: null,
          sendPayloadSnapshot: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(mailRecipients.id, recipientId),
            eq(mailRecipients.status, recipient.status),
            isNull(mailRecipients.resendMessageId),
          ),
        )
        .returning({ id: mailRecipients.id, archivedAt: mailRecipients.archivedAt });
      const terminalized = expired[0];
      if (!terminalized) return { kind: 'unavailable' };

      if (terminalized.archivedAt === null) {
        await tx
          .update(mailCampaigns)
          .set(status === 'failed'
            ? {
                queuedCount: sql`${mailCampaigns.queuedCount} - 1`,
                failedCount: sql`${mailCampaigns.failedCount} + 1`,
                updatedAt: now,
              }
            : {
                queuedCount: sql`${mailCampaigns.queuedCount} - 1`,
                skippedUnsubscribedCount:
                  sql`${mailCampaigns.skippedUnsubscribedCount} + 1`,
                updatedAt: now,
              })
          .where(eq(mailCampaigns.id, campaignId));
        await finalizeCampaignIfDone(tx, campaignId);
      }
      return { kind: status === 'failed' ? 'terminalized' : 'skipped' };
    };

    const currentContact = recipient.contactTargetId !== null
      && recipient.contactTargetId === lockedContact?.id
      ? lockedContact
      : null;

    let sendAttemptedAt = recipient.sendAttemptedAt;
    let sendPayloadSnapshot = recipient.sendPayloadSnapshot;
    if (recipient.status === 'queued') {
      if (recipient.archivedAt !== null) {
        return { kind: 'unavailable' };
      }
      if (!currentContact) {
        return finishWithoutSend('failed', '발송 대상 contact가 삭제되었습니다.');
      }
      if (currentContact.unsubscribedAt !== null) {
        return finishWithoutSend('skipped_unsubscribed', null);
      }
      if (proposedPayload === null) {
        return finishWithoutSend('failed', '발송에 필요한 recipient snapshot이 없습니다.');
      }
      sendAttemptedAt = now;
      sendPayloadSnapshot = proposedPayload;
    } else if (recipient.status === 'sending') {
      if (recipient.sendLeaseExpiresAt && recipient.sendLeaseExpiresAt > now) {
        return { kind: 'busy', retryAt: recipient.sendLeaseExpiresAt };
      }
      const recoveryExpired = sendAttemptedAt === null
        || now.getTime() - sendAttemptedAt.getTime() >= IDEMPOTENCY_RECOVERY_WINDOW_MS;
      if (recoveryExpired) {
        return finishWithoutSend('failed', '발송 복구 가능 시간이 만료되었습니다.');
      }
      if (sendPayloadSnapshot === null) {
        return { kind: 'payload_missing' };
      }
      if (!currentContact || currentContact.unsubscribedAt !== null) {
        return { kind: 'recovery_blocked' };
      }
    } else {
      return { kind: 'unavailable' };
    }

    if (sendPayloadSnapshot === null) return { kind: 'unavailable' };

    const claimed = await tx
      .update(mailRecipients)
      .set({
        status: 'sending',
        sendAttemptedAt,
        sendLeaseToken: leaseToken,
        sendLeaseExpiresAt: leaseExpiresAt,
        sendPayloadSnapshot,
        updatedAt: now,
      })
      .where(
        and(
          eq(mailRecipients.id, recipientId),
          eq(mailRecipients.status, recipient.status),
          isNull(mailRecipients.resendMessageId),
        ),
      )
      .returning({ id: mailRecipients.id });

    return claimed.length > 0
      ? { kind: 'claimed', leaseToken, payload: sendPayloadSnapshot }
      : { kind: 'unavailable' };
  });
}

async function claimRecipientDeliveryWithWait(
  campaignId: string,
  recipientId: string,
  proposedPayload: MailRecipientSendPayloadSnapshot | null,
): Promise<DeliveryClaim> {
  let claim = await claimRecipientDelivery(
    campaignId,
    recipientId,
    new Date(),
    proposedPayload,
  );
  if (claim.kind !== 'busy') return claim;

  const deadline = Math.min(
    claim.retryAt.getTime() + 1,
    Date.now() + DELIVERY_LEASE_MS + 1,
  );
  while (claim.kind === 'busy' && Date.now() < deadline) {
    const waitMs = Math.min(DELIVERY_LEASE_POLL_MS, deadline - Date.now());
    await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    claim = await claimRecipientDelivery(
      campaignId,
      recipientId,
      new Date(),
      proposedPayload,
    );
  }
  if (claim.kind === 'busy') {
    throw new RetryableCampaignSendError('recipient 발송 lease가 아직 사용 중입니다.');
  }
  return claim;
}

async function releaseRecipientLease(
  recipientId: string,
  leaseToken: string,
): Promise<void> {
  await db
    .update(mailRecipients)
    .set({ sendLeaseToken: null, sendLeaseExpiresAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(mailRecipients.id, recipientId),
        eq(mailRecipients.status, 'sending'),
        eq(mailRecipients.sendLeaseToken, leaseToken),
      ),
    );
}

async function settleClaimedRecipient(
  campaignId: string,
  recipientId: string,
  leaseToken: string,
  result:
    | { kind: 'accepted'; resendMessageId: string }
    | { kind: 'permanent_failure'; errorReason: string },
): Promise<boolean> {
  const now = new Date();
  return db.transaction(async (tx) => {
    const [campaign] = await tx
      .select({ id: mailCampaigns.id })
      .from(mailCampaigns)
      .where(eq(mailCampaigns.id, campaignId))
      .for('update');
    if (!campaign) return false;

    const updated = await tx
      .update(mailRecipients)
      .set(result.kind === 'accepted'
        ? {
            status: 'sent',
            resendMessageId: result.resendMessageId,
            sentAt: now,
            errorReason: null,
            sendAttemptedAt: null,
            sendLeaseToken: null,
            sendLeaseExpiresAt: null,
            sendPayloadSnapshot: null,
            updatedAt: now,
          }
        : {
            status: 'failed',
            errorReason: activeRecipientErrorReason(result.errorReason),
            sendAttemptedAt: null,
            sendLeaseToken: null,
            sendLeaseExpiresAt: null,
            sendPayloadSnapshot: null,
            updatedAt: now,
          })
      .where(
        and(
          eq(mailRecipients.id, recipientId),
          eq(mailRecipients.status, 'sending'),
          eq(mailRecipients.sendLeaseToken, leaseToken),
        ),
      )
      .returning({ id: mailRecipients.id, archivedAt: mailRecipients.archivedAt });
    const settled = updated[0];
    if (!settled) return false;

    if (settled.archivedAt === null) {
      await tx
        .update(mailCampaigns)
        .set(result.kind === 'accepted'
          ? {
              queuedCount: sql`${mailCampaigns.queuedCount} - 1`,
              sentCount: sql`${mailCampaigns.sentCount} + 1`,
              updatedAt: now,
            }
          : {
              queuedCount: sql`${mailCampaigns.queuedCount} - 1`,
              failedCount: sql`${mailCampaigns.failedCount} + 1`,
              updatedAt: now,
            })
        .where(eq(mailCampaigns.id, campaignId));
    }
    return true;
  });
}

/**
 * Inngest의 최종 retry까지 소진된 뒤 남은 미확정 recipient를 종결한다.
 * 외부 호출 중인 lease는 잠금이 끝날 때까지 건드리지 않고 재호출 시각을 반환한다.
 */
export async function terminalizeUnresolvedCampaignDispatch(
  campaignId: string,
  now = new Date(),
): Promise<DispatchCleanupResult> {
  return db.transaction(async (tx) => {
    const [campaign] = await tx
      .select({ status: mailCampaigns.status, archivedAt: mailCampaigns.archivedAt })
      .from(mailCampaigns)
      .where(eq(mailCampaigns.id, campaignId))
      .for('update');
    if (!campaign) {
      return { terminalized: 0, busyUntil: null };
    }
    const campaignIsActive = canDispatchCampaign(campaign);

    const unresolved = await tx
      .select({
        id: mailRecipients.id,
        status: mailRecipients.status,
        archivedAt: mailRecipients.archivedAt,
        resendMessageId: mailRecipients.resendMessageId,
        sendLeaseExpiresAt: mailRecipients.sendLeaseExpiresAt,
      })
      .from(mailRecipients)
      .where(
        and(
          eq(mailRecipients.campaignId, campaignId),
          campaignIsActive
            ? or(
                eq(mailRecipients.status, 'queued'),
                eq(mailRecipients.status, 'sending'),
              )
            : eq(mailRecipients.status, 'sending'),
        ),
      )
      .for('update');

    const busyRows = unresolved.filter(
      (row) => row.status === 'sending'
        && row.sendLeaseExpiresAt !== null
        && row.sendLeaseExpiresAt > now,
    );
    const busyIds = new Set(busyRows.map((row) => row.id));
    const terminalizableRows = unresolved.filter((row) => !busyIds.has(row.id));
    const acceptedIds = terminalizableRows
      .filter((row) => row.status === 'sending' && row.resendMessageId !== null)
      .map((row) => row.id);
    const failedIds = terminalizableRows
      .filter((row) => row.resendMessageId === null)
      .map((row) => row.id);

    let failedRows: Array<{ id: string; archivedAt: Date | null }> = [];
    if (failedIds.length > 0) {
      failedRows = await tx
        .update(mailRecipients)
        .set({
          status: 'failed',
          errorReason: activeRecipientErrorReason(
            '발송 작업의 최종 재시도까지 실패했습니다.',
          ),
          sendAttemptedAt: null,
          sendLeaseToken: null,
          sendLeaseExpiresAt: null,
          sendPayloadSnapshot: null,
          updatedAt: now,
        })
        .where(
          and(
            inArray(mailRecipients.id, failedIds),
            isNull(mailRecipients.resendMessageId),
          ),
        )
        .returning({ id: mailRecipients.id, archivedAt: mailRecipients.archivedAt });

      const activeFailedCount = campaignIsActive
        ? failedRows.filter((row) => row.archivedAt === null).length
        : 0;
      if (activeFailedCount > 0) {
        await tx
          .update(mailCampaigns)
          .set({
            queuedCount: sql`${mailCampaigns.queuedCount} - ${activeFailedCount}`,
            failedCount: sql`${mailCampaigns.failedCount} + ${activeFailedCount}`,
            updatedAt: now,
          })
          .where(eq(mailCampaigns.id, campaignId));
      }
    }

    let acceptedRows: Array<{ id: string; archivedAt: Date | null }> = [];
    if (acceptedIds.length > 0) {
      acceptedRows = await tx
        .update(mailRecipients)
        .set({
          status: 'sent',
          sentAt: now,
          errorReason: null,
          sendAttemptedAt: null,
          sendLeaseToken: null,
          sendLeaseExpiresAt: null,
          sendPayloadSnapshot: null,
          updatedAt: now,
        })
        .where(
          and(
            inArray(mailRecipients.id, acceptedIds),
            eq(mailRecipients.status, 'sending'),
            isNotNull(mailRecipients.resendMessageId),
          ),
        )
        .returning({ id: mailRecipients.id, archivedAt: mailRecipients.archivedAt });

      const activeAcceptedCount = campaignIsActive
        ? acceptedRows.filter((row) => row.archivedAt === null).length
        : 0;
      if (activeAcceptedCount > 0) {
        await tx
          .update(mailCampaigns)
          .set({
            queuedCount: sql`${mailCampaigns.queuedCount} - ${activeAcceptedCount}`,
            sentCount: sql`${mailCampaigns.sentCount} + ${activeAcceptedCount}`,
            updatedAt: now,
          })
          .where(eq(mailCampaigns.id, campaignId));
      }
    }

    if (campaignIsActive) {
      await finalizeCampaignIfDone(tx, campaignId);
    }

    const busyUntilDate = busyRows.reduce<Date | null>((latest, row) => {
      if (!row.sendLeaseExpiresAt) return latest;
      return latest === null || row.sendLeaseExpiresAt > latest
        ? row.sendLeaseExpiresAt
        : latest;
    }, null);
    return {
      terminalized: failedRows.length + acceptedRows.length,
      busyUntil: busyUntilDate?.toISOString() ?? null,
    };
  });
}

/**
 * Inngest dispatcher 의 'prepare' step.
 *   - campaign 검증 (queued/sending + non-archived만 허용)
 *   - status='sending' + started_at 마킹 (이미 sending 이면 변동 없음)
 *   - queued 또는 복구 가능한 sending recipient id 목록 반환
 *
 * Inngest step output 으로 직렬화되므로 recipientIds 만 반환 (Buffer 등 무거운 객체 X).
 */
export async function prepareCampaignDispatch(
  campaignId: string,
): Promise<{ recipientIds: string[]; requiresCleanup?: true } | null> {
  return db.transaction(async (tx) => {
    // prepare의 상태 판정과 활성화를 같은 campaign 행 잠금 아래 수행한다. 이 잠금은
    // cancel/archive와 경합할 때 오래된 active 판정으로 recipient를 반환하지 않게 한다.
    const [campaign] = await tx
      .select()
      .from(mailCampaigns)
      .where(eq(mailCampaigns.id, campaignId))
      .for('update');
    if (!campaign) return null;
    if (!canDispatchCampaign(campaign)) {
      const ambiguous = await tx
        .select({ id: mailRecipients.id })
        .from(mailRecipients)
        .where(
          and(
            eq(mailRecipients.campaignId, campaignId),
            eq(mailRecipients.status, 'sending'),
          ),
        );
      return ambiguous.length > 0
        ? { recipientIds: [], requiresCleanup: true }
        : null;
    }

    const activated = await tx
      .update(mailCampaigns)
      .set({
        status: 'sending',
        startedAt: campaign.startedAt ?? new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(mailCampaigns.id, campaignId),
          isNull(mailCampaigns.archivedAt),
          or(eq(mailCampaigns.status, 'queued'), eq(mailCampaigns.status, 'sending')),
        ),
      )
      .returning({ id: mailCampaigns.id });
    if (activated.length === 0) return null;

    const dispatchable = await tx
      .select({ id: mailRecipients.id })
      .from(mailRecipients)
      .where(
        and(
          eq(mailRecipients.campaignId, campaignId),
          or(
            and(
              eq(mailRecipients.status, 'queued'),
              isNull(mailRecipients.archivedAt),
            ),
            and(
              eq(mailRecipients.status, 'sending'),
              isNull(mailRecipients.resendMessageId),
            ),
          ),
        ),
      );

    if (dispatchable.length === 0) {
      await finalizeCampaignIfDone(tx, campaignId);
    }

    return { recipientIds: dispatchable.map((r) => r.id) };
  });
}

/**
 * Inngest dispatcher 의 'send-chunk' step. 청크 1개 처리:
 *   1. campaign + recipients + contact_targets 페치
 *   2. 첨부 R2 다운로드 (있으면 — 청크당 1회)
 *   3. recipient 별 html 빌드 (renderForCampaignSend → MailWrapper)
 *   4. campaign 재확인 + recipient별 durable lease 원자 인수
 *   5. 인수된 recipient만 안정 idempotency key로 단건 발송
 *   6. 결과별 mail_recipients UPDATE + mail_campaigns 카운터 atomic delta
 */
export async function dispatchCampaignChunk(
  campaignId: string,
  recipientIds: string[],
): Promise<DispatchChunkResult> {
  const [campaign] = await db.select().from(mailCampaigns).where(eq(mailCampaigns.id, campaignId));
  if (!campaign || !canDispatchCampaign(campaign)) {
    return { sent: 0, failed: 0, cancelled: true };
  }

  const baseUrl = (process.env['NEXT_PUBLIC_APP_URL'] ?? '').replace(/\/+$/, '');
  const fromDomain = process.env['RESEND_FROM_DOMAIN'];

  // recipient를 기준으로 contact_targets를 LEFT JOIN한다. contact가 삭제된 queued row도
  // 누락시키지 않고 failed로 종결하며, sending retry는 최초 claim 때 저장한 payload를 쓴다.
  const rows = await db
    .select({
      recipientId: mailRecipients.id,
      emailSnapshot: mailRecipients.emailSnapshot,
      contactTargetId: contactTargets.id,
      inviteCode: contactTargets.inviteCode,
      unsubscribeToken: contactTargets.unsubscribeToken,
      attrs: contactTargets.attrs,
      unsubscribedAt: contactTargets.unsubscribedAt,
      status: mailRecipients.status,
      archivedAt: mailRecipients.archivedAt,
      resendMessageId: mailRecipients.resendMessageId,
      sendAttemptedAt: mailRecipients.sendAttemptedAt,
      sendLeaseToken: mailRecipients.sendLeaseToken,
      sendLeaseExpiresAt: mailRecipients.sendLeaseExpiresAt,
      sendPayloadSnapshot: mailRecipients.sendPayloadSnapshot,
    })
    .from(mailRecipients)
    .leftJoin(contactTargets, eq(mailRecipients.contactTargetId, contactTargets.id))
    .where(
      and(
        eq(mailRecipients.campaignId, campaignId),
        inArray(mailRecipients.id, recipientIds),
        or(
          and(
            eq(mailRecipients.status, 'queued'),
            isNull(mailRecipients.archivedAt),
          ),
          and(
            eq(mailRecipients.status, 'sending'),
            isNull(mailRecipients.resendMessageId),
          ),
        ),
      ),
    );

  if (rows.length === 0) {
    await db.transaction((tx) => finalizeCampaignIfDone(tx, campaignId));
    return { sent: 0, failed: 0 };
  }

  // 이 조회 결과는 렌더링 최적화용 snapshot일 뿐 발송 적격성의 근거가 아니다.
  // 수신거부/삭제와 campaign 활성 여부는 campaign → contact → recipient 잠금 순서를
  // 따르는 claimRecipientDelivery 트랜잭션에서 다시 판정하고 카운터까지 함께 반영한다.
  const activeRows = rows;

  const attachments =
    campaign.attachmentsSnapshot.length > 0
      ? await resolveCampaignAttachments(campaign.attachmentsSnapshot)
      : undefined;

  const from = fromDomain
    ? `${campaign.fromNameSnapshot} <${campaign.fromLocalSnapshot}@${fromDomain}>`
    : null;
  const replyTo =
    campaign.replyToSnapshot
    ?? (fromDomain ? `${campaign.fromLocalSnapshot}@${fromDomain}` : null);

  const proposedSends = await Promise.all(
    activeRows.map(async (row): Promise<{
      recipientId: string;
      payload: MailRecipientSendPayloadSnapshot | null;
    }> => {
      if (row.sendPayloadSnapshot !== null) {
        return { recipientId: row.recipientId, payload: row.sendPayloadSnapshot };
      }
      if (row.status === 'queued' && row.unsubscribedAt !== null) {
        return { recipientId: row.recipientId, payload: null };
      }
      if (!baseUrl) throw new Error('NEXT_PUBLIC_APP_URL 환경변수가 설정되지 않았습니다.');
      if (!from || !replyTo) {
        throw new Error('RESEND_FROM_DOMAIN 환경변수가 설정되지 않았습니다.');
      }
      if (
        row.contactTargetId === null
        || row.emailSnapshot === null
        || row.inviteCode === null
        || row.attrs === null
        || (!campaign.isTest && row.unsubscribeToken === null)
      ) {
        return { recipientId: row.recipientId, payload: null };
      }

      const inviteUrl = buildInviteUrl(row.inviteCode, baseUrl);
      const unsubscribeToken = campaign.isTest
        ? UNSUBSCRIBE_SANDBOX_TOKEN
        : row.unsubscribeToken;
      const unsubscribeUrl = `${baseUrl}/unsubscribe/${unsubscribeToken}`;

      const rendered = renderForCampaignSend({
        subject: campaign.subjectSnapshot,
        bodyHtml: campaign.bodyHtmlSnapshot,
        fromName: campaign.fromNameSnapshot,
        contactAttrs: row.attrs,
        contactEmail: row.emailSnapshot,
        inviteUrl,
      });

      const html = await render(
        createElement(MailWrapper, {
          bodyHtml: rendered.bodyHtml,
          previewText: rendered.subject,
          unsubscribeUrl,
          testFooterKind: campaign.isTest ? 'campaign' : null,
        }),
      );

      return {
        recipientId: row.recipientId,
        payload: {
          from,
          replyTo,
          to: row.emailSnapshot,
          subject: rendered.subject,
          html,
          attachments: snapshotResolvedAttachments(attachments),
        },
      };
    }),
  );

  let sent = 0;
  let failed = 0;
  const providerRateLimiter = createCampaignProviderRateLimiter();

  // recipient마다 lease를 인수한 직후 고정 idempotency key로 단건 발송한다.
  for (const proposed of proposedSends) {
    const claim = await claimRecipientDeliveryWithWait(
      campaignId,
      proposed.recipientId,
      proposed.payload,
    );
    if (claim.kind === 'cancelled') return { sent, failed, cancelled: true };
    if (claim.kind === 'terminalized') {
      failed += 1;
      continue;
    }
    if (claim.kind === 'skipped') continue;
    if (claim.kind === 'payload_missing') {
      throw new RetryableCampaignSendError(
        '발송 payload snapshot이 없어 webhook 복구를 기다립니다.',
      );
    }
    if (claim.kind === 'recovery_blocked') {
      throw new RetryableCampaignSendError(
        'contact가 삭제 또는 수신거부되어 webhook 복구를 기다립니다.',
      );
    }
    if (claim.kind !== 'claimed') continue;

    let result: Awaited<ReturnType<typeof sendCampaignRecipient>>;
    try {
      if (!attachmentsMatchSnapshot(claim.payload.attachments, attachments)) {
        throw new RetryableCampaignSendError(
          '첨부 파일이 최초 발송 payload와 달라 webhook 복구를 기다립니다.',
        );
      }
      await providerRateLimiter.waitForTurn();
      result = await sendCampaignRecipient({
        from: claim.payload.from,
        replyTo: claim.payload.replyTo,
        campaignId,
        idempotencyKey: recipientIdempotencyKey(campaignId, proposed.recipientId),
        recipient: {
          recipientId: proposed.recipientId,
          to: claim.payload.to,
          subject: claim.payload.subject,
          html: claim.payload.html,
        },
        ...(attachments !== undefined ? { attachments } : {}),
      });
    } catch (error) {
      await releaseRecipientLease(proposed.recipientId, claim.leaseToken);
      throw error;
    }

    const applied = await settleClaimedRecipient(
      campaignId,
      proposed.recipientId,
      claim.leaseToken,
      result,
    );
    if (!applied) continue;
    if (result.kind === 'accepted') sent += 1;
    else failed += 1;
  }

  // 전건 failed(message_id 없음)로 끝나면 webhook이 도착하지 않아 finalize가 영영
  // 실행되지 않는다. 청크 처리 후 종료 조건(queued_count=0 AND sent_count=0)을 직접 판정해
  // 'sending'에 갇히는 것을 막는다. sent가 있으면 webhook이 finalize하므로 여기선 no-op.
  await db.transaction((tx) => finalizeCampaignIfDone(tx, campaignId));

  return { sent, failed };
}
