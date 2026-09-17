import 'server-only';

import { notFound } from 'next/navigation';

import { requireAuth } from '@/lib/auth';
import type { AuthUser } from '@/shared/contracts/auth';
import type { SurveyCapability } from '@/shared/contracts/workspace';

import {
  assertSurveyCapability,
  SurveyAccessError,
  type SurveyAccessUser,
} from './survey-access';

/**
 * 설문 capability 관문의 RSC 페이지 어댑터 — rpc-survey-access 의 페이지 짝 (티켓 09).
 *
 * 페이지 표면에서는 거부 사유를 가르지 않는다: 없는 설문도, 볼 수 없는 설문도, 그 작업만
 * 못 하는 설문도 전부 notFound() 로 접는다 — 콘솔 화면이 403 을 그릴 이유가 없고, 타 팀
 * 설문의 존재를 알려주지 않는 쪽이 기본값이다. 이 접기가 페이지마다 인라인으로 늘면
 * 한 표면만 사유를 흘리게 되므로 여기로 모은다.
 *
 * generateMetadata 와 본문이 같은 관문을 지나야 하는 페이지는 이 함수를 감싼 자기 헬퍼를
 * React cache() 로 묶어 요청당 판정을 1회로 줄인다(분석 페이지 2종 참조).
 */
export async function assertSurveyCapabilityPage(
  user: SurveyAccessUser,
  surveyId: string,
  capability: SurveyCapability,
): Promise<void> {
  try {
    await assertSurveyCapability(user, surveyId, capability);
  } catch (error) {
    if (error instanceof SurveyAccessError) notFound();
    throw error;
  }
}

/**
 * 설문 콘솔 페이지용 관문 — 세션 확인 + capability 판정을 한 번에 (티켓 10·21).
 *
 * 여기에도 env grant 게스트 분기가 있었고 티켓 21 이 걷었다 — 게스트가 계정 모델로 바뀌면서
 * 그 자격이 코어의 판정 대상이 됐기 때문이다(rpc 짝의 주석 참조). 남은 것은 세션 확인과
 * 코어 판정 둘뿐이고, 게스트·실사는 애초에 `/admin` 구역에 들어오지 못한다(레이아웃의 유형
 * 게이트가 자기 홈으로 돌려보낸다). 클라이언트가 보는 화면은 `/guest` 다(티켓 22).
 *
 * 게스트 차단 화면(컬럼 스킴·결과코드·업로드·쿼터)은 이걸 쓰지 말고
 * requireAdminPage + assertSurveyCapabilityPage 짝을 쓴다 — 지금은 정책이 같지만
 * **이유가 다르다**: 저쪽은 「관리 화면」임을 말하고 이쪽은 「설문 콘솔」임을 말한다.
 *
 * tests/repo/rsc-page-guards.test.ts 의 가드 목록에 등재돼 있다 — 이름을 바꾸면
 * 그 정규식도 함께 바꿀 것.
 */
export async function assertSurveyConsolePageAccess(
  surveyId: string,
  capability: SurveyCapability,
): Promise<AuthUser> {
  const viewer = await requireAuth();
  await assertSurveyCapabilityPage(viewer, surveyId, capability);
  return viewer;
}
