'use client';

import { useState } from 'react';

import { ChevronDown } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { numberFormatter } from '@/features/operations/format';
import type { ShareQuotaCellStatus, ShareQuotaStatus } from '@/lib/quota/quota-status-calc';
import { cn } from '@/lib/utils';

import { buildQuotaPivot, pivotCategoryIds, pivotColBorderClass, pivotColKey } from './quota-pivot';

interface Props {
  status: ShareQuotaStatus;
}

/** 셀 키 — `lib/quota/matching.ts` `cellKeyOf` 와 같은 규약(구분자 없이 join). */
function cellKey(categoryIds: string[]): string {
  return categoryIds.join('');
}

/**
 * 외주 실사 링크의 쿼터 현황판 — 셀마다 **내 완료 수와 마감 여부만** 그린다 (fieldwork-multi-company 티켓 08).
 *
 * 연구원·클라이언트가 보는 `QuotaStatusPanel` 과 얼굴(접힌 카드 · 매트릭스/목록 토글 · 피벗)을 맞추되 숫자가
 * 다르다: 받는 모양(`ShareQuotaStatus`)에 목표·전체 달성 수가 없으므로 「n / m」·달성률·부족 수를 그릴 재료가
 * 없다. 그래서 「부족 셀 순」 대신 **접수 중인 셀 먼저** 목록을 둔다 — 외주가 묻는 것은 「이 셀을 계속
 * 걸어야 하나」다. 마감은 설문 전체 기준이라 내 완료 수가 0 이어도 마감일 수 있다.
 *
 * 행 끝·열 끝 「계」는 내 완료 수 합이다(목표 합이 아니다).
 */
