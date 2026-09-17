'use client';

import { Badge, Card } from '@tremor/react';
import { AlertCircle } from 'lucide-react';

import type { AnalyticsResult } from '@/lib/analytics/types';

import { MultipleChoiceChart } from './charts/multiple-choice-chart';
import { RankingChart } from './charts/ranking-chart';
import { SingleChoiceChart } from './charts/single-choice-chart';
import { TableAnalyticsChart } from './charts/table-analytics';
import { TextResponses } from './charts/text-responses';

interface QuestionAnalyticsProps {
  data: AnalyticsResult;
}

/**
 * 질문 타입에 따라 적절한 차트 컴포넌트를 렌더링
 */
export function QuestionAnalytics({ data }: QuestionAnalyticsProps) {
  // 응답이 없는 경우
  if (data.totalResponses === 0) {
    return (
      <Card className="p-6">
        <div className="mb-4 flex items-start justify-between">
          <h3 className="text-lg font-semibold text-gray-900">{data.questionTitle}</h3>
          <Badge color="gray">응답 없음</Badge>
        </div>
        <div className="flex items-center justify-center py-12 text-gray-500">
          <div className="text-center">
            <AlertCircle className="mx-auto mb-2 h-8 w-8 text-gray-400" />
            <p>아직 이 질문에 대한 응답이 없습니다.</p>
          </div>
        </div>
      </Card>
    );
  }

  switch (data.type) {
    case 'single':
      return <SingleChoiceChart data={data} />;

    case 'multiple':
      return <MultipleChoiceChart data={data} />;

    case 'text':
      return <TextResponses data={data} />;

    case 'table':
      return <TableAnalyticsChart data={data} />;

    case 'multiselect':
      return <MultiSelectChart data={data} />;

    case 'ranking':
      return <RankingChart data={data} />;

    case 'notice':
      return <NoticeChart data={data} />;

    default:
      // TypeScript exhaustive check - 모든 케이스가 처리되었으므로 여기 도달하지 않음
      return null;
  }
}

/**
 * 다단계 선택 차트
 */
function MultiSelectChart({
  data,
}: {
  data: import('@/lib/analytics/types').MultiSelectAnalytics;
}) {
  return (
    <Card className="p-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{data.questionTitle}</h3>
          <p className="mt-1 text-sm text-gray-500">
            {data.totalResponses}명 응답 · 응답률 {data.responseRate.toFixed(1)}%
          </p>
        </div>
        <Badge color="indigo">다단계 선택</Badge>
      </div>

      <div className="space-y-6">
        {data.levelAnalytics.map((level) => (
          <div key={level.levelId} className="border-t pt-4 first:border-0 first:pt-0">
            <h4 className="mb-3 text-sm font-medium text-gray-700">{level.levelLabel}</h4>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {level.distribution.slice(0, 8).map((item) => (
                <div key={item.value} className="rounded-lg bg-gray-50 p-2 text-center">
                  <p className="truncate text-sm font-medium text-gray-900">{item.label}</p>
                  <p className="text-xs text-gray-500">
                    {item.count}명 ({item.percentage.toFixed(1)}%)
                  </p>
                </div>
              ))}
              {level.distribution.length > 8 && (
                <div className="flex items-center justify-center rounded-lg bg-gray-100 p-2 text-center">
                  <p className="text-xs text-gray-500">+{level.distribution.length - 8}개 더</p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/**
 * 공지사항 확인 차트
 */
function NoticeChart({ data }: { data: import('@/lib/analytics/types').NoticeAnalytics }) {
  return (
    <Card className="p-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{data.questionTitle}</h3>
          <p className="mt-1 text-sm text-gray-500">공지사항 확인 현황</p>
        </div>
        <Badge color="cyan">공지</Badge>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg bg-green-50 p-4 text-center">
          <p className="text-3xl font-bold text-green-600">{data.acknowledgedCount}</p>
          <p className="mt-1 text-sm text-green-700">확인함</p>
        </div>
        <div className="rounded-lg bg-gray-50 p-4 text-center">
          <p className="text-3xl font-bold text-gray-600">
            {data.totalResponses - data.acknowledgedCount}
          </p>
          <p className="mt-1 text-sm text-gray-700">미확인</p>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-1 flex justify-between text-sm text-gray-600">
          <span>확인률</span>
          <span className="font-medium">{data.acknowledgeRate.toFixed(1)}%</span>
        </div>
        <div className="h-3 w-full rounded-full bg-gray-200">
          <div
            className="h-3 rounded-full bg-green-500 transition-all duration-300"
            style={{ width: `${data.acknowledgeRate}%` }}
          />
        </div>
      </div>
    </Card>
  );
}
