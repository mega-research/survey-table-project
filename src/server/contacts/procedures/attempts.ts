import * as z from 'zod';

import { isGuestUser } from '@/lib/auth/guest-grants';
import { scoped } from '@/server/orpc';
import { assertScopedSurveyCapabilityRpc } from '@/server/rpc-survey-access';

import {
  AddContactAttemptInput,
  AttemptResultSchema,
  DeleteContactAttemptInput,
  UpdateContactAttemptInput,
} from '../domain/contact-attempt';
import * as svc from '../services/contact-attempts';

const add = scoped
  .input(AddContactAttemptInput)
  .output(AttemptResultSchema)
  .handler(async ({ context, input }) => {
    // 결과코드 회차 쓰기는 실사원도 갖는 유일한 쓰기라 contacts.manage 가 아니라 writeAttempts.
    await assertScopedSurveyCapabilityRpc(context.user, input.surveyId, 'contacts.writeAttempts');
    // 인증된 context 에서 1회 파생 — 서비스가 auth 를 재조회하지 않는다.
    return svc.addAttempt(input, isGuestUser(context.user.id));
  });

const update = scoped
  .input(UpdateContactAttemptInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ context, input }) => {
    await assertScopedSurveyCapabilityRpc(context.user, input.surveyId, 'contacts.writeAttempts');
    await svc.updateAttempt(input, isGuestUser(context.user.id));
    return { ok: true as const };
  });

const remove = scoped
  .input(DeleteContactAttemptInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ context, input }) => {
    await assertScopedSurveyCapabilityRpc(context.user, input.surveyId, 'contacts.writeAttempts');
    await svc.deleteAttempt(input, isGuestUser(context.user.id));
    return { ok: true as const };
  });

export const attempts = {
  add,
  update,
  remove,
};
