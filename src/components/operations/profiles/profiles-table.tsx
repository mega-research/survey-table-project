'use client';

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import { useMemo } from 'react';

import { LocalDateTime } from '@/components/ui/local-date-time';
import { useSearchParamsMutator } from '@/hooks/use-search-params-mutator';
import { cn } from '@/lib/utils';
import { formatPlatformKo } from '@/lib/operations/parse-ua';
import {
  formatTotalTime,
  mapStatusPill,
  parseQuestionNumberFromTitle,
  type ProfilesView,
  type SortDir,
  type SortKey,
  type StatusPillResult,
} from '@/lib/operations/profiles';
import type { ProfilesRow } from '@/lib/operations/profiles.server';

import { EmptyState } from '../empty-state';
import {
  ALIGN_CLASS,
  SortIndicator,
  TablePagerFooter,
  type CellAlign,
} from '../table-primitives';
import { ProfilesRowActions } from './profiles-row-actions';
import { StatusPill } from './status-pill';

interface QuestionMeta {
  id: string;
  order: number;
  title: string;
}

interface ColumnMeta {
  align: CellAlign;
  sortable: boolean;
}

interface Props {
  rows: ProfilesRow[];
  total: number;
  page: number;
  pageSize: number;
  sort: SortKey;
  dir: SortDir;
  /** 진척률 N/M·Qx 표기에 사용. surveyId 의 questions 메타 (id → order, title) */
  questions: ReadonlyArray<QuestionMeta>;
  surveyId: string;
  view: ProfilesView;
}

interface DisplayRow {
  id: string;
  idx: number;
  groupValue: string | null;
  platformKo: string;
  browser: string;
  pill: StatusPillResult;
  startedAt: Date;
  completedAt: Date | null;
  isInProgress: boolean;
  totalTimeText: string;
}

const meta = (align: CellAlign, sortable: boolean): ColumnMeta => ({ align, sortable });

/**
 * 응답 내역 테이블. 9 컬럼 + URL state sort/pagination + 검색 결과 EmptyState.
 */
export function ProfilesTable({ rows, total, page, pageSize, sort, dir, questions, surveyId, view }: Props) {
  const pushParams = useSearchParamsMutator();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const questionsById = useMemo(() => {
    const map = new Map<string, QuestionMeta>();
    for (const q of questions) map.set(q.id, q);
    return map;
  }, [questions]);

  const totalSteps = questions.length;

  const display = useMemo<DisplayRow[]>(
    () =>
      rows.map((r) => {
        const q = r.currentStepId ? questionsById.get(r.currentStepId) : undefined;
        const qNumber = q ? parseQuestionNumberFromTitle(q.title) : null;
        const pill = mapStatusPill({
          status: r.status,
          currentStepOrder: q?.order ?? null,
          totalSteps,
          qNumber,
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
          groupValue: r.groupValue,
          platformKo: formatPlatformKo(r.platform),
          browser: r.browser ?? 'Other',
          pill,
          startedAt: r.startedAt,
          completedAt: r.completedAt,
          isInProgress: r.status === 'in_progress',
          totalTimeText: formatTotalTime(r.totalSeconds, r.status),
        };
      }),
    [rows, questionsById, totalSteps],
  );

  const columns = useMemo<ColumnDef<DisplayRow>[]>(
    () => [
      { id: 'idx', accessorKey: 'idx', header: '순번', meta: meta('right', true) },
      {
        id: 'group',
        accessorFn: (r: DisplayRow) => r.groupValue ?? '공개링크',
        header: '조사 대상 그룹',
        meta: meta('left', false),
      },
      {
        id: 'platform',
        accessorKey: 'platformKo',
        header: '접속 단말',
        meta: meta('left', true),
      },
      { id: 'browser', accessorKey: 'browser', header: '브라우저', meta: meta('left', true) },
      {
        id: 'status',
        accessorKey: 'pill',
        header: '상태',
        cell: ({ row }) => <StatusPill pill={row.original.pill} />,
        meta: meta('center', false),
      },
      {
        id: 'startedAt',
        accessorKey: 'startedAt',
        header: '시작일시',
        cell: ({ row }) => <LocalDateTime value={row.original.startedAt} />,
        meta: meta('left', true),
      },
      {
        id: 'completedAt',
        accessorKey: 'completedAt',
        header: '종료일시',
        cell: ({ row }) =>
          row.original.isInProgress ? (
            '진행 중'
          ) : (
            <LocalDateTime value={row.original.completedAt} />
          ),
        meta: meta('left', true),
      },
      {
        id: 'totalSeconds',
        accessorKey: 'totalTimeText',
        header: '소요시간',
        meta: meta('right', true),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <ProfilesRowActions
            surveyId={surveyId}
            responseId={row.original.id}
            idx={row.original.idx}
            view={view}
          />
        ),
        meta: meta('center', false),
      },
    ],
    [surveyId, view],
  );

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
                      'px-3 py-2 text-xs font-medium uppercase tracking-wider text-slate-600',
                      ALIGN_CLASS[align],
                    )}
                  >
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
                return (
                  <td
                    key={cell.id}
                    className={cn(
                      'px-3 py-2 text-slate-700 tabular-nums',
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
        />
      )}
    </div>
  );
}
