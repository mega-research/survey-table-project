'use client';

import { useRouter } from 'next/navigation';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { AssignSurveysInput, AssignUserToTeamInput } from '@/shared/contracts/workspace-io';
import { client, orpc } from '@/shared/lib/rpc';

export const reassignmentKeys = {
  all: ['reassignment'] as const,
  inbox: () => [...reassignmentKeys.all, 'inbox'] as const,
  pendingSurvey: (surveyId: string) =>
    [...reassignmentKeys.all, 'pending-survey', surveyId] as const,
  ownerCandidates: (teamId: string) =>
    [...reassignmentKeys.all, 'owner-candidates', teamId] as const,
};

/** 인박스 — 지표 + 두 탭의 목록을 한 번에 받는다(.pen FLOW 8-2). */
export function useReassignmentInbox() {
  return useQuery({
    queryKey: reassignmentKeys.inbox(),
    queryFn: () => orpc.workspace.reassignment.inbox.call(),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });
}

/** 단건 재배치 화면(.pen FLOW 8-4). 배치가 끝나면 null 이 되어 화면이 인박스로 되돌린다. */
export function usePendingSurvey(surveyId: string) {
  return useQuery({
    queryKey: reassignmentKeys.pendingSurvey(surveyId),
    queryFn: () => orpc.workspace.reassignment.pendingSurvey.call({ surveyId }),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * 새 소유자 후보 — 목적지 팀을 고르기 전에는 물어볼 대상이 없다.
 *
 * `enabled` 로 막는 이유가 최적화가 아니다: teamId 가 빈 문자열이면 zod 가 거부해 화면에
 * 실패 배너가 뜬다. 「아직 안 골랐다」는 실패가 아니다.
 */
export function useOwnerCandidates(teamId: string | null) {
  return useQuery({
    queryKey: reassignmentKeys.ownerCandidates(teamId ?? ''),
    queryFn: () => orpc.workspace.reassignment.ownerCandidates.call({ teamId: teamId! }),
    enabled: teamId !== null,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * 배정·배치는 **전체 캐시를 접고 RSC 도 새로 그린다**.
 *
 * 해산(useDissolveTeam)과 같은 이유다. 사람이 팀에 들어가면 그 순간 팀 목록의 멤버 수·팀
 * 상세·팀원 추가 후보가 낡고, 설문이 배치되면 설문 목록·그룹 트리·작업 범위 스위처가 낡는다.
 * 사이드바 스위처와 설문 목록은 RSC 가 props 로 내려주므로 `invalidateQueries()` 만으로는
 * 갱신되지 않는다 — `router.refresh()` 가 함께 있어야 방금 배치한 설문이 실제로 나타난다.
 */
function useReassignmentMutation<TInput, TOutput>(
  mutationFn: (input: TInput) => Promise<TOutput>,
) {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries();
      router.refresh();
    },
  });
}

export function useAssignUserToTeam() {
  return useReassignmentMutation((input: AssignUserToTeamInput) =>
    client.workspace.reassignment.assignUser(input),
  );
}

export function useAssignSurveys() {
  return useReassignmentMutation((input: AssignSurveysInput) =>
    client.workspace.reassignment.assignSurveys(input),
  );
}
