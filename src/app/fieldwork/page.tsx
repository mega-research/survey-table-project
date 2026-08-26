import { FieldworkHomeView } from '@/features/fieldwork-console/fieldwork-home-view';
import { requireAccountTypePage } from '@/lib/auth/require-account-page';

/**
 * 실사 홈 (.pen FLOW 10-1) — 스텁. 초대 설문 목록은 티켓 24·25 소관이다.
 *
 * 소속 업체는 users.organization 이 아니라 실사 업체 엔티티(fieldwork_orgs)에서 온다.
 * 그 엔티티가 티켓 24 에서 생기므로 지금은 표시하지 않는다.
 */
export default async function FieldworkHomePage() {
  const user = await requireAccountTypePage('fieldwork');
  return <FieldworkHomeView user={user} organization={null} />;
}
