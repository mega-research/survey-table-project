import { notFound } from 'next/navigation';

import 'server-only';

import { canAccessSurvey, isViewOnlyGuest } from './guest-grants';
import { requirePageUser } from './require-page-user';

/**
 * 운영 콘솔 RSC 페이지 진입 가드 — 개인정보 평문을 직접 렌더하는 화면용.
 *
 * 미들웨어(src/lib/supabase/middleware.ts)는 grant 보유자의 경로만 제한한다. grant 도 없고
 * ADMIN_USER_IDS 에도 없는 세션(grant 를 뗀 옛 게스트 계정 등)은 그대로 통과하므로, 같은 데이터를
 * 주는 scoped procedure 가 막는 행위자에게 GET 만으로 화면이 열린다. 이 가드가 procedure 와 같은
 * 판정(canAccessSurvey)을 페이지에도 적용한다 — requireAdminPage 의 게스트 허용판이다.
 *
 * 보기만 하는 게스트는 미들웨어가 응답 현황·응답 내역 목록 밖으로 못 나가게 막지만, 평문 화면은
 * 미들웨어 하나에 기대지 않고 여기서도 거른다.
 *
 * canAccessSurvey 는 ADMIN_USER_IDS 미설정 시 fail-open 이라(admin-allowlist.ts) 기존 배포의
 * 동작은 바뀌지 않는다. 존재 여부를 노출하지 않도록 거부는 notFound() 로 처리한다.
 */
export async function requireSurveyConsolePage(surveyId: string) {
  const user = await requirePageUser();
  if (!canAccessSurvey(user.id, surveyId) || isViewOnlyGuest(user.id, surveyId)) {
    notFound();
  }
  return user;
}
