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
  /** system.resid 컬럼 헤더 라벨 (contactColumns 에서 가져옴). */
  residLabel: string;
  /** 시스템ID(firstResid) 컬럼 표시 여부 (progressColumns.showResid). 기본 true. */
  showResid?: boolean;
  /**
   * 분류 기준(groupBy) 활성 시 기준 값 컬럼들 (key=attrs 키 — 정렬 식별자,
   * label=컬럼 설정 라벨). 순서는 row.groupValues 와 일치. 빈 배열이면 기존과
   * 동일 — 그룹 라벨 컬럼을 자동 노출하지 않고 번호(firstResid) 컬럼을 표시한다.
   */
  groupColumns?: Array<{ key: string; label: string }>;
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
  showResid = true,
  groupColumns = [],
  page,
  size,
  sort,
  dir,
}: Props) {
  const groupByActive = groupColumns.length > 0;
  // 시스템ID 컬럼은 groupBy 비활성 + showResid 일 때만.
  const residVisible = !groupByActive && showResid;
  const pushParams = useSearchParamsMutator();
  const totalPages = Math.max(1, Math.ceil(totals.groupCount / size));
  // 제외 사유 내역 — 서버가 배타적 버킷으로 세므로 합이 excludedTotal 과 같다.
  // 0 인 사유는 접는다 (대부분 설문에서 한두 가지만 발생).
  const excludeReasons = [
    { label: '자격 미달', count: totals.excludedScreenedOut },
    { label: '결과코드 부적격', count: totals.excludedNegativeCode },
    { label: '수신거부', count: totals.excludedUnsubscribed },
  ].filter((r) => r.count > 0);

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

  // (# 또는 그룹 값 컬럼 N개) + N meta + 3 fixed (리스트수/완료/응답률)
  const colSpan =
    (groupByActive ? groupColumns.length : residVisible ? 1 : 0) + metaColumns.length + 3;
  // 전체 행의 "전체" 라벨이 차지할 좌측 컬럼 수. 0 이면 라벨 칸 자체가 없다.
  const leadingColSpan = colSpan - 3;

  return (
    <div className="overflow-hidden rounded border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-700">
          <tr>
            {residVisible && (
              <Th sort={sort} dir={dir} colKey="firstResid" align="right" onClick={handleSortClick}>
                {residLabel}
              </Th>
            )}
            {groupColumns.map((c) => (
              <Th
                key={`group-${c.key}`}
                sort={sort}
                dir={dir}
                colKey={`group:${c.key}` as ProgressSortKey}
                align="left"
                onClick={handleSortClick}
              >
                {c.label}
              </Th>
            ))}
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
          {/* 전체 행 — 헤더 아래 항상 첫 줄. totals 는 getProgressTotals 가 준
              페이지네이션·분류 단계 무관 합계라, 대/중/소 어느 기준으로 묶어도
              같은 전체 값을 보여준다. 정렬·페이지 이동에도 자리를 지킨다. */}
          <tr className="border-b-2 border-slate-200 bg-slate-50 font-semibold text-slate-900">
            {leadingColSpan > 0 && (
              <td colSpan={leadingColSpan} className="px-3 py-2">
                전체
              </td>
            )}
            <td className={cn(ALIGN_CLASS.right, 'px-3 py-2 tabular-nums')}>
              {numberFormatter.format(totals.listTotal)}
            </td>
            <td className={cn(ALIGN_CLASS.right, 'px-3 py-2 tabular-nums')}>
              {numberFormatter.format(totals.completedTotal)}
            </td>
            <td className={cn(ALIGN_CLASS.right, 'px-3 py-2')}>
              <span
                className={cn(
                  'inline-block rounded px-2 py-0.5 text-xs font-semibold',
                  TONE_CLASS[toneFromRate(totals.completedTotal, totals.listTotal)],
                )}
              >
                {formatRate(totals.completedTotal, totals.listTotal)}
              </span>
            </td>
          </tr>
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
                {residVisible && (
                  <td className={cn(ALIGN_CLASS.right, 'px-3 py-2 tabular-nums text-slate-500')}>
                    {r.firstResid ?? <span className="text-slate-300">—</span>}
                  </td>
                )}
                {groupColumns.map((c, i) => {
                  const v = r.groupValues[i] ?? null;
                  return (
                    <td
                      key={`group-${c.key}`}
                      className="max-w-[240px] truncate whitespace-nowrap px-3 py-2 font-medium text-slate-800"
                      title={v ?? undefined}
                    >
                      {v ?? <span className="font-normal text-slate-400">(미분류)</span>}
                    </td>
                  );
                })}
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
        {totals.excludedTotal > 0 && (
          <>
            {' · 제외 '}
            {numberFormatter.format(totals.excludedTotal)}
            {excludeReasons.length > 0 && (
              <>
                {' ('}
                {excludeReasons
                  .map((r) => `${r.label} ${numberFormatter.format(r.count)}`)
                  .join(', ')}
                {')'}
              </>
            )}
          </>
        )}
      </div>

      {totalPages > 1 && (
        <TablePagerFooter
          total={totals.groupCount}
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
