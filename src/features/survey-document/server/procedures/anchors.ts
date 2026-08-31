import * as z from 'zod';

import { assertSurveyAccess, scoped } from '@/server/orpc';

import {
  CreateSurveyAnchorInput,
  ListSurveyAnchorsInput,
  RemoveSurveyAnchorInput,
  SurveyAnchorSchema,
} from '../../domain/survey-anchor';
import * as svc from '../services/survey-anchors.service';

const list = scoped
  .input(ListSurveyAnchorsInput)
  .output(z.array(SurveyAnchorSchema))
  .handler(({ input, context }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    return svc.listSurveyAnchors(input);
  });

const create = scoped
  .input(CreateSurveyAnchorInput)
  .output(SurveyAnchorSchema)
  .handler(({ input, context }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    return svc.createSurveyAnchor(input);
  });

const remove = scoped
  .input(RemoveSurveyAnchorInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ input, context }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    await svc.removeSurveyAnchor(input);
    return { ok: true as const };
  });

export const anchors = {
  list,
  create,
  remove,
};
