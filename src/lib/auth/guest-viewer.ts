import { cache } from 'react';

import { requireAuth } from '@/lib/auth';
import { isGuestUser, isOverviewOnlyGuest } from '@/lib/auth/guest-grants';

/**
 * 현재 세션이 설문 단위 게스트(grant 보유자)인지 판정하는 서버 전용 헬퍼.
 *
 * 게스트에게 숨겨야 하는 관리자 UI(설문 편집·엑셀 내보내기·테스트 모드 등)의
 * 서버 렌더 분기와, 운영 콘솔 데이터 스코프 고정에 사용한다. 접근 강제는 여기가
 * 아니라 미들웨어(guestPathRedirect) + procedure(scoped/authed)가 담당한다.
 *
 * layout.tsx, overview/profiles/preview 등 여러 RSC 가 각자 직접 호출하고
 * loadOperationsDataScope 내부에서도 호출되어 요청당 여러 번 실행되므로 React
 * cache 로 감싸 supabase auth.getUser() 왕복을 요청당 1회로 줄인다.
 */
async function loadIsGuestViewer(): Promise<boolean> {
  // getCurrentUser 는 supabase 에러를 삼키고 null 을 돌려주는데, null 을 "게스트 아님"
  // 으로 해석하면 일시적 auth 장애가 게스트를 어드민 스코프로 흘려보낸다. 호출부는
  // 모두 미들웨어·procedure 인증을 통과한 뒤라 세션이 반드시 있으므로 fail-closed 로
  // requireAuth 를 쓴다.
  const user = await requireAuth();
  return isGuestUser(user.id);
}

export const isGuestViewer = cache(loadIsGuestViewer);

/**
 * 현재 세션이 이 설문에서 응답 현황만 보는 게스트인지 판정한다(guest-grants 의
 * OVERVIEW_ONLY_GUEST_GRANTS). 탭·헤더 버튼·응답 현황 카드의 서버 렌더 분기용이고,
 * 다른 화면 경로 차단은 미들웨어(guestPathRedirect)가 맡는다.
 */
async function loadIsOverviewOnlyViewer(surveyId: string): Promise<boolean> {
  const user = await requireAuth();
  return isOverviewOnlyGuest(user.id, surveyId);
}

export const isOverviewOnlyViewer = cache(loadIsOverviewOnlyViewer);
