import Link from 'next/link';

import { Send } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { LocalDateTime } from '@/components/ui/local-date-time';
import type { CampaignRow } from '@/lib/operations/campaigns.server';

interface Props {
  surveyId: string;
  rows: CampaignRow[];
  total: number;
  page: number;
  pageSize: number;
}

const STATUS_LABEL: Record<CampaignRow['status'], { label: string; tone: string }> = {
  draft: { label: '초안', tone: 'bg-slate-100 text-slate-700' },
  queued: { label: '대기', tone: 'bg-amber-100 text-amber-700' },
  sending: { label: '발송중', tone: 'bg-blue-100 text-blue-700' },
  completed: { label: '완료', tone: 'bg-emerald-100 text-emerald-700' },
  partial: { label: '부분 완료', tone: 'bg-orange-100 text-orange-700' },
  cancelled: { label: '취소됨', tone: 'bg-rose-100 text-rose-700' },
};

function num(n: number) {
  if (n === 0) return <span className="text-slate-300">0</span>;
  return n.toLocaleString('ko-KR');
}

export function CampaignsList({ surveyId, rows, total, page, pageSize }: Props) {
  if (rows.length === 0) {
    return (
      <Card className="border-dashed">
        <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
            <Send className="h-6 w-6 text-gray-400" />
          </div>
          <p className="text-sm text-gray-500">아직 등록된 발송 회차가 없습니다.</p>
          <Link
            href={`/admin/surveys/${surveyId}/operations/mail/campaigns/new`}
            className="mt-3 text-sm font-medium text-blue-500 hover:text-blue-600"
          >
            첫 단체 메일 만들기 →
          </Link>
        </div>
      </Card>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-3">
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[1100px]">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50 text-left text-xs font-medium tracking-wide text-gray-500 uppercase">
              <th className="px-3 py-3">회차</th>
              <th className="px-3 py-3">제목</th>
              <th className="px-3 py-3 text-right">발송대상수</th>
              <th className="px-3 py-3 text-right">성공</th>
              <th className="px-3 py-3 text-right">읽음</th>
              <th className="px-3 py-3 text-right">미오픈</th>
              <th className="px-3 py-3 text-right">전송오류</th>
              <th className="px-3 py-3 text-right">발송중</th>
              <th
                className="px-3 py-3 text-right"
                title="발송 등록 시점에 자동 제외된 대상 수 (수신거부 + 이메일 누락 + 삭제 등)"
              >
                스킵
              </th>
              <th className="px-3 py-3">상태</th>
              <th className="px-3 py-3">등록일시</th>
              <th className="px-3 py-3">발송일시</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const success = r.deliveredCount + r.openedCount;
              const errors = r.bouncedCount + r.failedCount + r.complainedCount;
              const inflight = r.queuedCount + r.sentCount;
              const status = STATUS_LABEL[r.status];
              const detailHref = `/admin/surveys/${surveyId}/operations/mail/campaigns/${r.id}`;
              return (
                <tr
                  key={r.id}
                  className="border-b border-gray-100 text-sm last:border-b-0 hover:bg-gray-50/50"
                >
                  <td className="font-mono text-xs text-slate-600">
                    <Link href={detailHref} className="block px-3 py-3">
                      #{r.runNumber}
                    </Link>
                  </td>
                  <td className="font-medium text-gray-900">
                    <Link href={detailHref} className="block px-3 py-3">
                      {r.isTest ? (
                        <span className="mr-2 inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                          테스트
                        </span>
                      ) : null}
                      {r.title}
                      {r.templateName ? (
                        <div className="text-xs text-slate-500">템플릿: {r.templateName}</div>
                      ) : null}
                    </Link>
                  </td>
                  <td>
                    <Link href={detailHref} className="block px-3 py-3 text-right tabular-nums">
                      {num(r.recipientCount)}
                    </Link>
                  </td>
                  <td>
                    <Link
                      href={detailHref}
                      className="block px-3 py-3 text-right tabular-nums text-emerald-700"
                    >
                      {num(success)}
                    </Link>
                  </td>
                  <td>
                    <Link href={detailHref} className="block px-3 py-3 text-right tabular-nums">
                      {num(r.openedCount)}
                    </Link>
                  </td>
                  <td>
                    <Link href={detailHref} className="block px-3 py-3 text-right tabular-nums">
                      {num(r.deliveredCount)}
                    </Link>
                  </td>
                  <td>
                    <Link
                      href={detailHref}
                      className="block px-3 py-3 text-right tabular-nums text-rose-600"
                    >
                      {num(errors)}
                    </Link>
                  </td>
                  <td>
                    <Link
                      href={detailHref}
                      className="block px-3 py-3 text-right tabular-nums text-blue-600"
                    >
                      {num(inflight)}
                    </Link>
                  </td>
                  <td>
                    <Link href={detailHref} className="block px-3 py-3 text-right tabular-nums">
                      {num(r.skippedUnsubscribedCount)}
                    </Link>
                  </td>
                  <td>
                    <Link href={detailHref} className="block px-3 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${status.tone}`}
                      >
                        {status.label}
                      </span>
                    </Link>
                  </td>
                  <td className="text-xs text-slate-500">
                    <Link href={detailHref} className="block px-3 py-3">
                      <LocalDateTime value={r.createdAt} />
                    </Link>
                  </td>
                  <td className="text-xs text-slate-500">
                    <Link href={detailHref} className="block px-3 py-3">
                      <LocalDateTime value={r.startedAt} />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {totalPages > 1 ? (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-slate-500">
            {page} / {totalPages}
          </span>
          <PageLink surveyId={surveyId} page={page - 1} disabled={page <= 1}>
            이전
          </PageLink>
          <PageLink surveyId={surveyId} page={page + 1} disabled={page >= totalPages}>
            다음
          </PageLink>
        </div>
      ) : null}
    </div>
  );
}

function PageLink({
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
      href={`/admin/surveys/${surveyId}/operations/mail/campaigns?page=${page}`}
      className="rounded border border-slate-200 px-2 py-1 text-slate-700 hover:bg-slate-50"
    >
      {children}
    </Link>
  );
}
