import * as z from 'zod';

import { assertSurveyAccess, scoped } from '@/server/orpc';

import {
  CancelCampaignInput,
  CreateCampaignInput,
  CreateCampaignResult,
  FetchCandidateIdsInput,
  FetchCandidateIdsResult,
  PreviewPreflightInput,
  PreviewPreflightResult,
  SendSingleCampaignInput,
} from '../../domain/mail-campaign';
import * as svc from '../services/mail-campaigns.service';
import { sendSingleCampaign } from '../services/mail-single-send.service';

const create = scoped
  .input(CreateCampaignInput)
  .output(CreateCampaignResult)
  .handler(({ context, input }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    return svc.createCampaign(input, context.user.id);
  });

const cancel = scoped
  .input(CancelCampaignInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ context, input }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    await svc.cancelCampaign(input);
    return { ok: true as const };
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
    return sendSingleCampaign(input, context.user.id);
  });

export const campaigns = {
  create,
  cancel,
  fetchCandidateIds,
  previewPreflight,
  sendSingle,
};
