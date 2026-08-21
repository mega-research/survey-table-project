'use client';

import { useState } from 'react';

import { ChevronDown } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { numberFormatter } from '@/lib/operations/format';
import type { QuotaCellStatus, QuotaCellTone, QuotaStatus } from '@/lib/operations/quota-status';
import { cn } from '@/lib/utils';

import { EmptyState } from '../empty-state';
import { buildQuotaPivot, pivotCategoryIds, pivotColBorderClass, pivotColKey } from './quota-pivot';

interface Props {
  status: QuotaStatus;
  /** 테스트 모드 집계 여부 — 배지로 표시. 집행(quotaful_out)은 스코프와 무관하게 실응답 전용. */
  isTestScope?: boolean | undefined;
}

/** 파스텔 톤 클래스 (목업 색: emerald/blue/amber/rose 300계열). */
const TONE_BAR: Record<QuotaCellTone, string> = {
  done: 'bg-emerald-300',
  good: 'bg-blue-300',
  warn: 'bg-amber-300',
  low: 'bg-rose-300',
};
const TONE_TINT: Record<QuotaCellTone, string> = {
  done: 'bg-emerald-50',
  good: 'bg-blue-50',
  warn: 'bg-amber-50',
  low: 'bg-rose-50',
};
/** pct% 텍스트 색 — 목업 emerald-600/blue-600/amber-700/rose-600. */
const TONE_TEXT: Record<QuotaCellTone, string> = {
  done: 'text-emerald-600',
  good: 'text-blue-600',
  warn: 'text-amber-700',
  low: 'text-rose-600',
};
/** '마감'/'부족' 칩 — 목업과 동일하게 done/low 톤에만 표시 (good/warn은 칩 없음). */
const TONE_CHIP: Partial<Record<QuotaCellTone, { label: string; className: string }>> = {
  done: { label: '마감', className: 'bg-emerald-100 text-emerald-600' },
  low: { label: '부족', className: 'bg-rose-100 text-rose-600' },
};

const LEGEND: { tone: QuotaCellTone; label: string }[] = [
  { tone: 'done', label: '마감 (100%)' },
  { tone: 'good', label: '순조 70%+' },
  { tone: 'warn', label: '주의 40–69%' },
  { tone: 'low', label: '부족 <40%' },
];

interface ShortfallCell extends QuotaCellStatus {
  remaining: number;
}

/** 셀 키 — `lib/quota/matching.ts` `cellKeyOf`와 동일하게 구분자 없이 join. */
function cellKey(categoryIds: string[]): string {
  return categoryIds.join('');
}

function findCell(cells: QuotaCellStatus[], categoryIds: string[]): QuotaCellStatus | undefined {
  const key = cellKey(categoryIds);
  return cells.find((c) => cellKey(c.categoryIds) === key);
}

/**
 * 운영 현황 콘솔 — 쿼터 현황판.
 *
 * 매트릭스(히트맵) / 부족 셀 순(리스트) 두 뷰를 세그먼트 토글로 전환한다.
 * 조건 2개는 행×열, 3개는 피벗(행=최다 카테고리 조건, 열=나머지 둘 중첩 헤더)으로
 * 그린다. 조건이 1개이거나 4개 이상이면 매트릭스를 그릴 수 없으므로 부족 셀 순
 * 리스트로 폴백한다 — "매트릭스" 토글은 비활성화 처리.
 */
