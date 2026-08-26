import 'server-only';

import { notFound } from 'next/navigation';

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
