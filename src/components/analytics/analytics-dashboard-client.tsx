'use client';

import { useCallback, useMemo, useState } from 'react';

import { Tab, TabGroup, TabList, TabPanel, TabPanels, TextInput } from '@tremor/react';
import {
  BarChart3,
  ChevronDown,
  ChevronUp,
  List,
  Search,
  TrendingUp,
} from 'lucide-react';

import { Button } from '@/components/ui/button';

import type { SurveyResponse } from '@/db/schema';
import { analyzeSurvey } from '@/lib/analytics/analyzer';
import { type FilterState, applyFilter, createEmptyFilter } from '@/lib/analytics/filter';
import type { SurveyAnalytics } from '@/lib/analytics/types';
import type { Question } from '@/types/survey';

import { SummaryCards } from './cards/summary-cards';
import { ResponseTimeline } from './charts/response-timeline';
import { CrossTabPanel } from './cross-tab';
import { ExportPanel } from './export-panel';
import { FilterPanel } from './filters';
import { QuestionAnalytics } from './question-analytics';

interface SurveyVersionInfo {
  id: string;
  versionNumber: number;
  status: string;
  changeNote: string | null;
  publishedAt: Date;
}

interface AnalyticsDashboardClientProps {
  survey: {
    id: string;
    title: string;
    questions: Question[];
  };
  responses: SurveyResponse[];
  versions?: SurveyVersionInfo[];
  onExportJson: () => Promise<string>;
  onExportCsv: () => Promise<string>;
}

