import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { resolvePostLoginDestination } from '@/lib/auth/account-home';
import { sanitizeRedirectPath } from '@/lib/auth/safe-redirect';
import { readSessionUser } from '@/lib/auth/session';
import { isActiveUser } from '@/shared/contracts/auth';

import { LoginForm } from './login-form';

interface PageProps {
  searchParams: Promise<{ redirect?: string }>;
}

/**
 * 로그인 화면 + 로그인 직후 목적지 해석기.
 *
 * 로그인 폼은 Better Auth 클라이언트로 세션을 만든 뒤 이 페이지로 되돌아온다. 목적지 판정에
 * 계정 유형이 필요해 클라이언트가 스스로 결정할 수 없기 때문 — 세션이 생긴 상태로 다시
 * 들어오면 여기서 유형별 목적지를 계산해 보낸다. 이미 로그인한 사용자가 로그인 주소를 직접
 * 열었을 때의 처리도 같은 경로다.
 *
 * 목적지 축은 **하나**다: 계정 유형의 홈(internal→설문 목록 · guest→/guest ·
 * fieldwork→/fieldwork). 티켓 21 전에는 설문 단위 env grant 게스트가 먼저 갈라져 grant 설문
 * 콘솔로 갔고, 담당이 아닌 설문을 향한 로그인은 강제 로그아웃까지 했다. 게스트가 계정
 * 모델이 되면서 그 축이 통째로 사라졌다 — 클라이언트가 보는 화면은 자기 홈뿐이다.
 */
export default async function AdminLoginPage({ searchParams }: PageProps) {
  const { redirect: redirectTo } = await searchParams;

  // active 세션 보유자는 목적지로 보낸다 (만료·폐기 쿠키면 세션 null → 폼 표시).
  const user = await readSessionUser(await headers());
  if (user && isActiveUser(user.status)) {
    redirect(resolvePostLoginDestination(user.userType, sanitizeRedirectPath(redirectTo)));
  }

  return <LoginForm redirectTo={redirectTo ?? ''} />;
}
