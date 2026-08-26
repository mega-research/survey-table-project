import 'server-only';

import { requireAuth } from '@/lib/auth';
import {
  SurveyAccessError,
  assertSurveyCapability,
} from '@/server/survey-access';
import type { SurveyCapability } from '@/shared/contracts/workspace';

export class SurveyOwnershipError extends Error {
  constructor(public readonly reason: 'not_found' | 'forbidden') {
    super(reason);
    this.name = 'SurveyOwnershipError';
  }
}

/**
 * 어드민 설문 화면 진입 가드 — 인증 + **설문 단위 capability**.
 *
 * 역할 모델 v2 티켓 07 이전에는 "인증된 사용자면 전 설문 접근" 이었다. 이제 팀 귀속이
 * 생겼으므로 판정은 survey-access 엔진 하나가 한다 — 여기서 팀·소유자 조건을 다시 쓰면
 * 매트릭스가 두 벌이 된다.
 *
 * 없는 설문과 권한 없는 설문은 사유를 갈라 돌려준다. 존재를 감출지는 호출 화면이 정한다
 * (콘솔 페이지는 둘 다 notFound 로 접는 것이 보통이다).
 *
 * 나머지 콘솔·빌더 표면의 관문 배선은 티켓 09~11 이 이어서 한다.
 */
export async function requireSurveyOwnership(
  surveyId: string,
  capability: SurveyCapability = 'survey.view',
) {
  const user = await requireAuth();
  try {
    await assertSurveyCapability(user, surveyId, capability);
  } catch (error) {
    if (error instanceof SurveyAccessError) throw new SurveyOwnershipError(error.reason);
    throw error;
  }
  return { user, survey: { id: surveyId } };
}
