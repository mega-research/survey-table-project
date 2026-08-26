'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { CreateUserInput, UserStatusFilter, UserTypeFilter } from '@/shared/contracts/auth-io';
import { client, orpc } from '@/shared/lib/rpc';

export const userKeys = {
  all: ['users'] as const,
  list: (userType: UserTypeFilter, status: UserStatusFilter) =>
    [...userKeys.all, 'list', userType, status] as const,
};

/** 사용자 목록 + 유형 칩 카운트 (슈퍼어드민 전용 표면). */
export function useUsers(userType: UserTypeFilter, status: UserStatusFilter) {
  return useQuery({
    queryKey: userKeys.list(userType, status),
    queryFn: () => orpc.auth.users.list.call({ userType, status }),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * 계정 직접 발급. 성공하면 목록 전체를 무효화한다 — 유형 칩 카운트가 함께 바뀌므로
 * 지금 보고 있는 필터 조합만 갱신하면 다른 칩의 숫자가 낡은 채로 남는다.
 */
export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUserInput) => client.auth.users.create(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: userKeys.all }),
  });
}
