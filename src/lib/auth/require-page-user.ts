import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import 'server-only';

import { requireAuth } from '@/lib/auth';
import { LOGIN_PATH } from '@/lib/auth/protected-paths';
import { REQUEST_PATH_HEADER } from '@/lib/auth/request-path-header';
import { sanitizeInternalPath } from '@/lib/auth/safe-redirect';

/**
 * 화면(RSC) 렌더용 세션 확인 — 세션이 없으면 오류를 던지지 않고 로그인 페이지로 보낸다.
 *
 * proxy 는 쿠키만 보고 `(internal)` 레이아웃은 하드 내비게이션에서만 세션을 다시 본다. 그래서 소프트 내비게이션 중에
 * 페이지 가드가 세션을 잃으면(그 사이 로그아웃·만료·인증 서버 일시 장애) `requireAuth` 의 「인증이 필요합니다.」가
 * 오류 화면과 Sentry 로 나갔다. 원래 가려던 경로를 실어 로그인으로 돌려보낸다(hotfix 2026-11-05 이식).
 * 로그인 화면은 active 세션이면 계정 유형의 홈으로 보내므로, 내부 계정이 아니라 막힌 게스트·실사도 루프 없이 자기 홈으로 간다.
 * fail-closed 는 그대로다 — 세션을 못 얻으면 화면을 그리지 않는다. RPC·Route Handler 는 이 함수를 쓰지 않는다(401 이 맞다).
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
  const pathname = original?.split(/[?#]/)[0];
  if (!original || pathname === LOGIN_PATH || pathname?.startsWith(`${LOGIN_PATH}/`)) return LOGIN_PATH;
  return `${LOGIN_PATH}?redirect=${encodeURIComponent(original)}`;
}
