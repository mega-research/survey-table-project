'use client';

import { useMemo } from 'react';

import { RecipientStatusBadge } from '@/features/operations/mail-campaign/recipient-status-badge';
import { recipientStatusMeta } from '@/lib/operations/recipient-status';
import { HeaderFilterPopover } from '@/features/operations/filters/header-filter-popover';
import { StatusPill } from '@/features/operations/profiles/status-pill';
import { mapStatusPill, type StatusPillResult } from '@/lib/operations/profiles';
import { SortIndicator, TablePagerFooter } from '@/features/operations/table-primitives';
import type { ContactColumnDef, ContactColumnScheme, ContactResultCode } from '@/shared/contracts/contacts';
import { useSearchParamsMutator } from '@/features/operations/hooks/use-search-params-mutator';
import { formatLocalMonthDayTime } from '@/lib/date-formatters';
import { attrsKeyOf, piiKeyOf, type ContactsSortDir, type ContactsSortKey } from '@/lib/operations/contacts';
import type { ContactsRow } from '@/server/read-models/contacts.server';
import { FILTER_SOURCE, MAIL_FILTER_OPTIONS } from '@/lib/operations/filter-shared';

interface ContactsTableProps {
  rows: ContactsRow[];
  total: number;
  page: number;
  pageSize: number;
  scheme: ContactColumnScheme;
  /** 현재 활성 sort key (URL searchParams) */
  sort: ContactsSortKey;
  /** 현재 정렬 방향 */
  dir: ContactsSortDir;
  /** 헤더 필터 드롭다운의 distinct RPC 호출용 */
  surveyId: string;
  /** system.contact_result 헤더 필터 체크박스 옵션 */
  resultCodeOptions: ContactResultCode[];
  /** 행 클릭 시 호출 — 단건 편집 라우트로 push */
  onRowClick?: (row: ContactsRow) => void;
}

/** 헤더 필터 드롭다운을 붙일 수 있는 source 인지 — HeaderFilterPopover 분기와 일치. */
function isHeaderFilterable(source: string): boolean {
  return (
    source.startsWith(FILTER_SOURCE.ATTRS_PREFIX) ||
    source.startsWith(FILTER_SOURCE.PII_PREFIX) ||
    source === FILTER_SOURCE.CONTACT_RESULT ||
    source === FILTER_SOURCE.WEB ||
    source === FILTER_SOURCE.EMAIL
  );
}

/** ContactColumnDef.source → sort key 매핑. system.* 중 정렬 가능한 것만 매핑. */
function sortKeyOf(source: string): ContactsSortKey | null {
  if (source.startsWith('attrs.')) return source as ContactsSortKey;
  switch (source) {
    case 'system.resid':
      return 'resid';
    case 'system.web':
      // 매칭 응답의 활동 시각 기준 — respondedAt 은 미완료(진행중·이탈) 행이
      // 전부 NULL 이라 순서가 생기지 않는다.
      return 'webActivity';
    case 'system.email_count':
      // 최신 메일 수신 상태 순위 기준 (열람 → 전달 완료 → … → 실패, 없음 마지막).
      return 'mailStatus';
    default:
      return null;
  }
}

/**
 * 컬럼+행 → { display: ReactNode, plain: string | undefined } 한 번 계산.
 * `display` 는 셀 안에 렌더, `plain` 은 td title 에 truncate hover 용으로 사용.
 */
const PII_DASH = '—';

function computeCell(col: ContactColumnDef, row: ContactsRow): {
  display: React.ReactNode;
  plain: string | undefined;
} {
  const attrsKey = attrsKeyOf(col.source);
  if (attrsKey) {
    const v = row.attrs[attrsKey];
    return v && v !== ''
      ? { display: v, plain: v }
      : { display: PII_DASH, plain: undefined };
  }
  const piiKey = piiKeyOf(col.source);
  if (piiKey) {
    const hint = row.piiMaskHints[piiKey];
    if (hint?.maskHint) {
      // 마스킹 힌트 (예: "naver.com", "5678", "김**")
      return {
        display: <span className="text-slate-600">{hint.maskHint}</span>,
        plain: hint.maskHint,
      };
    }
    return { display: PII_DASH, plain: undefined };
  }
  switch (col.source) {
    case 'system.resid':
      return {
        display: <span className="tabular-nums">{row.resid}</span>,
        plain: String(row.resid),
      };
    case 'system.contact_result':
      return row.latestResultCode
        ? {
            display: (
              <span className="text-xs">
                [{row.latestAttemptNo}] {row.latestResultCode}
              </span>
            ),
            plain: `[${row.latestAttemptNo}] ${row.latestResultCode}`,
          }
        : { display: '—', plain: undefined };
    case 'system.email_count':
      return row.latestMailStatus
        ? {
            display: <RecipientStatusBadge status={row.latestMailStatus} />,
            plain: recipientStatusMeta(row.latestMailStatus).label,
          }
        : { display: '—', plain: undefined };
    case 'system.web': {
      if (row.responseStatus == null) {
        return {
          display: <span className="text-slate-400">—</span>,
          plain: undefined,
        };
      }
      // 응답 내역과 같은 상태 어휘(mapStatusPill) 재사용 — 부속 정보만 다르다:
      // 응답 내역은 스텝 상세, 여기(컨택 운영)는 진행률 %.
      const base = mapStatusPill({ status: row.responseStatus });
      const pill: StatusPillResult = {
        label: base.label,
        tone: base.tone,
        ...(row.responseStatus !== 'completed' && row.progressPct != null
          ? { sub: `${row.progressPct}%` }
          : {}),
      };
      const title = row.respondedAt
        ? `응답 ${formatLocalMonthDayTime(row.respondedAt)}`
        : undefined;
      return {
        // formatLocalMonthDayTime 은 브라우저 locale/tz 의존(Client 전용)이라
        // SSR HTML 의 title 과 hydration 결과가 어긋난다. td 의 suppressHydrationWarning 의존.
        display: <StatusPill pill={pill} />,
        plain: title ?? pill.label,
      };
    }
    case 'system.contact_owner':
      return { display: '—', plain: undefined }; // 후속 슬라이스 면접원
    default:
      return { display: '—', plain: undefined };
  }
}

