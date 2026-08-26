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
  // 헤더 한 줄 때문에 홈 전체를 500 으로 떨어뜨리지 않는다 — 세션이 가리키는 행이 사라진
  // 경우(세션 cascade 때문에 사실상 도달 불가)에도 이름만으로 화면은 성립한다.
  const organization = await getProfile(user.id)
    .then((profile) => profile.organization)
    .catch(() => null);
  return <GuestHomeView user={user} organization={organization} />;
}
