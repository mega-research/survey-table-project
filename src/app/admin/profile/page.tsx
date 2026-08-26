import { redirect } from 'next/navigation';

import { ProfileView } from '@/features/workspace/profile/profile-view';
import { requireActiveAccount } from '@/lib/auth';

/**
 * 프로필 (.pen FLOW 3-2) — 세 계정 유형 공통.
 *
 * `/admin` 아래 있지만 내부 전용이 아니다. 가드가 requireAdminPage 가 아니라
 * requireActiveAccount 인 것이 그 뜻이고, admin 레이아웃의 유형 게이트도 이 경로를
 * ACCOUNT_PAGES 로 비켜준다. 데이터를 주는 auth.getProfile 도 account 베이스라 두 축이 같다.
 *
 * 비로그인은 proxy·레이아웃이 이미 걸러내지만, 소프트 내비게이션에서 레이아웃이 다시 돌지
 * 않으므로 여기서도 세션을 확인한다(티켓 02 기록).
 */
export default async function AdminProfilePage() {
  try {
    await requireActiveAccount();
  } catch {
    // 만료·폐기된 쿠키를 든 요청은 proxy 를 통과한다(쿠키 존재만 본다) — 500 대신 로그인으로.
    redirect('/admin/login?redirect=%2Fadmin%2Fprofile');
  }
  return <ProfileView />;
}
