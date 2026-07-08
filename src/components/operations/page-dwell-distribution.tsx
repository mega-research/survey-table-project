'use client';

import { useCallback, useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ErrorBar,
  XAxis,
  YAxis,
} from 'recharts';

import { Card, CardContent } from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { useSearchParamsMutator } from '@/hooks/use-search-params-mutator';
import { CHART_COLOR_BLUE_500 } from '@/lib/operations/chart-tokens';
import { formatSeconds } from '@/lib/operations/format';
import type { DwellOutput, DwellPage } from '@/lib/operations/page-dwell';

import { EmptyState } from './empty-state';
import {
  OCCURRENCE_GLYPHS,
  StepAxisTick,
  type StepTickItem,
} from './step-axis-tick';

const DWELL_PAGE_SIZE = 10;
const PAD_STEP_ID_PREFIX = '__pad__';

interface Props {
  data: DwellOutput;
  /** 페이지 offset. 0 = 첫 10개, 1 = 다음 10개, ... */
  pageOffset: number;
}

/** 단일 시리즈 — 평균 체류시간 막대. mockup 톤은 monochromatic-blue. */
const CHART_CONFIG: ChartConfig = {
  meanSeconds: {
    label: '평균 체류',
    color: CHART_COLOR_BLUE_500,
  },
};

/**
 * 차트에 직접 들어갈 행 형태.
 * - meanSeconds: y축 값 (null인 행은 0으로 — 막대가 안 보임).
 * - errorBar: ErrorBar용 ± 오프셋 (sd가 있으면 sd, 없으면 0).
 * - sdSeconds: 툴팁에 표기하기 위해 보존.
 */
interface ChartRow {
  stepId: string;
  label: string;
  position: number;
  n: number;
  meanSeconds: number;
  sdSeconds: number | null;
  errorBar: number;
}

/**
 * 운영 현황 콘솔 — A6 페이지별 체류시간 분포.
 *
 * x축: 페이지 라벨, y축: 평균 체류시간(초).
 * 각 막대 위에 ± SD ErrorBar.
 *
 * Edge:
 *   - data.pages가 비었거나 모든 page의 n=0 → EmptyState.
 *   - n=0 또는 mean=null인 행은 차트에서 막대 높이 0 + ErrorBar 미렌더.
 */
