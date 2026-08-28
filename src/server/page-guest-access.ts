import 'server-only';

import { notFound } from 'next/navigation';

import { requireAccountTypePage } from '@/lib/auth/require-account-page';
import type { AuthUser } from '@/shared/contracts/auth';
import type { SurveyGuestTab, SurveyGuestTabs } from '@/shared/contracts/workspace';

import { loadSurveyAccess, SurveyAccessError } from './survey-access';

/**
 * 게스트 콘솔 화면의 관문 — `page-survey-access` 의 게스트 짝 (역할 모델 v2 티켓 22).
 *
 * 저쪽(`assertSurveyConsolePageAccess`)과 나란한 자리지만 **묻는 것이 하나 더 있다**.
 * 내부 콘솔은 capability 하나로 끝나는데, 게스트 화면은 capability(`operations.view`)를
 * 지난 뒤 **탭 화이트리스트**를 다시 본다 — 게스트가 갖는 권한은 어느 설문에서나 같고
 * 설문마다 달라지는 것은 그 안에서 어느 탭이 열리는가이기 때문이다(티켓 21).
 *
 * 거부는 전부 notFound 다. 「부여되지 않은 설문」과 「허용되지 않은 탭」을 갈라 말하면
 * 주소 조작으로 부여 사실과 탭 구성이 확인된다 — .pen 5-2 노트의 「부여되지 않은 설문·내부
 * 메뉴는 **존재 자체가 보이지 않는다**」가 화면만의 약속이 아니라는 뜻이다.
 *
 * `tab` 을 생략하면 탭 축을 묻지 않는다. 설문지 미리보기가 그 경우다 — 스펙 §5 의
 * 「보는 것 ①」은 화이트리스트 밖이라 부여된 설문이면 언제나 열린다.
 *
 * tests/repo/rsc-page-guards.test.ts 의 가드 목록에 등재돼 있다 — 이름을 바꾸면 그 정규식도
 * 함께 바꿀 것.
 */
export interface GuestSurveyPageViewer {
  user: AuthUser;
  /** 이 설문에서 이 게스트에게 열린 탭 — 화면이 탭 바를 그릴 때 그대로 쓴다. */
  tabs: SurveyGuestTabs;
}

export async function assertGuestSurveyPageAccess(
  surveyId: string,
  tab?: SurveyGuestTab,
): Promise<GuestSurveyPageViewer> {
  const user = await requireAccountTypePage('guest');

  let access;
  try {
    access = await loadSurveyAccess(user, surveyId);
  } catch (error) {
    // 없는 설문·삭제된 설문은 코어가 not_found 로 던진다. 그 밖의 예외(DB 장애)는
    // 404 로 접지 않는다 — 조용한 404 는 장애를 「권한 없음」으로 오독하게 만든다.
    if (error instanceof SurveyAccessError) notFound();
    throw error;
  }

  if (!access.capabilities.has('operations.view')) notFound();
  // 유형 게이트를 지났으므로 guestTabs 는 반드시 채워져 있다 — 방어적으로 다시 접는다.
  const tabs = access.guestTabs;
  if (!tabs) notFound();
  if (tab !== undefined && !tabs[tab]) notFound();

  return { user, tabs };
}
