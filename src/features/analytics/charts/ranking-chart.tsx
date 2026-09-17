'use client';

import { Badge, BarChart, Card } from '@tremor/react';

import { formatPercentage } from '@/lib/analytics/analyzer';
import type { RankingAnalytics } from '@/lib/analytics/types';

interface RankingChartProps {
  data: RankingAnalytics;
}

/**
 * 순위형(ranking) 차트
 * - 총점(가중치) 가로 막대: k순위 = (positions - k + 1) 점
 * - 순위별 스택 막대: 각 옵션이 몇 명에게서 몇 위로 선택됐는지
 */
export function RankingChart({ data }: RankingChartProps) {
  const { positions, distribution, totalResponses, responseRate, maxPossibleScore } = data;

  // 총점 차트 데이터 (정렬은 analyzer 가 이미 수행)
  const totalScoreData = distribution.map((d) => ({
    name: d.label,
    '총점': d.totalScore,
  }));

  // 순위별 스택 데이터
  const rankCategories = Array.from({ length: positions }, (_, i) => `${i + 1}순위`);
  const stackData = distribution.map((d) => {
    const row: Record<string, string | number> = { name: d.label };
    for (let i = 0; i < positions; i++) {
      row[`${i + 1}순위`] = d.rankCounts[i] ?? 0;
    }
    return row;
  });

  // 순위별 색상 팔레트 (상위 → 하위, 진한 색 → 연한 색)
  const rankColors = ['indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose', 'amber', 'emerald', 'teal', 'sky'];

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{data.questionTitle}</h3>
          <p className="mt-1 text-sm text-gray-500">
            {totalResponses}명 응답 · 응답률 {formatPercentage(responseRate)} · {positions}순위까지 선택
          </p>
        </div>
        <Badge color="indigo">순위형</Badge>
      </div>

      {/* 총점 가중치 막대 */}
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-sm font-medium text-gray-700">가중치 총점</h4>
          <span className="text-xs text-gray-500">
            1위={positions}점 … {positions}위=1점 · 이론상 최대 {maxPossibleScore}점
          </span>
        </div>
        <BarChart
          className="h-72"
          data={totalScoreData}
          index="name"
          categories={['총점']}
          colors={['indigo']}
          valueFormatter={(value) => `${value}점`}
          layout="vertical"
          showAnimation
          showLegend={false}
        />
      </div>

      {/* 순위별 스택 분포 */}
      <div className="border-t pt-4">
        <h4 className="mb-3 text-sm font-medium text-gray-700">순위별 선택 분포</h4>
        <BarChart
          className="h-72"
          data={stackData}
          index="name"
          categories={rankCategories}
          colors={rankColors.slice(0, positions)}
          valueFormatter={(value) => `${value}명`}
          layout="vertical"
          stack
          showAnimation
        />
      </div>

      {/* 상세 테이블 */}
      <div className="mt-6 border-t pt-4">
        <h4 className="mb-3 text-sm font-medium text-gray-700">상세</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-gray-500">
                <th className="py-2 pr-4 font-medium">옵션</th>
                <th className="py-2 pr-4 text-right font-medium">총점</th>
                <th className="py-2 pr-4 text-right font-medium">평균 순위</th>
                {rankCategories.map((cat) => (
                  <th key={cat} className="py-2 pr-4 text-right font-medium">{cat}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {distribution.map((item) => (
                <tr key={item.value} className="border-b last:border-0">
                  <td className="py-2 pr-4 text-gray-900">{item.label}</td>
                  <td className="py-2 pr-4 text-right font-medium text-gray-900">
                    {item.totalScore}
                  </td>
                  <td className="py-2 pr-4 text-right text-gray-600">
                    {item.avgRank != null ? item.avgRank.toFixed(2) : '-'}
                  </td>
                  {item.rankCounts.map((count, i) => (
                    <td key={i} className="py-2 pr-4 text-right text-gray-600">
                      {count || '-'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}
