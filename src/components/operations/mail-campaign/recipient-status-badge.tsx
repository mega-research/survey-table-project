import { recipientStatusMeta } from '@/lib/operations/recipient-status';
import type { MailRecipientStatus } from '@/shared/contracts/mail';

/** 수신자 status badge. recipientStatusMeta 매핑 기반 단일 pill. */
export function RecipientStatusBadge({ status }: { status: MailRecipientStatus }) {
  const tone = recipientStatusMeta(status);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone.tone}`}
    >
      {tone.label}
    </span>
  );
}
