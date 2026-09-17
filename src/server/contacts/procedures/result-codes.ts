import * as z from 'zod';

import { authed } from '@/server/orpc';

import { UpdateResultCodesInput } from '../domain/contact-result-code';
import * as svc from '../services/contact-result-codes';

const update = authed
  .input(UpdateResultCodesInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ input }) => {
    await svc.updateResultCodes(input.surveyId, input.codes);
    return { ok: true as const };
  });

export const resultCodes = {
  update,
};