export function AnalyticsDashboardClient({
  survey,
  responses,
  versions,
  onExportJson,
  onExportCsv,
}: AnalyticsDashboardClientProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState<FilterState>(createEmptyFilter());
  const [selectedVersionId, setSelectedVersionId] = useState<string | ''>('');
  const [openQuestionIds, setOpenQuestionIds] = useState<Set<string>>(new Set());

  // 버전 필터링
  const versionFilteredResponses = useMemo(() => {
    if (!selectedVersionId) return responses;
    return responses.filter(
      (r) => (r as typeof r & { versionId?: string | null }).versionId === selectedVersionId,
    );
  }, [responses, selectedVersionId]);

  // 필터링된 응답 (버전 필터 → 조건 필터 순서)
  const filteredResponses = useMemo(() => {
    return applyFilter(filter, versionFilteredResponses, survey.questions);
  }, [filter, versionFilteredResponses, survey.questions]);

  // 필터링된 응답으로 분석 데이터 재계산
  const analytics: SurveyAnalytics = useMemo(() => {
    return analyzeSurvey(survey, filteredResponses);
  }, [survey, filteredResponses]);

  // 질문 검색 필터링
  const searchFilteredQuestions = useMemo(
    () =>
      analytics.questions.filter((q) =>
        q.questionTitle.toLowerCase().includes(searchTerm.toLowerCase()),
      ),
    [analytics.questions, searchTerm],
  );

  const toggleQuestion = useCallback((id: string) => {
    setOpenQuestionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setOpenQuestionIds(new Set(searchFilteredQuestions.map((q) => q.questionId)));
  }, [searchFilteredQuestions]);

  const collapseAll = useCallback(() => setOpenQuestionIds(new Set()), []);

  const openCount = useMemo(
    () => searchFilteredQuestions.filter((q) => openQuestionIds.has(q.questionId)).length,
    [searchFilteredQuestions, openQuestionIds],
  );

  const hasActiveFilter = filter.groups.length > 0;

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{analytics.surveyTitle}</h1>
          <div className="mt-1 flex items-center gap-3">
            <p className="text-sm text-gray-500">
              설문 응답 분석 대시보드
              {hasActiveFilter && (
                <span className="ml-2 text-blue-600">
                  (필터 적용됨: {filteredResponses.length}/{responses.length}명)
                </span>
              )}
            </p>
            {versions && versions.length > 0 && (
              <select
                className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700"
                value={selectedVersionId}
                onChange={(e) => setSelectedVersionId(e.target.value)}
              >
                <option value="">전체 버전</option>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.versionNumber}
                    {v.status === 'published' ? ' (현재)' : ''}
                    {v.changeNote ? ` - ${v.changeNote}` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
        <ExportPanel
          surveyId={analytics.surveyId}
          surveyTitle={analytics.surveyTitle}
          onExportJson={onExportJson}
          onExportCsv={onExportCsv}
        />
      </div>

      {/* 요약 카드 */}
      <SummaryCards summary={analytics.summary} />

      {/* 필터 패널 */}
      <FilterPanel
        questions={survey.questions}
        responses={responses}
        filter={filter}
        onFilterChange={setFilter}
      />

      {/* 교차분석 패널 */}
      <CrossTabPanel questions={survey.questions} responses={filteredResponses} />

      {/* 탭 그룹 */}
      <TabGroup>
        <TabList variant="solid">
          <Tab icon={BarChart3}>질문별 분석</Tab>
          <Tab icon={TrendingUp}>응답 추이</Tab>
          <Tab icon={List}>전체 요약</Tab>
        </TabList>
        <TabPanels>
          {/* 질문별 분석 탭 */}
          <TabPanel>
            <div className="mt-6 space-y-6">
              {/* 검색 + 일괄 토글 */}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="flex-1">
                  <TextInput
                    icon={Search}
                    placeholder="질문 검색..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={expandAll}>
                    모두 펼치기
                  </Button>
                  <Button variant="outline" size="sm" onClick={collapseAll}>
                    모두 접기
                  </Button>
                  <span className="whitespace-nowrap text-xs text-gray-500">
                    펼침 {openCount}/{searchFilteredQuestions.length}
                  </span>
                </div>
              </div>

              {/* 질문 목록 */}
              {searchFilteredQuestions.length > 0 ? (
                <div className="space-y-3">
                  {searchFilteredQuestions.map((question, index) => (
                    <CollapsibleQuestionCard
                      key={question.questionId}
                      index={index}
                      question={question}
                      isOpen={openQuestionIds.has(question.questionId)}
                      onToggle={() => toggleQuestion(question.questionId)}
                    />
                  ))}
                </div>
              ) : (
                <div className="py-12 text-center text-gray-500">
                  <Search className="mx-auto mb-2 h-8 w-8 text-gray-400" />
                  <p>검색 결과가 없습니다.</p>
                </div>
              )}
            </div>
          </TabPanel>

          {/* 응답 추이 탭 */}
          <TabPanel>
            <div className="mt-6">
              <ResponseTimeline data={analytics.timeline} />
            </div>
          </TabPanel>

          {/* 전체 요약 탭 */}
          <TabPanel>
            <div className="mt-6 space-y-4">
              {/* 요약 테이블 */}
              <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-gray-700">#</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-700">질문</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-700">유형</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-700">응답 수</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-700">응답률</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.questions.map((q, idx) => (
                      <tr
                        key={q.questionId}
                        className={`border-t border-gray-100 ${
                          idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                        }`}
                      >
                        <td className="px-4 py-3 text-gray-500">{idx + 1}</td>
                        <td className="max-w-xs truncate px-4 py-3 text-gray-900">
                          {q.questionTitle}
                        </td>
                        <td className="px-4 py-3">
                          <QuestionTypeBadge type={q.type} />
                        </td>
                        <td className="px-4 py-3 text-right text-gray-600">{q.totalResponses}명</td>
                        <td className="px-4 py-3 text-right">
                          <span
                            className={`font-medium ${
                              q.responseRate >= 80
                                ? 'text-green-600'
                                : q.responseRate >= 50
                                  ? 'text-amber-600'
                                  : 'text-red-600'
                            }`}
                          >
                            {q.responseRate.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 통계 요약 */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-lg bg-blue-50 p-4">
                  <p className="text-sm text-blue-700">총 질문 수</p>
                  <p className="text-2xl font-bold text-blue-900">{analytics.questions.length}개</p>
                </div>
                <div className="rounded-lg bg-green-50 p-4">
                  <p className="text-sm text-green-700">평균 응답률</p>
                  <p className="text-2xl font-bold text-green-900">
                    {(
                      analytics.questions.reduce((sum, q) => sum + q.responseRate, 0) /
                        analytics.questions.length || 0
                    ).toFixed(1)}
                    %
                  </p>
                </div>
                <div className="rounded-lg bg-violet-50 p-4">
                  <p className="text-sm text-violet-700">응답 기간</p>
                  <p className="text-2xl font-bold text-violet-900">
                    {analytics.timeline.length}일
                  </p>
                </div>
              </div>
            </div>
          </TabPanel>
        </TabPanels>
      </TabGroup>
    </div>
  );
}

/**
 * 질문 카드 - 토글이 true일 때만 QuestionAnalytics를 실제 렌더링
 */
function CollapsibleQuestionCard({
  index,
  question,
  isOpen,
  onToggle,
}: {
  index: number;
  question: import('@/lib/analytics/types').AnalyticsResult;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50"
        aria-expanded={isOpen}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-medium text-blue-600">
          {index + 1}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
          {question.questionTitle}
        </span>
        <QuestionTypeBadge type={question.type} />
        <span className="shrink-0 whitespace-nowrap text-xs text-gray-500">
          {question.totalResponses}명
        </span>
        {isOpen ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-gray-400" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
        )}
      </button>
      {isOpen && (
        <div className="border-t border-gray-100 p-2">
          <QuestionAnalytics data={question} />
        </div>
      )}
    </div>
  );
}

/**
 * 질문 유형 배지
 */
function QuestionTypeBadge({ type }: { type: string }) {
  const typeConfig: Record<string, { label: string; color: string }> = {
    single: { label: '단일 선택', color: 'bg-blue-100 text-blue-700' },
    multiple: { label: '복수 선택', color: 'bg-emerald-100 text-emerald-700' },
    text: { label: '텍스트', color: 'bg-violet-100 text-violet-700' },
    table: { label: '테이블', color: 'bg-amber-100 text-amber-700' },
    multiselect: { label: '다단계', color: 'bg-indigo-100 text-indigo-700' },
    notice: { label: '공지', color: 'bg-cyan-100 text-cyan-700' },
  };

  const config = typeConfig[type] || { label: type, color: 'bg-gray-100 text-gray-700' };

  return (
    <span className={`rounded-full px-2 py-1 text-xs font-medium ${config.color}`}>
      {config.label}
    </span>
  );
}
