import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { db } from '@/db';
import { createClient } from '@/lib/supabase/server';

export interface AuthUser {
  id: string;
  email: string | null;
}

export interface ORPCContext {
  db: typeof db;
  supabase: SupabaseClient;
  user: AuthUser | null;
  /**
   * 요청 헤더. rate limit 미들웨어가 신뢰 클라이언트 IP 추출에 사용한다.
   * route handler 경로에서만 채워지고, RSC 직접 호출/테스트 경로에는 없을 수 있다
   * (이 경로는 pub rate-limit 미들웨어를 거치지 않으므로 영향 없음). optional 로 둬서
   * 컨텍스트를 직접 구성하는 호출부(RSC·테스트)가 headers 를 강제로 채우지 않게 한다.
   */
  headers?: Headers;
}

/**
 * RSC와 procedure 양쪽이 재사용하는 요청 컨텍스트.
 * supabase 세션을 한 번 읽어 user를 채운다(없으면 null).
 * route handler 는 request.headers 를 전달하고, RSC 경로는 생략 가능(빈 Headers).
 */
export async function createContext(headers: Headers = new Headers()): Promise<ORPCContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return {
    db,
    supabase,
    user: user ? { id: user.id, email: user.email ?? null } : null,
    headers,
  };
}
