'use client';

import { useState } from 'react';

import Link from 'next/link';

import {
  Activity,
  ArrowLeft,
  BarChart3,
  Copy,
  Edit,
  ExternalLink,
  FileText,
  Globe,
  Loader2,
  Lock,
  LogOut,
  MoreVertical,
  Plus,
  Search,
  Trash2,
  User,
} from 'lucide-react';
import { toast } from 'sonner';

import { logout } from '@/actions/auth-actions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useDeleteSurvey, useSurveys } from '@/hooks/queries';
import { formatLocalDate } from '@/lib/date-formatters';
import { getSurveyAccessUrl } from '@/lib/survey-url';

export default function SurveyListPage() {
  const { data: surveys, isLoading, error } = useSurveys();
  const { mutate: deleteSurvey } = useDeleteSurvey();
  const [searchQuery, setSearchQuery] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // 로딩 중
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-blue-500" />
          <p className="text-gray-500">설문 목록을 불러오는 중...</p>
        </div>
      </div>
    );
  }

  // 에러 발생
  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
            <FileText className="h-8 w-8 text-red-400" />
          </div>
          <h3 className="mb-2 text-lg font-medium text-gray-900">오류가 발생했습니다</h3>
          <p className="mb-6 text-gray-500">설문 목록을 불러올 수 없습니다.</p>
          <Button onClick={() => window.location.reload()}>다시 시도</Button>
        </div>
      </div>
    );
  }

  const surveyList = surveys ?? [];

  const filteredSurveys = surveyList.filter((survey) =>
    survey.title.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const handleDeleteSurvey = (surveyId: string) => {
    if (confirm('이 설문을 삭제하시겠습니까?')) {
      deleteSurvey(surveyId);
      setOpenMenuId(null);
    }
  };

  const handleCopyLink = (survey: (typeof surveyList)[0]) => {
    const link = getSurveyUrl(survey);
    const fullLink = `${window.location.origin}${link}`;
    navigator.clipboard.writeText(fullLink);
    toast.success('링크가 복사되었습니다');
    setOpenMenuId(null);
  };

  // 설문 접근 URL 가져오기
  const getSurveyUrl = (survey: (typeof surveyList)[0]) => {
    return getSurveyAccessUrl(
      {
        id: survey.id,
        slug: survey.slug,
        privateToken: survey.privateToken,
        settings: { isPublic: survey.isPublic },
      },
      '',
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Navigation */}
      <nav className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link href="/">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="mr-2 h-4 w-4" />
                홈으로
              </Button>
            </Link>
            <div className="h-6 w-px bg-gray-300" />
            <div className="flex items-center space-x-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-blue-600">
                <FileText className="h-5 w-5 text-white" />
              </div>
              <span className="text-xl font-semibold text-gray-900">설문 관리</span>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Button asChild>
              <Link href="/admin/surveys/create">
                <Plus className="mr-2 h-4 w-4" />새 설문 만들기
              </Link>
            </Button>
            <Link href="/admin/profile">
              <Button variant="ghost" size="icon" title="프로필">
                <User className="h-5 w-5" />
              </Button>
            </Link>
            <form action={logout}>
              <Button
                variant="ghost"
                size="icon"
                title="로그아웃"
                className="text-red-500 hover:bg-red-50 hover:text-red-600"
              >
                <LogOut className="h-5 w-5" />
              </Button>
            </form>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div className="mx-auto max-w-7xl p-6">
        {/* Search Bar */}
        <div className="mb-6">
          <div className="relative max-w-md">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform text-gray-400" />
            <Input
              type="text"
              placeholder="설문 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {/* Survey List */}
        {filteredSurveys.length === 0 ? (
          <div className="py-16 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
              <FileText className="h-8 w-8 text-gray-400" />
            </div>
            <h3 className="mb-2 text-lg font-medium text-gray-900">
              {searchQuery ? '검색 결과가 없습니다' : '아직 설문이 없습니다'}
            </h3>
            <p className="mb-6 text-gray-500">
              {searchQuery ? '다른 검색어로 시도해보세요' : '첫 번째 설문을 만들어보세요!'}
            </p>
            {!searchQuery && (
              <Button asChild>
                <Link href="/admin/surveys/create">
                  <Plus className="mr-2 h-4 w-4" />새 설문 만들기
                </Link>
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {filteredSurveys.map((survey) => (
              <Card
                key={survey.id}
                className="group relative p-6 transition-shadow duration-200 hover:shadow-lg"
              >
                <div className="mb-4 flex items-start justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
                    <FileText className="h-5 w-5 text-blue-600" />
                  </div>
                  <div className="relative">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={() => setOpenMenuId(openMenuId === survey.id ? null : survey.id)}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>

                    {openMenuId === survey.id && (
                      <div className="absolute right-0 z-50 mt-2 w-48 rounded-lg border border-gray-200 bg-white shadow-lg">
                        <div className="py-1">
                          <Link
                            href={`/admin/surveys/${survey.id}/edit`}
                            className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                            onClick={() => setOpenMenuId(null)}
                          >
                            <Edit className="mr-2 h-4 w-4" />
                            수정
                          </Link>
                          <Link
                            href={`/admin/surveys/${survey.id}/analytics`}
                            className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                            onClick={() => setOpenMenuId(null)}
                          >
                            <BarChart3 className="mr-2 h-4 w-4" />
                            분석
                          </Link>
                          <Link
                            href={`/admin/surveys/${survey.id}/operations/overview`}
                            className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                            onClick={() => setOpenMenuId(null)}
                          >
                            <Activity className="mr-2 h-4 w-4" />
                            현황
                          </Link>
                          <button
                            onClick={() => handleCopyLink(survey)}
                            className="flex w-full items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                          >
                            <Copy className="mr-2 h-4 w-4" />
                            링크 복사
                          </button>
                          <Link
                            href={getSurveyUrl(survey)}
                            target="_blank"
                            className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                            onClick={() => setOpenMenuId(null)}
                          >
                            <ExternalLink className="mr-2 h-4 w-4" />
                            설문 열기
                          </Link>
                          <hr className="my-1" />
                          <button
                            onClick={() => handleDeleteSurvey(survey.id)}
                            className="flex w-full items-center px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            삭제
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <h3 className="mb-2 truncate text-lg font-semibold text-gray-900">
                  {survey.title}
                </h3>
                <p className="mb-4 text-sm text-gray-500">
                  전체 응답 {survey.responseCount.toLocaleString('ko-KR')}건 · 완료{' '}
                  {survey.completedResponseCount.toLocaleString('ko-KR')}건
                </p>

                <div className="flex items-center justify-between text-xs text-gray-400">
                  <span>수정일: {formatLocalDate(survey.updatedAt)}</span>
                  <span
                    className={`flex items-center gap-1 rounded-full px-2 py-1 ${
                      survey.isPublic
                        ? 'bg-green-100 text-green-600'
                        : 'bg-amber-100 text-amber-600'
                    }`}
                  >
                    {survey.isPublic ? (
                      <>
                        <Globe className="h-3 w-3" />
                        공개
                      </>
                    ) : (
                      <>
                        <Lock className="h-3 w-3" />
                        비공개
                      </>
                    )}
                  </span>
                </div>

                <div className="mt-4 flex space-x-2 border-t border-gray-100 pt-4">
                  <Button variant="outline" size="sm" className="flex-1" asChild>
                    <Link href={`/admin/surveys/${survey.id}/edit`}>
                      <Edit className="mr-1 h-3 w-3" />
                      수정
                    </Link>
                  </Button>
                  <Button variant="outline" size="sm" className="flex-1" asChild>
                    <Link href={`/admin/surveys/${survey.id}/analytics`}>
                      <BarChart3 className="mr-1 h-3 w-3" />
                      분석
                    </Link>
                  </Button>
                  <Button variant="outline" size="sm" className="flex-1" asChild>
                    <Link href={`/admin/surveys/${survey.id}/operations/overview`}>
                      <Activity className="mr-1 h-3 w-3" />
                      현황
                    </Link>
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Click outside to close menu */}
      {openMenuId && <div className="fixed inset-0 z-40" onClick={() => setOpenMenuId(null)} />}
    </div>
  );
}
