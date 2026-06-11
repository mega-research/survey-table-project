import { type NextRequest, NextResponse } from 'next/server';

import { createServerClient } from '@supabase/ssr';

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAdminRoute = request.nextUrl.pathname.startsWith('/admin');
  const isAnalyticsRoute = request.nextUrl.pathname.startsWith('/analytics');
  const isProtectedRoute = isAdminRoute || isAnalyticsRoute;
  const isLoginPage = request.nextUrl.pathname === '/admin/login';

  // Admin/analytics 경로 보호
  if (isProtectedRoute) {
    // 로그인 페이지가 아닌 보호 경로에서 로그인되지 않은 경우
    if (!user && !isLoginPage) {
      // 원래 가려던 경로를 redirect 파라미터로 보존 — 로그인 후 그대로 복귀시킨다.
      const original = request.nextUrl.pathname + request.nextUrl.search;
      const url = request.nextUrl.clone();
      url.pathname = '/admin/login';
      url.search = '';
      url.searchParams.set('redirect', original);
      return redirectWithSessionCookies(url, supabaseResponse);
    }

    // 이미 로그인되어 있고 로그인 페이지에 접근하는 경우
    if (user && isLoginPage) {
      const url = request.nextUrl.clone();
      url.pathname = '/admin/surveys';
      return redirectWithSessionCookies(url, supabaseResponse);
    }
  }

  return supabaseResponse;
}

// redirect 응답에도 supabaseResponse에 적재된 갱신 세션 쿠키를 옮겨 담는다.
// auth.getUser()가 토큰을 회전시키면 새 쿠키가 supabaseResponse에 staged되는데,
// NextResponse.redirect()로 만든 새 응답은 이를 자동으로 들고 가지 않는다.
// 복사하지 않으면 회전된 토큰이 브라우저에 전달되지 않아 다음 요청에서
// 만료된 쿠키로 인한 간헐적 재로그인/세션 종료가 발생한다 (Supabase SSR 가이드).
function redirectWithSessionCookies(url: URL, supabaseResponse: NextResponse) {
  const redirectResponse = NextResponse.redirect(url);
  for (const cookie of supabaseResponse.cookies.getAll()) {
    redirectResponse.cookies.set(cookie);
  }
  return redirectResponse;
}
