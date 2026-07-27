import * as z from 'zod';

import { assertSurveyAccess, scoped } from '@/server/orpc';

import {
  AddContactAttemptInput,
  AttemptResultSchema,
  DeleteContactAttemptInput,
  UpdateContactAttemptInput,
} from '../../domain/contact-attempt';
import * as svc from '../services/contact-attempts.service';

const add = scoped
  .input(AddContactAttemptInput)
  .output(AttemptResultSchema)
  .handler(({ context, input }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    return svc.addAttempt(input);
  });

const update = scoped
  .input(UpdateContactAttemptInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ context, input }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    await svc.updateAttempt(input);
    return { ok: true as const };
  });

const remove = scoped
  .input(DeleteContactAttemptInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ context, input }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    await svc.deleteAttempt(input);
    return { ok: true as const };
  });

export const attempts = {
  add,
  update,
  remove,
};
