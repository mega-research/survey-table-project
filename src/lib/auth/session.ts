import 'server-only';

import type { AuthUser, UserStatus, UserType } from '@/shared/contracts/auth';

import { auth } from './server';

/**
 * 세션 조회 + AuthUser 매핑 — 인증 사용자를 읽는 유일한 경로.
 *
 * oRPC 컨텍스트(server/context)와 REST·RSC 가드(lib/auth)가 함께 쓴다. 매핑을 한 곳에
 * 두는 이유는 아래 status 폴백 때문이다 — 같은 안전 기본값이 두 벌로 갈리면 한쪽만
 * 고쳐지는 순간 인증 판정이 어긋난다.
 */
export async function readSessionUser(headers: Headers): Promise<AuthUser | null> {
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  return {
    id: session.user.id,
    email: session.user.email ?? null,
    name: session.user.name,
    // status 는 additionalFields 라 세션 페이로드에서 optional 로 좁혀진다. 값이 없으면
    // 로그인 불가 상태로 접는다 — 스키마 default 와 같은 취지의 안전 기본값이다.
    status: (session.user.status as UserStatus | undefined) ?? 'pending',
    isSuperadmin: session.user.isSuperadmin ?? false,
    // status 와 같은 취지의 안전 기본값 — 값이 없으면 내부 표면을 열지 않는 쪽으로 접는다.
    // (컬럼은 NOT NULL default 'internal' 이라 실제 행에는 항상 값이 있다)
    userType: (session.user.userType as UserType | undefined) ?? 'guest',
    image: session.user.image ?? null,
  };
}
