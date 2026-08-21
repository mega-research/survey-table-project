'use client';

import { AreaChart, Badge, Card } from '@tremor/react';
import { TrendingUp } from 'lucide-react';

import type { TimelineData } from '@/lib/analytics/types';

interface ResponseTimelineProps {
  data: TimelineData[];
  title?: string;
}

export function ResponseTimeline({ data, title = '응답 추이' }: ResponseTimelineProps) {
  // 날짜 포맷팅
  const chartData = data.map((d) => ({
    date: new Date(d.date).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    }),
    '전체 응답': d.responses,
    '완료된 응답': d.completed,
  }));

  // 총계 계산
  const totalResponses = data.reduce((sum, d) => sum + d.responses, 0);
  const totalCompleted = data.reduce((sum, d) => sum + d.completed, 0);

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <p className="mt-1 text-sm text-gray-500">최근 {data.length}일간 응답 현황</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge color="blue">전체 {totalResponses}개</Badge>
          <Badge color="green">완료 {totalCompleted}개</Badge>
        </div>
      </div>

      {data.length > 0 ? (
        <AreaChart
          className="mt-4 h-72"
          data={chartData}
          index="date"
          categories={['전체 응답', '완료된 응답']}
          colors={['blue', 'green']}
          valueFormatter={(value) => `${value}개`}
          showAnimation
          showLegend
          curveType="monotone"
        />
      ) : (
        <div className="flex h-72 items-center justify-center text-gray-500">
          <div className="text-center">
            <TrendingUp className="mx-auto mb-2 h-8 w-8 text-gray-400" />
            <p>아직 응답 데이터가 없습니다.</p>
          </div>
        </div>
      )}
    </Card>
  );
}
