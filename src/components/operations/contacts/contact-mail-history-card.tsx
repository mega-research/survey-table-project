import type { ReactNode } from 'react';

import { ChevronDown } from 'lucide-react';

import { RecipientStatusBadge } from '@/components/operations/mail-campaign/recipient-status-badge';
import { LocalDateTime } from '@/components/ui/local-date-time';
import type { MailHistoryRow } from '@/lib/operations/contacts.server';

/** 조사 대상 메일 발송 이력 — 기본 접힘 collapsible. */
export function ContactMailHistoryCard({
  rows,
  action,
}: {
  rows: MailHistoryRow[];
  action?: ReactNode;
}) {
  const latest = rows[0];
  return (
    <details className="group rounded-lg border bg-white">
      <summary className="flex cursor-pointer items-center justify-between px-5 py-3 text-sm">
        <span className="flex items-center gap-1.5 font-medium text-slate-700">
          이메일 발송 현황 ({rows.length}건)
          <ChevronDown className="size-4 text-slate-400 transition-transform group-open:rotate-180" />
        </span>
        <span className="flex items-center gap-2">
          {action}
          {latest ? <RecipientStatusBadge status={latest.status} /> : null}
        </span>
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
                    {/* 단건 캠페인 제목은 이미 "단건: " 접두어를 포함 — 회차 라벨 없이 제목만 표시 */}
                    {r.kind === 'single'
                      ? r.campaignTitle
                      : `${r.runNumber}회차 · ${r.campaignTitle}`}
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
