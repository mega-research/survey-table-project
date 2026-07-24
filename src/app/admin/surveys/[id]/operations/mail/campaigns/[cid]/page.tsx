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

/** ?status=bounced,failed 처럼 쉼표 구분 다중 status 파싱. 빈 배열 = 전체. */
function parseStatuses(value: string | undefined): MailRecipientStatus[] {
  if (!value || value === 'all') return [];
  const valid = value
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is MailRecipientStatus =>
      (mailRecipientStatusValues as readonly string[]).includes(s),
    );
  return [...new Set(valid)];
}

export default async function CampaignDetailPage({ params, searchParams }: Props) {
  const { id: surveyId, cid } = await params;
  const sp = await searchParams;
  const scope = await getOperationsDataScope(surveyId);
  const recipPage = parsePage(sp.recipPage);
  const statuses = parseStatuses(sp.status);
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
    statuses,
    q,
  });

  const success = campaign.deliveredCount + campaign.openedCount;
  const errors = campaign.bouncedCount + campaign.failedCount + campaign.complainedCount;
  const inflight = campaign.queuedCount + campaign.sentCount;
  const statusBadge = STATUS_LABEL[campaign.status];
  const canCancel = campaign.status === 'queued' || campaign.status === 'draft';

  // 카운터 클릭 → 해당 status 조합으로 수신자 목록 필터. 카운터 숫자는 캠페인 전체 기준이라 q는 미유지.
  const recipientsHref = (statusList: MailRecipientStatus[]) => {
    const qs = statusList.length > 0 ? `?status=${statusList.join(',')}` : '';
    return `/admin/surveys/${surveyId}/operations/mail/campaigns/${cid}${qs}`;
  };

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

      {/* 카운터 카드 — 라벨은 수신자 목록 status badge 어휘와 정렬, 클릭 시 해당 status 조합으로 목록 필터 */}
      <Card className="p-6">
        <h2 className="mb-4 text-base font-semibold text-slate-900">발송 현황</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <Counter
            label="발송대상수"
            value={campaign.recipientCount}
            href={recipientsHref([])}
          />
          <Counter
            label="성공"
            value={success}
            tone="emerald"
            href={recipientsHref(['delivered', 'opened'])}
          />
          <Counter
            label="열람"
            value={campaign.openedCount}
            href={recipientsHref(['opened'])}
          />
          <Counter
            label="미열람"
            value={campaign.deliveredCount}
            href={recipientsHref(['delivered'])}
          />
          <Counter
            label="미전달"
            value={errors}
            tone="rose"
            href={recipientsHref(['bounced', 'failed', 'complained'])}
          />
          <Counter
            label="진행중"
            value={inflight}
            tone="blue"
            hint="메일을 보내는 중이거나 도착 확인을 기다리고 있습니다. (대기 + 발송됨)"
            href={recipientsHref(['queued', 'sent'])}
          />
          {/* 수신거부 카운터는 status 집계가 아니라 현재 수신거부 인원(발송 후 해지 포함)이라 클릭 필터 미제공 */}
          <Counter label="수신거부" value={campaign.currentUnsubscribedCount} />
        </div>
      </Card>

      <CampaignRecipientsTable
        surveyId={surveyId}
        campaignId={cid}
        rows={recipients.rows}
        total={recipients.total}
        page={recipients.page}
        pageSize={PAGE_SIZE}
        currentStatuses={statuses}
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
  href,
}: {
  label: string;
  value: number;
  tone?: 'emerald' | 'rose' | 'blue';
  hint?: string;
  href?: string;
}) {
  const toneClass =
    tone === 'emerald'
      ? 'text-emerald-700'
      : tone === 'rose'
        ? 'text-rose-600'
        : tone === 'blue'
          ? 'text-blue-600'
          : 'text-slate-900';
  // 브라우저 기본 title 은 표시까지 ~1초 지연이 있어 group-hover 즉시 표시 CSS tooltip 사용
  // (Radix tooltip 은 RSC 페이지에서 hydration mismatch 로 카드가 사라지는 문제가 있어 미사용)
  const inner = (
    <>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${toneClass}`}>
        {value.toLocaleString('ko-KR')}
      </div>
      {hint ? (
        <span className="bg-popover text-popover-foreground pointer-events-none invisible absolute top-full left-1/2 z-10 mt-1.5 w-max max-w-56 -translate-x-1/2 rounded-md border px-3 py-1.5 text-xs font-normal opacity-0 shadow-md transition-opacity duration-100 group-hover:visible group-hover:opacity-100">
          {hint}
        </span>
      ) : null}
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        className="group relative block rounded-lg border border-slate-200 bg-white p-3 transition-colors hover:border-slate-300 hover:bg-slate-50"
      >
        {inner}
      </Link>
    );
  }
  return (
    <div className="group relative rounded-lg border border-slate-200 bg-white p-3">{inner}</div>
  );
}
