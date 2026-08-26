import 'server-only';

import { notFound } from 'next/navigation';

import { requireAuth } from '@/lib/auth';

import { canAccessSurvey, isGuestUser } from './guest-grants';

/**
 * 설문 단위 RSC 진입 가드 — 게스트가 grant 밖 설문 화면에 닿지 못하게 막는다.
 *
 * admin 레이아웃의 guestPathRedirect 는 **하드 내비게이션에서만** 재실행된다. 클라이언트
 * 소프트 내비게이션은 공통 레이아웃(`/admin`)을 다시 렌더하지 않으므로, 설문 경계는 설문
 * 세그먼트가 바뀔 때 반드시 다시 도는 이 자리(`surveys/[id]/layout.tsx`)에서 한 번 더 본다.
 * 콘솔 RSC 는 procedure 가 아니라 service 를 직접 부르므로(assertSurveyAccess 미경유)
 * 이 가드가 없으면 다른 설문의 운영 데이터가 그대로 렌더된다.
 *
 * 존재 여부를 노출하지 않도록 거부는 notFound() 로 처리한다.
 */
export async function assertGuestSurveyPageAccess(surveyId: string): Promise<void> {
  const user = await requireAuth();
  if (!isGuestUser(user.id)) return;
  if (!canAccessSurvey(user.id, surveyId)) notFound();
}
