'use client';

import { Badge, BarChart, Card } from '@tremor/react';

import { formatPercentage } from '@/lib/analytics/analyzer';
import type { MultipleChoiceAnalytics } from '@/lib/analytics/types';

interface MultipleChoiceChartProps {
  data: MultipleChoiceAnalytics;
}

export function MultipleChoiceChart({ data }: MultipleChoiceChartProps) {
  const chartData = data.distribution.map((d) => ({
    name: d.label,
    '선택 수': d.count,
    선택률: d.percentage,
  }));

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{data.questionTitle}</h3>
          <p className="mt-1 text-sm text-gray-500">
            {data.totalResponses}명 응답 · 응답률 {formatPercentage(data.responseRate)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge color="emerald">복수 선택</Badge>
          <span className="text-xs text-gray-500">
            평균 {data.avgSelectionsPerResponse.toFixed(1)}개 선택
          </span>
        </div>
      </div>

      <BarChart
        className="mt-4 h-72"
        data={chartData}
        index="name"
        categories={['선택 수']}
        colors={['emerald']}
        valueFormatter={(value) => `${value}명`}
        layout="vertical"
        showAnimation
        showLegend={false}
      />

      {/* 상세 목록 */}
      <div className="mt-6 border-t pt-4">
        <h4 className="mb-3 text-sm font-medium text-gray-700">상세 분포</h4>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {data.distribution.map((item) => (
            <div
              key={item.value}
              className="flex items-center justify-between rounded-lg bg-gray-50 p-2"
            >
              <span className="flex-1 truncate text-sm text-gray-600">{item.label}</span>
              <div className="ml-2 flex items-center gap-2">
                <span className="text-sm font-medium text-gray-900">{item.count}명</span>
                <span className="text-xs text-gray-500">({formatPercentage(item.percentage)})</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
