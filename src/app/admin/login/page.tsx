import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import {
  GUEST_FORCE_LOGOUT_PATH,
  GUEST_FOREIGN_SURVEY_REASON,
  getGuestSurveyIds,
  guestPostLoginRedirect,
  isForeignSurveyConsolePath,
} from '@/lib/auth/guest-grants';
import { sanitizeRedirectPath } from '@/lib/auth/safe-redirect';
import { auth } from '@/lib/auth/server';

import { LoginForm } from './login-form';

interface PageProps {
  searchParams: Promise<{ redirect?: string; reason?: string }>;
}

/**
 * 로그인 화면 + 로그인 직후 목적지 해석기.
 *
 * 로그인 폼은 Better Auth 클라이언트로 세션을 만든 뒤 이 페이지로 되돌아온다. 목적지 판정에
 * 게스트 grant(서버 설정)가 필요해 클라이언트가 스스로 결정할 수 없기 때문 — 세션이 생긴
 * 상태로 다시 들어오면 여기서 유형별 목적지를 계산해 보낸다. 이미 로그인한 사용자가 로그인
 * 주소를 직접 열었을 때의 처리도 같은 경로다.
 */
export default async function AdminLoginPage({ searchParams }: PageProps) {
  const { redirect: redirectTo, reason } = await searchParams;

  // active 세션 보유자는 목적지로 보낸다 (만료·폐기 쿠키면 세션 null → 폼 표시).
  const session = await auth.api.getSession({ headers: await headers() });
  if (session?.user.status === 'active') {
    const target = sanitizeRedirectPath(redirectTo);
    const grantedSurveyIds = getGuestSurveyIds(session.user.id);
    if (grantedSurveyIds.length > 0) {
      const targetPath = target.split(/[?#]/)[0] ?? target;
      // 담당이 아닌 설문 콘솔을 향한 게스트 로그인 — 자기 설문으로 몰래 보내면 착각을
      // 유발하므로 세션을 끝내고 담당 계정 안내와 함께 로그인창에 남긴다.
      if (isForeignSurveyConsolePath(targetPath, grantedSurveyIds)) {
        redirect(
          `${GUEST_FORCE_LOGOUT_PATH}?redirect=${encodeURIComponent(target)}` +
            `&reason=${GUEST_FOREIGN_SURVEY_REASON}`,
        );
      }
      // 게스트는 기본 목적지(/admin/surveys)·무권한 경로가 강제 로그아웃 루프가 되므로
      // 자기 grant 설문으로 정착시킨다.
      redirect(guestPostLoginRedirect(target, grantedSurveyIds));
    }
    redirect(target);
  }

  return <LoginForm redirectTo={redirectTo ?? ''} reason={reason ?? ''} />;
}
