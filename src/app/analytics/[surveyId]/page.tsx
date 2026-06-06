import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ArrowLeft, Settings } from 'lucide-react';

import { AnalyticsDashboardClient } from '@/components/analytics';
import { Button } from '@/components/ui/button';
import {
  exportResponsesAsCsv,
  exportResponsesAsJson,
  getResponsesWithAnswers,
  getSurveyVersions,
} from '@/data/responses';
import { getSurveyWithDetails } from '@/features/survey-builder/server/services/survey-read.service';

interface AnalyticsPageProps {
  params: Promise<{ surveyId: string }>;
}

export default async function SurveyAnalyticsPage({ params }: AnalyticsPageProps) {
  const { surveyId } = await params;

  // 설문 및 응답 데이터 조회 (response_answers 우선, JSONB fallback)
  const [survey, responses, versions] = await Promise.all([
    getSurveyWithDetails(surveyId),
    getResponsesWithAnswers(surveyId),
    getSurveyVersions(surveyId),
  ]);

  if (!survey) {
    notFound();
  }

  // 내보내기 함수 (서버 액션)
  async function handleExportJson() {
    'use server';
    return exportResponsesAsJson(surveyId);
  }

  async function handleExportCsv() {
    'use server';
    return exportResponsesAsCsv(surveyId);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/analytics">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  설문 목록
                </Button>
              </Link>
              <div className="h-6 w-px bg-gray-200" />
              <div>
                <h1 className="max-w-md truncate text-lg font-semibold text-gray-900">
                  {survey.title}
                </h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link href={`/admin/surveys/${surveyId}/edit`}>
                <Button variant="outline" size="sm">
                  <Settings className="mr-2 h-4 w-4" />
                  설문 편집
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* 메인 콘텐츠 */}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <AnalyticsDashboardClient
          survey={{
            id: survey.id,
            title: survey.title,
            questions: survey.questions,
          }}
          responses={responses}
          versions={versions}
          onExportJson={handleExportJson}
          onExportCsv={handleExportCsv}
        />
      </main>
    </div>
  );
}

// 메타데이터 생성
export async function generateMetadata({ params }: AnalyticsPageProps) {
  const { surveyId } = await params;
  const survey = await getSurveyWithDetails(surveyId);

  if (!survey) {
    return {
      title: '설문을 찾을 수 없습니다',
    };
  }

  return {
    title: `${survey.title} - 분석 | Survey Table`,
    description: `${survey.title} 설문의 응답 분석 대시보드`,
  };
}
