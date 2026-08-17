import * as z from 'zod';

import { isGuestUser } from '@/lib/auth/guest-grants';
import { assertSurveyAccess, scoped } from '@/server/orpc';

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
} from '../../domain/mail-campaign';
import * as svc from '../services/mail-campaigns.service';
import { sendSingleCampaign } from '../services/mail-single-send.service';

const create = scoped
  .input(CreateCampaignInput)
  .output(CreateCampaignResult)
  .handler(({ context, input }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    // 인증된 context 에서 1회 파생 — 서비스가 auth 를 재조회하지 않는다.
    return svc.createCampaign(input, context.user.id, isGuestUser(context.user.id));
  });

const cancel = scoped
  .input(CancelCampaignInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ context, input }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    await svc.cancelCampaign(input, isGuestUser(context.user.id));
    return { ok: true as const };
  });

const resync = scoped
  .input(ResyncCampaignInput)
  .output(ResyncCampaignResult)
  .handler(({ context, input }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    return svc.resyncCampaign(input);
  });

const fetchCandidateIds = scoped
  .input(FetchCandidateIdsInput)
  .output(FetchCandidateIdsResult)
  .handler(({ context, input }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    return svc.fetchCandidateIds(input);
  });

const previewPreflight = scoped
  .input(PreviewPreflightInput)
  .output(PreviewPreflightResult)
  .handler(({ context, input }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    return svc.previewPreflight(input);
  });

const sendSingle = scoped
  .input(SendSingleCampaignInput)
  .output(CreateCampaignResult)
  .handler(({ context, input }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
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
