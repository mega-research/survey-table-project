import * as z from 'zod';

import { isGuestUser } from '@/lib/auth/guest-grants';
import { assertSurveyAccess, authed, scoped } from '@/server/orpc';

import {
  AddContactTargetInput,
  ContactTargetRowSchema,
  DeleteContactTargetInput,
  GenerateTestContactsInput,
  GenerateTestContactsResult,
  UpdateContactTargetInput,
} from '../domain/contact-target';
import * as svc from '../services/contact-targets';
import { generateTestContacts } from '../services/test-contacts';

const add = scoped
  .input(AddContactTargetInput)
  .output(ContactTargetRowSchema)
  .handler(({ context, input }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    // 인증된 context 에서 1회 파생 — 서비스가 auth 를 재조회하지 않는다.
    return svc.addContactTarget(input, isGuestUser(context.user.id));
  });

const update = scoped
  .input(UpdateContactTargetInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ context, input }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    // 편집자도 인증된 context 에서 넘긴다 — 「대상 정보 수정 현황」의 누가(게스트도 자기 이메일로).
    await svc.updateContactTarget(input, isGuestUser(context.user.id), {
      id: context.user.id,
      email: context.user.email ?? null,
    });
    return { ok: true as const };
  });

const remove = authed
  .input(DeleteContactTargetInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ context, input }) => {
    await svc.deleteContactTarget(input, isGuestUser(context.user.id));
    return { ok: true as const };
  });

const generateTest = authed
  .input(GenerateTestContactsInput)
  .output(GenerateTestContactsResult)
  .handler(({ context, input }) =>
    generateTestContacts(input, isGuestUser(context.user.id)),
  );

export const targets = {
  add,
  update,
  remove,
  generateTest,
};
