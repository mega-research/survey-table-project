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
      return NextResponse.redirect(url);
    }

    // 이미 로그인되어 있고 로그인 페이지에 접근하는 경우
    if (user && isLoginPage) {
      const url = request.nextUrl.clone();
      url.pathname = '/admin/surveys';
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
