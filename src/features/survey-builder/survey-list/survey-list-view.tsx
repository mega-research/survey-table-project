'use client';

import { useEffect, useMemo, useRef } from 'react';

import Link from 'next/link';

import { Loader2, Plus } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { SYSTEM_SCOPE } from '@/shared/contracts/workspace';
import { useWorkScopeOptional } from '@/shared/lib/work-scope-context';

import { useDeleteSurvey, useDuplicateSurvey, surveyListQueryOptions } from '../queries/use-surveys';
import { useSurveyListStore } from '../stores/survey-list-ui-store';
import { AdvancedSearchPanel } from './advanced-search-panel';
import { NoResultsEmptyState, NoSurveysEmptyState, NoTeamEmptyState } from './empty-states';
import { ListPagination } from './list-pagination';
import { ListToolbar } from './list-toolbar';
import { SurveyCard } from './survey-card';
import {
  countByStatusChip,
  distinctOwners,
  filterSurveyList,
  paginateSurveyList,
  sortSurveyList,
} from './survey-list-pipeline';

/**
 * 설문 목록 (.pen FLOW 6, 역할 모델 v2 티켓 08) — 상태 칩 · 검색 · 정렬 · 상세 검색 ·
 * 페이지네이션 · 카드 그리드.
 *
 * 작업 범위는 사이드바(AdminShell)가 컨텍스트로 내려준다. **쿼리 키에 범위가 들어가므로**
 * 팀을 바꾸면 키가 갈려 이전 팀의 캐시를 재사용하지 않고, 팀 미배치(none)는 조회 자체를
 * 하지 않는다(FLOW 9-1). 컨텍스트가 없는 트리(셸 밖)에서는 범위 미지정으로 조회한다 —
 * 서버가 쿠키·멤버십으로 해석한다.
 */
