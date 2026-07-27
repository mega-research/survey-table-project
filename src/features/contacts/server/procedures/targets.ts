import * as z from 'zod';

import { assertSurveyAccess, authed, scoped } from '@/server/orpc';

import {
  AddContactTargetInput,
  ContactTargetRowSchema,
  DeleteContactTargetInput,
  GenerateTestContactsInput,
  GenerateTestContactsResult,
  UpdateContactTargetInput,
} from '../../domain/contact-target';
import * as svc from '../services/contact-targets.service';
import { generateTestContacts } from '../services/test-contacts.service';

const add = scoped
  .input(AddContactTargetInput)
  .output(ContactTargetRowSchema)
  .handler(({ context, input }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    return svc.addContactTarget(input);
  });

const update = scoped
  .input(UpdateContactTargetInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ context, input }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    await svc.updateContactTarget(input);
    return { ok: true as const };
  });

const remove = authed
  .input(DeleteContactTargetInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ input }) => {
    await svc.deleteContactTarget(input);
    return { ok: true as const };
  });

const generateTest = authed
  .input(GenerateTestContactsInput)
  .output(GenerateTestContactsResult)
  .handler(({ input }) => generateTestContacts(input));

export const targets = {
  add,
  update,
  remove,
  generateTest,
};
