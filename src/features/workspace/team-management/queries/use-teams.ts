'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  AddTeamMemberInput,
  ChangeTeamMemberRoleInput,
  CreateTeamInput,
  DissolveTeamInput,
  RemoveTeamMemberInput,
  RenameTeamInput,
  UpdateMemberJobTitleInput,
} from '@/shared/contracts/workspace-io';
import { client, orpc } from '@/shared/lib/rpc';

export const teamKeys = {
  all: ['teams'] as const,
  list: () => [...teamKeys.all, 'list'] as const,
  detail: (teamId: string) => [...teamKeys.all, 'detail', teamId] as const,
  assignable: (teamId: string, query: string) =>
    [...teamKeys.all, 'assignable', teamId, query] as const,
};

/** 팀 관리 목록 + 메가리서치 카드 지표 (슈퍼어드민 전용 표면). */
export function useTeams() {
  return useQuery({
    queryKey: teamKeys.list(),
    queryFn: () => orpc.workspace.teams.list.call(),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });
}

/** 팀 상세 — 멤버 표 + 요청자의 관리 권한. */
export function useTeamDetail(teamId: string) {
  return useQuery({
    queryKey: teamKeys.detail(teamId),
    queryFn: () => orpc.workspace.teams.detail.call({ teamId }),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * 팀원 추가 후보 검색 — 미배치 internal 사용자만.
 *
 * 모달이 열려 있는 동안만 마운트되므로 따로 열림 여부를 받지 않는다. 검색어는 호출측이
 * 디바운스해 넘긴다 — 타이핑마다 왕복하면 서버가 아니라 사용자가 먼저 지친다.
 */
export function useAssignableUsers(teamId: string, query: string) {
  return useQuery({
    queryKey: teamKeys.assignable(teamId, query),
    queryFn: () => orpc.workspace.members.searchAssignable.call({ teamId, query }),
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });
}

export function useCreateTeam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTeamInput) => client.workspace.teams.create(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: teamKeys.all }),
  });
}

export function useRenameTeam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RenameTeamInput) => client.workspace.teams.rename(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: teamKeys.all }),
  });
}

/**
 * 팀 해산 — 되돌릴 수 없다(ADR-0011).
 *
 * 무효화가 `teamKeys.all` 로 끝나지 않는다. 해산은 팀 목록뿐 아니라 **화면 전체의 전제**를
 * 바꾼다 — 해산된 팀 소속이던 사람은 그 순간 미배치가 되고, 소속 설문은 배치 대기로 내려가
 * 설문 목록·그룹 트리·작업 범위가 전부 낡는다. 그래서 호출측(TeamListView)이 성공 후
 * 작업 범위까지 함께 정리한다.
 */
export function useDissolveTeam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DissolveTeamInput) => client.workspace.teams.dissolve(input),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

/**
 * 멤버 변경 3종 — 추가·역할·제외.
 *
 * 무효화를 teamKeys.all 로 넓게 거는 이유: 멤버가 바뀌면 상세의 표뿐 아니라 목록 카드의
 * 멤버 수와 후보 검색 결과(미배치 여부)까지 함께 낡는다. 상세만 새로 읽으면 목록으로
 * 돌아갔을 때 옛 숫자가 보인다.
 */
export function useAddTeamMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AddTeamMemberInput) => client.workspace.members.add(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: teamKeys.all }),
  });
}

export function useChangeTeamMemberRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ChangeTeamMemberRoleInput) => client.workspace.members.changeRole(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: teamKeys.all }),
  });
}

export function useRemoveTeamMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RemoveTeamMemberInput) => client.workspace.members.remove(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: teamKeys.all }),
  });
}

/** 직책 인라인 편집 — 상세 표만 바뀐다(목록 카드는 직책을 보여주지 않는다). */
export function useUpdateMemberJobTitle(teamId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateMemberJobTitleInput) =>
      client.workspace.members.updateJobTitle(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: teamKeys.detail(teamId) }),
  });
}
