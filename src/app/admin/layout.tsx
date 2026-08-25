import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { QueryProvider } from '@/components/providers/query-provider';
import {
  GUEST_FORCE_LOGOUT_PATH,
  getGuestSurveyIds,
  guestPathRedirect,
} from '@/lib/auth/guest-grants';
import { AUTH_PAGES } from '@/lib/auth/protected-paths';
import { auth } from '@/lib/auth/server';

// TanStack Query 는 관리자 화면만 쓴다. 공개 응답 페이지(/survey, /i, /preview, /unsubscribe)는
// plain RPC client 만 쓰므로 Provider 를 루트가 아니라 여기서 연다 — 응답자 번들에서 Query 런타임을 뺀다.
//
// 인증 가드도 여기가 집이다. proxy 는 세션 쿠키 존재만 보는 1차 게이트라, 만료·폐기된 쿠키와
// 비활성 계정은 이 레이아웃이 걸러야 한다(2단 게이트).
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers();
  const pathname = requestHeaders.get('x-pathname') ?? '';

  // proxy 를 거치지 않아 경로를 모르는 호출(테스트 등)은 페이지 자체 가드에 맡긴다.
  if (pathname !== '' && !AUTH_PAGES.has(pathname)) {
    const session = await auth.api.getSession({ headers: requestHeaders });
    if (!session) {
      redirect(`/admin/login?redirect=${encodeURIComponent(pathname)}`);
    }
    if (session.user.status !== 'active') {
      redirect('/admin/login');
    }

    // 게스트(설문 단위 grant) — 자기 설문 콘솔 밖은 전부 강제 로그아웃으로 보낸다.
    const grantedSurveyIds = getGuestSurveyIds(session.user.id);
    if (grantedSurveyIds.length > 0) {
      const dest = guestPathRedirect(pathname, grantedSurveyIds);
      if (dest === GUEST_FORCE_LOGOUT_PATH) {
        // 링크 prefetch 는 로그아웃 라우트로 보내지 않는다 — prefetch 가 리다이렉트를
        // 따라가 세션을 지우는 사고 방지. 로그인으로 직행.
        const isPrefetch =
          requestHeaders.get('next-router-prefetch') !== null ||
          requestHeaders.get('purpose') === 'prefetch';
        const target = `?redirect=${encodeURIComponent(pathname)}`;
        redirect(isPrefetch ? `/admin/login${target}` : `${GUEST_FORCE_LOGOUT_PATH}${target}`);
      }
      if (dest !== null) {
        redirect(dest);
      }
    }
  }

  return <QueryProvider>{children}</QueryProvider>;
}