/**
 * 조사 대상 목록 표.
 *
 * 컬럼 스킴(ContactColumnScheme) 기반 동적 헤더/셀 렌더 + 응답 완료 행 강조.
 * - attrs.* source: row.attrs[키] 표시 (이메일/사업자번호는 마스킹)
 * - system.resid/contact_result/web: 시스템 필드
 * - system.email_count: 최신 메일 수신 상태 badge (mail_recipients, 발송 이력 없으면 —)
 * - system.contact_owner: 다음 슬라이스 (면접원) 까지 placeholder
 *
 * 페이지네이션은 TablePagerFooter (totalPages/onPrev/onNext) 패턴을 그대로 사용.
 */
export function ContactsTable({
  rows,
  total,
  page,
  pageSize,
  scheme,
  sort,
  dir,
  surveyId,
  resultCodeOptions,
  onRowClick,
}: ContactsTableProps) {
  const pushParams = useSearchParamsMutator();

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const visibleColumns = useMemo(
    () => scheme.columns.filter((c) => !c.hidden).sort((a, b) => a.order - b.order),
    [scheme.columns],
  );

  const handlePageChange = (newPage: number) => {
    pushParams((p) => {
      if (newPage <= 1) p.delete('page');
      else p.set('page', String(newPage));
    });
  };

  /**
   * 컬럼 헤더 클릭 — sort/dir 토글.
   * 다른 컬럼 클릭 → 새 sort, dir=asc (web 은 desc — 첫 클릭이 최근 응답 순).
   * 같은 컬럼 재클릭 → dir 토글 (asc ↔ desc).
   */
  function toggleSort(key: ContactsSortKey) {
    pushParams((p) => {
      p.delete('page');
      if (sort === key) {
        const nextDir = dir === 'asc' ? 'desc' : 'asc';
        if (nextDir === 'asc') p.delete('dir');
        else p.set('dir', 'desc');
      } else {
        p.set('sort', key);
        // 시간축은 최근이 먼저가 자연스럽다 — 재클릭하면 처음 응답 순(asc).
        if (key === 'webActivity') p.set('dir', 'desc');
        else p.delete('dir');
      }
    });
  }

  return (
    <div>
      <div className="overflow-x-auto rounded border">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-600">
            <tr>
              {visibleColumns.map((col) => {
                const sortKey = sortKeyOf(col.source);
                const isActive = sortKey != null && sortKey === sort;
                return (
                  <th
                    key={col.key}
                    className="border-b px-3 py-2 text-left whitespace-nowrap"
                  >
                    <span className="inline-flex items-center gap-1">
                      {sortKey ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(sortKey)}
                          className="inline-flex items-center gap-1 hover:text-slate-900"
                        >
                          {col.label}
                          <SortIndicator direction={isActive ? dir : false} />
                        </button>
                      ) : (
                        col.label
                      )}
                      {isHeaderFilterable(col.source) && (
                        <HeaderFilterPopover
                          surveyId={surveyId}
                          source={col.source}
                          label={col.label}
                          {...(col.piiType !== undefined ? { piiType: col.piiType } : {})}
                          {...(col.source === FILTER_SOURCE.EMAIL
                            ? {
                                fixedOptions: MAIL_FILTER_OPTIONS.map((o) => ({
                                  value: o.value,
                                  label: o.label,
                                })),
                              }
                            : {})}
                          resultCodeOptions={resultCodeOptions}
                        />
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const responded = row.respondedAt != null;
              return (
                <tr
                  key={row.id}
                  className={`${responded ? 'bg-blue-50' : 'border-t'} ${onRowClick ? 'cursor-pointer hover:bg-slate-50' : ''}`}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {visibleColumns.map((col) => {
                    const { display, plain } = computeCell(col, row);
                    return (
                      <td
                        key={col.key}
                        className={`max-w-[240px] truncate px-3 py-2 whitespace-nowrap ${responded ? 'border-t border-blue-100' : ''}`}
                        title={plain}
                        suppressHydrationWarning
                      >
                        {display}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <TablePagerFooter
          total={total}
          page={page}
          totalPages={totalPages}
          onPrev={() => handlePageChange(page - 1)}
          onNext={() => handlePageChange(page + 1)}
          onPage={handlePageChange}
        />
      )}
    </div>
  );
}
