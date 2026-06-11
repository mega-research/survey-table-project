'use client';

import { useSearchParamsMutator } from '@/hooks/use-search-params-mutator';
import { cn } from '@/lib/utils';
import {
  ALIGN_CLASS,
  SortIndicator,
  TablePagerFooter,
} from '@/components/operations/table-primitives';
import {
  computeRate,
  toneFromRate,
  type ProgressRow,
  type ProgressSortKey,
  type SortDir,
  type ProgressTotals,
} from '@/lib/operations/report-progress';
import type { ProgressColumnDef } from '@/db/schema/schema-types';
import { numberFormatter } from '@/lib/operations/format';

interface Props {
  rows: ProgressRow[];
  totals: ProgressTotals;
  metaColumns: ProgressColumnDef[];
  /** system.resid 컬럼 헤더 라벨 (contactColumns 에서 가져옴). 폴백 '번호'. */
  residLabel: string;
  page: number;
  size: number;
  sort: ProgressSortKey;
  dir: SortDir;
}

const TONE_CLASS: Record<string, string> = {
  green: 'bg-emerald-100 text-emerald-800',
  amber: 'bg-amber-100 text-amber-800',
  rose: 'bg-rose-100 text-rose-800',
  gray: 'bg-slate-100 text-slate-600',
};

function formatRate(completed: number, list: number): string {
  if (list === 0) return '0.00';
  return computeRate(completed, list).toFixed(2);
}

/**
 * 진척률 표 (Report 탭).
 *
 * - 헤더 정렬은 URL search params 기반 (sort/dir/page).
 * - meta 컬럼은 surveys.progress_columns 스킴에 따라 동적으로 렌더링.
 *   그룹 라벨 컬럼은 자동 노출하지 않음 — 컬럼 설정에서 hidden=false 한 키만 메타로 표시.
 * - 응답률은 임계값(toneFromRate)에 따라 색상 pill 로 표기.
 * - groupValueRaw=null('(미분류)') 도 안정적인 row key 유지.
 */
export function ProgressTable({
  rows,
  totals,
  metaColumns,
  residLabel,
  page,
  size,
  sort,
  dir,
}: Props) {
  const pushParams = useSearchParamsMutator();
  const totalPages = Math.max(1, Math.ceil(totals.groupCount / size));

  const handleSortClick = (colKey: ProgressSortKey) => {
    const newDir: SortDir = sort === colKey && dir === 'desc' ? 'asc' : 'desc';
    pushParams((p) => {
      p.set('sort', colKey);
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

  // 1 # + N meta + 3 fixed (리스트수/완료/응답률)
  const colSpan = 1 + metaColumns.length + 3;

  return (
    <div className="overflow-hidden rounded border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-700">
          <tr>
            <Th sort={sort} dir={dir} colKey="firstResid" align="right" onClick={handleSortClick}>
              {residLabel}
            </Th>
            {metaColumns.map((c) => (
              <Th
                key={c.key}
                sort={sort}
                dir={dir}
                colKey={`meta:${c.key}` as ProgressSortKey}
                align="left"
                onClick={handleSortClick}
              >
                {c.label}
              </Th>
            ))}
            <Th sort={sort} dir={dir} colKey="listCount" align="right" onClick={handleSortClick}>
              리스트수
            </Th>
            <Th
              sort={sort}
              dir={dir}
              colKey="completedCount"
              align="right"
              onClick={handleSortClick}
            >
              완료
            </Th>
            <Th
              sort={sort}
              dir={dir}
              colKey="responseRate"
              align="right"
              onClick={handleSortClick}
            >
              응답률 (%)
            </Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 && (
            <tr>
              <td colSpan={colSpan} className="px-4 py-6 text-center text-slate-400">
                검색 결과가 없습니다.
              </td>
            </tr>
          )}
          {rows.map((r) => {
            const tone = toneFromRate(r.completedCount, r.listCount);
            const rate = formatRate(r.completedCount, r.listCount);
            return (
              <tr key={r.groupValueRaw ?? '__null__'} className="hover:bg-slate-50">
                <td className={cn(ALIGN_CLASS.right, 'px-3 py-2 tabular-nums text-slate-500')}>
                  {r.firstResid ?? <span className="text-slate-300">—</span>}
                </td>
                {metaColumns.map((c) => {
                  const v = r.meta[c.key];
                  return (
                    <td
                      key={c.key}
                      className="max-w-[240px] truncate whitespace-nowrap px-3 py-2 text-slate-700"
                      title={v ?? undefined}
                    >
                      {v ?? <span className="text-slate-300">—</span>}
                    </td>
                  );
                })}
                <td className={cn(ALIGN_CLASS.right, 'px-3 py-2 tabular-nums text-slate-700')}>
                  {numberFormatter.format(r.listCount)}
                </td>
                <td className={cn(ALIGN_CLASS.right, 'px-3 py-2 tabular-nums text-slate-700')}>
                  {numberFormatter.format(r.completedCount)}
                </td>
                <td className={cn(ALIGN_CLASS.right, 'px-3 py-2')}>
                  <span
                    className={cn(
                      'inline-block rounded px-2 py-0.5 text-xs font-medium',
                      TONE_CLASS[tone],
                    )}
                  >
                    {rate}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
        리스트 합계 {numberFormatter.format(totals.listTotal)} · 완료{' '}
        {numberFormatter.format(totals.completedTotal)}
      </div>

      {totalPages > 1 && (
        <TablePagerFooter
          total={totals.groupCount}
          page={page}
          totalPages={totalPages}
          onPrev={() => handlePageChange(page - 1)}
          onNext={() => handlePageChange(page + 1)}
        />
      )}
    </div>
  );
}

interface ThProps {
  sort: ProgressSortKey;
  dir: SortDir;
  colKey: ProgressSortKey;
  align: 'left' | 'right';
  onClick: (colKey: ProgressSortKey) => void;
  children: React.ReactNode;
}

function Th({ sort, dir, colKey, align, onClick, children }: ThProps) {
  const active = sort === colKey;
  const ariaSort = active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={cn(
        'px-3 py-2 text-xs font-medium uppercase tracking-wider text-slate-600',
        ALIGN_CLASS[align],
      )}
    >
      <button
        type="button"
        onClick={() => onClick(colKey)}
        className={cn(
          'inline-flex items-center gap-1 select-none rounded hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
          align === 'right' ? 'flex-row-reverse' : '',
        )}
      >
        {children}
        <SortIndicator direction={active ? dir : false} />
      </button>
    </th>
  );
}
