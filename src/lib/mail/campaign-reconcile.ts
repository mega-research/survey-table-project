import 'server-only';

import { mapResendLastEvent, canTransition } from '@/lib/mail/recipient-status-transition';
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
