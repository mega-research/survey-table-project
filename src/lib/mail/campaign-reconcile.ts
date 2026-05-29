import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@/db';
import { mailRecipients } from '@/db/schema/mail';
import { getResend } from '@/lib/mail/resend-client';
import { mapResendLastEvent, canTransition, applyRecipientTransition } from '@/lib/mail/recipient-status-transition';
import type { MailRecipientStatus } from '@/db/schema/mail';

export interface StuckRecipient {
  id: string;
  status: MailRecipientStatus;
  resendMessageId: string;
}

/** Resend 조회 결과: 성공 시 lastEvent, 실패 시 error=true (해당 건 skip). */
export interface ResendLookup {
  recipientId: string;
  lastEvent?: string;
  error?: boolean;
}

export interface ReconcileAction {
  recipientId: string;
  prevStatus: MailRecipientStatus;
  newStatus: MailRecipientStatus;
}

/**
 * stuck recipient + Resend 조회 결과를 받아 적용할 전이 목록을 계산한다(순수).
 * 조회 실패/미매핑/역행은 제외.
 */
export function planReconcileTransitions(
  stuck: StuckRecipient[],
  lookups: ResendLookup[],
): ReconcileAction[] {
  const byId = new Map(stuck.map((s) => [s.id, s]));
  const actions: ReconcileAction[] = [];
  for (const lk of lookups) {
    if (lk.error || !lk.lastEvent) continue;
    const recipient = byId.get(lk.recipientId);
    if (!recipient) continue;
    const newStatus = mapResendLastEvent(lk.lastEvent);
    if (!newStatus) continue;
    if (!canTransition(recipient.status, newStatus)) continue;
    actions.push({ recipientId: recipient.id, prevStatus: recipient.status, newStatus });
  }
  return actions;
}

const STUCK_STATUSES: MailRecipientStatus[] = ['queued', 'sending', 'sent'];

/**
 * 한 캠페인의 stuck recipient(message_id 보유)를 Resend 실제 상태와 동기화한다.
 * race window로 유실된 webhook 보강용. 정상 캠페인은 stuck 0건 -> Resend 호출 0회.
 */
export async function reconcileCampaignRecipients(
  campaignId: string,
): Promise<{ checked: number; updated: number }> {
  const stuck = await db
    .select({
      id: mailRecipients.id,
      status: mailRecipients.status,
      resendMessageId: mailRecipients.resendMessageId,
    })
    .from(mailRecipients)
    .where(
      and(
        eq(mailRecipients.campaignId, campaignId),
        inArray(mailRecipients.status, STUCK_STATUSES),
      ),
    );

  const targets: StuckRecipient[] = stuck
    .filter((r) => r.resendMessageId != null)
    .map((r) => ({ id: r.id, status: r.status as MailRecipientStatus, resendMessageId: r.resendMessageId! }));

  if (targets.length === 0) return { checked: 0, updated: 0 };

  const resend = getResend();
  const lookups: ResendLookup[] = await Promise.all(
    targets.map(async (t): Promise<ResendLookup> => {
      try {
        const { data } = await resend.emails.get(t.resendMessageId);
        return { recipientId: t.id, lastEvent: data?.last_event };
      } catch {
        return { recipientId: t.id, error: true };
      }
    }),
  );

  const actions = planReconcileTransitions(targets, lookups);
  const eventAt = new Date();
  let updated = 0;

  for (const action of actions) {
    await db.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: mailRecipients.id,
          campaignId: mailRecipients.campaignId,
          status: mailRecipients.status,
        })
        .from(mailRecipients)
        .where(eq(mailRecipients.id, action.recipientId))
        .for('update');
      const row = rows[0];
      if (!row) return;
      const ok = await applyRecipientTransition(tx, {
        recipientId: row.id,
        campaignId: row.campaignId,
        prevStatus: row.status as MailRecipientStatus,
        newStatus: action.newStatus,
        eventAt,
      });
      if (ok) updated += 1;
    });
  }

  return { checked: targets.length, updated };
}
