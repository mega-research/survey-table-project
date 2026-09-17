import * as z from 'zod';

import { authed } from '@/server/orpc';
import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';

import {
  CreateSurveyAnchorInput,
  ListSurveyAnchorsInput,
  RemoveSurveyAnchorInput,
  SurveyAnchorSchema,
} from '../domain/survey-anchor';
import * as svc from '../services/survey-anchors';

const list = authed
  .input(ListSurveyAnchorsInput)
  .output(z.array(SurveyAnchorSchema))
  .handler(async ({ input, context }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.view');
    return svc.listSurveyAnchors(input);
  });

const create = authed
  .input(CreateSurveyAnchorInput)
  .output(SurveyAnchorSchema)
  .handler(async ({ input, context }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.edit');
    return svc.createSurveyAnchor(input);
  });

const remove = authed
  .input(RemoveSurveyAnchorInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ input, context }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.edit');
    await svc.removeSurveyAnchor(input);
    return { ok: true as const };
  });

export const anchors = {
  list,
  create,
  remove,
};
