import 'server-only';

import { db } from '@/db';
import { auth } from '@/lib/auth/server';
import type { UserStatus } from '@/shared/contracts/auth';

export interface AuthUser {
  id: string;
  email: string | null;
  name: string;
  status: UserStatus;
  isSuperadmin: boolean;
}

export interface ORPCContext {
  db: typeof db;
  user: AuthUser | null;
  /**
   * 요청 헤더. rate limit 미들웨어의 신뢰 클라이언트 IP 추출과 Better Auth 세션 API
   * (changePassword 등) 호출에 사용한다.
   * route handler 경로에서만 채워지고, RSC 직접 호출/테스트 경로에는 없을 수 있다
   * (이 경로는 pub rate-limit 미들웨어를 거치지 않으므로 영향 없음). optional 로 둬서
   * 컨텍스트를 직접 구성하는 호출부(RSC·테스트)가 headers 를 강제로 채우지 않게 한다.
   */
  headers?: Headers;
}

/**
 * RSC와 procedure 양쪽이 재사용하는 요청 컨텍스트.
 * Better Auth 세션을 한 번 읽어 user를 채운다(없으면 null).
 * route handler 는 request.headers 를 전달하고, RSC 경로는 생략 가능(빈 Headers).
 */
export async function createContext(headers: Headers = new Headers()): Promise<ORPCContext> {
  const session = await auth.api.getSession({ headers });

  return {
    db,
    user: session
      ? {
          id: session.user.id,
          email: session.user.email ?? null,
          name: session.user.name,
          // status 는 additionalFields 라 세션 페이로드에서 optional 로 좁혀진다.
          // 값이 없으면 로그인 불가 상태로 접는 편이 안전하다(스키마 default 와 동일 취지).
          status: (session.user.status as UserStatus | undefined) ?? 'pending',
          isSuperadmin: session.user.isSuperadmin ?? false,
        }
      : null,
    headers,
  };
}
