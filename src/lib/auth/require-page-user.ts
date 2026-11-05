import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import 'server-only';

import { requireAuth } from '@/lib/auth';
import { sanitizeInternalPath } from '@/lib/auth/guest-grants';
import { REQUEST_PATH_HEADER } from '@/lib/auth/request-path-header';

/**
 * 화면(RSC) 렌더용 세션 확인 — 세션이 없으면 오류를 던지지 않고 로그인 페이지로 보낸다.
 *
 * 미들웨어가 세션을 보고 통과시킨 뒤에도 같은 요청의 렌더가 세션을 다시 확인하다 실패할 수 있다
 * (그 사이 로그아웃, 토큰 갱신 경합, 인증 서버 일시 장애). 그때 `requireAuth` 의 「인증이 필요합니다.」가
 * 오류 화면과 Sentry 로 나가던 것을, 원래 가려던 경로를 실어 로그인으로 돌려보내는 것으로 바꾼다.
 * fail-closed 는 그대로다 — 세션을 못 얻으면 화면을 그리지 않는다.
 *
 * RPC·Route Handler 는 이 함수를 쓰지 않는다(401 응답이 맞다). 다만 RPC 가 화면 헬퍼
 * (`isGuestViewer` 등)를 거쳐 이 함수에 닿아도 procedure 베이스가 이미 세션을 확인했으므로
 * 실패는 일시 장애뿐이고, 그때는 종전처럼 500 으로 끝난다.
 */
export async function requirePageUser() {
  try {
    return await requireAuth();
  } catch {
    redirect(await loginPathForCurrentRequest());
  }
}

async function loginPathForCurrentRequest(): Promise<string> {
  const original = sanitizeInternalPath((await headers()).get(REQUEST_PATH_HEADER));
  if (!original || original.startsWith('/admin/login')) return '/admin/login';
  return `/admin/login?redirect=${encodeURIComponent(original)}`;
}
