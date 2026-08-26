import { cache } from 'react';

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ArrowLeft, BarChart3, ExternalLink, Pencil } from 'lucide-react';

import { AnalyticsDashboardClient } from '@/features/analytics';
import { ExportDataModal } from '@/features/analytics/export-data-modal';
import { Button } from '@/components/ui/button';
import { getResponsesWithAnswers, getSurveyVersions } from '@/server/read-models/responses';
import { getSurveyWithDetails } from '@/server/survey-builder/services/survey-read';
import { assertSurveyCapabilityPage } from '@/server/page-survey-access';
import { requireAdminPage } from '@/lib/auth/require-admin-page';

interface AdminAnalyticsPageProps {
  params: Promise<{ id: string }>;
}

// 없는 설문과 타 팀 설문을 같은 notFound 로 접는다(티켓 09). 본문과 generateMetadata 가
// 함께 지나므로 cache 로 요청당 판정을 1회로 줄인다.
const assertAnalyticsPageAccess = cache(async (surveyId: string): Promise<void> => {
  const viewer = await requireAdminPage();
  await assertSurveyCapabilityPage(viewer, surveyId, 'analytics.view');
});

export default async function AdminSurveyAnalyticsPage({ params }: AdminAnalyticsPageProps) {
  const { id } = await params;

  // RSC 도 export procedure 와 같은 판정을 받는다 — 이 페이지는 복호화된 응답을 렌더한다.
  await assertAnalyticsPageAccess(id);

  // 설문 및 응답 데이터 조회 (response_answers 우선, JSONB fallback)
  const [survey, responses, versions] = await Promise.all([
    getSurveyWithDetails(id),
    getResponsesWithAnswers(id),
    getSurveyVersions(id),
  ]);

  if (!survey) {
    notFound();
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
        />
      </main>
    </div>
  );
}

// 메타데이터 생성 — 페이지와 같은 관문을 지난다. 여기서 새면 404 응답의 <title> 로
// 타 팀 설문 제목이 실린다.
export async function generateMetadata({ params }: AdminAnalyticsPageProps) {
  const { id } = await params;
  await assertAnalyticsPageAccess(id);
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
