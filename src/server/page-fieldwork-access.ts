import 'server-only';

import { notFound } from 'next/navigation';

import { requireAccountTypePage } from '@/lib/auth/require-account-page';
import type { AuthUser } from '@/shared/contracts/auth';
import type { SurveyCapability } from '@/shared/contracts/workspace';

import { loadSurveyAccess, SurveyAccessError } from './survey-access';

/**
 * 실사 콘솔 화면의 관문 — `page-guest-access` 의 실사 짝 (역할 모델 v2 티켓 26).
 *
 * 게스트 쪽과 나란한 자리지만 **탭 축이 없다.** 게스트는 capability 를 지난 뒤 설문마다
 * 다른 화이트리스트를 다시 물었는데(티켓 21), 실사는 초대되면 열리는 화면이 고정이라
 * 물을 것이 capability 하나다.
 *
 * 대신 이쪽에만 있는 축이 **쓰기 여부**다. 실사 팀장은 소속원이 초대된 설문을 초대 없이
 * 열람하되 결과코드는 못 남긴다(스펙 §6 「본인 초대 시」) — 화면이 그 차이를 그려야 하므로
 * `canWriteAttempts` 를 함께 돌려준다. 강제는 여기가 아니라 쓰기 표면의 관문이 한다:
 * 이 값은 「눌러도 거부되는 버튼」을 안 만드는 용도다.
 *
 * 거부는 전부 notFound 다. 「초대되지 않은 설문」과 「업체 밖 설문」을 갈라 말하면 주소
 * 조작으로 초대 사실과 업체 구성이 확인된다 — 게스트 관문과 같은 판단이다.
 *
 * tests/repo/rsc-page-guards.test.ts 의 가드 목록에 등재돼 있다 — 이름을 바꾸면 그 정규식도
 * 함께 바꿀 것.
 */
export interface FieldworkSurveyPageViewer {
  user: AuthUser;
  /**
   * 결과코드·메모를 남길 수 있는가 — **본인이 초대된 설문에서만** 참이다.
   *
   * 팀장의 파생 시야에서는 false 이고, 화면은 「결과 기록」 버튼을 그리지 않는다.
   */
  canWriteAttempts: boolean;
}

export async function assertFieldworkSurveyPageAccess(
  surveyId: string,
): Promise<FieldworkSurveyPageViewer> {
  const user = await requireAccountTypePage('fieldwork');

  let access;
  try {
    access = await loadSurveyAccess(user, surveyId);
  } catch (error) {
    // 없는 설문·삭제된 설문은 코어가 not_found 로 던진다. 그 밖의 예외(DB 장애)는
    // 404 로 접지 않는다 — 조용한 404 는 장애를 「권한 없음」으로 오독하게 만든다.
    if (error instanceof SurveyAccessError) notFound();
    throw error;
  }

  // 조사 대상·응답 현황 둘 다 이 문을 지난다. `contacts.view` 가 아니라
  // `operations.view` 를 묻는 이유는 후자가 실사 열의 **입구**이기 때문이다 — 초대와
  // 파생 시야 둘 다 가지며, 없으면 그 설문이 애초에 이 사람의 것이 아니다.
  if (!access.capabilities.has('operations.view')) notFound();

  return {
    user,
    canWriteAttempts: access.capabilities.has(
      'contacts.writeAttempts' satisfies SurveyCapability,
    ),
  };
}
