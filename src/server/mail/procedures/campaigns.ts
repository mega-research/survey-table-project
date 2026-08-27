import * as z from 'zod';

import { isGuestUser } from '@/lib/auth/guest-grants';
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

const create = scoped
  .input(CreateCampaignInput)
  .output(CreateCampaignResult)
  .handler(async ({ context, input }) => {
    await assertScopedSurveyCapabilityRpc(context.user, input.surveyId, 'mail.send');
    // 인증된 context 에서 1회 파생 — 서비스가 auth 를 재조회하지 않는다.
    return svc.createCampaign(input, context.user.id, isGuestUser(context.user.id));
  });

const cancel = scoped
  .input(CancelCampaignInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ context, input }) => {
    await assertScopedSurveyCapabilityRpc(context.user, input.surveyId, 'mail.send');
    await svc.cancelCampaign(input, isGuestUser(context.user.id));
    return { ok: true as const };
  });

const resync = scoped
  .input(ResyncCampaignInput)
  .output(ResyncCampaignResult)
  .handler(async ({ context, input }) => {
    await assertScopedSurveyCapabilityRpc(context.user, input.surveyId, 'mail.send');
    return svc.resyncCampaign(input);
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
    return sendSingleCampaign(input, context.user.id, isGuestUser(context.user.id));
  });

export const campaigns = {
  create,
  cancel,
  resync,
  fetchCandidateIds,
  previewPreflight,
  sendSingle,
};
