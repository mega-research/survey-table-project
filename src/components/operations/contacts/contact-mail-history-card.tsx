import { RecipientStatusBadge } from '@/components/operations/mail-campaign/recipient-status-badge';
import { LocalDateTime } from '@/components/ui/local-date-time';
import type { MailHistoryRow } from '@/lib/operations/contacts.server';

/** 조사 대상 메일 발송 이력 — 기본 접힘 collapsible. */
export function ContactMailHistoryCard({ rows }: { rows: MailHistoryRow[] }) {
  const latest = rows[0];
  return (
    <details className="rounded-lg border bg-white">
      <summary className="flex cursor-pointer items-center justify-between px-5 py-3 text-sm">
        <span className="font-medium text-slate-700">
          이메일 발송 현황 ({rows.length}건)
        </span>
        {latest ? <RecipientStatusBadge status={latest.status} /> : null}
      </summary>
      <div className="border-t px-5 py-3">
        {rows.length === 0 ? (
          <p className="text-sm text-slate-400">발송 내역이 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-1 border-b border-slate-100 pb-2 last:border-0 last:pb-0"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-700">
                    {r.runNumber}회차 · {r.campaignTitle}
                  </span>
                  <RecipientStatusBadge status={r.status} />
                </div>
                <div className="flex flex-wrap gap-x-2 text-xs text-slate-500">
                  {r.sentAt ? (
                    <span>
                      발송 <LocalDateTime value={r.sentAt} />
                    </span>
                  ) : null}
                  {r.deliveredAt ? (
                    <span>
                      전달 <LocalDateTime value={r.deliveredAt} />
                    </span>
                  ) : null}
                  {r.openedAt ? (
                    <span>
                      열람 <LocalDateTime value={r.openedAt} />
                    </span>
                  ) : null}
                  {r.bouncedAt ? (
                    <span>
                      반송 <LocalDateTime value={r.bouncedAt} />
                    </span>
                  ) : null}
                  {!r.sentAt && !r.deliveredAt && !r.openedAt && !r.bouncedAt ? (
                    <span>발송 대기</span>
                  ) : null}
                </div>
                {r.errorReason ? (
                  <div className="text-xs text-rose-500">{r.errorReason}</div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
