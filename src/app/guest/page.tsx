import { GuestHomeView } from '@/features/guest-console/guest-home-view';
import { requireAccountTypePage } from '@/lib/auth/require-account-page';
import { listGuestSurveys } from '@/server/read-models/guest-surveys';

export const dynamic = 'force-dynamic';

export const metadata = { title: '열람 가능한 조사' };

/**
 * 게스트 홈 (.pen FLOW 5-2) — 부여된 설문 카드 목록.
 *
 * 레이아웃이 이미 유형을 확인했지만 여기서도 확인한다 — 소프트 내비게이션에서 레이아웃은
 * 다시 돌지 않으므로, 목록 조회를 여는 자리가 자기 가드를 갖는다.
 */
export default async function GuestHomePage() {
  const user = await requireAccountTypePage('guest');
  const surveys = await listGuestSurveys(user.id);
  return <GuestHomeView surveys={surveys} />;
}
