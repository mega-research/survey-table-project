import { GuestHomeView } from '@/features/guest-console/guest-home-view';
import { requireAccountTypePage } from '@/lib/auth/require-account-page';
import { getProfile } from '@/server/auth/services/auth';

/**
 * 게스트 홈 (.pen FLOW 5-2) — 스텁. 부여 설문 목록은 티켓 21·22 소관이다.
 *
 * 가드가 페이지에 있고 레이아웃에는 없다 — 지금 이 구역에 페이지가 하나뿐이라 레이아웃이
 * 더 막을 것이 없다. 하위 라우트가 생기는 티켓 22 가 레이아웃 가드를 함께 세울 것.
 */
export default async function GuestHomePage() {
  const user = await requireAccountTypePage('guest');
  // 소속 기관은 세션 페이로드에 없다 — 헤더 표시에 쓰므로 DB 에서 읽는다.
  const profile = await getProfile(user.id);
  return <GuestHomeView user={user} organization={profile.organization} />;
}
