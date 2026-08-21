'use client';

import { BarChart } from '@tremor/react';

import type { CrossTabResult, PercentageBase } from '@/lib/analytics/cross-tab';
import { toCrossTabChartData } from '@/lib/analytics/cross-tab';

interface CrossTabChartProps {
  result: CrossTabResult;
  percentageBase: PercentageBase;
}

export function CrossTabChart({ result, percentageBase }: CrossTabChartProps) {
  const chartData = toCrossTabChartData(result, percentageBase);
  const categories = result.columns.map((col) => col.label);

  // 차트 색상
  const colors: (
    | 'blue'
    | 'cyan'
    | 'indigo'
    | 'violet'
    | 'fuchsia'
    | 'rose'
    | 'amber'
    | 'emerald'
    | 'teal'
    | 'sky'
  )[] = ['blue', 'cyan', 'indigo', 'violet', 'fuchsia', 'rose', 'amber', 'emerald', 'teal', 'sky'];

  return (
    <div className="h-[400px]">
      <BarChart
        data={chartData}
        index="name"
        categories={categories}
        colors={colors.slice(0, categories.length)}
        valueFormatter={(value) => `${value}%`}
        yAxisWidth={48}
        showLegend={true}
        showAnimation={true}
        stack={false}
      />
    </div>
  );
}
