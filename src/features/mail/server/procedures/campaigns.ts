import * as z from 'zod';

import { getGuestSurveyId } from '@/lib/auth/guest-grants';
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
    return svc.createCampaign(input, context.user.id, getGuestSurveyId(context.user.id) !== null);
  });

const cancel = scoped
  .input(CancelCampaignInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ context, input }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    await svc.cancelCampaign(input, getGuestSurveyId(context.user.id) !== null);
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
    return sendSingleCampaign(input, context.user.id, getGuestSurveyId(context.user.id) !== null);
  });

export const campaigns = {
  create,
  cancel,
  resync,
  fetchCandidateIds,
  previewPreflight,
  sendSingle,
};
