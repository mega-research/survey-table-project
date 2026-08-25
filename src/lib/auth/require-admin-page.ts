import 'server-only';

import { notFound } from 'next/navigation';

import { requireAuth } from '@/lib/auth';

import { isGuestUser } from './guest-grants';

/**
 * admin 전용 RSC 페이지 진입 가드.
 *
 * proxy(src/proxy.ts)는 세션 쿠키 존재만 보고, admin/analytics 레이아웃은 세션 유효성과
 * 계정 상태(active)까지만 본다. 그래서 analytics 처럼 RSC 가 복호화된 응답을 직접 렌더하는
 * 페이지는, 같은 데이터를 주는 authed procedure 가 막는 행위자(게스트)에게 GET 만으로
 * 열려 있었다. 이 가드가 procedure 와 같은 판정을 페이지에도 적용해 두 경로의 권한 축을 맞춘다.
 *
 * 존재 여부를 노출하지 않도록 거부는 notFound() 로 처리한다.
 */
export async function requireAdminPage() {
  const user = await requireAuth();
  if (isGuestUser(user.id)) {
    notFound();
  }
  return user;
}
