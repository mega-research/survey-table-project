import * as z from 'zod';

import { authed, pub, withRateLimit } from '@/server/orpc';

import { QuotaCheckInput, QuotaCheckResult, QuotaConfigSchema } from '../../domain/quota';
import * as svc from '../services/quota.service';

const get = authed
  .input(z.object({ surveyId: z.string() }))
  .output(QuotaConfigSchema.nullable())
  .handler(({ input }) => svc.getQuotaConfig(input.surveyId));

const save = authed
  .input(z.object({ surveyId: z.string(), config: QuotaConfigSchema }))
  .output(QuotaConfigSchema)
  .handler(({ input }) => svc.saveQuotaConfig(input.surveyId, input.config));

const check = pub
  .use(withRateLimit('response-mutation'))
  .input(QuotaCheckInput)
  .output(QuotaCheckResult)
  .handler(({ input }) => svc.checkQuota(input));

export const quota = { get, save, check };
