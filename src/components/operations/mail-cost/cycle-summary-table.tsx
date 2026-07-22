import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { LocalDateTime } from '@/components/ui/local-date-time';
import type { CycleSummary } from '@/lib/operations/mail-billing.server';
import { cn } from '@/lib/utils';

import { formatInt, formatKrw } from './_format';

interface Props {
  cycle: CycleSummary;
}

const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  draft: { label: '초안', tone: 'bg-slate-100 text-slate-700' },
  queued: { label: '대기', tone: 'bg-amber-100 text-amber-700' },
  sending: { label: '발송중', tone: 'bg-blue-100 text-blue-700' },
  completed: { label: '완료', tone: 'bg-emerald-100 text-emerald-700' },
  partial: { label: '부분 완료', tone: 'bg-orange-100 text-orange-700' },
  cancelled: { label: '취소됨', tone: 'bg-rose-100 text-rose-700' },
};

export function CycleSummaryTable({ cycle }: Props) {
  return (
    <Card className="overflow-hidden">
      <header className="border-b border-gray-100 bg-gray-50/60 px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-3">
            <h3 className="text-base font-semibold text-gray-900">
              {cycle.startLabel} ~ {cycle.endLabel}
            </h3>
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
              {cycle.planLabel}
            </span>
            {cycle.isCurrent && (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                진행 중
              </span>
            )}
          </div>
          <div className="text-sm text-gray-600">
            누적 {formatInt(cycle.totalBillable)}건 ·{' '}
            <span className="text-gray-500">포함 {formatInt(cycle.totalIncluded)}</span>
            {cycle.totalOverage > 0 && (
              <span className="ml-1 font-medium text-orange-600">
                · 초과 {formatInt(cycle.totalOverage)}
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-white text-left text-xs font-medium tracking-wide text-gray-500 uppercase">
              <th className="px-3 py-2.5">회차</th>
              <th className="px-3 py-2.5">설문</th>
              <th className="px-3 py-2.5">제목</th>
              <th className="px-3 py-2.5">발송일시</th>
              <th className="px-3 py-2.5">상태</th>
              <th className="px-3 py-2.5 text-right">청구수</th>
              <th className="px-3 py-2.5 text-right">평균단가</th>
              <th className="px-3 py-2.5 text-right">비용</th>
            </tr>
          </thead>
          <tbody>
            {cycle.campaigns.map((c) => {
              const status = STATUS_LABEL[c.status] ?? { label: c.status, tone: 'bg-slate-100 text-slate-600' };
              return (
                <tr
                  key={c.campaignId}
                  className="border-b border-gray-50 last:border-b-0 hover:bg-gray-50/40"
                >
                  <td className="px-3 py-2.5 font-medium tabular-nums text-gray-900">
                    {c.runNumber}
                  </td>
                  <td className="max-w-[200px] truncate px-3 py-2.5 text-gray-600">
                    {c.archivedAt === null ? (
                      <Link
                        href={`/admin/surveys/${c.surveyId}/operations/mail/campaigns/${c.campaignId}`}
                        className="hover:text-blue-600 hover:underline"
                      >
                        {c.surveyTitle}
                      </Link>
                    ) : (
                      <span>{c.surveyTitle}</span>
                    )}
                  </td>
                  <td className="max-w-[260px] px-3 py-2.5 text-gray-700">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate">{c.title}</span>
                      {c.isTest && (
                        <span className="shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
                          테스트
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-gray-600">
                    <LocalDateTime value={c.startedAt} format="month-day-time" />
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', status.tone)}>
                      {status.label}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-900">
                    {formatInt(c.billableCount)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">
                    {c.averageUnitPriceKrw === 0 ? (
                      <span className="text-gray-400">0원</span>
                    ) : (
                      `${c.averageUnitPriceKrw.toLocaleString('ko-KR')}원`
                    )}
                  </td>
                  <td
                    className={cn(
                      'px-3 py-2.5 text-right tabular-nums',
                      c.costKrw === 0 ? 'text-gray-400' : 'font-medium text-gray-900',
                    )}
                  >
                    {formatKrw(c.costKrw)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-200 bg-gray-50/50">
              <td colSpan={5} className="px-3 py-2.5 text-right text-xs font-medium text-gray-500">
                초과분 소계
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">
                {formatInt(cycle.totalOverage)}
              </td>
              <td />
              <td className="px-3 py-2.5 text-right tabular-nums font-medium text-gray-900">
                {formatKrw(cycle.overageCostKrw)}
              </td>
            </tr>
            <tr className="bg-gray-50/50">
              <td colSpan={7} className="px-3 py-2.5 text-right text-xs font-medium text-gray-500">
                월 구독료
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">
                {formatKrw(cycle.monthlyFeeKrw)}
              </td>
            </tr>
            <tr className="border-t border-gray-200 bg-blue-50/40">
              <td colSpan={7} className="px-3 py-3 text-right text-sm font-semibold text-gray-900">
                기간 합계
              </td>
              <td className="px-3 py-3 text-right tabular-nums text-base font-semibold text-blue-700">
                {formatKrw(cycle.totalCostKrw)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}
