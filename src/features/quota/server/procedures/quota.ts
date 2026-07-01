import * as z from 'zod';

import { authed } from '@/server/orpc';

import { QuotaConfigSchema } from '../../domain/quota';
import * as svc from '../services/quota.service';

const get = authed
  .input(z.object({ surveyId: z.string() }))
  .output(QuotaConfigSchema.nullable())
  .handler(({ input }) => svc.getQuotaConfig(input.surveyId));

const save = authed
  .input(z.object({ surveyId: z.string(), config: QuotaConfigSchema }))
  .output(QuotaConfigSchema)
  .handler(({ input }) => svc.saveQuotaConfig(input.surveyId, input.config));

export const quota = { get, save };
