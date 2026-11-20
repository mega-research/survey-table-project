import * as Sentry from '@sentry/nextjs';
import { and, eq, isNull, sql } from 'drizzle-orm';
import 'server-only';

import { type DbTransaction as Tx, db } from '@/db';
import {
  mailCampaigns,
  mailLinkClicks,
  mailRecipients,
  webhookEvents,
} from '@/db/schema/mail';
import { hashClientIp } from '@/lib/duplicate-detection/salted-hash.server';
import { logger } from '@/lib/logger';
import {
  CLICKED_EVENT_TYPE,
  MAX_CLICKS_PER_RECIPIENT,
  USER_AGENT_MAX_LENGTH,
  type ResendClickData,
  classifyClickedLink,
} from '../domain/link-click';
import { hasReplyForwardTag, isReplyForwardDeliveryFailure } from '../domain/reply-forward';
import { hasReplyRelayTag } from '../domain/reply-relay';
import { requestRecipientFallbacks } from './campaign-fallback';
import {
  applyRecipientTransition,
  mapResendWebhookType,
  triggersFallback,
} from './recipient-status-transition';
import type { MailRecipientStatus } from '@/shared/contracts/mail';

/** 이 서비스가 수신자 기록에 반영하는 알림인가 — 상태 알림이거나 클릭 알림. */
function isRecipientEvent(eventType: string): boolean {
  return eventType === CLICKED_EVENT_TYPE || mapResendWebhookType(eventType) !== null;
}

interface LockedRecipient {
  id: string;
  campaignId: string;
  status: MailRecipientStatus;
  archivedAt: Date | null;
}

/**
 * 알림이 가리키는 수신자를 찾아 잠근다 — 회차 행 → 수신자 행 순서다(이 수신자에 닿는 알림은 종류와 무관하게
 * 같은 순서로 잠가 서로 엇갈리지 않는다). 발송 서비스 메일 id 로 찾고, 없으면 발송 태그(수신자 id·회차 id)로 찾는다.
 * 전달 메일(회신 전달)과 중계 메일(답장 중계)은 수신자 기록이 없는 메일이라 null 이다.
 * 발송 직후 메일 id 가 아직 안 적힌 수신자면 여기서 적는다.
 */
async function lockRecipientForEvent(
  tx: Tx,
  resendMessageId: string,
  tags?: Record<string, string>,
): Promise<LockedRecipient | null> {
  // 전달 메일(회신 전달)과 중계 메일(답장 중계)은 수신자 기록이 없는 메일이다 — 수신자 상태·발송 회차 집계를 건드리지 않는다.
  if (hasReplyForwardTag(tags) || hasReplyRelayTag(tags)) return null;

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

  return {
    id: row.id,
    campaignId: row.campaignId,
    status: row.status as MailRecipientStatus,
    archivedAt: row.archivedAt,
  };
}

/** 알림의 시각 글자 → Date. 없거나 읽히지 않으면 null. */
function parseEventAt(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? null : at;
}

async function applyResendEvent(
  tx: Tx,
  resendMessageId: string,
  eventType: string,
  createdAtRaw: string,
  tags?: Record<string, string>,
): Promise<string | null> {
  const newStatus = mapResendWebhookType(eventType);
  if (!newStatus) return null;

  const row = await lockRecipientForEvent(tx, resendMessageId, tags);
  if (!row) return null;

  const applied = await applyRecipientTransition(tx, {
    recipientId: row.id,
    campaignId: row.campaignId,
    prevStatus: row.status,
    newStatus,
    eventAt: parseEventAt(createdAtRaw) ?? new Date(),
    recipientArchivedAt: row.archivedAt,
  });
  // 반송·실패로 바뀐 수신자 — 커밋 뒤 다음 순위 주소로 대체 발송을 건다.
  return applied && triggersFallback(newStatus) ? row.id : null;
}

/**
 * 클릭 알림 한 건을 수신자 기록에 반영한다 (CONTEXT.md 「링크 클릭」, ADR 0042).
 *
 * 수신자 행을 잠근 채로 클릭 줄을 넣고(수신자당 상한을 같은 잠금 아래에서 센다), 수신 상태가 아직 열람
 * 전이면 열람으로 올린다 — 이미지를 막은 메일 프로그램은 열람이 잡히지 않는데 링크는 누른다.
 * 클릭 정보의 모양이 달라 줄을 못 넣어도 열람으로는 올린다(눌렀다는 사실은 알림 자체가 말한다).
 * 링크 주소·IP·브라우저 정보는 로그에 싣지 않는다.
 */
async function applyClickEvent(
  tx: Tx,
  resendMessageId: string,
  createdAtRaw: string,
  click: ResendClickData | null,
  tags?: Record<string, string>,
): Promise<void> {
  const row = await lockRecipientForEvent(tx, resendMessageId, tags);
  if (!row) return;

  const clickedAt = parseEventAt(click?.timestamp) ?? parseEventAt(createdAtRaw) ?? new Date();

  if (click) {
    const [counted] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(mailLinkClicks)
      .where(eq(mailLinkClicks.recipientId, row.id));
    if ((counted?.count ?? 0) >= MAX_CLICKS_PER_RECIPIENT) {
      logger.warn(
        { recipientId: row.id, campaignId: row.campaignId },
        '[link-click] 수신자당 클릭 상한 — 이 클릭은 기록하지 않는다',
      );
    } else {
      const link = classifyClickedLink(click.link, process.env['NEXT_PUBLIC_APP_URL']);
      await tx.insert(mailLinkClicks).values({
        recipientId: row.id,
        linkKind: link.kind,
        linkUrl: link.url,
        clickedAt,
        ipHash: hashClientIp(click.ipAddress),
        userAgent: click.userAgent?.slice(0, USER_AGENT_MAX_LENGTH) ?? null,
      });
    }
  }

  await applyRecipientTransition(tx, {
    recipientId: row.id,
    campaignId: row.campaignId,
    prevStatus: row.status,
    newStatus: 'opened',
    eventAt: clickedAt,
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
  /** 클릭 알림(`email.clicked`)에만 실린다 — 누른 링크·시각·IP·브라우저 정보. 모양이 다르면 null. */
  click?: ResendClickData | null;
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
 * 클릭 알림(`email.clicked`)은 같은 트랜잭션에서 클릭 줄을 넣고 수신 상태를 열람으로 올린다(`applyClickEvent`).
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
    if (!event.resendMessageId || !isRecipientEvent(event.type)) {
      return { result: 'ignored' as const, fallbackRecipientId: null };
    }
    if (event.type === CLICKED_EVENT_TYPE) {
      await applyClickEvent(
        tx,
        event.resendMessageId,
        event.createdAt,
        event.click ?? null,
        event.tags,
      );
      return { result: 'processed' as const, fallbackRecipientId: null };
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
