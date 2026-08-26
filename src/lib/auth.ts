import { headers } from 'next/headers';

import { readSessionUser } from '@/lib/auth/session';
import { isActiveUser, isInternalUser } from '@/shared/contracts/auth';
import type { AuthUser } from '@/shared/contracts/auth';

/**
 * 인증 필수 — 미인증·비활성·비내부 계정이면 에러 throw.
 * REST route handler / RSC 페이지에서 사용. oRPC authed 와 동일 정책
 * (세션 + status='active' + userType='internal')이라 REST 가 형제 우회 경로가 되지 않는다.
 *
 * guest·fieldwork 계정은 로그인은 되지만 이 문을 통과하지 못한다 — export·업로드 같은
 * REST 표면이 그들에게 열려 있으면 계정 발급이 곧 PII 유출 경로가 된다. 각 콘솔은
 * 자기 가드(oRPC scoped 등)로 열리며 유형별 라우팅은 티켓 05 소관이다.
 */
export async function requireAuth(): Promise<AuthUser> {
  const user = await readSessionUser(await headers());
  if (!user || !isActiveUser(user.status) || !isInternalUser(user.userType)) {
    throw new Error('인증이 필요합니다.');
  }
  return user;
}

/**
 * 자기 계정 표면용 인증 — 세션 + active. **계정 유형을 보지 않는다.**
 *
 * oRPC `account` 베이스의 REST·RSC 짝이다. 세 유형 모두 자기 이름·아바타·비밀번호를
 * 바꾸므로(.pen FLOW 3-2) 아바타 업로드처럼 프로필에 딸린 REST 표면은 이 문을 쓴다.
 * 내부 전용 표면은 계속 requireAuth 를 쓸 것 — 이 함수로 갈아끼우면 게스트·실사에게
 * export·업로드가 열린다.
 */
export async function requireActiveAccount(): Promise<AuthUser> {
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
