import * as z from 'zod';

import { isGuestUser } from '@/lib/auth/guest-grants';
import { assertSurveyWriteAccessInShare, scoped } from '@/server/orpc';

import {
  AddContactAttemptInput,
  AttemptResultSchema,
  DeleteContactAttemptInput,
  UpdateContactAttemptInput,
} from '../domain/contact-attempt';
import { contactEditorOf } from '../domain/contact-target-edit';
import * as svc from '../services/contact-attempts';

const add = scoped
  .input(AddContactAttemptInput)
  .output(AttemptResultSchema)
  .handler(({ context, input }) => {
    // 담당 범위에 묶인 게스트에게도 연다 — 범위 밖 대상은 서비스가 NOT_FOUND 로 접는다.
    const share = assertSurveyWriteAccessInShare(context.user.id, input.surveyId);
    // 인증된 context 에서 1회 파생 — 서비스가 auth 를 재조회하지 않는다. 편집자는 회차 기록자다.
    return svc.addAttempt(
      input,
      isGuestUser(context.user.id),
      contactEditorOf(context.user),
      share,
    );
  });

const update = scoped
  .input(UpdateContactAttemptInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ context, input }) => {
    const share = assertSurveyWriteAccessInShare(context.user.id, input.surveyId);
    await svc.updateAttempt(
      input,
      isGuestUser(context.user.id),
      contactEditorOf(context.user),
      share,
    );
    return { ok: true as const };
  });

const remove = scoped
  .input(DeleteContactAttemptInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ context, input }) => {
    const share = assertSurveyWriteAccessInShare(context.user.id, input.surveyId);
    await svc.deleteAttempt(
      input,
      isGuestUser(context.user.id),
      contactEditorOf(context.user),
      share,
    );
    return { ok: true as const };
  });

export const attempts = {
  add,
  update,
  remove,
};
