import 'server-only';

import { notFound } from 'next/navigation';

import { requireAuth } from '@/lib/auth';

/**
 * admin 전용 RSC 페이지 진입 가드.
 *
 * proxy(src/proxy.ts)는 세션 쿠키 존재만 보고, admin/analytics 레이아웃은 세션 유효성과
 * 계정 상태(active)까지만 본다. 그래서 analytics 처럼 RSC 가 복호화된 응답을 직접 렌더하는
 * 페이지는, 같은 데이터를 주는 authed procedure 가 막는 행위자에게 GET 만으로 열려 있었다.
 * 이 가드가 procedure 와 같은 판정을 페이지에도 적용해 두 경로의 권한 축을 맞춘다.
 *
 * 티켓 21 에서 본문이 한 줄로 줄었다 — 예전에는 env grant 게스트를 userId 로 따로 걸렀지만,
 * 게스트가 계정 유형이 되면서 `requireAuth`(세션 + active + internal)가 그 일을 함께 한다.
 * 그래도 이름을 남기는 이유는 호출부가 말하는 바가 다르기 때문이다: 이 이름이 붙은 페이지는
 * 「관리 화면」이고, 그 사실은 tests/repo/rsc-page-guards 가 목록으로 지킨다.
 */
export async function requireAdminPage() {
  return requireAuth();
}

/**
 * 전역 관리 전용 RSC 페이지 진입 가드 (사용자 관리 등).
 *
 * oRPC superadmin 베이스와 같은 판정이다 — 페이지는 열리는데 데이터만 FORBIDDEN 으로
 * 막히는 어긋남을 만들지 않는다. 거부는 존재를 노출하지 않도록 notFound().
 */
export async function requireSuperadminPage() {
  const user = await requireAdminPage();
  if (!user.isSuperadmin) {
    notFound();
  }
  return user;
}
