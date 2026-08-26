import { headers } from 'next/headers';

import { readSessionUser } from '@/lib/auth/session';
import { isActiveUser } from '@/shared/contracts/auth';
import type { AuthUser } from '@/shared/contracts/auth';

/**
 * 인증 필수 — 미인증이거나 active 가 아닌 계정이면 에러 throw.
 * REST route handler / RSC 페이지에서 사용. oRPC authed 와 동일 정책
 * (세션 + status='active')이라 REST 가 형제 우회 경로가 되지 않는다.
 */
export async function requireAuth(): Promise<AuthUser> {
  const user = await readSessionUser(await headers());
  if (!user || !isActiveUser(user.status)) {
    throw new Error('인증이 필요합니다.');
  }
  return user;
}

/**
 * 현재 사용자 조회 — 인증되지 않으면 null 반환. 계정 상태는 걸러내지 않는다.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  return readSessionUser(await headers());
}

/**
 * 인증 여부만 확인 — boolean 반환. 계정 상태는 보지 않는다.
 */
export async function isAuthenticated(): Promise<boolean> {
  return (await getCurrentUser()) !== null;
}
