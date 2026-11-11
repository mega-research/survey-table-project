'use client';

import { useMemo } from 'react';

import { HeaderFilterPopover } from '@/features/operations/filters/header-filter-popover';
import { useSearchParamsMutator } from '@/features/operations/hooks/use-search-params-mutator';
import { RecipientStatusBadge } from '@/features/operations/mail-campaign/recipient-status-badge';
import { StatusPill } from '@/features/operations/profiles/status-pill';
import { SortIndicator, TablePagerFooter } from '@/features/operations/table-primitives';
import { resolveContactRowMark } from '@/lib/contacts/result-code-row-mark';
import { formatLocalMonthDayTime } from '@/lib/date-formatters';
import {
  type ContactsSortDir,
  type ContactsSortKey,
  attrsKeyOf,
  piiKeyOf,
} from '@/lib/operations/contacts-format';
import {
  FILTER_SOURCE,
  MAIL_FILTER_OPTIONS,
  withNoneOption,
} from '@/lib/operations/filter-shared';
import { type StatusPillResult, mapStatusPill } from '@/lib/operations/profiles-format';
import { recipientStatusMeta } from '@/lib/operations/recipient-status';
import type {
  ContactColumnDef,
  ContactColumnScheme,
  ContactResultCode,
  ResultCodeRowMark,
} from '@/shared/contracts/contacts';
import type { ContactAssignmentOption, ContactsRow } from '@/shared/contracts/contacts-io';

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
  /** system.contact_owner 헤더 필터 체크박스 옵션 (컨택원 순서) + 「— (없음)」. */
  assignmentOptions?: ContactAssignmentOption[];
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
    source === FILTER_SOURCE.EMAIL ||
    source === FILTER_SOURCE.CONTACT_OWNER
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
    case 'system.contact_owner':
      // 컨택원 순서 → 이름, 배정 없음 마지막.
      return 'owner';
    default:
      return null;
  }
}

/**
 * 컬럼+행 → { display: ReactNode, plain: string | undefined } 한 번 계산.
 * `display` 는 셀 안에 렌더, `plain` 은 td title 에 truncate hover 용으로 사용.
 */
const PII_DASH = '—';

/**
 * 행 표시별 클래스 — 끝난 대상은 파란 음영(온라인 응답완료 행이 원래 쓰던 색), 빠지는 대상은 같은 세기의 붉은 음영.
 * 음영 행은 줄 사이 선도 같은 색 계열로 그린다(회색 선이 음영을 끊어 보이지 않게).
 */
const ROW_MARK_CLASS: Record<ResultCodeRowMark, { row: string; cell: string; hover: string }> = {
  none: { row: 'border-t', cell: '', hover: 'hover:bg-slate-50' },
  done: { row: 'bg-blue-50', cell: 'border-t border-blue-100', hover: 'hover:bg-blue-100' },
  out: { row: 'bg-rose-50', cell: 'border-t border-rose-100', hover: 'hover:bg-rose-100' },
};

function computeCell(
  col: ContactColumnDef,
  row: ContactsRow,
  rowMark: ResultCodeRowMark,
): {
  display: React.ReactNode;
  plain: string | undefined;
} {
  const attrsKey = attrsKeyOf(col.source);
  if (attrsKey) {
    const v = row.attrs[attrsKey];
    return v && v !== '' ? { display: v, plain: v } : { display: PII_DASH, plain: undefined };
  }
  const piiKey = piiKeyOf(col.source);
  if (piiKey) {
    // 목록 화면은 평문을 싣는다. 평문이 빠진 칸(복호화 실패)과 평문을 싣지 않은 호출은 힌트로 그린다.
    const plainValue = row.piiPlain?.[piiKey];
    if (plainValue) return { display: plainValue, plain: plainValue };
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
            // 빠지는 대상은 결과코드 글자도 붉게 — 행 음영만으로 뜻을 전하지 않는다.
            display: (
              <span
                className={rowMark === 'out' ? 'text-xs font-semibold text-rose-700' : 'text-xs'}
              >
                [{row.latestAttemptNo}] {row.latestResultCode}
              </span>
            ),
            plain: `[${row.latestAttemptNo}] ${row.latestResultCode}`,
          }
        : { display: '—', plain: undefined };
    case 'system.email_count':
      // latestMailStatus 는 서버의 유효 메일 상태(effectiveMailStatusExpr) — 수신거부
      // 판정이면 이미 'skipped_unsubscribed' 로 내려오므로 여기선 그대로 그린다.
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
      // 지금 맡은 컨택원 — 배정 없음은 다른 열의 빈 값과 같은 「—」.
      // 칩은 흰 바탕 + 테두리다 — 파란 바탕이면 끝난 대상의 파란 행 음영에 묻힌다.
      return row.assignment
        ? {
            display: (
              <span className="inline-block rounded border border-blue-200 bg-white px-1.5 py-px text-xs font-medium text-blue-700">
                {row.assignment.name}
              </span>
            ),
            plain: row.assignment.name,
          }
        : { display: '—', plain: undefined };
    default:
      return { display: '—', plain: undefined };
  }
}

/**
 * 조사 대상 목록 표.
 *
 * 컬럼 스킴(ContactColumnScheme) 기반 동적 헤더/셀 렌더 + 응답 완료 행 강조.
 * - attrs.* source: row.attrs[키] 표시
 * - pii.* source: 평문(row.piiPlain)이 실렸으면 그 값, 없으면 마스킹 힌트
 * - system.resid/contact_result/web: 시스템 필드
 * - system.email_count: 최신 메일 수신 상태 badge (mail_recipients, 발송 이력 없으면 —)
 * - system.contact_owner: 지금 맡은 컨택원 이름 칩 (배정 없음은 —)
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
  assignmentOptions = [],
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
          <thead className="bg-slate-50 text-xs text-slate-600 uppercase">
            <tr>
              {visibleColumns.map((col) => {
                const sortKey = sortKeyOf(col.source);
                const isActive = sortKey != null && sortKey === sort;
                return (
                  <th key={col.key} className="border-b px-3 py-2 text-left whitespace-nowrap">
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
                          {...(col.source === FILTER_SOURCE.CONTACT_OWNER
                            ? {
                                fixedOptions: withNoneOption(
                                  assignmentOptions.map((o) => ({ value: o.id, label: o.name })),
                                ),
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
              const rowMark = resolveContactRowMark(
                { responded: row.respondedAt != null, latestResultCode: row.latestResultCode },
                resultCodeOptions,
              );
              const tone = ROW_MARK_CLASS[rowMark];
              return (
                <tr
                  key={row.id}
                  data-row-mark={rowMark}
                  className={`${tone.row} ${onRowClick ? `cursor-pointer ${tone.hover}` : ''}`}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {visibleColumns.map((col) => {
                    const { display, plain } = computeCell(col, row, rowMark);
                    return (
                      <td
                        key={col.key}
                        className={`max-w-[240px] truncate px-3 py-2 whitespace-nowrap ${tone.cell}`}
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
          onPage={handlePageChange}
        />
      )}
    </div>
  );
}
