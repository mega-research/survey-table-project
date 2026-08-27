import * as z from 'zod';

import { isGuestUser } from '@/lib/auth/guest-grants';
import { authed, scoped } from '@/server/orpc';
import {
  assertScopedSurveyCapabilityRpc,
  assertSurveyCapabilityRpc,
} from '@/server/rpc-survey-access';

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
  .handler(async ({ context, input }) => {
    // 대상 추가는 명단 관리다 — 실사원의 회차 쓰기(writeAttempts)와 갈라 manage 를 요구한다.
    await assertScopedSurveyCapabilityRpc(context.user, input.surveyId, 'contacts.manage');
    // 인증된 context 에서 1회 파생 — 서비스가 auth 를 재조회하지 않는다.
    return svc.addContactTarget(input, isGuestUser(context.user.id));
  });

const update = scoped
  .input(UpdateContactTargetInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ context, input }) => {
    await assertScopedSurveyCapabilityRpc(context.user, input.surveyId, 'contacts.manage');
    await svc.updateContactTarget(input, isGuestUser(context.user.id));
    return { ok: true as const };
  });

const remove = authed
  .input(DeleteContactTargetInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'contacts.manage');
    await svc.deleteContactTarget(input, isGuestUser(context.user.id));
    return { ok: true as const };
  });

const generateTest = authed
  .input(GenerateTestContactsInput)
  .output(GenerateTestContactsResult)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'contacts.manage');
    return generateTestContacts(input, isGuestUser(context.user.id));
  });

export const targets = {
  add,
  update,
  remove,
  generateTest,
};
