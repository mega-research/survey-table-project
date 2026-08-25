import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { QueryProvider } from '@/components/providers/query-provider';
import { auth } from '@/lib/auth/server';

// TanStack Query 는 관리자 화면만 쓴다. 공개 응답 페이지(/survey, /i, /preview, /unsubscribe)는
// plain RPC client 만 쓰므로 Provider 를 루트가 아니라 여기서 연다 — 응답자 번들에서 Query 런타임을 뺀다.
//
// admin 레이아웃과 같은 2단 게이트 — proxy 의 쿠키 검사 뒤 여기서 세션·계정 상태를 재검증한다.
// 게스트는 admin 레이아웃이 이미 콘솔 밖을 막지만, /analytics 는 그 밖이라 페이지 가드
// (requireAdminPage)가 별도로 막는다.
export default async function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.status !== 'active') {
    redirect('/admin/login');
  }
  return <QueryProvider>{children}</QueryProvider>;
}
