import { orpc } from './rpc';

/**
 * 설문 그룹 조회의 공유 조각 (역할 모델 v2 티켓 12).
 *
 * 두 묶음이 같은 목록을 본다 — 사이드바 트리(workspace)와 설문 목록·그룹 관리 모달
 * (survey-builder). feature 끼리 직접 import 할 수 없으므로 **키와 조회 옵션만** 여기에 둔다
 * (work-scope-context 와 같은 탈출구). 무효화 규칙이 갈리면 한쪽 화면만 옛 카운트를 들고 있다.
 *
 * mutation 은 여기 없다 — 그룹을 바꾸면 설문 목록 캐시도 함께 접어야 하는데 그 키는
 * survey-builder 소유라, 공유 트리가 feature 를 가리키게 된다.
 */
export const surveyGroupKeys = {
  all: ['survey-groups'] as const,
  lists: () => [...surveyGroupKeys.all, 'list'] as const,
  list: (teamId: string) => [...surveyGroupKeys.lists(), teamId] as const,
  ungrouped: (teamId: string, query: string) =>
    [...surveyGroupKeys.all, 'ungrouped', teamId, query] as const,
};

/** 팀의 그룹 목록. 팀 범위가 아니면(시스템 전체 보기·미배치) 그룹 자체가 없는 화면이라 끈다. */
export function surveyGroupListQueryOptions(teamId: string | null) {
  return {
    queryKey: surveyGroupKeys.list(teamId ?? ''),
    queryFn: () => orpc.workspace.surveyGroups.list.call({ teamId: teamId as string }),
    enabled: Boolean(teamId),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  };
}
