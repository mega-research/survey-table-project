import * as z from 'zod';

import { getGuestSurveyId } from '@/lib/auth/guest-grants';
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
    // 인증된 context 에서 1회 파생 — 서비스가 auth 를 재조회하지 않는다.
    return svc.addContactTarget(input, getGuestSurveyId(context.user.id) !== null);
  });

const update = scoped
  .input(UpdateContactTargetInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ context, input }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    await svc.updateContactTarget(input, getGuestSurveyId(context.user.id) !== null);
    return { ok: true as const };
  });

const remove = authed
  .input(DeleteContactTargetInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ context, input }) => {
    await svc.deleteContactTarget(input, getGuestSurveyId(context.user.id) !== null);
    return { ok: true as const };
  });

const generateTest = authed
  .input(GenerateTestContactsInput)
  .output(GenerateTestContactsResult)
  .handler(({ context, input }) =>
    generateTestContacts(input, getGuestSurveyId(context.user.id) !== null),
  );

export const targets = {
  add,
  update,
  remove,
  generateTest,
};
