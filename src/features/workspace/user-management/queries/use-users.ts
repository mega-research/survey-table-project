'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  ChangeUserStatusInput,
  CreateUserInput,
  ResetUserPasswordInput,
  UpdateUserInput,
  UserStatusFilter,
  UserTypeFilter,
} from '@/shared/contracts/auth-io';
import { client, orpc } from '@/shared/lib/rpc';

import { userKeys } from '../../account-query-keys';

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

/** 사용자 정보 편집 — 목록 행의 이름·이메일·소속·직책이 바뀌므로 목록을 무효화한다. */
export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateUserInput) => client.auth.users.update(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: userKeys.all }),
  });
}

/**
 * 계정 상태 전이 — 일시 정지 / 재직 복귀 / 퇴사 / 재입사.
 * 상태가 바뀌면 상태 필터로 좁힌 목록에서 행이 드나들고 유형 칩 카운트도 함께 흔들리므로
 * 생성과 같은 이유로 목록 전체를 무효화한다.
 */
export function useChangeUserStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ChangeUserStatusInput) => client.auth.users.changeStatus(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: userKeys.all }),
  });
}

/**
 * 비밀번호 재설정.
 * 목록에 보이는 값은 하나도 바뀌지 않으므로 무효화하지 않는다 — 재설정의 효과는 전부
 * 계정 쪽(해시·세션)에 있다.
 */
export function useResetUserPassword() {
  return useMutation({
    mutationFn: (input: ResetUserPasswordInput) => client.auth.users.resetPassword(input),
  });
}