export function QuotaStatusPanel({ status, isTestScope = false }: Props) {
  // 3조건 전용 피벗 배치. 그 외 개수면 null.
  const pivot = buildQuotaPivot(status.dimensions);
  const canMatrix = status.dimensions.length === 2 || pivot !== null;
  const [view, setView] = useState<'matrix' | 'shortfall'>(canMatrix ? 'matrix' : 'shortfall');
  // 평소엔 접힘 — 제목 클릭으로 펼침/접힘 (2026-07-02 운영 피드백).
  const [open, setOpen] = useState(false);

  // 부족 셀 순 = 남은 수(target-current) 내림차순
  const shortfall: ShortfallCell[] = [...status.cells]
    .map((c) => ({ ...c, remaining: Math.max(0, c.target - c.current) }))
    .filter((c) => c.remaining > 0)
    .sort((a, b) => b.remaining - a.remaining);

  const showMatrix = canMatrix && view === 'matrix';
  const dim0 = status.dimensions[0];
  const dim1 = status.dimensions[1];

  return (
    <Card>
      <CardContent className="px-5 py-4">
        <Collapsible open={open} onOpenChange={setOpen}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CollapsibleTrigger asChild>
              <button type="button" className="flex items-center gap-2 hover:opacity-80">
                <ChevronDown
                  className={cn(
                    'h-4 w-4 text-slate-400 transition-transform',
                    open && 'rotate-180',
                  )}
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
                  {isTestScope && (
                    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-bold text-amber-600">
                      테스트 응답 집계
                    </span>
                  )}
                </h3>
              </button>
            </CollapsibleTrigger>
            {open && (
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
                  onClick={() => setView('shortfall')}
                  className={cn(
                    'border-l border-slate-300 px-3 py-1.5 transition-colors',
                    !showMatrix
                      ? 'bg-blue-500 font-semibold text-white'
                      : 'text-slate-500 hover:bg-slate-50',
                  )}
                >
                  부족 셀 순
                </button>
              </div>
            )}
          </div>

          <CollapsibleContent className="mt-3">
            {showMatrix && pivot ? (
              <>
                <MatrixLegend />
                {/* 세로 max-h + sticky thead — 스크롤해도 헤더가 테이블 끝까지 따라온다 (bulk-preview 패턴) */}
                <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200">
                  <table className="w-full border-separate border-spacing-0 text-sm">
                    <thead className="sticky top-0 z-10">
                      <tr>
                        <th
                          rowSpan={2}
                          className="max-w-[160px] min-w-[110px] border-r border-b border-slate-300 bg-slate-50 px-3 py-2 text-left align-middle text-xs font-semibold break-keep text-slate-500"
                        >
                          {pivot.rowDim.label}
                        </th>
                        {pivot.colOuterDim.categories.map((outer, oi) => (
                          <th
                            key={outer.id}
                            colSpan={pivot.colInnerDim.categories.length}
                            className={cn(
                              'border-b border-slate-200 bg-slate-50 px-2 py-1.5 text-center text-xs font-semibold text-slate-700',
                              oi < pivot.colOuterDim.categories.length - 1 &&
                                'border-r border-r-slate-300',
                            )}
                          >
                            {outer.label}
                          </th>
                        ))}
                      </tr>
                      <tr>
                        {pivot.columns.map((col, ci) => (
                          <th
                            key={pivotColKey(col)}
                            className={cn(
                              'border-b border-slate-300 bg-slate-50 px-2 py-1.5 text-center text-xs font-semibold text-slate-500',
                              pivotColBorderClass(ci, pivot),
                            )}
                          >
                            {col.inner.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pivot.rowDim.categories.map((row, ri) => {
                        const isLastRow = ri === pivot.rowDim.categories.length - 1;
                        return (
                          <tr key={row.id}>
                            <th
                              scope="row"
                              className={cn(
                                'border-r border-r-slate-300 bg-slate-50 px-3 py-2 text-left text-sm font-semibold whitespace-nowrap text-slate-700',
                                !isLastRow && 'border-b border-b-slate-100',
                              )}
                            >
                              {row.label}
                            </th>
                            {pivot.columns.map((col, ci) => {
                              const cell = findCell(
                                status.cells,
                                pivotCategoryIds(status.dimensions, pivot, row.id, col),
                              );
                              return (
                                <td
                                  key={pivotColKey(col)}
                                  className={cn(
                                    'p-1.5 align-top',
                                    !isLastRow && 'border-b border-b-slate-100',
                                    pivotColBorderClass(ci, pivot),
                                  )}
                                >
                                  {cell ? <QuotaHeatCell cell={cell} /> : <UnsetHeatCell />}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            ) : showMatrix && dim0 && dim1 ? (
              <>
                <MatrixLegend />
                <div className="max-h-[70vh] overflow-auto">
                  <table className="w-full border-separate border-spacing-0 text-sm">
                    <thead className="sticky top-0 z-10">
                      <tr>
                        <th className="bg-white p-2" />
                        {dim1.categories.map((col) => (
                          <th
                            key={col.id}
                            className="border-b border-slate-200 bg-slate-50 p-2 text-center text-xs font-semibold text-slate-700"
                          >
                            {col.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dim0.categories.map((row) => (
                        <tr key={row.id}>
                          <th className="border-r border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm font-semibold whitespace-nowrap text-slate-700">
                            {row.label}
                          </th>
                          {dim1.categories.map((col) => {
                            const cell = findCell(status.cells, [row.id, col.id]);
                            return (
                              <td
                                key={col.id}
                                className="border-r border-b border-slate-100 p-1.5 align-top"
                              >
                                {cell ? <QuotaHeatCell cell={cell} /> : <UnsetHeatCell />}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : shortfall.length === 0 ? (
              <EmptyState
                message="부족한 셀이 없습니다"
                description="모든 셀이 목표를 달성했습니다"
              />
            ) : (
              <ol className="divide-y divide-slate-100">
                {shortfall.map((cell, i) => (
                  <li
                    key={cellKey(cell.categoryIds)}
                    className="flex items-center gap-4 py-2.5 first:pt-0 last:pb-0"
                  >
                    <span className="w-5 shrink-0 text-xs font-bold text-slate-400">{i + 1}</span>
                    <span className="w-40 shrink-0 truncate text-sm font-semibold text-slate-900">
                      {cell.labels.join(' · ')}
                    </span>
                    <span className="w-24 shrink-0 text-xs text-slate-500">
                      {numberFormatter.format(cell.current)} / {numberFormatter.format(cell.target)}
                    </span>
                    <div className="h-2 max-w-xs flex-1 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className="h-full rounded-full bg-rose-300"
                        style={{ width: `${Math.min(100, cell.pct)}%` }}
                      />
                    </div>
                    <span className="w-24 shrink-0 text-right text-sm font-bold text-amber-700">
                      {numberFormatter.format(cell.remaining)}{' '}
                      <span className="text-xs font-normal text-slate-400">남음</span>
                    </span>
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

/** 매트릭스 한 칸 — current/target + 진행바 + pct% + (done/low만) 마감/부족 칩. */
function QuotaHeatCell({ cell }: { cell: QuotaCellStatus }) {
  const chip = TONE_CHIP[cell.tone];
  return (
    <div className={cn('flex min-w-[112px] flex-col gap-1.5 rounded-lg p-2', TONE_TINT[cell.tone])}>
      <div className="flex items-baseline gap-1">
        <span className="text-base font-bold text-slate-900">
          {numberFormatter.format(cell.current)}
        </span>
        <span className="text-xs text-slate-400">/ {numberFormatter.format(cell.target)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200/70">
        <div
          className={cn('h-full rounded-full', TONE_BAR[cell.tone])}
          style={{ width: `${Math.min(100, cell.pct)}%` }}
        />
      </div>
      <div className="flex min-h-[16px] items-center justify-between">
        <span className={cn('text-xs font-bold', TONE_TEXT[cell.tone])}>{cell.pct}%</span>
        {chip && (
          <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold', chip.className)}>
            {chip.label}
          </span>
        )}
      </div>
    </div>
  );
}

/** 매트릭스 공용 톤 범례 — 2조건/3조건 분기가 함께 쓴다. */
function MatrixLegend() {
  return (
    <div className="mb-4 flex flex-wrap gap-4 text-xs text-slate-500">
      {LEGEND.map((l) => (
        <span key={l.tone} className="flex items-center gap-1.5">
          <i className={cn('inline-block h-2.5 w-2.5 rounded-sm', TONE_BAR[l.tone])} />
          {l.label}
        </span>
      ))}
    </div>
  );
}

/** 매트릭스 조합에 목표가 등록되지 않은 칸(sparse cells) — 데이터를 지어내지 않고 미설정 표시. */
function UnsetHeatCell() {
  return (
    <div className="flex min-w-[112px] items-center justify-center rounded-lg bg-slate-50 p-2 text-xs text-slate-300">
      —
    </div>
  );
}
