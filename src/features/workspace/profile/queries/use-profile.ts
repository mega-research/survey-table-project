'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { UpdatePasswordInput, UpdateProfileInput } from '@/shared/contracts/auth-io';
import { client, orpc } from '@/shared/lib/rpc';

export const profileKeys = {
  me: ['profile', 'me'] as const,
};

/**
 * 내 프로필 — 세 계정 유형 공통.
 * 세션이 아니라 DB 를 읽으므로 다른 사람이 바꾼 직책·소속도 여기에 반영된다.
 */
export function useProfile() {
  return useQuery({
    queryKey: profileKeys.me,
    queryFn: () => orpc.auth.getProfile.call(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

/** 이름·아바타 저장. 응답이 곧 갱신된 프로필이라 그대로 캐시에 심는다. */
export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProfileInput) => client.auth.updateProfile(input),
    onSuccess: (profile) => queryClient.setQueryData(profileKeys.me, profile),
  });
}

/**
 * 비밀번호 변경.
 *
 * 실패를 throw 가 아니라 `{ error }` 로 돌려주는 계약이라(기존 UX 유지) 호출측이 결과를
 * 들여다봐야 한다 — mutation 이 성공했다고 비밀번호가 바뀐 것은 아니다.
 */
export function useUpdatePassword() {
  return useMutation({
    mutationFn: (input: UpdatePasswordInput) => client.auth.updatePassword(input),
  });
}

/**
 * 아바타 업로드 — 프로필 전용 REST 라우트(/api/upload/avatar).
 * 서버가 정사각 WebP 로 깎아 저장하고 공개 URL 을 돌려준다.
 */
export async function uploadAvatar(file: File): Promise<string> {
  const body = new FormData();
  body.append('file', file);
  const res = await fetch('/api/upload/avatar', { method: 'POST', body });
  const json: unknown = await res.json().catch(() => null);
  const payload = (json ?? {}) as { url?: string; error?: string };
  if (!res.ok || !payload.url) {
    throw new Error(payload.error ?? '아바타를 업로드하지 못했습니다.');
  }
  return payload.url;
}
