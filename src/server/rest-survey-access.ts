import 'server-only';

import { NextResponse } from 'next/server';

import { canAccessSurvey, isGuestUser } from '@/lib/auth/guest-grants';
import type { SurveyCapability } from '@/shared/contracts/workspace';

import {
  assertSurveyCapability,
  SurveyAccessError,
  type SurveyAccessUser,
} from './survey-access';

/**
 * 설문 capability 관문의 REST 어댑터 — rpc-survey-access·page-survey-access 의 형제 (티켓 11).
 *
 * 판정과 거부 사유는 코어(survey-access 의 denialReasonFor)가 정하고, 여기는 그 사유를
 * HTTP 응답으로 옮기기만 한다 — not_found(없거나 볼 수 없음)는 404 존재 은닉,
 * forbidden(보이지만 그 작업 권한 없음)은 403. Route Handler 는 throw 가 아니라
 * NextResponse 반환으로 끝나는 표면이라 assert 가 아니라 check 다:
 * 통과하면 null, 거부면 그대로 return 할 응답을 돌려준다.
 *
 * 403 바디는 rpc 어댑터의 문구가 아니라 종전 REST 거부 바디('권한이 없습니다.')를
 * 그대로 쓴다 — 이 표면의 기존 소비자(다운로드 실패 안내)가 보던 계약이다.
 */
export async function checkSurveyCapabilityRest(
  user: SurveyAccessUser,
  surveyId: string,
  capability: SurveyCapability,
): Promise<NextResponse | null> {
  try {
    await assertSurveyCapability(user, surveyId, capability);
    return null;
  } catch (error) {
    if (error instanceof SurveyAccessError) {
      return error.reason === 'not_found'
        ? NextResponse.json({ error: '설문을 찾을 수 없습니다.' }, { status: 404 })
        : NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
    }
    throw error;
  }
}

/**
 * 게스트 허용 REST 표면용 — assertScopedSurveyCapabilityRpc 의 REST 짝.
 *
 * env grant 게스트는 팀 멤버십이 없어 capability 판정이 항상 거부한다 — grant 일치가
 * 유일한 자격이므로 종전 판정(grant 설문만, 불일치 403)을 그대로 둔다. 내부 계정은
 * capability 관문을 지난다. 스펙 §8 의 "게스트 export 항상 차단"은 게스트 부여가 계정
 * 모델로 바뀌는 티켓 21 의 체크리스트다 — 그 전에 막으면 게스트 콘솔의 살아 있는
 * 다운로드 버튼이 깨진다.
 */
export async function checkScopedSurveyCapabilityRest(
  user: SurveyAccessUser,
  surveyId: string,
  capability: SurveyCapability,
): Promise<NextResponse | null> {
  if (isGuestUser(user.id)) {
    if (!canAccessSurvey(user.id, surveyId)) {
      return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
    }
    return null;
  }
  return checkSurveyCapabilityRest(user, surveyId, capability);
}
