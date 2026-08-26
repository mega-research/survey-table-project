import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { QueryProvider } from '@/components/providers/query-provider';
import {
  GUEST_FORCE_LOGOUT_PATH,
  getGuestSurveyIds,
  guestPathRedirect,
} from '@/lib/auth/guest-grants';
import { AUTH_PAGES } from '@/lib/auth/protected-paths';
import { readSessionUser } from '@/lib/auth/session';
import { isActiveUser } from '@/shared/contracts/auth';

// TanStack Query 는 관리자 화면만 쓴다. 공개 응답 페이지(/survey, /i, /preview, /unsubscribe)는
// plain RPC client 만 쓰므로 Provider 를 루트가 아니라 여기서 연다 — 응답자 번들에서 Query 런타임을 뺀다.
//
// 인증 가드도 여기가 집이다. proxy 는 세션 쿠키 존재만 보는 1차 게이트라, 만료·폐기된 쿠키와
// 비활성 계정은 이 레이아웃이 걸러야 한다(2단 게이트).
//
// 다만 이 레이아웃은 **하드 내비게이션에서만** 다시 돈다 — 클라이언트 소프트 내비게이션은
// 공통 상위 레이아웃을 재렌더하지 않는다(partial rendering). 그래서 데이터에 닿는 자리는
// 각자 가드를 갖는다: 설문 경계는 surveys/[id]/layout.tsx, 게스트 차단 화면과 전역 관리
// 화면은 페이지의 requireAdminPage, procedure 는 authed/scoped. 이 레이아웃은 그 위의
// 첫 관문이지 유일한 관문이 아니다 — x-pathname 이 없어 가드를 건너뛰어도(프록시 미경유)
// 데이터가 새지 않는 이유가 이것이다.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers();
  const pathname = requestHeaders.get('x-pathname') ?? '';

  // proxy 를 거치지 않아 경로를 모르는 호출(테스트 등)은 페이지 자체 가드에 맡긴다.
  if (pathname !== '' && !AUTH_PAGES.has(pathname)) {
    const user = await readSessionUser(requestHeaders);
    if (!user) {
      redirect(`/admin/login?redirect=${encodeURIComponent(pathname)}`);
    }
    if (!isActiveUser(user.status)) {
      redirect('/admin/login');
    }

    // 게스트(설문 단위 grant) — 자기 설문 콘솔 밖은 전부 강제 로그아웃으로 보낸다.
    const grantedSurveyIds = getGuestSurveyIds(user.id);
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
