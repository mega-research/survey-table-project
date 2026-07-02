'use client';

import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from 'recharts';

import { Card, CardContent } from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { CHART_COLOR_ROSE_400 } from '@/lib/operations/chart-tokens';
import type {
  DropFunnelBar,
  DropFunnelOutput,
} from '@/lib/operations/drop-funnel';
import { numberFormatter } from '@/lib/operations/format';

import { EmptyState } from './empty-state';
import { StepAxisTick, type StepTickItem } from './step-axis-tick';

/**
 * 다른 운영 콘솔 차트 (페이지별 체류시간) 와 동일하게 막대가 적을 때 좌측 정렬되도록
 * 최소 슬롯 수를 보장. 빈 슬롯은 X축 라벨도 없는 placeholder 행.
 */
const MIN_FUNNEL_SLOTS = 10;
const PAD_QUESTION_ID_PREFIX = '__pad__';

interface Props {
  data: DropFunnelOutput;
}

/** 단일 시리즈 — drop 막대 색상은 mockup의 rose 톤. */
const CHART_CONFIG: ChartConfig = {
  dropCount: {
    label: '이탈자',
    color: CHART_COLOR_ROSE_400,
  },
};

/**
 * 운영 현황 콘솔 — A5 Drop funnel.
 *
 * x축: 이탈 위치 (2줄 tick: 페이지 N / 라벨 — StepAxisTick, A6 체류시간 차트와 동일 형식).
 * y축: 이탈자 수. 진행률은 tick 에서 빼고 툴팁에만 표시.
 * 정렬: 질문 위치 ASC (snapshot 순서대로 funnel 형태).
 *
 * 빈 상태:
 *   bars 배열이 비어 있으면 EmptyState로 대체 (drop 응답이 없는 경우).
 */
export function DropFunnel({ data }: Props) {
  // 막대가 10개 미만이면 우측에 빈 슬롯을 채워 좌측 정렬을 보장한다.
  // tooltip/라벨 모두 비워두는 placeholder — questionId 의 sentinel prefix 로 식별.
  const visibleBars = useMemo<DropFunnelBar[]>(() => {
    if (data.bars.length === 0 || data.bars.length >= MIN_FUNNEL_SLOTS) {
      return data.bars;
    }
    const padCount = MIN_FUNNEL_SLOTS - data.bars.length;
    const padding: DropFunnelBar[] = [];
    for (let i = 0; i < padCount; i++) {
      padding.push({
        questionId: `${PAD_QUESTION_ID_PREFIX}${i}`,
        label: '',
        position: null,
        page: null,
        dropCount: 0,
        cumulativeProgressPct: null,
      });
    }
    return [...data.bars, ...padding];
  }, [data.bars]);

  const tickItems = useMemo<StepTickItem[]>(
    () =>
      visibleBars.map((bar) => ({
        page: bar.page,
        hidden: bar.questionId.startsWith(PAD_QUESTION_ID_PREFIX),
      })),
    [visibleBars],
  );

  return (
    <Card>
      <CardContent className="px-5 py-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-slate-900">
            이탈 응답 위치별 사례
          </h3>
          <p className="mt-0.5 text-xs text-slate-400">
            x: 이탈 위치 · y: 이탈자 수 · 진행률은 툴팁에서 확인
          </p>
        </div>

        {data.bars.length === 0 ? (
          <EmptyState message="이탈 응답이 없습니다" />
        ) : (
          <ChartContainer
            config={CHART_CONFIG}
            className="aspect-auto h-72 w-full"
          >
            <BarChart
              data={visibleBars}
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
                width={32}
                tickFormatter={(v: number) => numberFormatter.format(v)}
              />
              <ChartTooltip
                cursor={{ fill: 'rgba(148, 163, 184, 0.15)' }}
                content={
                  <ChartTooltipContent
                    indicator="dot"
                    hideLabel={false}
                    formatter={(value, _name, item) => {
                      // 'value' = dropCount (number). 'item.payload' = DropFunnelBar.
                      const payload = item.payload as DropFunnelBar;
                      const lines: React.ReactNode[] = [
                        <span key="count">
                          이탈자 {numberFormatter.format(Number(value))}명
                        </span>,
                      ];
                      if (payload.page != null) {
                        lines.push(
                          <span key="page" className="ml-2 text-slate-500">
                            페이지 {payload.page}
                          </span>,
                        );
                      }
                      if (
                        typeof payload.cumulativeProgressPct === 'number' &&
                        Number.isFinite(payload.cumulativeProgressPct)
                      ) {
                        lines.push(
                          <span key="pct" className="ml-2 text-slate-500">
                            진행 {payload.cumulativeProgressPct.toFixed(1)}%
                          </span>,
                        );
                      }
                      return <div className="flex items-center">{lines}</div>;
                    }}
                  />
                }
              />
              <Bar
                dataKey="dropCount"
                fill="var(--color-dropCount)"
                radius={[3, 3, 0, 0]}
                isAnimationActive={false}
              >
                <LabelList
                  dataKey="dropCount"
                  position="top"
                  className="fill-slate-700"
                  fontSize={11}
                  formatter={(v: number) => (v > 0 ? numberFormatter.format(v) : '')}
                />
              </Bar>
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
