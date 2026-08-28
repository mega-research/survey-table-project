import { ORPCError } from '@orpc/server';

import { authed, superadmin } from '@/server/orpc';
import { assertSurveyCapabilityRpc, toRpcSurveyAccessError } from '@/server/rpc-survey-access';
import { toRpcWorkScopeError } from '@/server/rpc-work-scope';

import {
  CreateSurveyInput,
  DuplicateResultSchema,
  EnsureSurveyInDbInput,
  EnsureSurveyResultSchema,
  SurveyIdInput,
  SurveyLifecycleOutput,
  SurveyOwnershipRequiredError,
  SurveyRowSchema,
  UpdateSurveyInput,
} from '../domain/survey';
import * as svc from '../services/surveys';

/**
 * 설문 CRUD procedure (authed).
 * 생성 경로(ensure/create/duplicate)는 서비스가 소유·배치를 판정하고(티켓 07),
 * 기존 설문을 지목하는 update/delete 는 handler 첫 줄에서 capability 관문을 지난다(티켓 09).
 */

// ensure 는 기존 행이면 서비스가 편집 관문을 지난다(존재 오라클 봉인) — 사유만 옮긴다.
/**
 * 소유 팀을 정할 수 없는 생성 거부를 RPC 어휘로 옮긴다.
 *
 * 매핑이 없으면 rpc-error-policy 가 정체불명의 500 으로 마스킹한다. 도달 경로가 둘 있다 —
 * 시스템 전체 보기·팀 미배치에서 만들려는 경우(화면이 버튼을 잠그지만 raw RPC 는 남는다),
 * 그리고 **해산된 팀 범위**(티켓 13). 둘 다 입력은 옳고 지금 상태와 충돌할 뿐이라 CONFLICT 다.
 */
function rethrowCreateError(error: unknown): never {
  if (error instanceof SurveyOwnershipRequiredError) {
    throw new ORPCError('CONFLICT', { message: error.message });
  }
  // 생성 경로는 작업 범위를 먼저 판정한다(resolveNewSurveyOwnership) — 일반 사용자가
  // scope='system' 을 실어 보내면 코어가 거부하고, 매핑이 없으면 그 거부가 500 이 된다.
  // 두 매퍼 모두 해당 없는 예외는 그대로 돌려주므로 겹쳐 써도 서로를 삼키지 않는다.
  throw toRpcSurveyAccessError(toRpcWorkScopeError(error));
}

const ensure = authed
  .input(EnsureSurveyInDbInput)
  .output(EnsureSurveyResultSchema)
  .handler(async ({ context, input }) => {
    try {
      return await svc.ensureSurveyInDb(context.user, input);
    } catch (error) {
      rethrowCreateError(error);
    }
  });

const create = authed
  .input(CreateSurveyInput)
  .output(SurveyRowSchema)
  .handler(({ context, input }) => svc.createSurvey(context.user, input).catch(rethrowCreateError));

const update = authed
  .input(UpdateSurveyInput)
  .output(SurveyRowSchema)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.edit');
    return svc.updateSurvey(input);
  });

// delete 는 예약어이므로 export 키는 del 로 둔다(router 접근 경로는 surveys.delete).
//
// 티켓 17 부터 실제 동작은 soft delete 다 — 관문·요구 capability·응답 모양은 그대로다.
const del = authed
  .input(SurveyIdInput)
  .output(SurveyLifecycleOutput)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.delete');
    return svc.deleteSurvey(input).catch((error: unknown) => {
      // 관문을 지난 뒤 다른 요청이 먼저 지운 경우 — 관문의 어휘로 되돌린다.
      throw toRpcSurveyAccessError(error);
    });
  });

/**
 * 삭제 취소 (티켓 17) — **슈퍼어드민 전용**.
 *
 * capability 관문을 쓸 수 없다. 코어가 삭제된 설문을 조회 단계에서 `deleted_at IS NULL` 로
 * 걸러 언제나 not_found 를 주기 때문이고, 그 필터를 느슨하게 하면 삭제가 「안 보인다」는
 * 성질 자체가 무너진다. 그래서 이 표면만 판정 축을 팀이 아니라 전역 권한으로 바꾼다 —
 * 삭제된 설문 목록도 같은 이유로 시스템 전체 보기 + 슈퍼어드민에서만 열린다.
 *
 * 소유자·팀장에게 열지 않는 것은 의도다. 삭제가 사고였다면 되돌릴 사람은 있지만, 되돌리는
 * 일이 흔해지면 「삭제」가 실질적으로 아카이브가 되어 팀이 그것을 정리 수단으로 쓰기 시작한다.
 */
const restore = superadmin
  .input(SurveyIdInput)
  .output(SurveyLifecycleOutput)
  .handler(({ input }) =>
    svc.restoreSurvey(input).catch((error: unknown) => {
      throw toRpcSurveyAccessError(error);
    }),
  );

// 복제는 원본 읽기 권한 검사가 서비스 안(원본 조회 직전)에 있다 — 사유만 RPC 어휘로 옮긴다.
const duplicate = authed
  .input(SurveyIdInput)
  .output(DuplicateResultSchema)
  .handler(async ({ context, input }) => {
    try {
      return await svc.duplicateSurvey(context.user, input);
    } catch (error) {
      throw toRpcSurveyAccessError(error);
    }
  });

export const surveys = {
  ensure,
  create,
  update,
  delete: del,
  restore,
  duplicate,
};
