import type { MailRecipientStatus } from '@/shared/contracts/mail';

/** 수신자 status → 표시 라벨 + tailwind 톤. 수신자 목록·조사 대상 목록 공유. */
export const STATUS_LABEL: Record<MailRecipientStatus, { label: string; tone: string }> = {
  queued: { label: '대기', tone: 'bg-amber-100 text-amber-700' },
  sending: { label: '전송중', tone: 'bg-blue-100 text-blue-700' },
  sent: { label: '발송됨', tone: 'bg-blue-100 text-blue-700' },
  delivered: { label: '전달 완료', tone: 'bg-emerald-100 text-emerald-700' },
  opened: { label: '열람', tone: 'bg-emerald-200 text-emerald-800' },
  bounced: { label: '반송', tone: 'bg-rose-100 text-rose-700' },
  complained: { label: '신고', tone: 'bg-rose-200 text-rose-800' },
  failed: { label: '실패', tone: 'bg-rose-100 text-rose-700' },
  skipped_unsubscribed: { label: '수신거부', tone: 'bg-slate-100 text-slate-600' },
};

/**
 * status 의 표시 메타(라벨 + 톤). STATUS_LABEL 에 없는 status(향후 enum 확장 등)는
 * status 문자열 라벨 + 중립 톤으로 폴백해 런타임 크래시를 막는다.
 */
export function recipientStatusMeta(status: MailRecipientStatus): { label: string; tone: string } {
  return STATUS_LABEL[status] ?? { label: status, tone: 'bg-slate-100 text-slate-600' };
}

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
