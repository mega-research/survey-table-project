'use client';

import { useMemo, useState } from 'react';

import { BarChart3, Clock, Download, FileText, PieChart, TrendingUp, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatLocalDateTime } from '@/lib/date-formatters';
import {
  useCompletedResponses,
  useExportResponsesCsv,
  useExportResponsesJson,
  useQuestionStatistics,
  useResponseSummary,
  useResponses,
} from '@/hooks/queries/use-responses';
import { useSurveyBuilderStore } from '@/stores/survey-store';

interface ResponseAnalyticsProps {
  surveyId: string;
  className?: string;
}

export function ResponseAnalytics({ surveyId, className }: ResponseAnalyticsProps) {
  const { currentSurvey } = useSurveyBuilderStore();
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);

  const { data: allResponses = [] } = useResponses(surveyId);
  const { data: completedResponses = [] } = useCompletedResponses(surveyId);
  const { data: summary } = useResponseSummary(surveyId);
  const { mutateAsync: exportJson } = useExportResponsesJson();
  const { mutateAsync: exportCsv } = useExportResponsesCsv();

  const handleExport = async (format: 'json' | 'csv') => {
    const data = format === 'json' ? await exportJson(surveyId) : await exportCsv(surveyId);

    const blob = new Blob([data], {
      type: format === 'json' ? 'application/json' : 'text/csv',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `survey-responses-${surveyId}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (allResponses.length === 0) {
    return (
      <Card className={className}>
        <CardContent className="p-8">
          <div className="text-center text-gray-500">
            <BarChart3 className="mx-auto mb-4 h-12 w-12 text-gray-400" />
            <h3 className="mb-2 text-lg font-medium text-gray-900">응답 데이터가 없습니다</h3>
            <p className="text-sm">설문이 게시되면 응답 분석을 확인할 수 있습니다.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* 전체 통계 요약 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <Users className="h-8 w-8 text-blue-500" />
              <div>
                <p className="text-2xl font-bold text-gray-900">{summary?.totalResponses ?? 0}</p>
                <p className="text-sm text-gray-600">총 응답 수</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <TrendingUp className="h-8 w-8 text-green-500" />
              <div>
                <p className="text-2xl font-bold text-gray-900">
                  {summary?.completedResponses ?? 0}
                </p>
                <p className="text-sm text-gray-600">완료된 응답</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <PieChart className="h-8 w-8 text-purple-500" />
              <div>
                <p className="text-2xl font-bold text-gray-900">
                  {(summary?.responseRate ?? 0).toFixed(1)}%
                </p>
                <p className="text-sm text-gray-600">완료율</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <Clock className="h-8 w-8 text-orange-500" />
              <div>
                <p className="text-2xl font-bold text-gray-900">
                  {(summary?.averageCompletionTime ?? 0).toFixed(1)}분
                </p>
                <p className="text-sm text-gray-600">평균 완료 시간</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 질문별 분석 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>질문별 응답 분석</CardTitle>
            <div className="flex gap-2">
              <Button onClick={() => handleExport('csv')} variant="outline" size="sm">
                <Download className="mr-2 h-4 w-4" />
                CSV 다운로드
              </Button>
              <Button onClick={() => handleExport('json')} variant="outline" size="sm">
                <Download className="mr-2 h-4 w-4" />
                JSON 다운로드
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {currentSurvey.questions.map((question, index) => {
              const isSelected = selectedQuestionId === question.id;

              return (
                <QuestionStatItem
                  key={question.id}
                  surveyId={surveyId}
                  question={question}
                  index={index}
                  isSelected={isSelected}
                  completedCount={summary?.completedResponses ?? 0}
                  onSelect={() => setSelectedQuestionId(isSelected ? null : question.id)}
                />
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* 최근 응답 목록 */}
      <Card>
        <CardHeader>
          <CardTitle>최근 응답</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[...completedResponses]
              .sort(
                (a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime(),
              )
              .slice(0, 10)
              .map((response) => {
                const completionTime =
                  (new Date(response.completedAt!).getTime() -
                    new Date(response.startedAt).getTime()) /
                  (1000 * 60);

                return (
                  <div
                    key={response.id}
                    className="flex items-center justify-between rounded-lg bg-gray-50 p-3"
                  >
                    <div className="flex items-center space-x-3">
                      <FileText className="h-4 w-4 text-gray-400" />
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          응답 #{response.id.slice(-8)}
                        </p>
                        <p className="text-xs text-gray-600">
                          {formatLocalDateTime(response.completedAt)}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-gray-600">
                        완료 시간: {completionTime.toFixed(1)}분
                      </p>
                      <p className="text-xs text-gray-500">
                        질문 수:{' '}
                        {Object.keys(response.questionResponses as Record<string, unknown>).length}
                        개
                      </p>
                    </div>
                  </div>
                );
              })}

            {completedResponses.length === 0 && (
              <div className="py-8 text-center text-gray-500">
                <p>아직 완료된 응답이 없습니다.</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function QuestionStatItem({
  surveyId,
  question,
  index,
  isSelected,
  completedCount,
  onSelect,
}: {
  surveyId: string;
  question: any;
  index: number;
  isSelected: boolean;
  completedCount: number;
  onSelect: () => void;
}) {
  const { data: stats } = useQuestionStatistics(surveyId, question.id);

  if (!stats) {
    return (
      <div className="rounded-lg border border-gray-200 p-4">
        <p className="text-sm text-gray-500">로딩 중...</p>
      </div>
    );
  }

  return (
    <div
      className={`cursor-pointer rounded-lg border p-4 transition-all ${
        isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <h3 className="font-medium text-gray-900">
            {index + 1}. {question.title}
          </h3>
          <p className="mt-1 text-sm text-gray-600">
            응답률: {stats.responseRate.toFixed(1)}% ({stats.totalResponses}/{completedCount}명)
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <span
            className={`rounded px-2 py-1 text-xs font-medium ${
              stats.responseRate > 80
                ? 'bg-green-100 text-green-800'
                : stats.responseRate > 50
                  ? 'bg-yellow-100 text-yellow-800'
                  : 'bg-red-100 text-red-800'
            }`}
          >
            {stats.responseRate.toFixed(0)}%
          </span>
        </div>
      </div>

      {isSelected && (
        <div className="mt-4 border-t border-gray-200 pt-4">
          <QuestionResponseDetail question={question} stats={stats} />
        </div>
      )}
    </div>
  );
}

function QuestionResponseDetail({ question, stats }: { question: any; stats: any }) {
  if (stats.totalResponses === 0) {
    return (
      <div className="py-4 text-center text-gray-500">
        <p>응답 데이터가 없습니다.</p>
      </div>
    );
  }

  switch (stats.type) {
    case 'single':
      return (
        <div className="space-y-2">
          <h4 className="font-medium text-gray-900">응답 분포</h4>
          {Object.entries(stats.responseCounts as Record<string, number>).map(([value, count]) => {
            const percentage = (count / stats.totalResponses) * 100;
            return (
              <div key={value} className="flex items-center space-x-3">
                <div className="w-24 truncate text-sm text-gray-600">{value}</div>
                <div className="h-4 flex-1 overflow-hidden rounded-full bg-gray-200">
                  <div
                    className="h-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
                <div className="w-16 text-right text-sm text-gray-900">
                  {count}명 ({percentage.toFixed(1)}%)
                </div>
              </div>
            );
          })}
        </div>
      );

    case 'multiple':
      return (
        <div className="space-y-2">
          <h4 className="font-medium text-gray-900">선택된 옵션 (중복 응답 가능)</h4>
          {Object.entries(stats.optionCounts as Record<string, number>).map(([option, count]) => {
            const percentage = (count / stats.totalResponses) * 100;
            return (
              <div key={option} className="flex items-center space-x-3">
                <div className="w-24 truncate text-sm text-gray-600">{option}</div>
                <div className="h-4 flex-1 overflow-hidden rounded-full bg-gray-200">
                  <div
                    className="h-full bg-green-500 transition-all duration-300"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
                <div className="w-16 text-right text-sm text-gray-900">
                  {count}회 ({percentage.toFixed(1)}%)
                </div>
              </div>
            );
          })}
        </div>
      );

    case 'table':
      return (
        <div className="space-y-2">
          <h4 className="font-medium text-gray-900">테이블 응답 요약</h4>
          <div className="text-sm text-gray-600">
            <p>총 {stats.totalResponses}개의 테이블 응답이 수집되었습니다.</p>
            <p>응답 세부 분석은 CSV 다운로드를 통해 확인하실 수 있습니다.</p>
          </div>
        </div>
      );

    default:
      return (
        <div className="py-4 text-center text-gray-500">
          <p>이 질문 유형의 분석은 준비 중입니다.</p>
        </div>
      );
  }
}
