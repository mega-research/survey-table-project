import type { ReactNode } from 'react';

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CancelCampaignButton } from '@/components/operations/mail-campaign/cancel-campaign-button';
import { CampaignRecipientsTable } from '@/components/operations/mail-campaign/campaign-recipients-table';
import { Card } from '@/components/ui/card';
import { LocalDateTime } from '@/components/ui/local-date-time';
import {
  mailRecipientStatusValues,
  type MailCampaignStatus,
  type MailRecipientStatus,
} from '@/db/schema/mail';
import {
  getCampaignDetail,
  listCampaignRecipients,
} from '@/lib/operations/campaigns.server';
import { getOperationsDataScope } from '@/lib/operations/data-scope.server';

const PAGE_SIZE = 25;

interface Props {
  params: Promise<{ id: string; cid: string }>;
  searchParams: Promise<{ recipPage?: string; status?: string; q?: string }>;
}

const STATUS_LABEL: Record<MailCampaignStatus, { label: string; tone: string }> = {
  draft: { label: '초안', tone: 'bg-slate-100 text-slate-700' },
  queued: { label: '대기', tone: 'bg-amber-100 text-amber-700' },
  sending: { label: '발송중', tone: 'bg-blue-100 text-blue-700' },
  completed: { label: '완료', tone: 'bg-emerald-100 text-emerald-700' },
  partial: { label: '부분 완료', tone: 'bg-orange-100 text-orange-700' },
  cancelled: { label: '취소됨', tone: 'bg-rose-100 text-rose-700' },
};

function parsePage(value: string | undefined): number {
  const n = parseInt(value ?? '1', 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function parseStatus(value: string | undefined): MailRecipientStatus | 'all' {
  if (!value || value === 'all') return 'all';
  return (mailRecipientStatusValues as readonly string[]).includes(value)
    ? (value as MailRecipientStatus)
    : 'all';
}

export default async function CampaignDetailPage({ params, searchParams }: Props) {
  const { id: surveyId, cid } = await params;
  const sp = await searchParams;
  const scope = await getOperationsDataScope(surveyId);
  const recipPage = parsePage(sp.recipPage);
  const status = parseStatus(sp.status);
  const q = (sp.q ?? '').trim();

  const campaign = await getCampaignDetail(surveyId, cid, scope);
  if (!campaign) {
    notFound();
  }

  const recipients = await listCampaignRecipients({
    surveyId,
    campaignId: cid,
    scope,
    page: recipPage,
    pageSize: PAGE_SIZE,
    status,
    q,
  });

  const success = campaign.deliveredCount + campaign.openedCount;
  const errors = campaign.bouncedCount + campaign.failedCount + campaign.complainedCount;
  const inflight = campaign.queuedCount + campaign.sentCount;
  const statusBadge = STATUS_LABEL[campaign.status];
  const canCancel = campaign.status === 'queued' || campaign.status === 'draft';

  // "이 단체 메일 미응답자 재발송" 동선 — 같은 다중 절 필터 재현 + 미응답 강제 + 자동 전체 선택.
  // legacy 스냅샷(clauses 없음)은 필터 없이 미응답+전체선택만 적용(best-effort).
  const reuseFilter = new URLSearchParams();
  for (const c of campaign.filterSnapshot.clauses ?? []) {
    reuseFilter.append('col', c.source);
    reuseFilter.append('q', c.value);
    reuseFilter.append('op', c.op ?? '');
  }
  reuseFilter.set('unresponded', '1');
  reuseFilter.set('templateId', campaign.mailTemplateId ?? '');
  reuseFilter.set('autoSelectAll', '1');
  const reuseHref = `/admin/surveys/${surveyId}/operations/mail/campaigns/new?${reuseFilter.toString()}`;

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
      <div>
        <Link
          href={`/admin/surveys/${surveyId}/operations/mail/campaigns`}
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          ← 단체 발송
        </Link>
      </div>

      {/* 메타 카드 */}
      <Card className="space-y-4 p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-slate-500">#{campaign.runNumber}</span>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge.tone}`}
              >
                {statusBadge.label}
              </span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              {campaign.title}
            </h1>
            {campaign.templateName ? (
              <p className="text-sm text-slate-500">
                템플릿:{' '}
                {campaign.mailTemplateId ? (
                  <Link
                    href={`/admin/surveys/${surveyId}/operations/mail/templates/${campaign.mailTemplateId}/edit`}
                    className="text-blue-600 hover:text-blue-700"
                  >
                    {campaign.templateName}
                  </Link>
                ) : (
                  <span>{campaign.templateName}</span>
                )}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canCancel ? (
              <CancelCampaignButton surveyId={surveyId} campaignId={cid} />
            ) : null}
            <Link
              href={reuseHref}
              className="rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              미응답자 재발송
            </Link>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-4 border-t border-slate-200 pt-4 text-sm sm:grid-cols-4">
          <Meta label="등록일시" value={<LocalDateTime value={campaign.createdAt} />} />
          <Meta label="발송 시작" value={<LocalDateTime value={campaign.startedAt} />} />
          <Meta label="발송 완료" value={<LocalDateTime value={campaign.completedAt} />} />
          <Meta label="제목 (메일)" value={campaign.subjectSnapshot} />
        </dl>
      </Card>

      {/* 카운터 카드 */}
      <Card className="p-6">
        <h2 className="mb-4 text-base font-semibold text-slate-900">발송 현황</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <Counter label="발송대상수" value={campaign.recipientCount} />
          <Counter label="성공" value={success} tone="emerald" />
          <Counter label="읽음" value={campaign.openedCount} />
          <Counter label="미오픈" value={campaign.deliveredCount} />
          <Counter label="전송오류" value={errors} tone="rose" />
          <Counter label="발송중" value={inflight} tone="blue" />
          <Counter
            label="수신거부"
            value={campaign.currentUnsubscribedCount}
            hint="단체 메일 발송 대상 중 현재 수신거부 상태인 인원 (발송 후 해지 포함)"
          />
        </div>
      </Card>

      <CampaignRecipientsTable
        surveyId={surveyId}
        campaignId={cid}
        rows={recipients.rows}
        total={recipients.total}
        page={recipients.page}
        pageSize={PAGE_SIZE}
        currentStatus={status}
        currentQuery={q}
      />
    </main>
  );
}

function Meta({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-slate-900">{value}</dd>
    </div>
  );
}

function Counter({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number;
  tone?: 'emerald' | 'rose' | 'blue';
  hint?: string;
}) {
  const toneClass =
    tone === 'emerald'
      ? 'text-emerald-700'
      : tone === 'rose'
        ? 'text-rose-600'
        : tone === 'blue'
          ? 'text-blue-600'
          : 'text-slate-900';
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3" title={hint}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${toneClass}`}>
        {value.toLocaleString('ko-KR')}
      </div>
    </div>
  );
}
