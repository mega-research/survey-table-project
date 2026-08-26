import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { QueryProvider } from '@/components/providers/query-provider';
import { accountHomePath } from '@/lib/auth/account-home';
import { readSessionUser } from '@/lib/auth/session';
import { isActiveUser, isInternalUser } from '@/shared/contracts/auth';

// TanStack Query 는 관리자 화면만 쓴다. 공개 응답 페이지(/survey, /i, /preview, /unsubscribe)는
// plain RPC client 만 쓰므로 Provider 를 루트가 아니라 여기서 연다 — 응답자 번들에서 Query 런타임을 뺀다.
//
// admin 레이아웃과 같은 2단 게이트 — proxy 의 쿠키 검사 뒤 여기서 세션·계정 상태·계정 유형을
// 재검증한다. 설문 단위 env grant 게스트는 userType 이 'internal' 이라 이 문을 통과하므로
// **각 페이지의 requireAdminPage 가 막아야 한다** — 루트·상세 모두 그 가드를 갖고 있다.
// (2026-08-26 이전에는 루트에 그 호출이 없어 이 주석이 사실이 아니었다.)
export default async function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  const user = await readSessionUser(await headers());
  if (!user || !isActiveUser(user.status)) {
    redirect('/admin/login');
  }
  // 분석은 내부 구역이다 — 게스트·실사 계정은 자기 홈으로 돌려보낸다(admin 레이아웃과 같은 판단).
  if (!isInternalUser(user.userType)) {
    redirect(accountHomePath(user.userType));
  }
  return <QueryProvider>{children}</QueryProvider>;
}
