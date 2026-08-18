'use client';

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import { useMemo } from 'react';

import { Badge } from '@/components/ui/badge';
import { LocalDateTime } from '@/components/ui/local-date-time';
import { useSearchParamsMutator } from '@/hooks/use-search-params-mutator';
import { cn } from '@/lib/utils';
import { formatPlatformKo } from '@/lib/operations/parse-ua';
import { formatIpHash } from '@/lib/operations/profile-columns';
import type { ProfileColumnDef } from '@/db/schema/schema-types';
import {
  formatTotalTime,
  mapStatusPill,
  type ProfilesView,
  type SortDir,
  type SortKey,
  type StatusPillResult,
  type StepLocation,
} from '@/lib/operations/profiles';
import type { ProfilesRow } from '@/lib/operations/profiles.server';

import { EmptyState } from '../empty-state';
import { HeaderFilterPopover } from '../filters/header-filter-popover';
import {
  ALIGN_CLASS,
  SortIndicator,
  TablePagerFooter,
  type CellAlign,
} from '../table-primitives';
import { ProfilesRowActions } from './profiles-row-actions';
import { StatusPill } from './status-pill';

interface ColumnMeta {
  align: CellAlign;
  sortable: boolean;
  /**
   * false = 자유 텍스트(attrs·pii) 컬럼 — 최대 폭 초과 시 말줄임 + title 노출.
   * true(기본) = 정형 값(날짜·숫자·상태 등) — 내용 폭 그대로. 모든 셀은 한 줄 고정.
   */
  nowrap?: boolean;
  /** 있으면 헤더에 깔때기 필터(HeaderFilterPopover)를 단다 — hcol 파라미터의 source. */
  filterSource?: string;
}

/** status 헤더 깔때기 고정 옵션 — StatusPill 라벨과 같은 상태 어휘. */
const STATUS_FUNNEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'completed', label: '완료' },
  { value: 'in_progress', label: '진행중' },
  { value: 'drop', label: '이탈' },
  { value: 'screened_out', label: '자격 미달' },
  { value: 'quotaful_out', label: '쿼터마감' },
  { value: 'bad', label: '불량' },
];

interface Props {
  rows: ProfilesRow[];
  total: number;
  page: number;
  pageSize: number;
  sort: SortKey;
  dir: SortDir;
  /**
   * 진척 위치 N/M·Qx 표기용. currentStepId(=페이지 step ID, 'group:…'|'table:…') →
   * 그 step 대표 질문의 order/질문번호 맵. profiles.ts 의 buildStepLocationMap 결과.
   */
  stepLocations: Record<string, StepLocation>;
  /** 진척 분모 M — 전체 질문 수. */
  totalSteps: number;
  surveyId: string;
  view: ProfilesView;
  /** 설문에 컨택 타겟이 존재하는지 — false 면 시스템ID 열을 만들지 않는다 (엑셀 내보내기와 동일 규칙) */
  hasContacts: boolean;
  /** 게스트 세션 — 행 액션에서 admin 전용 메뉴(삭제·초기화·복원)를 숨긴다. */
  isGuest: boolean;
  /** 표시 컬럼 스킴 — visibleProfileColumns 결과 (order 순, hidden 제외). */
  columnScheme: ProfileColumnDef[];
  /** contactTargetId → columnKey → 복호화 평문. 표시 스킴의 pii.* 키만 채워진다. */
  piiByTarget: Record<string, Record<string, string>>;
}

interface DisplayRow {
  id: string;
  idx: number;
  /** 매칭 컨택의 resid (번호/systemID). 익명이면 null → '—' 표시 */
  resid: number | null;
  groupValue: string | null;
  platformKo: string;
  browser: string;
  /** 원본 status — 액션 메뉴의 이탈 응답 안내(수정 시 완료 전환) 분기용. pill 은 표시 전용. */
  status: string;
  pill: StatusPillResult;
  startedAt: Date;
  completedAt: Date | null;
  isInProgress: boolean;
  totalTimeText: string;
  isTest: boolean;
  /** 매칭 컨택의 attrs — 스킴의 attrs.* 컬럼 표시용 */
  attrs: Record<string, string> | null;
  /** pii.* 컬럼의 piiByTarget 조인 키 */
  contactTargetId: string | null;
  /** ipHash 앞 8자 표시값 (전체 해시는 렌더하지 않음) */
  ipHashText: string;
}

const meta = (align: CellAlign, sortable: boolean, nowrap = true): ColumnMeta => ({
  align,
  sortable,
  nowrap,
});

/**
 * 응답 내역 테이블. 컬럼 스킴(profile_columns) 기반 동적 컬럼 + URL state
 * sort/pagination + 검색 결과 EmptyState. 스킴 미설정 시 서버가 기본 스킴
 * (기존 9컬럼)을 넘긴다.
 */
