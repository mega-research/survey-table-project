import { cache } from 'react';

import { requireActiveAccount } from '@/lib/auth';
import { isGuestAccount } from '@/shared/contracts/auth';

/**
 * 현재 세션이 클라이언트(게스트) 계정인지 판정하는 서버 전용 헬퍼.
 *
 * 판정 출처가 티켓 21 에서 바뀌었다 — env grant 목록이 아니라 **계정 유형**이다.
 * 쓰이는 곳은 접근제어가 아니라 **데이터 파티션**이다: 게스트 화면은 전역 테스트 모드와
 * 무관하게 항상 실데이터를 본다(loadOperationsDataScope). 접근 강제는 여기가 아니라
 * 설문 capability 코어(server/survey-access)와 유형 게이트가 담당한다.
 *
 * layout.tsx, overview/profiles/preview 등 여러 RSC 가 각자 직접 호출하고
 * loadOperationsDataScope 내부에서도 호출되어 요청당 여러 번 실행되므로 React
 * cache 로 감싸 세션 조회 왕복을 요청당 1회로 줄인다.
 */
async function loadIsGuestViewer(): Promise<boolean> {
  // getCurrentUser 는 세션이 없으면 null 을 돌려주는데, null 을 "게스트 아님" 으로
  // 해석하면 일시적 auth 장애가 게스트를 어드민 스코프로 흘려보낸다. 호출부는 모두
  // 레이아웃 가드·procedure 인증을 통과한 뒤라 세션이 반드시 있으므로 fail-closed 로
  // 던지는 문을 쓴다. requireAuth(내부 전용)가 아니라 requireActiveAccount 인 것이
  // 요점이다 — 게스트를 판정하는 함수가 게스트를 먼저 거부하면 언제나 false 가 된다.
  const user = await requireActiveAccount();
  return isGuestAccount(user.userType);
}

export const isGuestViewer = cache(loadIsGuestViewer);
