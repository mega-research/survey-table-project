import { ORPCError } from '@orpc/server';
import * as z from 'zod';

import { isExternalAccount } from '@/shared/contracts/auth';
import { scoped } from '@/server/orpc';
import { assertScopedSurveyCapabilityRpc } from '@/server/rpc-survey-access';

import {
  CancelCampaignInput,
  CreateCampaignInput,
  CreateCampaignResult,
  FetchCandidateIdsInput,
  FetchCandidateIdsResult,
  PreviewPreflightInput,
  PreviewPreflightResult,
  ResyncCampaignInput,
  ResyncCampaignResult,
  SendSingleCampaignInput,
} from '../domain/mail-campaign';
import * as svc from '../services/campaigns';
import { sendSingleCampaign } from '../services/single-send';

/**
 * 캠페인 서비스의 0행·미존재 거부를 RPC 어휘로 옮긴다 (티켓 15).
 *
 * 두 서비스 모두 WHERE 에 surveyId 를 함께 걸어 **타 설문 캠페인을 지목하면 여기로 온다**.
 * 매핑이 없으면 500 으로 마스킹돼, 정확히 거부된 요청이 화면에는 「내부 오류」로 보인다.
 * 취소는 상태 충돌(발송 시작 후)과 미소속이 같은 0행이라 CONFLICT 로 모은다 — 갈라 말하면
 * 「그 캠페인이 이 설문 것인가」가 응답으로 드러난다.
 */
/**
 * 단건 발송의 사전 거부 — 전부 **이 설문 안에서** 대상을 찾지 못했거나 보낼 수 없는 상태다.
 * 타 설문 컨택·템플릿을 실어 보내면 첫 두 줄로 떨어진다(조회에 surveyId 가 함께 걸려 있다).
 */
const SINGLE_SEND_NOT_FOUND_MESSAGES = new Set([
  '조사 대상을 찾을 수 없습니다.',
  '선택한 메일 템플릿을 찾을 수 없습니다.',
]);

const SINGLE_SEND_CONFLICT_MESSAGES = new Set([
  '수신거부된 조사 대상에게는 메일을 보낼 수 없습니다.',
  '연락금지 결과코드가 기록된 조사 대상입니다.',
  '이메일 정보가 없는 조사 대상입니다.',
]);

const CAMPAIGN_CONFLICT_MESSAGES = new Set([
  '발송 시작 후에는 취소할 수 없습니다.',
  // 선택 컨택이 이 설문·이 파티션에서 전부 조회되지 않았다는 뜻이다 — 화면이 열린 뒤
  // 모드가 바뀐 정상 케이스와 **타 설문 컨택을 실어 보낸 경우**가 같은 0행으로 온다.
  // 갈라 말하면 「그 컨택이 어느 설문 것인가」가 응답으로 드러나므로 한 사유로 모은다.
  '운영 모드가 변경되었습니다. 화면을 새로고침한 뒤 다시 시도하세요.',
]);

function rethrowCampaignRefusal(error: unknown): never {
  if (error instanceof Error && CAMPAIGN_CONFLICT_MESSAGES.has(error.message)) {
    throw new ORPCError('CONFLICT', { message: error.message });
  }
  if (error instanceof Error && error.message === '단체 메일을 찾을 수 없습니다.') {
    throw new ORPCError('NOT_FOUND', { message: error.message });
  }
  if (error instanceof Error && SINGLE_SEND_NOT_FOUND_MESSAGES.has(error.message)) {
    throw new ORPCError('NOT_FOUND', { message: error.message });
  }
  if (error instanceof Error && SINGLE_SEND_CONFLICT_MESSAGES.has(error.message)) {
    throw new ORPCError('CONFLICT', { message: error.message });
  }
  throw error;
}

const create = scoped
  .input(CreateCampaignInput)
  .output(CreateCampaignResult)
  .handler(async ({ context, input }) => {
    await assertScopedSurveyCapabilityRpc(context.user, input.surveyId, 'mail.send');
    // 인증된 context 에서 1회 파생 — 서비스가 auth 를 재조회하지 않는다.
    return svc
      .createCampaign(input, context.user.id, isExternalAccount(context.user.userType))
      .catch(rethrowCampaignRefusal);
  });

const cancel = scoped
  .input(CancelCampaignInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ context, input }) => {
    await assertScopedSurveyCapabilityRpc(context.user, input.surveyId, 'mail.send');
    await svc.cancelCampaign(input, isExternalAccount(context.user.userType)).catch(rethrowCampaignRefusal);
    return { ok: true as const };
  });

const resync = scoped
  .input(ResyncCampaignInput)
  .output(ResyncCampaignResult)
  .handler(async ({ context, input }) => {
    await assertScopedSurveyCapabilityRpc(context.user, input.surveyId, 'mail.send');
    return svc.resyncCampaign(input).catch(rethrowCampaignRefusal);
  });

const fetchCandidateIds = scoped
  .input(FetchCandidateIdsInput)
  .output(FetchCandidateIdsResult)
  .handler(async ({ context, input }) => {
    // 발송 마법사 전용 조회(수신 후보 확정) — 발송 흐름의 일부라 mail.view 가 아니라 mail.send 를 따른다.
    await assertScopedSurveyCapabilityRpc(context.user, input.surveyId, 'mail.send');
    return svc.fetchCandidateIds(input);
  });

const previewPreflight = scoped
  .input(PreviewPreflightInput)
  .output(PreviewPreflightResult)
  .handler(async ({ context, input }) => {
    await assertScopedSurveyCapabilityRpc(context.user, input.surveyId, 'mail.send');
    return svc.previewPreflight(input);
  });

const sendSingle = scoped
  .input(SendSingleCampaignInput)
  .output(CreateCampaignResult)
  .handler(async ({ context, input }) => {
    await assertScopedSurveyCapabilityRpc(context.user, input.surveyId, 'mail.send');
    return sendSingleCampaign(input, context.user.id, isExternalAccount(context.user.userType)).catch(
      rethrowCampaignRefusal,
    );
  });

export const campaigns = {
  create,
  cancel,
  resync,
  fetchCandidateIds,
  previewPreflight,
  sendSingle,
};
