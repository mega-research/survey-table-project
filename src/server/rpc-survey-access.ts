import 'server-only';

import { ORPCError } from '@orpc/server';

import type { SurveyCapability } from '@/shared/contracts/workspace';

import {
  assertSurveyCapability,
  SurveyAccessError,
  type SurveyAccessUser,
} from './survey-access';

/**
 * 설문 capability 관문의 RPC 어댑터 (역할 모델 v2 티켓 09).
 *
 * 판정과 거부 사유는 survey-access(denialReasonFor)가 정하고, 여기는 그 사유를 RPC
 * 에러 어휘로 옮기기만 한다 — rpc-error-policy 가 예외 노출을 다루듯 이 파일은 접근
 * 거부의 노출을 다룬다. not_found(없거나 볼 수 없음)는 NOT_FOUND, forbidden(보이지만
 * 그 작업 권한 없음)은 FORBIDDEN.
 *
 * surveyId 를 받는 authed procedure 의 handler 첫 줄에서 부른다. RSC 페이지는 이걸 쓰지
 * 말고 assertSurveyCapability + notFound() 로 자기 표면에 맞게 접는다.
 */
export async function assertSurveyCapabilityRpc(
  user: SurveyAccessUser,
  surveyId: string,
  capability: SurveyCapability,
): Promise<void> {
  try {
    await assertSurveyCapability(user, surveyId, capability);
  } catch (error) {
    throw toRpcSurveyAccessError(error);
  }
}

/**
 * SurveyAccessError → RPC 에러. capability 검사가 procedure 가 아니라 서비스 안
 * (트랜잭션 경계)에서 도는 경로(saveWithDetails·duplicate 등)가 던진 것을 옮길 때도 쓴다.
 */
export function toRpcSurveyAccessError(error: unknown): unknown {
  if (error instanceof SurveyAccessError) {
    return error.reason === 'not_found'
      ? new ORPCError('NOT_FOUND', { message: '설문을 찾을 수 없습니다.' })
      : new ORPCError('FORBIDDEN', { message: '이 작업을 수행할 권한이 없습니다.' });
  }
  return error;
}
