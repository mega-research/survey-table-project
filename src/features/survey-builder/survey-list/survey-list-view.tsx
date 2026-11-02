'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Folder, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { ListPagination } from '@/components/ui/list-pagination';
import { cn } from '@/lib/utils';
import {
  INITIAL_ADVANCED_FILTERS,
  INITIAL_SURVEY_LIST_PAGE_QUERY,
  SURVEY_LIST_PAGE_SIZE,
  type SurveyListPageQuery,
} from '@/shared/contracts/survey-builder-io';
import { surveyListPageQueryOptions, surveyListScopeParam } from '@/shared/lib/survey-list-queries';
import { useWorkScopeOptional } from '@/shared/lib/work-scope-context';

import { useMoveSurveyToGroup, useSurveyGroups } from '../queries/use-survey-groups';
import { useDeleteSurvey, useDuplicateSurvey, useRestoreSurvey } from '../queries/use-surveys';
import { AdvancedSearchPanel } from './advanced-search-panel';
import { CreateTeamPickDialog } from './create-team-pick-dialog';
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
import { ListToolbar } from './list-toolbar';
import { SurveyCard } from './survey-card';
import {
  changeSurveyListQuery,
  clearNarrowingFilters,
  hasNarrowingFilters,
  parseSurveyListQuery,
  serializeSurveyListQuery,
} from './survey-list-url';

