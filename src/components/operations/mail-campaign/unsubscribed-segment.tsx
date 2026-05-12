import Link from 'next/link';

import { Card } from '@/components/ui/card';
import type { UnsubscribedContactRow } from '@/lib/operations/campaigns.server';

interface Props {
  surveyId: string;
  rows: UnsubscribedContactRow[];
  total: number;
  page: number;
  pageSize: number;
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function UnsubscribedSegment({ surveyId, rows, total, page, pageSize }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">수신거부자 명단</h2>
          <p className="mt-1 text-sm text-slate-500">
            모든 캠페인에서 자동으로 제외됩니다. 총 {total.toLocaleString('ko-KR')}명.
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <Card className="border-dashed">
          <div className="px-6 py-10 text-center text-sm text-slate-500">
            아직 수신거부 처리된 컨택이 없습니다.
          </div>
        </Card>
      ) : (
        <>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[600px]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50 text-left text-xs font-medium tracking-wide text-gray-500 uppercase">
                  <th className="px-4 py-3">번호</th>
                  <th className="px-4 py-3">이메일</th>
                  <th className="px-4 py-3">그룹</th>
                  <th className="px-4 py-3">해지 시각</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-gray-100 text-sm last:border-b-0 hover:bg-gray-50/50"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">#{r.resid}</td>
                    <td className="px-4 py-3 text-slate-900">{r.emailMasked}</td>
                    <td className="px-4 py-3 text-slate-600">{r.groupValue ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {formatDate(r.unsubscribedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          {totalPages > 1 ? (
            <div className="flex items-center justify-end gap-2 text-sm">
              <span className="text-slate-500">
                {page} / {totalPages}
              </span>
              <SegPageLink surveyId={surveyId} page={page - 1} disabled={page <= 1}>
                이전
              </SegPageLink>
              <SegPageLink surveyId={surveyId} page={page + 1} disabled={page >= totalPages}>
                다음
              </SegPageLink>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function SegPageLink({
  surveyId,
  page,
  disabled,
  children,
}: {
  surveyId: string;
  page: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span className="rounded border border-slate-200 px-2 py-1 text-slate-300">{children}</span>
    );
  }
  return (
    <Link
      href={`/admin/surveys/${surveyId}/operations/mail/campaigns?unsubPage=${page}#unsubscribed`}
      className="rounded border border-slate-200 px-2 py-1 text-slate-700 hover:bg-slate-50"
    >
      {children}
    </Link>
  );
}
