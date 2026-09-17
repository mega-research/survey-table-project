import 'server-only';

import { redirect } from 'next/navigation';

import { requireActiveAccount } from '@/lib/auth';
import type { AuthUser, UserType } from '@/shared/contracts/auth';

import { accountHomePath } from './account-home';

/**
 * 계정 유형 구역(/guest·/fieldwork) RSC 진입 가드.
 *
 * 거부를 notFound 가 아니라 **자기 홈으로 리다이렉트**한다 — requireAdminPage 와 다른 판단이다.
 * 저쪽은 "이 화면이 있다는 사실"이 권한 정보라 존재를 감추지만, 유형 구역은 서로의 존재가
 * 비밀이 아니고 잘못 들어온 사용자에게는 갈 곳을 알려주는 편이 낫다.
 *
 * 비로그인·비활성은 로그인으로 보낸다. proxy 가 쿠키 존재만 보므로 만료된 쿠키를 든 요청이
 * 여기까지 온다.
 */
export async function requireAccountTypePage(expected: UserType): Promise<AuthUser> {
  let user: AuthUser;
  try {
    user = await requireActiveAccount();
  } catch {
    redirect(`/admin/login?redirect=${encodeURIComponent(accountHomePath(expected))}`);
  }
  if (user.userType !== expected) {
    redirect(accountHomePath(user.userType));
  }
  return user;
}
