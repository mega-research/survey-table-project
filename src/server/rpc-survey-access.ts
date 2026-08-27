import 'server-only';

import { ORPCError } from '@orpc/server';

import { canAccessSurvey, isGuestUser } from '@/lib/auth/guest-grants';
import type { SurveyCapability } from '@/shared/contracts/workspace';

import {
  assertSurveyCapability,
  assertSurveyCapabilityBatch,
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
 * 여러 설문에 같은 요구를 한 번에 거는 관문 (티켓 12).
 *
 * 「설문 담기」가 최대 200건을 한 요청으로 받는다 — 단건 관문을 루프로 돌리면 설문마다
 * DB 왕복 두 번이 난다. 판정 결과는 단건과 동일하고 거부 코드 매핑도 같다.
 */
export async function assertSurveyCapabilityBatchRpc(
  user: SurveyAccessUser,
  surveyIds: readonly string[],
  capabilities: readonly SurveyCapability[],
): Promise<void> {
  try {
    await assertSurveyCapabilityBatch(user, surveyIds, capabilities);
  } catch (error) {
    throw toRpcSurveyAccessError(error);
  }
}

/**
 * scoped 표면(게스트 허용 콘솔)용 관문 — 주체에 따라 판정 축을 가른다 (티켓 10).
 *
 * env grant 게스트는 팀 멤버십이 없어 capability 판정이 항상 거부한다 — grant 일치가
 * 그들의 유일한 자격이므로 종전 판정(grant 설문만, 불일치 FORBIDDEN)을 그대로 둔다.
 * 내부 계정은 위 capability 관문을 지나고, grant 없는 guest·fieldwork 계정은 capability
 * 판정의 계정 유형 게이트가 NOT_FOUND 로 접는다(구 assertSurveyAccess 의 FORBIDDEN 에서
 * 존재 은닉 쪽으로 조정). 게스트 부여가 계정 모델로 바뀌는 티켓 21 이 이 분기를
 * capability 판정 하나로 합친다.
 */
export async function assertScopedSurveyCapabilityRpc(
  user: SurveyAccessUser,
  surveyId: string,
  capability: SurveyCapability,
): Promise<void> {
  if (isGuestUser(user.id)) {
    if (!canAccessSurvey(user.id, surveyId)) {
      throw new ORPCError('FORBIDDEN', { message: '해당 설문에 대한 권한이 없습니다.' });
    }
    return;
  }
  await assertSurveyCapabilityRpc(user, surveyId, capability);
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
