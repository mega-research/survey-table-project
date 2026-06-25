'use client';

import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
  type SortingState,
} from '@tanstack/react-table';
import { useMemo, useState } from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { DailyStatsRow } from '@/lib/operations/daily-stats';
import { numberFormatter } from '@/lib/operations/format';

import { EmptyState } from './empty-state';
import { ALIGN_CLASS, SortIndicator, TablePagerFooter, type CellAlign } from './table-primitives';

interface Props {
  data: DailyStatsRow[];
}

/** 0~1 비율 → '78.7%' 형태 (소수 첫째 자리). null → '—' */
function formatRate(rate: number | null): string {
  if (rate === null) return '—';
  return `${(rate * 100).toFixed(1)}%`;
}

/** 0~1 비율 → '12.4' (소수 첫째 자리, % 기호 없음). null → '—' */
function formatColumnPct(pct: number | null): string {
  if (pct === null) return '—';
  return (pct * 100).toFixed(1);
}

/**
 * 운영 현황 콘솔 — A3 일자별 통계 표.
 *
 * - 5개 컬럼 (일자 / Total / Completed / Col % / Drop) 모두 정렬 가능.
 * - 기본 정렬은 일자 내림차순 (최근 → 과거).
 * - 비어 있으면 EmptyState 로 대체.
 *
 * 정렬 표시는 활성 컬럼에만 ▲ / ▼ 아이콘으로 노출 (헤더 클릭으로 토글).
 */
export function DailyStatsTable({ data }: Props) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'date', desc: true }]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });

  const columns = useMemo<ColumnDef<DailyStatsRow>[]>(
    () => [
      {
        id: 'date',
        accessorKey: 'date',
        header: '일자',
        // label 필드를 표시하되 정렬은 underlying date 문자열(YYYY-MM-DD lexical)로
        // (색상은 부모 <td> 의 text-slate-700 을 상속)
        cell: ({ row }) => row.original.label,
        meta: { align: 'left' as const },
      },
      {
        id: 'total',
        accessorKey: 'total',
        header: '전체',
        cell: ({ getValue }) => numberFormatter.format(getValue<number>()),
        meta: { align: 'right' as const },
      },
      {
        id: 'completed',
        // completed 자체로 정렬 (rate가 아니라 count 기준이 더 자연스러움 — 목업과 동일)
        accessorKey: 'completed',
        header: '완료',
        cell: ({ row }) => {
          const completed = row.original.completed;
          const rate = row.original.completionRate;
          return (
            <span>
              {numberFormatter.format(completed)}
              {rate !== null && (
                <span className="ml-1 text-xs text-slate-400">
                  ({formatRate(rate)})
                </span>
              )}
            </span>
          );
        },
        meta: { align: 'right' as const },
      },
      {
        id: 'columnPct',
        accessorKey: 'columnPct',
        header: '점유율',
        cell: ({ getValue }) => formatColumnPct(getValue<number | null>()),
        // null 은 항상 가장 작은 값으로 — 점유율은 total=0일 때만 null이라 실 데이터에는 없음
        sortUndefined: 'last',
        meta: { align: 'right' as const },
      },
      {
        id: 'drop',
        accessorKey: 'drop',
        header: '이탈',
        cell: ({ getValue }) => numberFormatter.format(getValue<number>()),
        meta: { align: 'right' as const },
      },
    ],
    [],
  );

  // TanStack Table useReactTable은 React Compiler 비호환 API라 국소 예외로 둔다.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  return (
    <Card>
      <CardContent className="px-5 py-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">일자별 통계 표</h3>
        </div>

        {data.length === 0 ? (
          <EmptyState message="일자별 데이터가 없습니다" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id} className="bg-slate-50">
                    {headerGroup.headers.map((header) => {
                      const align =
                        (header.column.columnDef.meta as { align?: CellAlign } | undefined)
                          ?.align ?? 'left';
                      const sortDir = header.column.getIsSorted();
                      const toggle = header.column.getToggleSortingHandler();
                      return (
                        <th
                          key={header.id}
                          scope="col"
                          className={cn(
                            'px-3 py-2 text-xs font-medium uppercase tracking-wider text-slate-600',
                            ALIGN_CLASS[align],
                          )}
                          aria-sort={
                            sortDir === 'asc'
                              ? 'ascending'
                              : sortDir === 'desc'
                                ? 'descending'
                                : 'none'
                          }
                        >
                          <button
                            type="button"
                            onClick={toggle}
                            className={cn(
                              'inline-flex items-center gap-1 select-none rounded hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
                              align === 'right' ? 'flex-row-reverse' : '',
                            )}
                          >
                            {flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                            <SortIndicator direction={sortDir} />
                          </button>
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
                      const align =
                        (cell.column.columnDef.meta as { align?: CellAlign } | undefined)
                          ?.align ?? 'left';
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
            {table.getPageCount() > 1 && (
              <TablePagerFooter
                total={data.length}
                page={table.getState().pagination.pageIndex + 1}
                totalPages={table.getPageCount()}
                onPrev={() => table.previousPage()}
                onNext={() => table.nextPage()}
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
