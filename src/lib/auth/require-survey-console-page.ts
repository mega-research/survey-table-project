import { notFound } from 'next/navigation';

import 'server-only';

import { canAccessSurvey, canViewOnlyGuestPreview, isViewOnlyGuest } from './guest-grants';
import { requirePageUser } from './require-page-user';

/**
 * 보기만 하는 게스트를 이 화면이 어떻게 다루는가 — 미들웨어(guestPathRedirect)와 같은 세 갈래.
 * - `deny`(기본): 막는다. 응답 현황·응답 내역 목록 밖의 콘솔 화면 전부.
 * - `allow`: 연다. 응답 현황·응답 내역 목록.
 * - `previewGrant`: 설문 보기를 허용한 grant(`allowPreview`)만 연다. 설문 보기 화면.
 */
export type ViewOnlyPolicy = 'deny' | 'allow' | 'previewGrant';

/**
 * 게스트에게도 여는 설문 화면(운영 콘솔·설문 보기)의 RSC 진입 가드.
 *
 * 미들웨어(src/lib/supabase/middleware.ts)는 grant 보유자의 경로만 제한한다. grant 도 없고
 * ADMIN_USER_IDS 에도 없는 세션(grant 를 뗀 옛 게스트 계정 등)은 그대로 통과하므로, 같은 데이터를
 * 주는 scoped procedure 가 막는 행위자에게 GET 만으로 화면이 열린다. 이 가드가 procedure 와 같은
 * 판정(canAccessSurvey)을 페이지에도 적용한다 — requireAdminPage 의 게스트 허용판이다.
 *
 * 보기만 하는 게스트의 경로 제한도 미들웨어 하나에 기대지 않고 여기서 같은 규칙으로 거른다.
 * 어느 화면이 어느 갈래인지는 `tests/repo/admin-page-guard.test.ts` 의 표가 정본이고, 그 표를
 * 미들웨어 판정과 대조한다.
 *
 * canAccessSurvey 는 ADMIN_USER_IDS 미설정 시 fail-open 이라(admin-allowlist.ts) 기존 배포의
 * 동작은 바뀌지 않는다. 존재 여부를 노출하지 않도록 거부는 notFound() 로 처리한다.
 */
export async function requireSurveyConsolePage(
  surveyId: string,
  options: { viewOnly?: ViewOnlyPolicy } = {},
) {
  const user = await requirePageUser();
  if (!canAccessSurvey(user.id, surveyId)) notFound();
  if (isViewOnlyGuest(user.id, surveyId)) {
    const policy = options.viewOnly ?? 'deny';
    const allowed =
      policy === 'allow' ||
      (policy === 'previewGrant' && canViewOnlyGuestPreview(user.id, surveyId));
    if (!allowed) notFound();
  }
  return user;
}
