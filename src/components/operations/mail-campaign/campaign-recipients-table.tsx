import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { LocalDateTime } from '@/components/ui/local-date-time';
import type { MailRecipientStatus } from '@/db/schema/mail';
import type { CampaignRecipientRow } from '@/lib/operations/campaigns.server';

import { RecipientStatusBadge } from './recipient-status-badge';

interface Props {
  surveyId: string;
  campaignId: string;
  rows: CampaignRecipientRow[];
  total: number;
  page: number;
  pageSize: number;
  /** 활성 status 필터 목록. 빈 배열 = 전체. */
  currentStatuses: MailRecipientStatus[];
  currentQuery: string;
}

// 칩 클릭 = 해당 status 토글(다중 선택). 발송 현황 카운터 클릭도 같은 ?status= 조합으로 진입한다.
const STATUS_FILTER_CHIPS: Array<{
  value: MailRecipientStatus;
  label: string;
}> = [
  { value: 'queued', label: '대기' },
  { value: 'sent', label: '발송됨' },
  { value: 'delivered', label: '전달 완료' },
  { value: 'opened', label: '열람' },
  { value: 'bounced', label: '반송' },
  { value: 'failed', label: '실패' },
  { value: 'complained', label: '신고' },
  { value: 'skipped_unsubscribed', label: '수신거부' },
];

function buildHref(
  surveyId: string,
  campaignId: string,
  overrides: Partial<{ statuses: MailRecipientStatus[]; q: string; recipPage: number }>,
): string {
  const params = new URLSearchParams();
  if (overrides.statuses && overrides.statuses.length > 0)
    params.set('status', overrides.statuses.join(','));
  if (overrides.q && overrides.q.trim()) params.set('q', overrides.q.trim());
  if (overrides.recipPage && overrides.recipPage > 1)
    params.set('recipPage', String(overrides.recipPage));
  const qs = params.toString();
  return `/admin/surveys/${surveyId}/operations/mail/campaigns/${campaignId}${
    qs ? `?${qs}` : ''
  }`;
}

export function CampaignRecipientsTable({
  surveyId,
  campaignId,
  rows,
  total,
  page,
  pageSize,
  currentStatuses,
  currentQuery,
}: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const toggledStatuses = (status: MailRecipientStatus): MailRecipientStatus[] =>
    currentStatuses.includes(status)
      ? currentStatuses.filter((s) => s !== status)
      : [...currentStatuses, status];

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">수신자 목록</h2>
          <p className="mt-1 text-sm text-slate-500">총 {total.toLocaleString('ko-KR')}건</p>
        </div>
        <form className="flex items-center gap-2" action="" method="get">
          <input
            type="search"
            name="q"
            defaultValue={currentQuery}
            placeholder="이메일 검색"
            className="rounded border border-slate-200 px-3 py-1.5 text-sm"
          />
          {currentStatuses.length > 0 ? (
            <input type="hidden" name="status" value={currentStatuses.join(',')} />
          ) : null}
          <button
            type="submit"
            className="rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            검색
          </button>
        </form>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Link
          href={buildHref(surveyId, campaignId, { statuses: [], q: currentQuery })}
          className={`rounded-full px-3 py-1 text-xs ${
            currentStatuses.length === 0
              ? 'bg-blue-600 text-white'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          전체
        </Link>
        {STATUS_FILTER_CHIPS.map((chip) => (
          <Link
            key={chip.value}
            href={buildHref(surveyId, campaignId, {
              statuses: toggledStatuses(chip.value),
              q: currentQuery,
            })}
            className={`rounded-full px-3 py-1 text-xs ${
              currentStatuses.includes(chip.value)
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {chip.label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <Card className="border-dashed">
          <div className="px-6 py-10 text-center text-sm text-slate-500">
            해당 조건의 수신자가 없습니다.
          </div>
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50 text-left text-xs font-medium tracking-wide text-gray-500 uppercase">
                <th className="px-3 py-2">번호</th>
                <th className="px-3 py-2">이메일</th>
                <th className="px-3 py-2">그룹</th>
                <th className="px-3 py-2">상태</th>
                <th className="px-3 py-2">발송</th>
                <th className="px-3 py-2">전달</th>
                <th className="px-3 py-2">열람</th>
                <th className="px-3 py-2">메모</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                return (
                  <tr
                    key={r.id}
                    className="border-b border-gray-100 text-sm last:border-b-0 hover:bg-gray-50/50"
                  >
                    <td className="px-3 py-2 font-mono text-xs text-slate-600">
                      {r.contactResid === null ? '—' : `#${r.contactResid}`}
                    </td>
                    <td className="px-3 py-2 text-slate-900">{r.emailMasked}</td>
                    <td className="px-3 py-2 text-slate-600">{r.contactGroupValue ?? '—'}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1">
                        <RecipientStatusBadge status={r.status} />
                        {/* status='skipped_unsubscribed' 는 이미 status badge 가 "수신거부" 라 중복 노출 회피.
                            발송 후 본인이 footer 링크로 해지한 경우에만 별도 badge 노출. */}
                        {r.unsubscribedAt && r.status !== 'skipped_unsubscribed' && (
                          <span
                            className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"
                            title={`수신거부 ${r.unsubscribedAt.toISOString()}`}
                          >
                            수신거부
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      <LocalDateTime value={r.sentAt} />
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      <LocalDateTime value={r.deliveredAt} />
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      <LocalDateTime value={r.openedAt} />
                    </td>
                    <td className="px-3 py-2 text-xs text-rose-600">{r.errorReason ?? ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-slate-500">
            {page} / {totalPages}
          </span>
          <PageLink
            href={
              page > 1
                ? buildHref(surveyId, campaignId, {
                    statuses: currentStatuses,
                    q: currentQuery,
                    recipPage: page - 1,
                  })
                : null
            }
          >
            이전
          </PageLink>
          <PageLink
            href={
              page < totalPages
                ? buildHref(surveyId, campaignId, {
                    statuses: currentStatuses,
                    q: currentQuery,
                    recipPage: page + 1,
                  })
                : null
            }
          >
            다음
          </PageLink>
        </div>
      ) : null}
    </section>
  );
}

function PageLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  if (!href) {
    return (
      <span className="rounded border border-slate-200 px-2 py-1 text-slate-300">{children}</span>
    );
  }
  return (
    <Link
      href={href}
      className="rounded border border-slate-200 px-2 py-1 text-slate-700 hover:bg-slate-50"
    >
      {children}
    </Link>
  );
}
