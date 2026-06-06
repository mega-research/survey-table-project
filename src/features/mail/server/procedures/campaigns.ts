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
} from '../../domain/mail-campaign';
import * as svc from '../services/mail-campaigns.service';

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

export const campaigns = {
  create,
  cancel,
  fetchCandidateIds,
  previewPreflight,
};
