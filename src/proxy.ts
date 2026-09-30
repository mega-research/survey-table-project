import { type NextRequest, NextResponse } from 'next/server';

import { getSessionCookie } from 'better-auth/cookies';

import { AUTH_PAGES, LOGIN_PATH } from '@/lib/auth/protected-paths';

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
      url.pathname = LOGIN_PATH;
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
     * 세션 쿠키를 요구하는 **루트 전수**. 어휘의 정본은
     * `lib/auth/protected-paths` 의 `SESSION_GATED_ROOT_SEGMENTS` 이고, 여기 리터럴은 그
     * 사본이다 — Next 가 이 값을 빌드 타임에 정적으로 읽으므로 배열을 펼쳐 쓸 수 없다.
     * **둘이 어긋나지 않는 것은 `tests/repo/proxy-matcher-coverage.test.ts` 가 본다.**
     *
     * `/admin` 접두를 걷은 뒤(라우트 그룹 `app/(internal)/`) 내부 콘솔이 루트 여덟 개로
     * 흩어졌다. 접두 하나로 「이 아래는 전부 세션이 필요하다」를 말할 수 없으므로 목록이
     * 길어졌고, **새 내부 루트를 만들고 여기 등재를 빠뜨리면 그 구역만 1차 게이트 없이
     * 렌더를 시작한다** — 조용히 뚫린다. 그래서 완전성을 사람이 아니라 파일 시스템에서
     * 확인한다(그 가드가 `app/(internal)/*` 를 훑는다).
     *
     * **루트마다 두 줄인 것이 계약이다** — `'/surveys/:path*'` 는 `/surveys` 자체를 매치하지
     * 않는다(Next 의 path-to-regexp 의미론). 목록 화면이 정확히 그 자리라, 한 줄만 적으면
     * 목록만 세션 없이 렌더를 시작한다. 하위 페이지가 없는 루트(`/billing`)도 같은 모양으로
     * 적는다 — 예외를 두면 「어느 루트가 두 줄인가」를 사람이 기억해야 한다.
     *
     * 유형 구역(`/guest`·`/fieldwork`)도 같은 1차 게이트를 지난다 — 쿠키 없는 요청을
     * 로그인으로 보내는 일은 경로마다 다를 이유가 없고, 빠뜨리면 그 구역만 세션 없이 렌더를
     * 시작한다. 유형 일치 판정은 페이지의 requireAccountTypePage 몫이다.
     *
     * **`/fw` 는 일부러 없다** (ADR-0026). 외주 실사 링크는 계정 세션이 아니라 링크 세션으로
     * 열리므로, 여기 넣으면 세션 쿠키가 없는 외주가 전원 로그인으로 튕겨 기능이 통째로
     * 닫힌다. 그 구역의 자격은 주소의 토큰 + 비밀번호이고 판정은 server/fieldwork-link 가
     * 한다 — 「일관성」을 이유로 한 줄 더하지 말 것. 응답자 표면
     * (`/survey`·`/i`·`/preview`·`/unsubscribe`)과 랜딩(`/`)도 같은 이유로 없다.
     */
    '/billing',
    '/billing/:path*',
    '/file-cleanup',
    '/file-cleanup/:path*',
    '/login',
    '/login/:path*',
    '/profile',
    '/profile/:path*',
    '/reassignment',
    '/reassignment/:path*',
    '/surveys',
    '/surveys/:path*',
    '/teams',
    '/teams/:path*',
    '/users',
    '/users/:path*',
    '/analytics',
    '/analytics/:path*',
    '/guest',
    '/guest/:path*',
    '/fieldwork',
    '/fieldwork/:path*',
  ],
};
