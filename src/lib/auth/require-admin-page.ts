import 'server-only';

import { notFound } from 'next/navigation';

import { requireAuth } from '@/lib/auth';

import { isAdminUserAllowed } from './admin-allowlist';

/**
 * admin 전용 RSC 페이지 진입 가드.
 *
 * 미들웨어(src/lib/supabase/middleware.ts)는 세션 유무만 보고 allowlist 를 검사하지 않는다.
 * 그래서 analytics 처럼 RSC 가 복호화된 응답을 직접 렌더하는 페이지는, 같은 데이터를 주는
 * authed procedure 가 막는 행위자(세션은 있으나 ADMIN_USER_IDS 밖)에게 GET 만으로 열려 있었다.
 * 이 가드가 procedure 와 같은 판정을 페이지에도 적용해 두 경로의 권한 축을 맞춘다.
 *
 * isAdminUserAllowed 는 ADMIN_USER_IDS 미설정 시 fail-open 이라(admin-allowlist.ts) 기존 배포의
 * 동작은 바뀌지 않는다. 게스트는 미들웨어가 grant 설문의 operations/preview 밖으로 나가지
 * 못하게 막으므로 여기까지 도달하지 않는다.
 *
 * 존재 여부를 노출하지 않도록 거부는 notFound() 로 처리한다.
 */
export async function requireAdminPage() {
  const user = await requireAuth();
  if (!isAdminUserAllowed(user.id)) {
    notFound();
  }
  return user;
}
