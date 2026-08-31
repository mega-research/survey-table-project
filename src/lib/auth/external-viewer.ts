import { cache } from 'react';

import { requireActiveAccount } from '@/lib/auth';
import { isInternalUser } from '@/shared/contracts/auth';

/**
 * 현재 세션이 **비내부 계정**(게스트·실사)인지 판정하는 서버 전용 헬퍼.
 *
 * 쓰이는 곳은 접근제어가 아니라 **데이터 파티션**이다: 외부 계정 화면은 전역 테스트 모드와
 * 무관하게 항상 실데이터를 본다(loadOperationsDataScope). 접근 강제는 여기가 아니라 설문
 * capability 코어(server/survey-access)와 유형 게이트가 담당한다.
 *
 * **티켓 25 에서 게스트 전용에서 넓어졌다.** 실사가 `contacts.view`·`contacts.writeAttempts`
 * 를 얻으면서 컨택 표면이 실제로 열렸는데, 그 규칙이 게스트만 보고 있으면 담당 연구원이
 * 테스트 모드를 켠 설문에서 실사원이 **test 파티션을 읽고 결과코드를 test 로 쓴다** — 밖에서
 * 전화를 돌리는 사람이 실데이터를 못 보고, 남긴 기록도 아무도 못 본다. 게스트를 real 로
 * 고정한 이유(read/write 비대칭 차단)가 실사에는 더 강하게 적용된다: 실사의 일 자체가
 * 실제 연락처를 상대하는 것이다.
 *
 * 판정을 「게스트인가」가 아니라 「내부가 아닌가」로 적는 것이 요점이다. 유형이 늘 때마다
 * 이 술어를 고치는 대신, 내부 표면만 테스트 모드를 따른다는 사실을 그대로 쓴다.
 *
 * layout.tsx, overview/profiles/preview 등 여러 RSC 가 각자 직접 호출하고
 * loadOperationsDataScope 내부에서도 호출되어 요청당 여러 번 실행되므로 React
 * cache 로 감싸 세션 조회 왕복을 요청당 1회로 줄인다.
 */
async function loadIsExternalViewer(): Promise<boolean> {
  // getCurrentUser 는 세션이 없으면 null 을 돌려주는데, null 을 "내부 계정" 으로 해석하면
  // 일시적 auth 장애가 외부 계정을 어드민 스코프로 흘려보낸다. 호출부는 모두 레이아웃
  // 가드·procedure 인증을 통과한 뒤라 세션이 반드시 있으므로 fail-closed 로 던지는 문을 쓴다.
  // requireAuth(내부 전용)가 아니라 requireActiveAccount 인 것이 요점이다 — 외부 계정을
  // 판정하는 함수가 외부 계정을 먼저 거부하면 언제나 false 가 된다.
  const user = await requireActiveAccount();
  return !isInternalUser(user.userType);
}

export const isExternalViewer = cache(loadIsExternalViewer);
