'use client';

import { useId, useState } from 'react';

import Link from 'next/link';

import {
  Activity,
  ArrowLeft,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Copy,
  CopyPlus,
  Edit,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  Globe,
  Loader2,
  Lock,
  LogOut,
  MoreVertical,
  PencilLine,
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
import { TruncatedText } from '@/components/ui/truncated-text';
import {
  useDeleteSurvey,
  useDuplicateSurvey,
  useSurveys,
} from '@/features/survey-builder/queries/use-surveys';
import { formatLocalDate } from '@/lib/date-formatters';
import { getSurveyAccessUrl } from '@/lib/survey-url';
import {
  compareSurveyCardTitle,
  hasOwnCardTitle,
  matchesSurveyListSearch,
  surveyCardTitle,
} from '@/utils/survey-card-title';
import { partitionSurveyList } from '@/utils/survey-list-groups';

import { SurveyCardTitleDialog } from './survey-card-title-dialog';
import { useOpenSurveyListGroups } from './use-open-survey-list-groups';

/** 묶음 안에서 가장 최근에 고친 설문의 수정일 — 접힌 묶음 카드에 적는다. */
function latestUpdatedAt(surveys: ReadonlyArray<{ updatedAt: Date | string }>): Date {
  return new Date(Math.max(...surveys.map((survey) => new Date(survey.updatedAt).getTime())));
}

export default function SurveyListPage() {
  const { data: surveys, isLoading, error } = useSurveys();
  const { mutate: deleteSurvey } = useDeleteSurvey();
  const { mutate: duplicateSurvey, isPending: isDuplicating } = useDuplicateSurvey();
  const [searchQuery, setSearchQuery] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  // 카드 제목을 바꾸는 중인 설문 id — 창은 목록에서 그 설문을 다시 찾아 지금 값을 보인다.
  const [cardTitleSurveyId, setCardTitleSurveyId] = useState<string | null>(null);
  const { openGroups, toggleGroup } = useOpenSurveyListGroups();
  const listId = useId();

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

  // 카드 제목과 설문 제목 어느 쪽으로도 찾는다 — 카드 제목을 따로 지은 설문을 설문 제목으로 찾지 못하면 「없다」고 오해한다.
  const filteredSurveys = surveyList.filter((survey) =>
    matchesSurveyListSearch(survey, searchQuery),
  );

  // 묶음(임시 장치 — `lib/survey-list-groups.server.ts`). 검색 중에는 묶음을 풀어 한 목록으로 보여 준다 —
  // 접혀 있다는 이유로 묶음 안의 설문이 검색에서 빠지면 「없다」고 오해한다.
  const isSearching = searchQuery.trim() !== '';
  const { groups, ungrouped } = partitionSurveyList(surveyList);

  const handleDeleteSurvey = (surveyId: string) => {
    if (confirm('이 설문을 삭제하시겠습니까?')) {
      deleteSurvey(surveyId);
      setOpenMenuId(null);
    }
  };

  const handleDuplicateSurvey = (surveyId: string) => {
    if (isDuplicating) return;
    duplicateSurvey(surveyId, {
      // duplicate 는 원본 미존재 시 null 을 반환하므로 성공 콜백에서도 분기한다.
      onSuccess: (copy) => {
        if (copy) toast.success('설문이 복제되었습니다');
        else toast.error('설문 복제에 실패했습니다');
      },
      onError: () => toast.error('설문 복제에 실패했습니다'),
    });
    setOpenMenuId(null);
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

  // 설문 카드 한 장 — 묶음 안·묶음 밖·검색 결과가 같은 카드를 쓴다. groupName 은 검색 결과에서만 넘긴다.
  const renderSurveyCard = (survey: (typeof surveyList)[0], groupName?: string | null) => (
    <Card
      key={survey.id}
      className="group relative p-6 transition-shadow duration-200 hover:shadow-lg"
    >
      <div className="mb-4 flex items-start justify-between">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-100">
          <FileText className="h-5 w-5 text-blue-600" />
        </div>
        <div className="flex min-w-0 items-center gap-1 pl-3">
          {groupName && (
            <span className="flex min-w-0 items-center gap-1.5 rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
              <Folder className="h-3 w-3 shrink-0" aria-hidden />
              <TruncatedText text={groupName} className="min-w-0" />
            </span>
          )}
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
                    onClick={() => {
                      setCardTitleSurveyId(survey.id);
                      setOpenMenuId(null);
                    }}
                    className="flex w-full items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    <PencilLine className="mr-2 h-4 w-4" />
                    카드 제목 바꾸기
                  </button>
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
                  <button
                    onClick={() => handleDuplicateSurvey(survey.id)}
                    disabled={isDuplicating}
                    className="flex w-full items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:pointer-events-none disabled:opacity-50"
                  >
                    {isDuplicating ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CopyPlus className="mr-2 h-4 w-4" />
                    )}
                    복제
                  </button>
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
      </div>

      <h3 className="mb-2 min-w-0 text-lg font-semibold text-gray-900">
        <TruncatedText text={surveyCardTitle(survey)} />
      </h3>
      {/* 카드 제목을 따로 지은 설문은 응답자가 보는 설문 제목을 한 줄 더 보인다 */}
      {hasOwnCardTitle(survey) && (
        <p className="-mt-1 mb-2 min-w-0 text-[13px] text-gray-500">
          <TruncatedText text={`설문 제목: ${survey.title}`} />
        </p>
      )}
      <p className="mb-4 text-sm text-gray-500">
        {`온라인 응답 완료 ${survey.completedResponseCount.toLocaleString('ko-KR')}건`}
        {` · 실사 완료 처리 ${survey.fieldworkCompletedCount.toLocaleString('ko-KR')}건`}
      </p>

      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>수정일: {formatLocalDate(survey.updatedAt)}</span>
        <span
          className={`flex items-center gap-1 rounded-full px-2 py-1 ${
            survey.isPublic ? 'bg-green-100 text-green-600' : 'bg-amber-100 text-amber-600'
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
  );

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
        ) : isSearching || groups.length === 0 ? (
          <div>
            {isSearching && groups.length > 0 && (
              <h2 className="mb-3 text-sm font-semibold text-gray-700">
                검색 결과{' '}
                <span className="font-normal text-gray-500">{filteredSurveys.length}</span>
              </h2>
            )}
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {filteredSurveys.map((survey) =>
                renderSurveyCard(survey, isSearching ? survey.listGroup : null),
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            <section aria-labelledby={`${listId}-groups`}>
              <h2 id={`${listId}-groups`} className="mb-3 text-sm font-semibold text-gray-700">
                묶음 <span className="font-normal text-gray-500">{groups.length}</span>
              </h2>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                {groups.map((group, index) => {
                  const isOpen = openGroups.includes(group.name);
                  const panelId = `${listId}-group-${index}`;
                  return (
                    <div
                      key={group.name}
                      className={
                        isOpen
                          ? 'col-span-full rounded-xl border border-gray-200 bg-gray-100 p-5'
                          : 'rounded-xl border border-gray-200 bg-white shadow-sm transition-shadow duration-200 hover:shadow-md'
                      }
                    >
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-controls={isOpen ? panelId : undefined}
                        onClick={() => toggleGroup(group.name)}
                        className={`flex w-full items-center gap-3.5 rounded-xl text-left focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none ${
                          isOpen ? '' : 'px-5 py-4'
                        }`}
                      >
                        {isOpen ? (
                          <FolderOpen
                            className="h-[22px] w-[22px] shrink-0 text-gray-700"
                            aria-hidden
                          />
                        ) : (
                          <Folder
                            className="h-[22px] w-[22px] shrink-0 text-gray-500"
                            aria-hidden
                          />
                        )}
                        {isOpen ? (
                          <span className="flex min-w-0 flex-1 items-baseline gap-2">
                            <TruncatedText
                              text={group.name}
                              className="min-w-0 font-semibold text-gray-900"
                            />
                            <span className="shrink-0 text-[13px] text-gray-500">
                              설문 {group.surveys.length}
                            </span>
                          </span>
                        ) : (
                          <span className="min-w-0 flex-1">
                            <TruncatedText
                              text={group.name}
                              className="font-semibold text-gray-900"
                            />
                            <span className="block truncate text-[13px] text-gray-500">
                              설문 {group.surveys.length} · 최근 수정{' '}
                              {formatLocalDate(latestUpdatedAt(group.surveys))}
                            </span>
                          </span>
                        )}
                        {isOpen ? (
                          <span className="flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm font-medium text-gray-700">
                            접기
                            <ChevronUp className="h-4 w-4" aria-hidden />
                          </span>
                        ) : (
                          <ChevronDown className="h-5 w-5 shrink-0 text-gray-500" aria-hidden />
                        )}
                      </button>
                      {isOpen && (
                        <div
                          id={panelId}
                          className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3"
                        >
                          {/* 묶음 안은 카드 제목순 — 번호를 붙인 카드 제목이 문서 순서대로 선다 */}
                          {[...group.surveys]
                            .sort(compareSurveyCardTitle)
                            .map((survey) => renderSurveyCard(survey))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
            {ungrouped.length > 0 && (
              <section aria-labelledby={`${listId}-ungrouped`}>
                <h2 id={`${listId}-ungrouped`} className="mb-3 text-sm font-semibold text-gray-700">
                  설문 <span className="font-normal text-gray-500">{ungrouped.length}</span>
                </h2>
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {ungrouped.map((survey) => renderSurveyCard(survey))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      <SurveyCardTitleDialog
        survey={surveyList.find((survey) => survey.id === cardTitleSurveyId) ?? null}
        onClose={() => setCardTitleSurveyId(null)}
      />

      {/* Click outside to close menu */}
      {openMenuId && <div className="fixed inset-0 z-40" onClick={() => setOpenMenuId(null)} />}
    </div>
  );
}