export function ShareQuotaStatusPanel({ status }: Props) {
  const pivot = buildQuotaPivot(status.dimensions);
  const canMatrix = status.dimensions.length === 2 || pivot !== null;
  const [view, setView] = useState<'matrix' | 'list'>(canMatrix ? 'matrix' : 'list');
  const [open, setOpen] = useState(false);

  const byKey = new Map(status.cells.map((c) => [cellKey(c.categoryIds), c]));
  const sumMine = (keys: string[]): number | null => {
    let hit = false;
    let sum = 0;
    for (const key of keys) {
      const c = byKey.get(key);
      if (!c) continue;
      hit = true;
      sum += c.mine;
    }
    return hit ? sum : null;
  };
  const allKeys = status.cells.map((c) => cellKey(c.categoryIds));

  // 접수 중인 셀 먼저, 그 안은 등록 순서 그대로(정렬 키가 될 목표가 없다).
  const listed = [...status.cells.filter((c) => !c.closed), ...status.cells.filter((c) => c.closed)];

  const showMatrix = canMatrix && view === 'matrix';
  const dim0 = status.dimensions[0];
  const dim1 = status.dimensions[1];
  const hasCells = status.cells.length > 0;

  // 2조건은 행 × 열, 3조건은 피벗 — 둘 다 「행 카테고리 + 열」 좌표를 categoryIds 로 접는다.
  const grid =
    showMatrix && pivot
      ? {
          rowLabel: pivot.rowDim.label,
          rows: pivot.rowDim.categories,
          outer: pivot.colOuterDim.categories.map((c) => ({
            ...c,
            span: pivot.colInnerDim.categories.length,
          })),
          columns: pivot.columns.map((col, ci) => ({
            key: pivotColKey(col),
            label: col.inner.label,
            border: pivotColBorderClass(ci, pivot),
            idsFor: (rowId: string) => pivotCategoryIds(status.dimensions, pivot, rowId, col),
          })),
        }
      : showMatrix && dim0 && dim1
        ? {
            rowLabel: dim0.label,
            rows: dim0.categories,
            outer: null,
            columns: dim1.categories.map((col, ci) => ({
              key: col.id,
              label: col.label,
              border: ci < dim1.categories.length - 1 ? 'border-r border-r-slate-200' : '',
              idsFor: (rowId: string) => [rowId, col.id],
            })),
          }
        : null;

  return (
    <Card>
      <CardContent className="px-5 py-4">
        <Collapsible open={open} onOpenChange={setOpen}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CollapsibleTrigger
              render={<button type="button" className="flex items-center gap-2 hover:opacity-80" />}
            >
              <ChevronDown
                className={cn('h-4 w-4 text-slate-400 transition-transform', open && 'rotate-180')}
              />
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                쿼터 현황
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[11px] font-bold',
                    status.enabled ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-500',
                  )}
                >
                  {status.enabled ? '집행 중' : '집계만'}
                </span>
              </h3>
            </CollapsibleTrigger>
            {open && hasCells && (
              <div
                role="tablist"
                aria-label="쿼터 현황 보기"
                className="flex overflow-hidden rounded-lg border border-slate-300 text-xs"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={showMatrix}
                  disabled={!canMatrix}
                  onClick={() => setView('matrix')}
                  className={cn(
                    'px-3 py-1.5 transition-colors',
                    showMatrix
                      ? 'bg-blue-500 font-semibold text-white'
                      : canMatrix
                        ? 'text-slate-500 hover:bg-slate-50'
                        : 'cursor-not-allowed text-slate-300',
                  )}
                >
                  매트릭스
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={!showMatrix}
                  onClick={() => setView('list')}
                  className={cn(
                    'border-l border-slate-300 px-3 py-1.5 transition-colors',
                    !showMatrix ? 'bg-blue-500 font-semibold text-white' : 'text-slate-500 hover:bg-slate-50',
                  )}
                >
                  접수 중 먼저
                </button>
              </div>
            )}
          </div>

          <CollapsibleContent className="mt-3">
            <p className="mb-3 text-xs text-slate-500">
              칸의 숫자는 맡은 조사 대상의 완료 수입니다. 마감은 설문 전체 기준입니다.
            </p>
            {!hasCells ? (
              <p className="py-6 text-center text-sm text-slate-500">목표가 설정된 셀이 없습니다</p>
            ) : grid ? (
              <div className="mx-auto max-h-[70vh] w-fit max-w-full overflow-auto rounded-lg border border-slate-200">
                <table className="border-separate border-spacing-0 text-sm">
                  <thead className="sticky top-0 z-10">
                    {grid.outer && (
                      <tr>
                        <th
                          rowSpan={2}
                          className="max-w-[160px] min-w-[110px] border-r border-b border-slate-300 bg-slate-50 px-3 py-2 text-left align-middle text-xs font-semibold break-keep text-slate-500"
                        >
                          {grid.rowLabel}
                        </th>
                        {grid.outer.map((outer, oi) => (
                          <th
                            key={outer.id}
                            colSpan={outer.span}
                            className={cn(
                              'border-b border-slate-200 bg-slate-50 px-2 py-1.5 text-center text-xs font-semibold text-slate-700',
                              oi < grid.outer!.length - 1 && 'border-r border-r-slate-300',
                            )}
                          >
                            {outer.label}
                          </th>
                        ))}
                        <th
                          rowSpan={2}
                          className="border-b border-l border-slate-300 bg-slate-100 px-3 py-2 text-center align-middle text-xs font-semibold text-slate-700"
                        >
                          계
                        </th>
                      </tr>
                    )}
                    <tr>
                      {!grid.outer && (
                        <th className="border-r border-b border-slate-300 bg-slate-50 px-3 py-2 text-left text-xs font-semibold text-slate-500">
                          {grid.rowLabel}
                        </th>
                      )}
                      {grid.columns.map((col) => (
                        <th
                          key={col.key}
                          className={cn(
                            'border-b border-slate-300 bg-slate-50 px-2 py-1.5 text-center text-xs font-semibold text-slate-500',
                            col.border,
                          )}
                        >
                          {col.label}
                        </th>
                      ))}
                      {!grid.outer && (
                        <th className="border-b border-l border-slate-300 bg-slate-100 px-3 py-2 text-center text-xs font-semibold text-slate-700">
                          계
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {grid.rows.map((row) => (
                      <tr key={row.id}>
                        <th
                          scope="row"
                          className="border-r border-b border-r-slate-300 border-b-slate-200 bg-slate-50 px-3 py-1.5 text-left text-sm font-semibold whitespace-nowrap text-slate-700"
                        >
                          {row.label}
                        </th>
                        {grid.columns.map((col) => {
                          const c = byKey.get(cellKey(col.idsFor(row.id)));
                          return (
                            <td key={col.key} className={cn('border-b border-b-slate-200 p-1', col.border)}>
                              {c ? <MineCell cell={c} /> : <UnsetCell />}
                            </td>
                          );
                        })}
                        <TotalCell total={sumMine(grid.columns.map((col) => cellKey(col.idsFor(row.id))))} />
                      </tr>
                    ))}
                    <tr>
                      <th
                        scope="row"
                        className="border-t border-r border-t-slate-300 border-r-slate-300 bg-slate-100 px-3 py-1.5 text-left text-sm font-semibold text-slate-700"
                      >
                        계
                      </th>
                      {grid.columns.map((col) => (
                        <TotalCell
                          key={col.key}
                          total={sumMine(grid.rows.map((row) => cellKey(col.idsFor(row.id))))}
                          className={cn('border-t border-t-slate-300', col.border)}
                        />
                      ))}
                      <TotalCell total={sumMine(allKeys)} className="border-t border-t-slate-300" grand />
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <ol className="divide-y divide-slate-100">
                {listed.map((c) => (
                  <li
                    key={cellKey(c.categoryIds)}
                    className="flex items-center gap-4 py-2.5 first:pt-0 last:pb-0"
                  >
                    <span
                      className={cn(
                        'w-40 shrink-0 truncate text-sm font-semibold',
                        c.closed ? 'text-slate-500' : 'text-slate-900',
                      )}
                    >
                      {c.labels.join(' · ')}
                    </span>
                    <span className="flex-1 text-xs text-slate-500">
                      내 완료 <span className="font-semibold text-slate-700">{numberFormatter.format(c.mine)}</span>
                    </span>
                    <ClosedBadge closed={c.closed} />
                  </li>
                ))}
              </ol>
            )}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

function ClosedBadge({ closed }: { closed: boolean }) {
  return closed ? (
    <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-bold text-emerald-600">
      마감
    </span>
  ) : (
    <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-bold text-blue-600">
      접수 중
    </span>
  );
}

/** 매트릭스 한 칸 — 내 완료 수와 마감 표시. 마감 칸은 옅은 초록, 접수 중인 칸은 흰 바탕. */
function MineCell({ cell }: { cell: ShareQuotaCellStatus }) {
  return (
    <div
      className={cn(
        'flex items-center justify-center gap-1.5 rounded px-2 py-1 text-sm font-semibold tabular-nums whitespace-nowrap',
        cell.closed ? 'bg-emerald-50 text-emerald-600' : 'text-slate-700',
      )}
    >
      <span>{numberFormatter.format(cell.mine)}</span>
      {cell.closed && <span className="text-[11px] font-bold">마감</span>}
    </div>
  );
}

function TotalCell({
  total,
  className,
  grand = false,
}: {
  total: number | null;
  className?: string;
  grand?: boolean;
}) {
  return (
    <td
      className={cn(
        'border-b border-l border-b-slate-200 border-l-slate-300 bg-slate-100 px-3 py-1.5 text-center text-sm tabular-nums whitespace-nowrap',
        grand ? 'font-bold text-slate-900' : 'font-semibold text-slate-700',
        className,
      )}
    >
      {total === null ? '—' : numberFormatter.format(total)}
    </td>
  );
}

/** 목표가 등록되지 않은 조합 — 미설정 표시. */
function UnsetCell() {
  return <div className="px-2 py-1 text-center text-xs text-slate-300">—</div>;
}
