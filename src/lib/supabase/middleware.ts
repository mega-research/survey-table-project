import { type NextRequest, NextResponse } from 'next/server';

import { createServerClient } from '@supabase/ssr';

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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
  const isLoginPage = request.nextUrl.pathname === '/admin/login';

  // Admin 경로 보호
  if (isAdminRoute) {
    // 로그인 페이지가 아닌 admin 경로에서 로그인되지 않은 경우
    if (!user && !isLoginPage) {
      // 원래 가려던 경로를 redirect 파라미터로 보존 — 로그인 후 그대로 복귀시킨다.
      // admin 경로만 여기 도달하므로 루트("/") 는 자연히 제외된다.
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
