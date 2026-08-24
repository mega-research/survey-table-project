import Link from 'next/link';

import { HeaderFilterPopover } from '@/features/operations/filters/header-filter-popover';
import { Card } from '@/components/ui/card';
import { LocalDateTime } from '@/components/ui/local-date-time';
import { PagerJump } from '@/features/operations/pager-jump';
import { buildPageItems } from '@/features/operations/table-primitives';
import type { MailRecipientStatus } from '@/shared/contracts/mail';
import type { CampaignRecipientRow } from '@/shared/contracts/mail-io';
import { RECIPIENT_FILTER_LABEL, RECIPIENT_FILTER_SOURCE } from '@/lib/operations/filter-shared';
import type { HeaderFilterEntry } from '@/features/operations/filters/header-filter-url';

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
  /** 활성 깔때기(hcol/hm/hv) — 칩·검색 링크가 유실시키지 않도록 함께 실어 나른다. */
  headerEntries: HeaderFilterEntry[];
  /** 그룹 깔때기 체크박스 선택지 (이 캠페인 수신자에 실제로 등장하는 값) */
  groupOptions: Array<{ value: string; label: string }>;
  /** 메모(반송/실패 사유) 깔때기 체크박스 선택지 */
  errorOptions: Array<{ value: string; label: string }>;
  /** 최근 결과코드 깔때기 체크박스 선택지 */
  resultOptions: Array<{ value: string; label: string }>;
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

/**
 * 이 화면의 이메일 검색은 rq 다. 깔때기 적용이 빌더 파라미터('q')를 지우므로,
 * 구 URL 로 들어온 q 를 지워지기 전에 rq 로 옮긴다.
 */
const LEGACY_SEARCH_RENAME = { from: 'q', to: 'rq' } as const;

/** 필터가 좁아지면 첫 페이지로 — 공용 헬퍼는 'page' 만 리셋한다. */
const RECIPIENT_RESET_PARAMS = ['recipPage'];

type HrefOverrides = Partial<{
  statuses: MailRecipientStatus[];
  q: string;
  recipPage: number | string;
  headerEntries: HeaderFilterEntry[];
}>;