/**
 * 설문 목록 (.pen FLOW 6, 역할 모델 v2 티켓 08 · 시안 F8-a) — 목록 상태 세그먼트 · 검색 · 정렬 · 상세 검색 ·
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
  // 서버 페이지가 미리 채운 목록도 같은 함수로 키를 만든다 — 여기서 따로 접으면 그 목록이 쓰이지 않는다.
  const requestedScope = surveyListScopeParam(contextScope);
  const isUnassigned = contextScope?.kind === 'none';

  // 휴지통은 슈퍼어드민의 시스템 전체 보기에만 있다(티켓 17). 범위를 바꾸면 주소의 조건도
  // 되돌리지만 그건 effect 라 한 렌더 늦는다 — 그 한 번의 요청이 FORBIDDEN 으로 떨어져 에러
  // 배너가 번쩍이므로 조회 조건 자체를 여기서 좁힌다.
  const canSeeDeleted = (workScope?.isSuperadmin ?? false) && contextScope?.kind === 'system';

  // 조건의 정본은 주소다(티켓 03) — 새로고침·뒤로 가기·링크 공유에서 살아 있어야 하고, 서버
  // 페이지네이션에서는 조건이 곧 조회 키다. 그룹 화면(`?group=`)·팀 좁힘(`?team=`)도 같은 주소에 있다.
  const searchParams = useSearchParams();
  const urlQuery = useMemo(() => parseSurveyListQuery(searchParams), [searchParams]);
  const query = useMemo<SurveyListPageQuery>(
    () => (urlQuery.deleted && !canSeeDeleted ? { ...urlQuery, deleted: false } : urlQuery),
    [urlQuery, canSeeDeleted],
  );
  const showDeleted = query.deleted;
  const router = useRouter();

  /**
   * 조건을 바꿔 주소에 올린다. 페이지가 아닌 조건이 바뀌면 1페이지로 돌아간다.
   * 치는 칸(검색·상세 검색)은 replace — 글자마다 뒤로 가기 기록이 쌓이지 않게. 고르는 칸(목록
   * 상태·정렬·페이지·휴지통)은 push — 뒤로 가기가 직전 조건으로 돌아간다.
   */
  function updateQuery(patch: Partial<SurveyListPageQuery>, mode: 'push' | 'replace' = 'push') {
    const next = changeSurveyListQuery(urlQuery, patch);
    if (next === urlQuery) return;
    const search = serializeSurveyListQuery(next);
    router[mode](search ? `/surveys?${search}` : '/surveys', { scroll: false });
  }

  const { data, isLoading, error, isPlaceholderData } = useQuery({
    ...surveyListPageQueryOptions(requestedScope, query),
    // 팀 미배치는 조회 자체를 하지 않는다 — 서버도 빈 목록을 주지만 왕복부터 없앤다.
    enabled: !isUnassigned,
    // 페이지·조건을 바꾸는 동안 이전 결과를 흐리게 남긴다 — 빈 화면으로 깜빡이지 않게.
    placeholderData: keepPreviousData,
  });
  const { mutate: deleteSurvey } = useDeleteSurvey();
  const { mutate: restoreSurvey, isPending: isRestoring } = useRestoreSurvey();
  const { mutate: duplicateSurvey, isPending: isDuplicating } = useDuplicateSurvey();

  const requestedGroupId = query.groupId;
  const ungroupedOnly = query.ungrouped;
  // 그룹은 팀 소유물이라 **서버가 해석한 범위**로 물어야 한다 — 화면 컨텍스트의 팀을 쓰면
  // 쿠키가 접힌 경우(해산된 팀 등) 팀 A 의 그룹 목록으로 팀 B 의 설문을 좁히게 된다.
  // 이전 조건의 결과를 흐리게 보이는 동안(범위 전환 직후 포함)에는 그 결과의 범위를 믿지 않는다.
  const resolvedScope = (isPlaceholderData ? null : data?.scope) ?? contextScope ?? null;
  const teamScopeId = resolvedScope?.kind === 'team' ? resolvedScope.teamId : null;
  const {
    data: groups,
    isPending: groupsPending,
    isError: groupsError,
  } = useSurveyGroups(teamScopeId);
  const { mutate: moveSurveyToGroup } = useMoveSurveyToGroup();
  const [groupManagerOpen, setGroupManagerOpen] = useState(false);
  const [teamPickOpen, setTeamPickOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // 작업 범위를 바꾸면 주소의 조건을 전부 되돌린다 — 이전 팀에서 남은 검색어·페이지가 새 팀
  // 목록을 조용히 0건/빈 페이지로 만들지 않게(새 워크스페이스에서 시작하는 것과 동일 취급).
  // 그룹·팀 좁힘은 사이드바 링크가 새 주소로 열므로 따로 되돌릴 것이 없다.
  const scopeKey =
    contextScope?.kind === 'team'
      ? `team:${contextScope.teamId}`
      : (contextScope?.kind ?? 'no-shell');
  const prevScopeKeyRef = useRef(scopeKey);
  useEffect(() => {
    if (prevScopeKeyRef.current === scopeKey) return;
    prevScopeKeyRef.current = scopeKey;
    setAdvancedOpen(false);
    router.replace('/surveys', { scroll: false });
  }, [scopeKey, router]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const groupList = useMemo(() => groups ?? [], [groups]);
  // **관리 표면은 내 팀 그룹만 받는다.** 목록에는 협업 그룹(타 팀 폴더)이 함께 오는데, 그것은
  // 「보이는 폴더」일 뿐 내가 고칠 수 있는 폴더가 아니다 — 이름 변경·정렬·삭제는 그 팀 멤버만
  // 하고(procedures 의 관문), 담기는 팀이 같아야 한다(SurveyTeamMismatchError). 그대로 넘기면
  // 그룹 관리 모달에 남의 팀 폴더가 서고 케밥의 「그룹 이동」이 CONFLICT 나는 목적지를 준다.
  // 활성 그룹 판정은 협업 그룹도 봐야 하므로 groupList 를 그대로 쓴다.
  const manageableGroups = useMemo(
    () => groupList.filter((g) => g.foreignTeamName === null),
    [groupList],
  );
  const activeGroup = groupList.find((g) => g.id === requestedGroupId) ?? null;
  // 지목한 그룹이 없으면(삭제됐거나 남의 팀 id) 주소를 정리한다 — 서버는 그 그룹으로 좁혀 빈
  // 결과를 주므로, 두면 유령 그룹 주소로 빈 화면에 갇힌다. 시스템 전체 보기에는 그룹 개념이
  // 없어 언제나 정리한다. 그룹 목록이 아직 안 왔거나 실패했으면 손대지 않는다 — "아직 안 왔다"
  // 와 "없더라" 는 다른 상태다.
  const groupsSettled = teamScopeId !== null && !groupsPending && !groupsError;
  const groupMissing =
    requestedGroupId !== null &&
    (resolvedScope?.kind === 'system' || (groupsSettled && !activeGroup));
  useEffect(() => {
    if (groupMissing) router.replace('/surveys');
  }, [groupMissing, router]);

  // 팀 좁힘은 서버가 실제로 건 경우에만 제목을 바꾼다 — 지목한 팀 설문이 없으면 좁히지 않는다.
  const activeTeam = data?.activeTeam ?? null;
  const counts = data?.lifecycleCounts ?? { all: 0, draft: 0, running: 0, closed: 0 };
  const owners = data?.owners ?? [];
  const total = data?.total ?? 0;

  /** 결과 0개 화면이 푸는 조건 — 검색·목록 상태·상세 검색. 그룹·팀 좁힘은 주소가 가리키는 화면이다. */
  const activeConditions = [
    ...(query.q.trim() !== ''
      ? [{ key: 'q', label: `검색어 「${query.q.trim()}」`, onClear: () => updateQuery({ q: '' }) }]
      : []),
    ...(query.lifecycle !== 'all'
      ? [
          {
            key: 'lifecycle',
            label: LIFECYCLE_LABELS[query.lifecycle],
            onClear: () => updateQuery({ lifecycle: 'all' }),
          },
        ]
      : []),
    ...(hasNarrowingFilters({ ...INITIAL_SURVEY_LIST_PAGE_QUERY, advanced: query.advanced })
      ? [
          {
            key: 'advanced',
            label: '상세 검색',
            onClear: () => updateQuery({ advanced: INITIAL_ADVANCED_FILTERS }),
          },
        ]
      : []),
  ];

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
  // 시스템 전체 보기에서는 팀을 골라 만든다 — 범위를 바꾸지 않고 생성 화면에 팀을 넘긴다.
  const canCreateByPickingTeam = isSystemScope && (workScope?.isSuperadmin ?? false);
  // 그룹은 팀 소유물이라 팀 범위에서만 존재한다 — 시스템 전체 보기에는 그룹 개념이 없다(.pen 6-2).
  const canManageGroups = teamScopeId !== null;
  // 그룹 화면 주소로 들어왔으면 그룹 목록이 올 때까지 기다린다 — 먼저 그리면 그룹 머리 없이
  // 카드가 번쩍인다. 없는 그룹이라 주소를 정리하는 중에도 빈 결과를 그리지 않는다.
  const showLoading =
    isLoading ||
    (requestedGroupId !== null && teamScopeId !== null && groupsPending) ||
    groupMissing;
  const currentUserId = workScope?.currentUserId ?? null;
  const isSuperadmin = workScope?.isSuperadmin ?? false;
  const leaderTeamIds = workScope?.leaderTeamIds ?? [];

  return (
    // 목록 영역 폭 상한 — .pen FLOW 6-2 본문(976px)보다 넓혀 카드 한 장이 약 410px 가 된다.
    // 큰 모니터에서 3열 카드가 가로로만 늘어나지 않게 막는 것이 목적이다.
    <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-[18px] px-9 py-[30px]">
      <div className="flex items-center justify-between">
        {activeGroup ? (
          <GroupViewHeader
            groupName={activeGroup.name}
            foreignTeamName={activeGroup.foreignTeamName}
          />
        ) : activeTeam ? (
          <h1 className="text-2xl font-semibold text-[#1C1C1E]">
            {activeTeam.name}
            {ungroupedOnly && <span className="text-[#6E6E73]"> · 미분류</span>}
          </h1>
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
              href="/surveys/create"
              className="flex h-[42px] items-center gap-1.5 rounded-[9px] bg-[#2E4FCE] px-4 text-[14px] font-semibold text-white hover:bg-[#2743AE]"
            >
              <Plus className="h-4 w-4" />새 설문 만들기
            </Link>
          ) : canCreateByPickingTeam ? (
            <button
              type="button"
              onClick={() => setTeamPickOpen(true)}
              className="flex h-[42px] items-center gap-1.5 rounded-[9px] bg-[#2E4FCE] px-4 text-[14px] font-semibold text-white hover:bg-[#2743AE]"
            >
              <Plus className="h-4 w-4" />새 설문 만들기
            </button>
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
          <Link href="/surveys" className="text-[#2E4FCE] hover:underline">
            전체 목록으로
          </Link>
        </div>
      )}

      {!showLoading && !error && !(requestedGroupId !== null && groupsError) && (
        <>
          <ListToolbar
            counts={counts}
            lifecycle={query.lifecycle}
            onLifecycleChange={(lifecycle) => updateQuery({ lifecycle })}
            resultCount={total}
            searchQuery={query.q}
            onSearchQueryChange={(q) => updateQuery({ q }, 'replace')}
            sortBy={query.sort}
            onSortByChange={(sort) => updateQuery({ sort })}
            searchPlaceholder={
              activeGroup ? `이 그룹 안에서 ${SEARCH_PLACEHOLDER}` : SEARCH_PLACEHOLDER
            }
            advancedOpen={advancedOpen}
            onToggleAdvanced={() => setAdvancedOpen(!advancedOpen)}
            deletedCount={data?.deletedCount ?? null}
            showDeleted={showDeleted}
            // 모드를 바꾸면 목록이 통째로 갈리므로 목록 상태·검색어도 함께 되돌린다 — 남겨두면
            // 휴지통이 「진행중 + 검색어」로 좁혀진 채 열려 비어 보인다.
            onToggleDeleted={(deleted) => updateQuery({ deleted, lifecycle: 'all', q: '' })}
            advancedPanel={
              advancedOpen && (
                <AdvancedSearchPanel
                  advanced={query.advanced}
                  onChange={(patch) =>
                    updateQuery({ advanced: { ...query.advanced, ...patch } }, 'replace')
                  }
                  onReset={() => updateQuery({ advanced: INITIAL_ADVANCED_FILTERS }, 'replace')}
                  onClose={() => setAdvancedOpen(false)}
                  owners={owners}
                />
              )
            }
          />

          {scope.kind === 'none' ? (
            // 셸 밖 트리에서 서버가 미배치로 해석한 경우 — FLOW 9-1 문구로 안내한다.
            <NoTeamEmptyState />
          ) : counts.all === 0 ? (
            // 「전체」 숫자는 범위·그룹·팀 좁힘까지만 센다 — 0 이면 조건과 무관하게 빈 화면이다.
            // 휴지통이 비어 있는 것·그룹이 비어 있는 것·팀에 설문이 없는 것은 다른 화면이다 —
            // 여기서 「새 설문 만들기」를 권하면 방금 무엇을 보러 왔는지와 어긋나고, 그룹 좁힘은
            // 주소가 소유해 「조건 풀기」로는 풀리지 않는다.
            showDeleted ? (
              <EmptyDeletedState />
            ) : activeGroup ? (
              <EmptyGroupState />
            ) : (
              <NoSurveysEmptyState canCreate={canCreate} />
            )
          ) : total === 0 ? (
            <NoResultsEmptyState
              conditions={activeConditions}
              onClearAll={() => {
                const next = clearNarrowingFilters(urlQuery);
                const search = serializeSurveyListQuery(next);
                router.push(search ? `/surveys?${search}` : '/surveys', { scroll: false });
              }}
            />
          ) : (
            <>
              {/* 넓은 화면에서도 3열이 상한이다 — 폭에 맞춰 열을 늘리면(4~5열) 카드가 촘촘해 읽기 어렵다.
                  조건을 바꾸는 동안에는 이전 결과를 흐리게 남긴다(빈 화면 깜빡임 없음). */}
              <div
                aria-busy={isPlaceholderData}
                className={cn(
                  'grid grid-cols-1 gap-6 transition-opacity md:grid-cols-2 xl:grid-cols-3',
                  isPlaceholderData && 'pointer-events-none opacity-50',
                )}
              >
                {items.map((survey) =>
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
                      groups={manageableGroups}
                      onMoveToGroup={canManageGroups ? handleMoveToGroup : null}
                    />
                  ),
                )}
              </div>

              <div className="flex flex-col items-center gap-1">
                <ListPagination
                  page={data?.page ?? 1}
                  totalPages={data?.totalPages ?? 1}
                  onPageChange={(page) => updateQuery({ page })}
                />
                <p className="text-[12.5px] text-[#6E6E73] tabular-nums">
                  {formatPageRange(total, data?.page ?? 1)}
                </p>
              </div>
            </>
          )}

          {activeGroup && <GroupViewFooterNote />}
        </>
      )}

      {canCreateByPickingTeam && (
        <CreateTeamPickDialog
          open={teamPickOpen}
          onOpenChange={setTeamPickOpen}
          teams={workScope?.teams ?? []}
        />
      )}

      {groupManagerOpen && teamScopeId && (
        <GroupManageModal
          teamId={teamScopeId}
          groups={manageableGroups}
          onClose={() => setGroupManagerOpen(false)}
        />
      )}
    </div>
  );
}

/** 검색창 안내 — 단어마다 이 칸들 중 하나에 들면 맞는다(내 태그 이름 매칭은 티켓 09). */
const SEARCH_PLACEHOLDER = '설문 이름, 설명, 소유자, 내 태그 — 여러 단어는 띄어서';

const LIFECYCLE_LABELS = { draft: '작성중', running: '진행중', closed: '종료' } as const;

/** 「총 N개 중 1–24」 — 보이는 페이지가 전체 결과의 어디인지. */
function formatPageRange(total: number, page: number): string {
  if (total === 0) return '총 0개';
  const start = (page - 1) * SURVEY_LIST_PAGE_SIZE + 1;
  const end = Math.min(page * SURVEY_LIST_PAGE_SIZE, total);
  return `총 ${total}개 중 ${start}–${end}`;
}
