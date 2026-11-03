import * as z from 'zod';

import { isGuestUser } from '@/lib/auth/guest-grants';
import { assertSurveyAccess, scoped } from '@/server/orpc';

import {
  AddContactAttemptInput,
  AttemptResultSchema,
  DeleteContactAttemptInput,
  UpdateContactAttemptInput,
} from '../domain/contact-attempt';
import type { ContactEditor } from '../domain/contact-target-edit';
import * as svc from '../services/contact-attempts';

/** 인증된 context 의 사용자 — 회차 기록자이자 「대상 정보 수정 현황」의 누가(게스트도 자기 이메일로). */
function editorOf(user: { id: string; email?: string | null }): ContactEditor {
  return { id: user.id, email: user.email ?? null };
}

const add = scoped
  .input(AddContactAttemptInput)
  .output(AttemptResultSchema)
  .handler(({ context, input }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    // 인증된 context 에서 1회 파생 — 서비스가 auth 를 재조회하지 않는다.
    return svc.addAttempt(input, isGuestUser(context.user.id), editorOf(context.user));
  });

const update = scoped
  .input(UpdateContactAttemptInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ context, input }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    await svc.updateAttempt(input, isGuestUser(context.user.id), editorOf(context.user));
    return { ok: true as const };
  });

const remove = scoped
  .input(DeleteContactAttemptInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ context, input }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    await svc.deleteAttempt(input, isGuestUser(context.user.id), editorOf(context.user));
    return { ok: true as const };
  });

export const attempts = {
  add,
  update,
  remove,
};
