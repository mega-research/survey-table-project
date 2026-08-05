import { getCurrentUser } from '@/lib/auth';
import { getGuestSurveyId } from '@/lib/auth/guest-grants';

/**
 * 현재 세션이 설문 단위 게스트(grant 보유자)인지 판정하는 RSC 전용 헬퍼.
 *
 * 게스트에게 숨겨야 하는 관리자 UI(설문 편집·엑셀 내보내기·설문 중단 등)의
 * 서버 렌더 분기에 사용한다. 접근 강제는 여기가 아니라 미들웨어
 * (guestPathRedirect) + procedure(scoped/authed)가 담당한다.
 */
export async function isGuestViewer(): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  return getGuestSurveyId(user.id) !== null;
}
