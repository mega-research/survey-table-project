import Link from 'next/link';

import { ArrowRight, BarChart3, Calendar, FileText, Plus, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { LocalDateTime } from '@/components/ui/local-date-time';
import { getResponseCountsGroupedBySurvey } from '@/data/responses';
import { getSurveys } from '@/data/surveys';

// 라이브 응답 수를 보여주는 대시보드. 빌드 타임 prerender(static) 대상이 되면
// 프로덕션 DB에 카운트 쿼리를 실행하다 statement_timeout 으로 빌드가 실패한다.
// 항상 요청 시점에 렌더링한다.
export const dynamic = 'force-dynamic';

export default async function AnalyticsListPage() {
  // 모든 설문의 응답 수를 단일 GROUP BY 로 집계 (설문별 count fan-out 제거)
  const [surveys, countsMap] = await Promise.all([
    getSurveys(),
    getResponseCountsGroupedBySurvey(),
  ]);
  const surveysWithResponses = surveys.map((survey) => {
    const counts = countsMap.get(survey.id) ?? { total: 0, completed: 0 };
    return {
      ...survey,
      totalResponses: counts.total,
      completedResponses: counts.completed,
    };
  });

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-3">
              <BarChart3 className="h-6 w-6 text-blue-500" />
              <h1 className="text-xl font-semibold text-gray-900">설문 분석</h1>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/admin/surveys">
                <Button variant="outline" size="sm">
                  <FileText className="mr-2 h-4 w-4" />
                  설문 관리
                </Button>
              </Link>
              <Link href="/admin/surveys/create">
                <Button size="sm">
                  <Plus className="mr-2 h-4 w-4" />새 설문
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* 메인 콘텐츠 */}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {surveysWithResponses.length > 0 ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {surveysWithResponses.map((survey) => (
              <Link key={survey.id} href={`/analytics/${survey.id}`}>
                <Card className="group cursor-pointer p-6 transition-shadow hover:shadow-md">
                  <div className="mb-4 flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-lg font-semibold text-gray-900 transition-colors group-hover:text-blue-600">
                        {survey.title}
                      </h3>
                      {survey.description && (
                        <p className="mt-1 line-clamp-2 text-sm text-gray-500">
                          {survey.description}
                        </p>
                      )}
                    </div>
                    <ArrowRight className="ml-2 h-5 w-5 flex-shrink-0 text-gray-400 transition-colors group-hover:text-blue-500" />
                  </div>

                  {/* 통계 */}
                  <div className="mt-4 grid grid-cols-2 gap-4 border-t border-gray-100 pt-4">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-gray-400" />
                      <div>
                        <p className="text-lg font-semibold text-gray-900">
                          {survey.completedResponses}
                        </p>
                        <p className="text-xs text-gray-500">완료된 응답</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-gray-400" />
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          <LocalDateTime value={survey.createdAt} format="short-month-day" />
                        </p>
                        <p className="text-xs text-gray-500">생성일</p>
                      </div>
                    </div>
                  </div>

                  {/* 상태 배지 */}
                  <div className="mt-4 flex items-center gap-2">
                    {survey.completedResponses > 0 ? (
                      <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700">
                        {survey.completedResponses}개 응답
                      </span>
                    ) : (
                      <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
                        응답 없음
                      </span>
                    )}
                    {survey.isPublic ? (
                      <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700">
                        공개
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700">
                        비공개
                      </span>
                    )}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          // 빈 상태
          <div className="py-16 text-center">
            <BarChart3 className="mx-auto mb-4 h-16 w-16 text-gray-300" />
            <h2 className="mb-2 text-xl font-semibold text-gray-900">아직 설문이 없습니다</h2>
            <p className="mb-6 text-gray-500">새 설문을 만들어 응답을 수집하고 분석해보세요.</p>
            <Link href="/admin/surveys/create">
              <Button>
                <Plus className="mr-2 h-4 w-4" />첫 설문 만들기
              </Button>
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}

export const metadata = {
  title: '설문 분석 | Survey Table',
  description: '설문 응답 데이터를 분석하고 인사이트를 확인하세요.',
};
