import { cache } from 'react';

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ArrowLeft, Settings } from 'lucide-react';

import { AnalyticsDashboardClient } from '@/features/analytics';
import { Button } from '@/components/ui/button';
import { getResponsesWithAnswers, getSurveyVersions } from '@/server/read-models/responses';
import { getSurveyWithDetails } from '@/server/survey-builder/services/survey-read';
import { assertSurveyCapabilityPage } from '@/server/page-survey-access';
import { requireAdminPage } from '@/lib/auth/require-admin-page';

interface AnalyticsPageProps {
  params: Promise<{ surveyId: string }>;
}

/**
 * 없는 설문과 타 팀 설문을 같은 notFound 로 접는다(티켓 09). 본문과 generateMetadata 가
 * 함께 지나므로 cache 로 요청당 판정을 1회로 줄인다.
 *
 * **analytics.view 만으로는 열리지 않는다** — 이 페이지는 `getResponsesWithAnswers` 로
 * 복호화된 원문 응답과 응답 행 전체(contactTargetId·sessionId·ipHash·fpHash·deviceId·
 * userAgent·metadata)를 읽어 클라이언트 컴포넌트 props 로 직렬화한다. 즉 RSC payload 에
 * 응답 원문과 응답자 추적 데이터가 그대로 실린다. 매트릭스가 팀원에게 `responses.view` 를
 * 주지 않는 것은 바로 그 데이터를 막으려는 것이므로, 분석 화면도 같은 권한을 요구해야
 * capability 분리가 성립한다(Codex 적대적 리뷰, 사용자 확정 2026-08-27).
 *
 * 두 관문을 순서대로 지나면 사유가 정확해진다 — 볼 수 없는 설문은 analytics.view 에서
 * not_found 로, 볼 수는 있지만 응답 열람 권한이 없는 팀원은 responses.view 에서 걸린다.
 */
const assertAnalyticsPageAccess = cache(async (surveyId: string): Promise<void> => {
  const viewer = await requireAdminPage();
  await assertSurveyCapabilityPage(viewer, surveyId, 'analytics.view');
  await assertSurveyCapabilityPage(viewer, surveyId, 'responses.view');
});

export default async function SurveyAnalyticsPage({ params }: AnalyticsPageProps) {
  const { surveyId } = await params;

  // RSC 도 export procedure 와 같은 판정을 받는다 — 이 페이지는 복호화된 응답을 렌더한다.
  await assertAnalyticsPageAccess(surveyId);

  // 설문 및 응답 데이터 조회 (response_answers 우선, JSONB fallback)
  const [survey, responses, versions] = await Promise.all([
    getSurveyWithDetails(surveyId),
    getResponsesWithAnswers(surveyId),
    getSurveyVersions(surveyId),
  ]);

  if (!survey) {
    notFound();
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
        />
      </main>
    </div>
  );
}

// 메타데이터 생성 — 페이지와 같은 관문을 지난다. 여기서 새면 404 응답의 <title> 로
// 타 팀 설문 제목이 실린다.
export async function generateMetadata({ params }: AnalyticsPageProps) {
  const { surveyId } = await params;
  await assertAnalyticsPageAccess(surveyId);
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
