'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { useQuery } from '@tanstack/react-query';
import { Folder, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { SYSTEM_SCOPE } from '@/shared/contracts/workspace';
import { useWorkScopeOptional } from '@/shared/lib/work-scope-context';

import { useMoveSurveyToGroup, useSurveyGroups } from '../queries/use-survey-groups';
import {
  surveyListQueryOptions,
  useDeleteSurvey,
  useDuplicateSurvey,
  useRestoreSurvey,
} from '../queries/use-surveys';
import { useSurveyListStore } from '../stores/survey-list-ui-store';
import { AdvancedSearchPanel } from './advanced-search-panel';
import { DeletedSurveyCard } from './deleted-survey-card';
import {
  EmptyDeletedState,
  EmptyGroupState,
  NoResultsEmptyState,
  NoSurveysEmptyState,
  NoTeamEmptyState,
} from './empty-states';
import { GroupManageModal } from './groups/group-manage-modal';
import { GroupViewFooterNote, GroupViewHeader } from './groups/group-view-header';
import { ListPagination } from './list-pagination';
import { ListToolbar } from './list-toolbar';
import { SurveyCard } from './survey-card';
import {
  countByStatusChip,
  distinctOwners,
  filterSurveyList,
  narrowToGroup,
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

  // 휴지통은 슈퍼어드민의 시스템 전체 보기에만 있다(티켓 17). 범위가 바뀌면 스토어도
  // resetAll 로 따라 내려가지만 그건 effect 라 한 렌더 늦는다 — 그 한 번의 요청이
  // FORBIDDEN 으로 떨어져 에러 배너가 번쩍이므로 조회 조건 자체를 여기서 좁힌다.
  const canSeeDeleted = (workScope?.isSuperadmin ?? false) && contextScope?.kind === 'system';

  const {
    searchQuery,
    statusChip,
    showDeleted,
    sortBy,
    advancedOpen,
    advanced,
    page,
    setSearchQuery,
    setStatusChip,
    setShowDeleted,
    setSortBy,
    setAdvancedOpen,
    setAdvanced,
    setPage,
    resetAdvanced,
    resetAll,
  } = useSurveyListStore();

  const { data, isLoading, error } = useQuery({
    // 휴지통은 조회 조건이 달라 쿼리 키가 갈린다 — 모드 토글이 곧 새 왕복이다(티켓 17).
    ...surveyListQueryOptions(requestedScope, showDeleted && canSeeDeleted),
    // 팀 미배치는 조회 자체를 하지 않는다 — 서버도 빈 목록을 주지만 왕복부터 없앤다.
    enabled: !isUnassigned,
  });
  const { mutate: deleteSurvey } = useDeleteSurvey();
  const { mutate: restoreSurvey, isPending: isRestoring } = useRestoreSurvey();
  const { mutate: duplicateSurvey, isPending: isDuplicating } = useDuplicateSurvey();

  // 그룹 화면은 목록의 다른 상태가 아니라 별개의 주소다(`?group=<id>`) — 뒤로 가기·새로고침·
  // 링크 공유가 살아 있어야 해서 스토어가 아니라 URL 이 정본이다.
  const searchParams = useSearchParams();
  const requestedGroupId = searchParams.get('group');
  // 그룹은 팀 소유물이라 **서버가 해석한 범위**로 물어야 한다 — 화면 컨텍스트의 팀을 쓰면
  // 쿠키가 접힌 경우(해산된 팀 등) 팀 A 의 그룹 목록으로 팀 B 의 설문을 좁히게 된다.
  const resolvedScope = data?.scope ?? contextScope ?? null;
  const teamScopeId = resolvedScope?.kind === 'team' ? resolvedScope.teamId : null;
  const {
    data: groups,
    isPending: groupsPending,
    isError: groupsError,
  } = useSurveyGroups(teamScopeId);
  const router = useRouter();
  const { mutate: moveSurveyToGroup } = useMoveSurveyToGroup();
  const [groupManagerOpen, setGroupManagerOpen] = useState(false);

  // 팀이나 그룹을 바꾸면 필터·페이지를 전부 되돌린다 — 이전 화면에서 남은 검색어·페이지가
  // 새 목록을 조용히 0건/빈 페이지로 만들지 않게(새 워크스페이스에서 시작하는 것과 동일 취급).
  const scopeKey = `${
    contextScope?.kind === 'team'
      ? `team:${contextScope.teamId}`
      : (contextScope?.kind ?? 'no-shell')
  }|group:${requestedGroupId ?? ''}`;
  const prevScopeKeyRef = useRef(scopeKey);
  useEffect(() => {
    if (prevScopeKeyRef.current === scopeKey) return;
    prevScopeKeyRef.current = scopeKey;
    resetAll();
  }, [scopeKey, resetAll]);

  const allSurveys = useMemo(() => data?.surveys ?? [], [data]);
  const groupList = useMemo(() => groups ?? [], [groups]);
  // 지목한 그룹이 목록에 없으면(삭제됐거나 남의 팀 id) 그룹 좁힘 자체를 하지 않는다 —
  // 유령 그룹 주소로 빈 화면에 갇히지 않게.
  const activeGroup = groupList.find((g) => g.id === requestedGroupId) ?? null;
  const groupId = activeGroup?.id ?? null;
  // 목록을 **실제로 받아본 뒤** 그 그룹이 없으면 주소도 정리한다. 안 그러면 보고 있던 그룹을
  // 삭제했을 때 URL 만 죽은 `?group=` 을 계속 실어 나르고(새로고침·뒤로가기·링크 공유),
  // scopeKey 가 그대로라 필터 리셋도 일어나지 않는다. 로딩·에러 중에는 손대지 않는다 —
  // "아직 안 왔다" 와 "없더라" 는 다른 상태다.
  const groupsSettled = teamScopeId !== null && !groupsPending && !groupsError;
  useEffect(() => {
    if (!requestedGroupId || !groupsSettled || activeGroup) return;
    router.replace('/admin/surveys');
  }, [requestedGroupId, groupsSettled, activeGroup, router]);

  // 칩 카운트·소유자 목록은 그룹 화면이 보는 부분집합에서 세야 화면과 숫자가 어긋나지 않는다.
  const scopedSurveys = useMemo(() => narrowToGroup(allSurveys, groupId), [allSurveys, groupId]);
  const counts = useMemo(() => countByStatusChip(scopedSurveys), [scopedSurveys]);
  const owners = useMemo(() => distinctOwners(scopedSurveys), [scopedSurveys]);

  const filtered = useMemo(
    () =>
      sortSurveyList(
        filterSurveyList(allSurveys, { searchQuery, statusChip, advanced, groupId }),
        sortBy,
      ),
    [allSurveys, searchQuery, statusChip, advanced, groupId, sortBy],
  );

  const {
    pageItems,
    totalPages,
    page: clampedPage,
  } = useMemo(() => paginateSurveyList(filtered, page), [filtered, page]);

  function handleDelete(surveyId: string) {
    if (confirm('이 설문을 삭제하시겠습니까?')) {
      deleteSurvey(surveyId, {
        onError: (err) => toast.error(err instanceof Error ? err.message : '삭제에 실패했습니다.'),
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

  function handleRestore(surveyId: string) {
    restoreSurvey(surveyId, {
      onSuccess: () => toast.success('설문을 복구했습니다'),
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : '설문을 복구하지 못했습니다.'),
    });
  }

  function handleMoveToGroup(surveyId: string, nextGroupId: string | null) {
    moveSurveyToGroup(
      { surveyId, groupId: nextGroupId },
      {
        onSuccess: () => toast.success(nextGroupId ? '그룹으로 이동했습니다' : '그룹에서 뺐습니다'),
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : '그룹을 옮기지 못했습니다.'),
      },
    );
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
  const scope = resolvedScope ?? { kind: 'none' as const };
  const isSystemScope = scope.kind === 'system';
  const canCreate = scope.kind === 'team';
  // 그룹은 팀 소유물이라 팀 범위에서만 존재한다 — 시스템 전체 보기에는 그룹 개념이 없다(.pen 6-2).
  const canManageGroups = teamScopeId !== null;
  // 그룹 화면 주소로 들어왔으면 그룹 목록이 올 때까지 기다린다 — 먼저 그리면 「설문 목록」
  // 제목 + 팀 전체 카드가 한 번 번쩍였다가 그룹으로 접힌다.
  const showLoading =
    isLoading || (requestedGroupId !== null && teamScopeId !== null && groupsPending);
  const currentUserId = workScope?.currentUserId ?? null;
  const isSuperadmin = workScope?.isSuperadmin ?? false;
  const leaderTeamIds = workScope?.leaderTeamIds ?? [];

  return (
    <div className="flex flex-col gap-5 p-10">
      <div className="flex items-center justify-between">
        {activeGroup ? (
          <GroupViewHeader groupName={activeGroup.name} />
        ) : (
          <h1 className="text-2xl font-semibold text-[#1C1C1E]">
            {isSystemScope ? '설문 목록 — 시스템 전체 보기' : '설문 목록'}
          </h1>
        )}
        <div className="flex items-center gap-2.5">
          {canManageGroups && (
            <button
              type="button"
              onClick={() => setGroupManagerOpen(true)}
              className="flex h-[42px] items-center gap-1.5 rounded-[9px] border border-[#E5E5EA] bg-white px-[18px] text-[14px] font-medium text-[#374151] hover:bg-[#F5F5F7]"
            >
              <Folder className="h-4 w-4" />
              {activeGroup ? '그룹 편집' : '그룹 관리'}
            </button>
          )}
          {canCreate ? (
            <Link
              href="/admin/surveys/create"
              className="flex h-[42px] items-center gap-1.5 rounded-[9px] bg-[#2E4FCE] px-4 text-[14px] font-semibold text-white hover:bg-[#2743AE]"
            >
              <Plus className="h-4 w-4" />새 설문 만들기
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
      </div>

      {showLoading && (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-[#9CA3AF]" />
        </div>
      )}

      {error && !showLoading && (
        <div className="py-24 text-center text-[13.5px] text-[#6E6E73]">
          설문 목록을 불러올 수 없습니다.
        </div>
      )}

      {/* 그룹 목록을 못 가져오면 `?group=` 주소인데 팀 전체 목록이 그려진다 — 정상 폴백
          ("불러왔는데 그 그룹이 없더라")과 갈라서 조용히 서지 않게 한다. */}
      {requestedGroupId !== null && groupsError && !showLoading && !error && (
        <div className="py-24 text-center text-[13.5px] text-[#6E6E73]">
          그룹을 불러올 수 없습니다.{' '}
          <Link href="/admin/surveys" className="text-[#2E4FCE] hover:underline">
            전체 목록으로
          </Link>
        </div>
      )}

      {!showLoading && !error && !(requestedGroupId !== null && groupsError) && (
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
              searchPlaceholder={activeGroup ? '그룹 내 설문 검색' : '설문 검색...'}
              advancedOpen={advancedOpen}
              onToggleAdvanced={() => setAdvancedOpen(!advancedOpen)}
              deletedCount={data?.deletedCount ?? null}
              showDeleted={showDeleted && canSeeDeleted}
              onToggleDeleted={setShowDeleted}
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
            // 휴지통이 비어 있는 것과 팀에 설문이 없는 것은 다른 화면이다 — 여기서 「새 설문
            // 만들기」를 권하면 방금 무엇을 보러 왔는지와 어긋난다.
            showDeleted && canSeeDeleted ? (
              <EmptyDeletedState />
            ) : (
              <NoSurveysEmptyState canCreate={canCreate} />
            )
          ) : activeGroup && scopedSurveys.length === 0 ? (
            // 그룹이 비어 있는 것과 필터로 0건이 된 것은 다른 화면이다 — 「초기화」로는
            // URL 이 소유한 그룹 좁힘이 풀리지 않아 버튼이 아무 일도 하지 않는다.
            <EmptyGroupState />
          ) : filtered.length === 0 ? (
            <NoResultsEmptyState onReset={resetAll} />
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                {pageItems.map((survey) =>
                  // 휴지통은 카드가 다르다 — 삭제된 설문에서 할 수 있는 일은 복구뿐이라
                  // 케밥·수정·현황·분석이 전부 없다(티켓 17). 서버가 목록을 갈라 주므로
                  // 화면은 행이 들고 온 deletedAt 만 보면 된다.
                  survey.deletedAt ? (
                    <DeletedSurveyCard
                      key={survey.id}
                      survey={survey}
                      onRestore={handleRestore}
                      isRestoring={isRestoring}
                    />
                  ) : (
                    <SurveyCard
                      key={survey.id}
                      survey={survey}
                      viewer={{ scope, currentUserId, isSuperadmin, leaderTeamIds }}
                      onDelete={handleDelete}
                      onDuplicate={handleDuplicate}
                      isDuplicating={isDuplicating}
                      groups={groupList}
                      onMoveToGroup={canManageGroups ? handleMoveToGroup : null}
                    />
                  ),
                )}
              </div>

              <ListPagination page={clampedPage} totalPages={totalPages} onPageChange={setPage} />
            </>
          )}

          {activeGroup && <GroupViewFooterNote />}
        </>
      )}

      {groupManagerOpen && teamScopeId && (
        <GroupManageModal
          teamId={teamScopeId}
          groups={groupList}
          onClose={() => setGroupManagerOpen(false)}
        />
      )}
    </div>
  );
}