function buildHref(
  surveyId: string,
  campaignId: string,
  // recipPage 에 '__PAGE__' 토큰 문자열을 넘기면 PagerJump 용 href 템플릿이 된다.
  overrides: HrefOverrides,
): string {
  const params = new URLSearchParams();
  if (overrides.statuses && overrides.statuses.length > 0)
    params.set('status', overrides.statuses.join(','));
  // 이메일 검색은 rq — 깔때기 적용이 지우는 빌더 파라미터('q')와 이름이 겹치면 안 된다.
  if (overrides.q && overrides.q.trim()) params.set('rq', overrides.q.trim());
  // 상태 칩·페이저를 눌러도 깔때기가 살아 있어야 한다.
  for (const e of overrides.headerEntries ?? []) {
    params.append('hcol', e.source);
    params.append('hm', e.mode);
    params.append('hv', e.hv);
  }
  if (overrides.recipPage && overrides.recipPage !== 1)
    params.set('recipPage', String(overrides.recipPage));
  const qs = params.toString();
  return `/admin/surveys/${surveyId}/operations/mail/campaigns/${campaignId}${qs ? `?${qs}` : ''}`;
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
  headerEntries,
  groupOptions,
  errorOptions,
  resultOptions,
}: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // 모든 링크가 활성 깔때기를 기본으로 물고 간다 — 한 군데라도 빠뜨리면 그 링크를
  // 누르는 순간 필터가 조용히 풀린다.
  const hrefFor = (overrides: HrefOverrides): string =>
    buildHref(surveyId, campaignId, { headerEntries, ...overrides });

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
        {/* GET 폼 제출은 쿼리스트링을 폼 필드로 통째 교체한다 — 유지할 파라미터는
            전부 hidden 으로 실어야 검색 순간에 조용히 사라지지 않는다. */}
        <form className="flex items-center gap-2" action="" method="get">
          <input
            type="search"
            name="rq"
            defaultValue={currentQuery}
            placeholder="이메일 검색"
            className="rounded border border-slate-200 px-3 py-1.5 text-sm"
          />
          {currentStatuses.length > 0 ? (
            <input type="hidden" name="status" value={currentStatuses.join(',')} />
          ) : null}
          {headerEntries.map((e) => (
            <span key={e.source}>
              <input type="hidden" name="hcol" value={e.source} />
              <input type="hidden" name="hm" value={e.mode} />
              <input type="hidden" name="hv" value={e.hv} />
            </span>
          ))}
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
          href={hrefFor({ statuses: [], q: currentQuery })}
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
            href={hrefFor({
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
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50 text-left text-xs font-medium tracking-wide text-gray-500 uppercase">
                <th className="px-3 py-2">시스템ID</th>
                <th className="px-3 py-2">이메일</th>
                <th className="px-3 py-2">
                  <span className="inline-flex items-center gap-1">
                    {RECIPIENT_FILTER_LABEL[RECIPIENT_FILTER_SOURCE.GROUP]}
                    <HeaderFilterPopover
                      surveyId={surveyId}
                      source={RECIPIENT_FILTER_SOURCE.GROUP}
                      label={RECIPIENT_FILTER_LABEL[RECIPIENT_FILTER_SOURCE.GROUP] ?? '그룹'}
                      renameOnApply={LEGACY_SEARCH_RENAME}
                      resetParams={RECIPIENT_RESET_PARAMS}
                      fixedOptions={groupOptions}
                    />
                  </span>
                </th>
                <th className="px-3 py-2">상태</th>
                <th className="px-3 py-2">발송</th>
                <th className="px-3 py-2">전달</th>
                <th className="px-3 py-2">열람</th>
                <th className="px-3 py-2">
                  <span className="inline-flex items-center gap-1">
                    {RECIPIENT_FILTER_LABEL[RECIPIENT_FILTER_SOURCE.RESULT]}
                    <HeaderFilterPopover
                      surveyId={surveyId}
                      source={RECIPIENT_FILTER_SOURCE.RESULT}
                      label={RECIPIENT_FILTER_LABEL[RECIPIENT_FILTER_SOURCE.RESULT] ?? '최근 결과코드'}
                      renameOnApply={LEGACY_SEARCH_RENAME}
                      resetParams={RECIPIENT_RESET_PARAMS}
                      fixedOptions={resultOptions}
                    />
                  </span>
                </th>
                <th className="px-3 py-2">
                  <span className="inline-flex items-center gap-1">
                    {RECIPIENT_FILTER_LABEL[RECIPIENT_FILTER_SOURCE.ERROR]}
                    <HeaderFilterPopover
                      surveyId={surveyId}
                      source={RECIPIENT_FILTER_SOURCE.ERROR}
                      label={RECIPIENT_FILTER_LABEL[RECIPIENT_FILTER_SOURCE.ERROR] ?? '메모'}
                      renameOnApply={LEGACY_SEARCH_RENAME}
                      resetParams={RECIPIENT_RESET_PARAMS}
                      fixedOptions={errorOptions}
                    />
                  </span>
                </th>
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
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {r.latestResultCode ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-rose-600">{r.errorReason ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-end gap-1 text-sm">
          <span className="mr-1 text-slate-500">
            {page} / {totalPages}
          </span>
          <PageLink
            href={
              page > 1
                ? hrefFor({
                    statuses: currentStatuses,
                    q: currentQuery,
                    recipPage: page - 1,
                  })
                : null
            }
          >
            이전
          </PageLink>
          {buildPageItems(page, totalPages).map((item, i) =>
            item === 'ellipsis' ? (
              <span key={`ellipsis-${i}`} className="px-1 text-slate-400">
                …
              </span>
            ) : item === page ? (
              <span
                key={item}
                aria-current="page"
                className="rounded border border-blue-500 bg-blue-500 px-2 py-1 font-medium text-white"
              >
                {item}
              </span>
            ) : (
              <PageLink
                key={item}
                href={hrefFor({
                  statuses: currentStatuses,
                  q: currentQuery,
                  recipPage: item,
                })}
              >
                {item}
              </PageLink>
            ),
          )}
          <PageLink
            href={
              page < totalPages
                ? hrefFor({
                    statuses: currentStatuses,
                    q: currentQuery,
                    recipPage: page + 1,
                  })
                : null
            }
          >
            다음
          </PageLink>
          <PagerJump
            totalPages={totalPages}
            hrefTemplate={hrefFor({
              statuses: currentStatuses,
              q: currentQuery,
              recipPage: '__PAGE__',
            })}
          />
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
