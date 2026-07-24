import * as z from 'zod';

import { authed } from '@/server/orpc';

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

const create = authed
  .input(CreateCampaignInput)
  .output(CreateCampaignResult)
  .handler(({ input, context }) => svc.createCampaign(input, context.user.id));

const cancel = authed
  .input(CancelCampaignInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ input }) => {
    await svc.cancelCampaign(input);
    return { ok: true as const };
  });

const fetchCandidateIds = authed
  .input(FetchCandidateIdsInput)
  .output(FetchCandidateIdsResult)
  .handler(({ input }) => svc.fetchCandidateIds(input));

const previewPreflight = authed
  .input(PreviewPreflightInput)
  .output(PreviewPreflightResult)
  .handler(({ input }) => svc.previewPreflight(input));

const sendSingle = authed
  .input(SendSingleCampaignInput)
  .output(CreateCampaignResult)
  .handler(({ input, context }) => sendSingleCampaign(input, context.user.id));

export const campaigns = {
  create,
  cancel,
  fetchCandidateIds,
  previewPreflight,
  sendSingle,
};