export function SurveyListView() {
  const workScope = useWorkScopeOptional();
  const contextScope = workScope?.scope ?? null;

  // 화면이 지목하는 범위 문자열 — 컨텍스트의 해석된 범위에서 출발한다. 첫 렌더부터 실제
  // 범위가 키에 들어가야 "범위 미지정" 키 하나에 여러 팀의 응답이 겹쳐 쓰이지 않는다.
  const requestedScope =
    contextScope === null
      ? null
      : contextScope.kind === 'system'
        ? SYSTEM_SCOPE
        : contextScope.kind === 'team'
          ? contextScope.teamId
          : null;
  const isUnassigned = contextScope?.kind === 'none';

  const { data, isLoading, error } = useQuery({
    ...surveyListQueryOptions(requestedScope),
    // 팀 미배치는 조회 자체를 하지 않는다 — 서버도 빈 목록을 주지만 왕복부터 없앤다.
    enabled: !isUnassigned,
  });
  const { mutate: deleteSurvey } = useDeleteSurvey();
  const { mutate: duplicateSurvey, isPending: isDuplicating } = useDuplicateSurvey();

  const {
    searchQuery,
    statusChip,
    sortBy,
    advancedOpen,
    advanced,
    page,
    setSearchQuery,
    setStatusChip,
    setSortBy,
    setAdvancedOpen,
    setAdvanced,
    setPage,
    resetAdvanced,
    resetAll,
  } = useSurveyListStore();

  // 팀을 바꾸면 필터·페이지를 전부 되돌린다 — 이전 팀에서 남은 검색어·페이지가 새 팀 목록을
  // 조용히 0건/빈 페이지로 만들지 않게(새 워크스페이스에서 시작하는 것과 동일 취급).
  const scopeKey =
    contextScope?.kind === 'team' ? `team:${contextScope.teamId}` : (contextScope?.kind ?? 'no-shell');
  const prevScopeKeyRef = useRef(scopeKey);
  useEffect(() => {
    if (prevScopeKeyRef.current === scopeKey) return;
    prevScopeKeyRef.current = scopeKey;
    resetAll();
  }, [scopeKey, resetAll]);

  const allSurveys = useMemo(() => data?.surveys ?? [], [data]);
  const counts = useMemo(() => countByStatusChip(allSurveys), [allSurveys]);
  const owners = useMemo(() => distinctOwners(allSurveys), [allSurveys]);

  const filtered = useMemo(
    () => sortSurveyList(filterSurveyList(allSurveys, { searchQuery, statusChip, advanced }), sortBy),
    [allSurveys, searchQuery, statusChip, advanced, sortBy],
  );

  const { pageItems, totalPages, page: clampedPage } = useMemo(
    () => paginateSurveyList(filtered, page),
    [filtered, page],
  );

  function handleDelete(surveyId: string) {
    if (confirm('이 설문을 삭제하시겠습니까?')) {
      deleteSurvey(surveyId, {
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : '삭제에 실패했습니다.'),
      });
    }
  }

  function handleDuplicate(surveyId: string) {
    if (isDuplicating) return;
    duplicateSurvey(surveyId, {
      // duplicate 는 원본 미존재 시 null 을 반환하므로 성공 콜백에서도 분기한다.
      onSuccess: (copy) => {
        if (copy) toast.success('설문이 복제되었습니다');
        else toast.error('설문 복제에 실패했습니다');
      },
      onError: () => toast.error('설문 복제에 실패했습니다'),
    });
  }

  // 팀 미배치 — 조회 없이 빈 상태만 (.pen FLOW 9-1).
  if (isUnassigned) {
    return (
      <div className="p-10">
        <NoTeamEmptyState />
      </div>
    );
  }

  // 서버가 해석한 범위가 정답이다 — 요청한 범위와 다를 수 있다(해산된 팀 쿠키 등).
  const scope = data?.scope ?? contextScope ?? { kind: 'none' as const };
  const isSystemScope = scope.kind === 'system';
  const canCreate = scope.kind === 'team';
  const currentUserId = workScope?.currentUserId ?? null;
  const isSuperadmin = workScope?.isSuperadmin ?? false;

  return (
    <div className="flex flex-col gap-5 p-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-[#1C1C1E]">
          {isSystemScope ? '설문 목록 — 시스템 전체 보기' : '설문 목록'}
        </h1>
        {canCreate ? (
          <Link
            href="/admin/surveys/create"
            className="flex h-[42px] items-center gap-1.5 rounded-[9px] bg-[#2E4FCE] px-4 text-[14px] font-semibold text-white hover:bg-[#2743AE]"
          >
            <Plus className="h-4 w-4" />
            새 설문 만들기
          </Link>
        ) : (
          // 시스템 전체 보기는 조회 범위라 소유 목적지가 될 수 없다 (.pen 6-2 노트).
          <span
            title={
              isSystemScope
                ? '설문을 만들려면 소유 팀을 먼저 선택하세요'
                : '소속된 팀이 없어 설문을 만들 수 없습니다'
            }
            className="flex h-[42px] cursor-not-allowed items-center gap-1.5 rounded-[9px] bg-[#E5E7EB] px-4 text-[14px] font-semibold text-[#9CA3AF]"
          >
            <Plus className="h-4 w-4" />새 설문 만들기
          </span>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-[#9CA3AF]" />
        </div>
      )}

      {error && !isLoading && (
        <div className="py-24 text-center text-[13.5px] text-[#6E6E73]">
          설문 목록을 불러올 수 없습니다.
        </div>
      )}

      {!isLoading && !error && (
        <>
          <div className="relative">
            <ListToolbar
              counts={counts}
              statusChip={statusChip}
              onStatusChipChange={setStatusChip}
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              sortBy={sortBy}
              onSortByChange={setSortBy}
              advancedOpen={advancedOpen}
              onToggleAdvanced={() => setAdvancedOpen(!advancedOpen)}
            />
            {advancedOpen && (
              <AdvancedSearchPanel
                advanced={advanced}
                onChange={setAdvanced}
                onReset={resetAdvanced}
                onClose={() => setAdvancedOpen(false)}
                owners={owners}
              />
            )}
          </div>

          {scope.kind === 'none' ? (
            // 셸 밖 트리에서 서버가 미배치로 해석한 경우 — FLOW 9-1 문구로 안내한다.
            <NoTeamEmptyState />
          ) : allSurveys.length === 0 ? (
            <NoSurveysEmptyState canCreate={canCreate} />
          ) : filtered.length === 0 ? (
            <NoResultsEmptyState onReset={resetAll} />
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                {pageItems.map((survey) => (
                  <SurveyCard
                    key={survey.id}
                    survey={survey}
                    scope={scope}
                    currentUserId={currentUserId}
                    isSuperadmin={isSuperadmin}
                    onDelete={handleDelete}
                    onDuplicate={handleDuplicate}
                    isDuplicating={isDuplicating}
                  />
                ))}
              </div>

              <ListPagination page={clampedPage} totalPages={totalPages} onPageChange={setPage} />
            </>
          )}
        </>
      )}
    </div>
  );
}