export function ProfilesTable({ rows, total, page, pageSize, sort, dir, stepLocations, totalSteps, surveyId, view, hasContacts, isGuest, columnScheme, piiByTarget }: Props) {
  const pushParams = useSearchParamsMutator();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const display = useMemo<DisplayRow[]>(
    () =>
      rows.map((r) => {
        const loc = r.currentStepId ? stepLocations[r.currentStepId] : undefined;
        const pill = mapStatusPill({
          status: r.status,
          visibleStepIndex: r.visibleStepIndex,
          visibleStepTotal: r.visibleStepTotal,
          totalQuestions: totalSteps,
          qNumber: loc?.qNumber ?? null,
        });
        if (r.status === 'completed' && r.completedAt === null) {
          // DB 일관성 깨짐 방어 — 행은 '—' 로 노출하되 운영자가 파악할 수 있게 로깅
           
          console.warn('[profiles-table] completed status with null completed_at', {
            id: r.id,
          });
        }
        return {
          id: r.id,
          idx: r.idx,
          resid: r.resid,
          groupValue: r.groupValue,
          platformKo: formatPlatformKo(r.platform),
          browser: r.browser ?? 'Other',
          status: r.status,
          pill,
          startedAt: r.startedAt,
          completedAt: r.completedAt,
          isInProgress: r.status === 'in_progress',
          totalTimeText: formatTotalTime(r.totalSeconds, r.status),
          isTest: r.isTest,
          attrs: r.attrs,
          contactTargetId: r.contactTargetId,
          ipHashText: formatIpHash(r.ipHash),
        };
      }),
    [rows, stepLocations, totalSteps],
  );

  const columns = useMemo<ColumnDef<DisplayRow>[]>(() => {
    // 스킴 항목 → TanStack 컬럼. sys.* 는 고정 렌더, attrs./pii. 는 값 조회.
    const buildColumn = (c: ProfileColumnDef): ColumnDef<DisplayRow> | null => {
      if (c.key.startsWith('attrs.')) {
        const attrKey = c.key.slice('attrs.'.length);
        return {
          id: c.key,
          accessorFn: (r: DisplayRow) => r.attrs?.[attrKey] ?? '—',
          header: c.label,
          // 자유 텍스트 — wrap 허용해 정형 컬럼 대신 남는 폭을 흡수.
          // 정렬은 조사 대상과 같은 attrs 자연 정렬 (숫자 값은 숫자순).
          meta: { ...meta('left', true, false), filterSource: c.key },
        };
      }
      if (c.key.startsWith('pii.')) {
        const piiKey = c.key.slice('pii.'.length);
        return {
          id: c.key,
          accessorFn: (r: DisplayRow) =>
            (r.contactTargetId && piiByTarget[r.contactTargetId]?.[piiKey]) || '—',
          header: c.label,
          meta: { ...meta('left', false, false), filterSource: c.key },
        };
      }
      switch (c.key) {
        case 'sys.idx':
          return { id: 'idx', accessorKey: 'idx', header: c.label, meta: meta('right', true) };
        case 'sys.resid':
          // 시스템ID 열은 컨택 있는 설문에만 — 엑셀 내보내기와 동일 규칙
          if (!hasContacts) return null;
          return {
            id: 'resid',
            accessorFn: (r: DisplayRow) => r.resid ?? '—',
            header: c.label,
            meta: meta('center', true),
          };
        case 'sys.group':
          return {
            id: 'group',
            accessorFn: (r: DisplayRow) => r.groupValue ?? '공개링크',
            header: c.label,
            meta: meta('left', true),
          };
        case 'sys.platform':
          return {
            id: 'platform',
            accessorKey: 'platformKo',
            header: c.label,
            meta: meta('left', true),
          };
        case 'sys.browser':
          return { id: 'browser', accessorKey: 'browser', header: c.label, meta: meta('left', true) };
        case 'sys.status':
          return {
            id: 'status',
            accessorKey: 'pill',
            header: c.label,
            cell: ({ row }) => (
              <div className="flex items-center justify-center gap-1.5">
                <StatusPill pill={row.original.pill} />
                {row.original.isTest && (
                  <Badge
                    variant="outline"
                    className="border-amber-300 bg-amber-50 text-amber-700"
                  >
                    테스트
                  </Badge>
                )}
              </div>
            ),
            meta: { ...meta('center', true), filterSource: 'status' },
          };
        case 'sys.startedAt':
          return {
            id: 'startedAt',
            accessorKey: 'startedAt',
            header: c.label,
            cell: ({ row }) => <LocalDateTime value={row.original.startedAt} />,
            meta: meta('left', true),
          };
        case 'sys.completedAt':
          return {
            id: 'completedAt',
            accessorKey: 'completedAt',
            header: c.label,
            cell: ({ row }) =>
              row.original.isInProgress ? (
                '진행 중'
              ) : (
                <LocalDateTime value={row.original.completedAt} />
              ),
            meta: meta('left', true),
          };
        case 'sys.totalSeconds':
          return {
            id: 'totalSeconds',
            accessorKey: 'totalTimeText',
            header: c.label,
            meta: meta('right', true),
          };
        case 'sys.ipHash':
          return {
            id: 'ipHash',
            accessorKey: 'ipHashText',
            header: c.label,
            meta: meta('left', false),
          };
        default:
          // 알 수 없는 키 (스킴 버전 차이 등) — 렌더에서 무시
          return null;
      }
    };

    return [
      ...columnScheme.map(buildColumn).filter((c): c is ColumnDef<DisplayRow> => c !== null),
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <ProfilesRowActions
            surveyId={surveyId}
            responseId={row.original.id}
            idx={row.original.idx}
            view={view}
            isGuest={isGuest}
            status={row.original.status}
          />
        ),
        meta: meta('center', false),
      },
    ];
  }, [surveyId, view, hasContacts, isGuest, columnScheme, piiByTarget]);

  // TanStack Table useReactTable은 React Compiler 비호환 API라 국소 예외로 둔다.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: display,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const handleSortClick = (columnId: string) => {
    const newSort = columnId as SortKey;
    const newDir: SortDir = sort === newSort && dir === 'desc' ? 'asc' : 'desc';
    pushParams((p) => {
      p.set('sort', newSort);
      p.set('dir', newDir);
      p.delete('page');
    });
  };

  const handlePageChange = (newPage: number) => {
    pushParams((p) => {
      if (newPage <= 1) p.delete('page');
      else p.set('page', String(newPage));
    });
  };

  if (rows.length === 0) {
    return (
      <EmptyState
        message="검색 결과가 없습니다"
        description="필터를 초기화하거나 검색어를 바꿔 보세요"
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="bg-slate-50">
              {headerGroup.headers.map((header) => {
                const m = header.column.columnDef.meta as ColumnMeta | undefined;
                const align = m?.align ?? 'left';
                const sortable = m?.sortable ?? false;
                const isActive = sortable && sort === (header.column.id as SortKey);
                const ariaSort = isActive
                  ? dir === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : 'none';
                return (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={ariaSort}
                    className={cn(
                      'whitespace-nowrap px-3 py-2 text-xs font-medium uppercase tracking-wider text-slate-600',
                      ALIGN_CLASS[align],
                    )}
                  >
                    <span className="inline-flex items-center gap-1">
                      {sortable ? (
                        <button
                          type="button"
                          onClick={() => handleSortClick(header.column.id)}
                          className={cn(
                            'inline-flex items-center gap-1 select-none rounded hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
                            align === 'right' ? 'flex-row-reverse' : '',
                          )}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <SortIndicator direction={isActive ? dir : false} />
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                      {m?.filterSource && (
                        <HeaderFilterPopover
                          surveyId={surveyId}
                          source={m.filterSource}
                          label={String(header.column.columnDef.header ?? '')}
                          {...(m.filterSource === 'status'
                            ? {
                                fixedOptions: STATUS_FUNNEL_OPTIONS,
                                // 상단 상태 select 와 모순 AND 방지 — 깔때기 적용이 이긴다.
                                // 단 status=deleted 는 삭제 뷰 선택이므로 보존.
                                onApplyParams: (p: URLSearchParams) => {
                                  if (p.get('status') !== 'deleted') p.delete('status');
                                },
                              }
                            : {})}
                        />
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="border-b border-slate-100">
              {row.getVisibleCells().map((cell) => {
                const m = cell.column.columnDef.meta as ColumnMeta | undefined;
                const align = m?.align ?? 'left';
                const isFreeText = m?.nowrap === false;
                return (
                  <td
                    key={cell.id}
                    // 자유 텍스트(attrs·pii)는 내용 폭만큼 한 줄 유지, 최대 폭 초과 시
                    // 말줄임 + title 로 전체 노출. 컬럼이 많아지면 내용 기준으로
                    // wrapper 의 overflow-x-auto 가로 스크롤이 생긴다.
                    title={isFreeText ? String(cell.getValue() ?? '') : undefined}
                    className={cn(
                      'whitespace-nowrap px-3 py-2 text-slate-700 tabular-nums',
                      isFreeText && 'max-w-60 truncate',
                      ALIGN_CLASS[align],
                    )}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

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
