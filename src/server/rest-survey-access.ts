import 'server-only';

import { NextResponse } from 'next/server';

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
 * 비내부 계정도 지나는 REST 표면용 — assertScopedSurveyCapabilityRpc 의 REST 짝.
 *
 * 여기에도 게스트 분기가 있었고 티켓 21 이 걷었다(rpc 짝의 주석 참조). 이 표면들은 export
 * 3종인데, **게스트에게 export 는 항상 차단**이라는 스펙 §8 의 칸이 이제 두 겹으로 지켜진다 —
 * `requireAuth` 가 비내부 계정을 아예 들이지 않고, 설령 들어와도 게스트 열에는
 * `export.download` 가 없다. 예전에는 그 칸이 열려 있었다: env grant 게스트 콘솔의 다운로드
 * 버튼이 살아 있어 티켓 11 이 현행 유지로 두고 이 티켓에 인계했다.
 */
export async function checkScopedSurveyCapabilityRest(
  user: SurveyAccessUser,
  surveyId: string,
  capability: SurveyCapability,
): Promise<NextResponse | null> {
  return checkSurveyCapabilityRest(user, surveyId, capability);
}
