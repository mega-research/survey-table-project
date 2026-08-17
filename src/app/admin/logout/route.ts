import { NextResponse } from 'next/server';

import { isGuestUser } from '@/lib/auth/guest-grants';
import { createClient } from '@/lib/supabase/server';

/**
 * 게스트 강제 로그아웃 라우트.
 *
 * 게스트(설문 단위 grant)가 grant 밖 설문의 운영 콘솔 URL 로 진입하면
 * 미들웨어(guestPathRedirect)가 여기로 보낸다. 안내 페이지를 거치지 않고
 * 즉시 세션을 끝내 로그인 화면으로 보낸다 — 다른 설문을 보려면 해당 설문
 * 담당 계정으로 다시 로그인하라는 운영 결정(2026-08-14).
 *
 * GET 인 이유: 미들웨어 redirect 는 GET 으로만 이어질 수 있다. GET 상태 변경의
 * CSRF 리스크는 두 겹으로 좁힌다 — 게스트가 아니면 signOut 없이 돌려보내고
 * (관리자 대상 로그아웃 CSRF 차단), scope 'local' 로 현재 브라우저 세션만
 * 끝낸다(공유 게스트 계정의 타 기기 실사 세션 보존 — 기본 global 은 전 기기
 * refresh token 폐기).
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL('/admin/login', request.url));
  }
  if (!isGuestUser(user.id)) {
    return NextResponse.redirect(new URL('/admin/surveys', request.url));
  }
  await supabase.auth.signOut({ scope: 'local' });
  return NextResponse.redirect(new URL('/admin/login', request.url));
}
