'use client';

import {
  BarChart,
  Card,
  DonutChart,
  Legend,
  Tab,
  TabGroup,
  TabList,
  TabPanel,
  TabPanels,
} from '@tremor/react';
import { BarChart3, PieChart } from 'lucide-react';

import { CHART_COLORS, formatPercentage } from '@/lib/analytics/analyzer';
import type { SingleChoiceAnalytics } from '@/lib/analytics/types';

interface SingleChoiceChartProps {
  data: SingleChoiceAnalytics;
}

export function SingleChoiceChart({ data }: SingleChoiceChartProps) {
  const chartData = data.distribution.map((d) => ({
    name: d.label,
    value: d.count,
    percentage: d.percentage,
  }));

  // 색상 배열 (최대 10개)
  const colors = CHART_COLORS.slice(0, Math.min(chartData.length, 10));

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{data.questionTitle}</h3>
          <p className="mt-1 text-sm text-gray-500">
            {data.totalResponses}명 응답 · 응답률 {formatPercentage(data.responseRate)}
          </p>
        </div>
        <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-600">
          {data.questionType === 'radio' ? '단일 선택' : '드롭다운'}
        </span>
      </div>

      <TabGroup>
        <TabList variant="solid" className="w-fit">
          <Tab icon={PieChart}>도넛</Tab>
          <Tab icon={BarChart3}>막대</Tab>
        </TabList>
        <TabPanels>
          {/* 도넛 차트 */}
          <TabPanel>
            <div className="mt-6 flex flex-col items-center gap-6 lg:flex-row">
              <DonutChart
                className="h-52 w-52"
                data={chartData}
                category="value"
                index="name"
                valueFormatter={(value) => `${value}명`}
                colors={colors}
                showAnimation
              />
              <div className="w-full flex-1">
                <Legend
                  categories={chartData.map((d) => d.name)}
                  colors={colors}
                  className="flex-wrap justify-center lg:justify-start"
                />
                {/* 상세 목록 */}
                <div className="mt-4 max-h-48 space-y-2 overflow-y-auto">
                  {data.distribution.map((item) => (
                    <div key={item.value} className="flex items-center justify-between text-sm">
                      <span className="flex-1 truncate text-gray-600">{item.label}</span>
                      <span className="ml-4 font-medium text-gray-900">
                        {item.count}명 ({formatPercentage(item.percentage)})
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </TabPanel>

          {/* 막대 차트 */}
          <TabPanel>
            <BarChart
              className="mt-6 h-72"
              data={chartData}
              index="name"
              categories={['value']}
              colors={['blue']}
              valueFormatter={(value) => `${value}명`}
              layout="vertical"
              showAnimation
              showLegend={false}
            />
          </TabPanel>
        </TabPanels>
      </TabGroup>
    </Card>
  );
}
