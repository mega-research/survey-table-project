import * as z from 'zod';

import { authed } from '@/server/orpc';

import {
  CopySavedLookupInput,
  DeleteSurveyLookupInput,
  SurveyLookupSchema,
  UpsertSurveyLookupInput,
} from '../../domain/survey-lookup';
import * as svc from '../services/survey-lookups.service';

const copy = authed
  .input(CopySavedLookupInput)
  .output(SurveyLookupSchema)
  .handler(({ input }) => svc.copySavedLookupToSurvey(input.surveyId, input.savedLookupId));

const upsert = authed
  .input(UpsertSurveyLookupInput)
  .output(SurveyLookupSchema)
  .handler(({ input }) => svc.upsertSurveyLookup(input.surveyId, input.lookup));

const remove = authed
  .input(DeleteSurveyLookupInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ input }) => {
    await svc.deleteSurveyLookup(input.surveyId, input.surveyLookupId);
    return { ok: true as const };
  });

export const lookups = {
  copy,
  upsert,
  remove,
};
