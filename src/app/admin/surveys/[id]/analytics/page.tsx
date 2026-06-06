import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ArrowLeft, BarChart3, ExternalLink, Pencil } from 'lucide-react';

import { AnalyticsDashboardClient } from '@/components/analytics';
import { ExportDataModal } from '@/components/analytics/export-data-modal';
import { Button } from '@/components/ui/button';
import {
  exportResponsesAsCsv,
  exportResponsesAsJson,
  getResponsesWithAnswers,
  getSurveyVersions,
} from '@/data/responses';
import { getSurveyWithDetails } from '@/features/survey-builder/server/services/survey-read.service';

interface AdminAnalyticsPageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminSurveyAnalyticsPage({ params }: AdminAnalyticsPageProps) {
  const { id } = await params;

  // 설문 및 응답 데이터 조회 (response_answers 우선, JSONB fallback)
  const [survey, responses, versions] = await Promise.all([
    getSurveyWithDetails(id),
    getResponsesWithAnswers(id),
    getSurveyVersions(id),
  ]);

  if (!survey) {
    notFound();
  }

  // 내보내기 함수 (서버 액션)
  async function handleExportJson() {
    'use server';
    return exportResponsesAsJson(id);
  }

  async function handleExportCsv() {
    'use server';
    return exportResponsesAsCsv(id);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 - Admin 스타일 */}
      <nav className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link href="/admin/surveys">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="mr-2 h-4 w-4" />
                목록으로
              </Button>
            </Link>
            <div className="h-6 w-px bg-gray-300" />
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-blue-500" />
              <h1 className="max-w-md truncate text-lg font-medium text-gray-900">
                {survey.title}
              </h1>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <ExportDataModal surveyId={survey.id} surveyTitle={survey.title} />
            <Link href={`/admin/surveys/${id}/edit`}>
              <Button variant="outline" size="sm">
                <Pencil className="mr-2 h-4 w-4" />
                설문 편집
              </Button>
            </Link>
            <Link href={`/analytics/${id}`} target="_blank">
              <Button variant="outline" size="sm">
                <ExternalLink className="mr-2 h-4 w-4" />
                상세 분석
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* 메인 콘텐츠 */}
      <main className="mx-auto max-w-7xl px-6 py-8">
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
export async function generateMetadata({ params }: AdminAnalyticsPageProps) {
  const { id } = await params;
  const survey = await getSurveyWithDetails(id);

  if (!survey) {
    return {
      title: '설문을 찾을 수 없습니다',
    };
  }

  return {
    title: `${survey.title} - 분석 | Survey Table 관리자`,
    description: `${survey.title} 설문의 응답 분석`,
  };
}
