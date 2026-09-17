import 'server-only';

import { ORPCError } from '@orpc/server';

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
 * scoped 표면(비내부 계정도 지나는 콘솔)용 관문 — **판정은 코어 하나가 한다** (티켓 21).
 *
 * 예전에는 여기에 게스트 분기가 있었다. env grant 모델의 게스트는 팀 멤버십이 없어
 * capability 판정이 언제나 거부했으므로, 그들만 grant 일치로 따로 통과시켜야 했다. 게스트가
 * 계정 모델(`users.user_type='guest'` + `survey_participants`)로 바뀌면서 그 자격이 코어의
 * 판정 대상이 됐고, 분기는 사라졌다 — 실사(티켓 24)도 어댑터가 아니라 코어에서 갈린다.
 *
 * 그래서 이 함수는 `assertSurveyCapabilityRpc` 와 같은 일을 한다. 이름을 남겨 두는 것은
 * **표면의 청중이 다르기 때문**이다: 이 이름이 붙은 자리는 「내부 계정 말고도 들어올 수
 * 있는 문」이라는 뜻이고, tests/repo 의 정적 가드도 그 구분을 본다. 합치면 어느 문이
 * 비내부 계정에 노출되는지가 코드에서 사라진다.
 */
export async function assertScopedSurveyCapabilityRpc(
  user: SurveyAccessUser,
  surveyId: string,
  capability: SurveyCapability,
): Promise<void> {
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
