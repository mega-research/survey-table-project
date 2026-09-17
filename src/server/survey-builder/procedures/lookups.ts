import * as z from 'zod';

import { authed } from '@/server/orpc';
import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';

import {
  CopySavedLookupInput,
  DeleteSurveyLookupInput,
  SurveyLookupSchema,
  UpsertSurveyLookupInput,
} from '../domain/survey-lookup';
import * as svc from '../services/survey-lookups';

// 설문 LUT 사본 mutation 은 전부 설문 편집이다 — survey.edit 관문을 지난다(티켓 09).

const copy = authed
  .input(CopySavedLookupInput)
  .output(SurveyLookupSchema)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.edit');
    return svc.copySavedLookupToSurvey(input.surveyId, input.savedLookupId);
  });

const upsert = authed
  .input(UpsertSurveyLookupInput)
  .output(SurveyLookupSchema)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.edit');
    return svc.upsertSurveyLookup(input.surveyId, input.lookup);
  });

const remove = authed
  .input(DeleteSurveyLookupInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.edit');
    await svc.deleteSurveyLookup(input.surveyId, input.surveyLookupId);
    return { ok: true as const };
  });

export const lookups = {
  copy,
  upsert,
  remove,
};
