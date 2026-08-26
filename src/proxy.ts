import { type NextRequest, NextResponse } from 'next/server';

import { getSessionCookie } from 'better-auth/cookies';

import { AUTH_PAGES } from '@/lib/auth/protected-paths';

/**
 * 1차 게이트 — 세션 쿠키 존재만 빠르게 검사한다(DB 미조회).
 *
 * 쿠키가 있어도 유효성·계정 상태·게스트 경로 제한은 admin/analytics 서버 레이아웃이
 * 재검증한다. 미들웨어에서 세션을 조회하지 않는 이유는 Better Auth 세션 검증이 DB
 * 왕복이라 전 요청에 붙이면 비싸고, 레이아웃이 어차피 같은 판정을 다시 해야 하기 때문.
 *
 * pathname 은 x-pathname 요청 헤더로 하위 레이아웃에 전달한다 — 레이아웃은 자기 경로를
 * 모르는데, 인증 페이지(로그인)를 가드에서 빼려면 경로가 필요하다.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (!AUTH_PAGES.has(pathname)) {
    const sessionCookie = getSessionCookie(request);
    if (!sessionCookie) {
      // 원래 가려던 경로를 redirect 파라미터로 보존 — 로그인 후 그대로 복귀시킨다.
      const url = request.nextUrl.clone();
      url.pathname = '/admin/login';
      url.search = '';
      url.searchParams.set('redirect', pathname + search);
      return NextResponse.redirect(url);
    }
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    /*
     * /admin·/analytics(내부 구역)와 /guest·/fieldwork(계정 유형 구역) 보호.
     * 정적 파일과 이미지는 제외.
     *
     * 유형 구역도 같은 1차 게이트를 지난다 — 쿠키 없는 요청을 로그인으로 보내는 일은
     * 경로마다 다를 이유가 없고, 빠뜨리면 그 구역만 세션 없이 렌더를 시작한다.
     * 유형 일치 판정은 페이지의 requireAccountTypePage 몫이다.
     */
    '/admin/:path*',
    '/analytics/:path*',
    '/guest/:path*',
    '/fieldwork/:path*',
  ],
};
