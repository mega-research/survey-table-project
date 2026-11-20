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
import { InternalFailure } from '@/server/internal-failure';
import {
  CLICKED_EVENT_TYPE,
  MAX_CLICKS_PER_RECIPIENT,
  USER_AGENT_MAX_LENGTH,
  type ResendClickData,
  classifyClickedLink,
} from '../domain/link-click';
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
 * 발송 직후 메일 id 가 아직 안 적힌 수신자면 여기서 적는다.
 */
async function lockRecipientForEvent(
  tx: Tx,
  resendMessageId: string,
  tags?: Record<string, string>,
): Promise<LockedRecipient | null> {
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

/** 상태 알림(발송됨·전달·열람·반송·신고) 한 건을 수신자 상태와 회차 집계에 반영한다. */
async function applyStatusEvent(
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
  event: VerifiedResendWebhookEvent & { resendMessageId: string },
): Promise<void> {
  const row = await lockRecipientForEvent(tx, event.resendMessageId, event.tags);
  if (!row) return;

  const click = event.click ?? null;
  const clickedAt = parseEventAt(click?.timestamp) ?? parseEventAt(event.createdAt) ?? new Date();

  if (click) {
    const link = classifyClickedLink(click.link, process.env['NEXT_PUBLIC_APP_URL']);
    // 앱 주소를 모르면 어느 링크인지 판정할 수 없다 — 판정 없이 저장하면 초대·수신거부 주소가 그 밖의 링크로
    // 남는다. 실패로 답해 발송 서비스가 다시 보내게 한다(발송도 이 설정이 없으면 멈춘다).
    if (!link) throw new InternalFailure('NEXT_PUBLIC_APP_URL 환경변수가 설정되지 않았습니다.');

    const [counted] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        survey: sql<number>`count(*) FILTER (WHERE ${mailLinkClicks.linkKind} = 'survey')::int`,
      })
      .from(mailLinkClicks)
      .where(eq(mailLinkClicks.recipientId, row.id));
    const atCap = (counted?.total ?? 0) >= MAX_CLICKS_PER_RECIPIENT;
    // 상한이 찼어도 그 수신자의 첫 설문 링크 클릭은 남긴다 — MAX_CLICKS_PER_RECIPIENT 주석 참조.
    const firstSurveyClick = link.kind === 'survey' && (counted?.survey ?? 0) === 0;
    if (atCap && !firstSurveyClick) {
      logger.warn(
        { recipientId: row.id, campaignId: row.campaignId },
        '[link-click] 수신자당 클릭 상한 — 이 클릭은 기록하지 않는다',
      );
    } else {
      await tx.insert(mailLinkClicks).values({
        recipientId: row.id,
        linkKind: link.kind,
        linkUrl: link.url,
        clickedAt,
        ipHash: hashClientIp(click.ipAddress),
        userAgent: click.userAgent?.slice(0, USER_AGENT_MAX_LENGTH) ?? null,
      });
    }
  } else {
    // 발송 서비스가 알림 모양을 바꾸면 여기로만 들어와 클릭 기록이 통째로 사라진다 — 조용히 넘어가지 않는다.
    logger.warn(
      { recipientId: row.id, campaignId: row.campaignId },
      '[link-click] 클릭 정보를 읽지 못한 알림 — 줄 없이 열람으로만 올린다',
    );
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
    applyStatusEvent(tx, resendMessageId, eventType, createdAtRaw, tags),
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
 * webhook dedupe 기록과 recipient 전이를 한 transaction으로 커밋한다.
 * 전이 실패 시 dedupe insert도 rollback되어 provider retry가 이벤트를 다시 처리할 수 있다.
 * 클릭 알림(`email.clicked`)은 같은 트랜잭션에서 클릭 줄을 넣고 수신 상태를 열람으로 올린다(`applyClickEvent`).
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
      await applyClickEvent(tx, { ...event, resendMessageId: event.resendMessageId });
      return { result: 'processed' as const, fallbackRecipientId: null };
    }

    const fallbackRecipientId = await applyStatusEvent(
      tx,
      event.resendMessageId,
      event.type,
      event.createdAt,
      event.tags,
    );
    return { result: 'processed' as const, fallbackRecipientId };
  });
  if (outcome.fallbackRecipientId) await requestRecipientFallbacks([outcome.fallbackRecipientId]);
  return outcome.result;
}
