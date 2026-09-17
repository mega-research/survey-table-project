'use client';

import { Card, ProgressBar } from '@tremor/react';
import { BarChart3, Calendar, CheckCircle, Clock, TrendingUp, Users } from 'lucide-react';

import { formatMinutes, formatNumber } from '@/lib/analytics/analyzer';
import type { SurveySummary } from '@/lib/analytics/types';
import { LocalDateTime } from '@/components/ui/local-date-time';

interface SummaryCardsProps {
  summary: SurveySummary;
}

export function SummaryCards({ summary }: SummaryCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {/* 총 응답 수 */}
      <Card className="p-4" decoration="top" decorationColor="blue">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">총 응답</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">
              {formatNumber(summary.totalResponses)}
            </p>
          </div>
          <div className="rounded-lg bg-blue-50 p-2">
            <Users className="h-5 w-5 text-blue-500" />
          </div>
        </div>
      </Card>

      {/* 완료된 응답 */}
      <Card className="p-4" decoration="top" decorationColor="green">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">완료된 응답</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">
              {formatNumber(summary.completedResponses)}
            </p>
          </div>
          <div className="rounded-lg bg-green-50 p-2">
            <CheckCircle className="h-5 w-5 text-green-500" />
          </div>
        </div>
        <ProgressBar value={summary.completionRate} color="green" className="mt-3" />
        <p className="mt-1 text-xs text-gray-500">{summary.completionRate.toFixed(1)}% 완료율</p>
      </Card>

      {/* 평균 응답 시간 */}
      <Card className="p-4" decoration="top" decorationColor="amber">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">평균 응답 시간</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">
              {formatMinutes(summary.avgCompletionTime)}
            </p>
          </div>
          <div className="rounded-lg bg-amber-50 p-2">
            <Clock className="h-5 w-5 text-amber-500" />
          </div>
        </div>
      </Card>

      {/* 오늘 응답 */}
      <Card className="p-4" decoration="top" decorationColor="violet">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">오늘 응답</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">
              {formatNumber(summary.todayResponses)}
            </p>
          </div>
          <div className="rounded-lg bg-violet-50 p-2">
            <Calendar className="h-5 w-5 text-violet-500" />
          </div>
        </div>
      </Card>

      {/* 이번 주 응답 */}
      <Card className="p-4" decoration="top" decorationColor="cyan">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">이번 주 응답</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">
              {formatNumber(summary.weekResponses)}
            </p>
          </div>
          <div className="rounded-lg bg-cyan-50 p-2">
            <BarChart3 className="h-5 w-5 text-cyan-500" />
          </div>
        </div>
      </Card>

      {/* 마지막 응답 */}
      <Card className="p-4" decoration="top" decorationColor="rose">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">마지막 응답</p>
            <LocalDateTime
              value={summary.lastResponseAt}
              format="short-month-day-time"
              fallback="-"
              className="mt-1 block text-lg font-bold text-gray-900"
            />
          </div>
          <div className="rounded-lg bg-rose-50 p-2">
            <TrendingUp className="h-5 w-5 text-rose-500" />
          </div>
        </div>
      </Card>
    </div>
  );
}