export function PageDwellDistribution({ data, pageOffset }: Props) {
  const pushParams = useSearchParamsMutator();

  // n=0 step (응답이 누적되지 않은 페이지) 은 빈 막대만 차지하므로 차트에서 제외.
  // 같은 label 이 여러 번 등장하면 (그룹 step 이 인터리브로 분리된 경우) 두 번째부터 ①/②/… 인덱스 부여.
  const filteredPages = useMemo<DwellPage[]>(() => {
    const nonEmpty = data.pages.filter((p) => p.n > 0);
    const labelCounts = new Map<string, number>();
    for (const p of nonEmpty) {
      labelCounts.set(p.label, (labelCounts.get(p.label) ?? 0) + 1);
    }
    const seen = new Map<string, number>();
    return nonEmpty.map((p) => {
      const total = labelCounts.get(p.label) ?? 1;
      if (total <= 1) return p;
      const nth = (seen.get(p.label) ?? 0) + 1;
      seen.set(p.label, nth);
      return { ...p, label: `${p.label} ${OCCURRENCE_GLYPHS[nth - 1] ?? `(${nth})`}` };
    });
  }, [data.pages]);

  // 현재 offset 에 해당하는 step 슬라이스 (n=0 제외 후 기준).
  // 슬라이스가 10개 미만이면 우측에 빈 슬롯을 채워 좌측 정렬을 보장한다.
  const visiblePages = useMemo(() => {
    const start = pageOffset * DWELL_PAGE_SIZE;
    const sliced = filteredPages.slice(start, start + DWELL_PAGE_SIZE);
    if (sliced.length === 0 || sliced.length >= DWELL_PAGE_SIZE) return sliced;
    const padCount = DWELL_PAGE_SIZE - sliced.length;
    const padding: DwellPage[] = [];
    for (let i = 0; i < padCount; i++) {
      padding.push({
        stepId: `${PAD_STEP_ID_PREFIX}${i}`,
        label: '',
        position: 0,
        page: null,
        n: 0,
        meanSeconds: null,
        sdSeconds: null,
      });
    }
    return [...sliced, ...padding];
  }, [filteredPages, pageOffset]);

  const totalPages = filteredPages.length;
  const canGoPrev = pageOffset > 0;
  const canGoNext = (pageOffset + 1) * DWELL_PAGE_SIZE < totalPages;

  const handlePageOffset = useCallback(
    (delta: 1 | -1) => {
      const next = Math.max(0, pageOffset + delta);
      pushParams((p) => {
        if (next === 0) {
          p.delete('dwellOffset');
        } else {
          p.set('dwellOffset', String(next));
        }
      });
    },
    [pageOffset, pushParams],
  );

  // ErrorBar용 오프셋과 차트 친화적 형태로 변환. visiblePages 기준으로 렌더.
  const chartRows = useMemo<ChartRow[]>(() => {
    return visiblePages.map((p) => {
      const mean = p.meanSeconds ?? 0;
      // sdSeconds가 null이면 errorBar=0 → recharts가 막대를 안 그린다.
      const errorBar = p.sdSeconds ?? 0;
      return {
        stepId: p.stepId,
        label: p.label,
        position: p.position,
        n: p.n,
        meanSeconds: mean,
        sdSeconds: p.sdSeconds,
        errorBar,
      };
    });
  }, [visiblePages]);

  const tickItems = useMemo<StepTickItem[]>(
    () =>
      visiblePages.map((p) => ({
        page: p.page,
        hidden: p.stepId.startsWith(PAD_STEP_ID_PREFIX),
      })),
    [visiblePages],
  );

  // visiblePages 는 data.pages 의 슬라이스이므로, data.pages 가 비어 있으면 visiblePages 도 비어 있다.
  const allEmpty = visiblePages.length === 0;

  return (
    <Card>
      <CardContent className="px-5 py-4">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              페이지별 체류시간 분포
            </h3>
            <p className="mt-0.5 text-xs text-slate-400">
              평균 ± 표준편차 (상하 2.5% 트리밍)
            </p>
          </div>
          {totalPages > DWELL_PAGE_SIZE && (
            <div className="flex shrink-0 items-center gap-2 text-xs text-slate-600">
              <button
                type="button"
                onClick={() => handlePageOffset(-1)}
                disabled={!canGoPrev}
                aria-label="이전 페이지"
                className="rounded border border-slate-200 px-2 py-1 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ‹
              </button>
              <span className="tabular-nums">
                {pageOffset * DWELL_PAGE_SIZE + 1}~
                {Math.min((pageOffset + 1) * DWELL_PAGE_SIZE, totalPages)} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => handlePageOffset(1)}
                disabled={!canGoNext}
                aria-label="다음 페이지"
                className="rounded border border-slate-200 px-2 py-1 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ›
              </button>
            </div>
          )}
        </div>

        {allEmpty ? (
          <EmptyState
            message="체류시간 데이터가 없습니다"
            description="응답이 누적되면 여기에 표시됩니다"
          />
        ) : (
          <ChartContainer config={CHART_CONFIG} className="aspect-auto h-72 w-full">
            <BarChart
              data={chartRows}
              margin={{ top: 16, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={4}
                interval={0}
                height={44}
                tick={(tickProps) => (
                  <StepAxisTick {...tickProps} items={tickItems} />
                )}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tickMargin={4}
                width={48}
                tickFormatter={(v: number) => formatSeconds(v)}
              />
              <ChartTooltip
                cursor={{ fill: 'rgba(148, 163, 184, 0.15)' }}
                content={
                  <ChartTooltipContent
                    indicator="dot"
                    hideLabel={false}
                    formatter={(_value, _name, item) => {
                      const payload = item.payload as ChartRow;
                      const meanLine =
                        payload.n === 0
                          ? '데이터 없음'
                          : `평균 ${formatSeconds(payload.meanSeconds)}`;
                      const sdLine =
                        payload.sdSeconds === null
                          ? null
                          : `± ${formatSeconds(payload.sdSeconds)}`;
                      return (
                        <div className="flex flex-col gap-0.5">
                          <span>{meanLine}</span>
                          {sdLine && (
                            <span className="text-slate-500">{sdLine}</span>
                          )}
                          <span className="text-slate-400 text-[10px]">
                            n = {payload.n}
                          </span>
                        </div>
                      );
                    }}
                  />
                }
              />
              {/* 막대 위 숫자 라벨은 ErrorBar whisker 와 겹쳐 제거 — 평균/±SD/n 은 툴팁이 담당. */}
              <Bar
                dataKey="meanSeconds"
                fill="var(--color-meanSeconds)"
                radius={[3, 3, 0, 0]}
                isAnimationActive={false}
              >
                <ErrorBar
                  dataKey="errorBar"
                  width={6}
                  stroke="#94a3b8"
                  strokeWidth={1.25}
                  strokeOpacity={0.7}
                />
              </Bar>
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
