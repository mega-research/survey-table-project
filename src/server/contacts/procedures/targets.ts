import * as z from 'zod';

import { isGuestUser } from '@/lib/auth/guest-grants';
import { assertSurveyWriteAccessInShare, authed, scoped } from '@/server/orpc';

import {
  AddContactTargetInput,
  ContactTargetRowSchema,
  DeleteContactTargetInput,
  GenerateTestContactsInput,
  GenerateTestContactsResult,
  UpdateContactTargetInput,
} from '../domain/contact-target';
import { contactEditorOf } from '../domain/contact-target-edit';
import * as svc from '../services/contact-targets';
import { generateTestContacts } from '../services/test-contacts';

const add = scoped
  .input(AddContactTargetInput)
  .output(ContactTargetRowSchema)
  .handler(({ context, input }) => {
    // 담당 범위에 묶인 게스트에게도 연다 — 추가하는 대상에 자기 범위 값이 찍힌다.
    const share = assertSurveyWriteAccessInShare(context.user.id, input.surveyId);
    // 인증된 context 에서 1회 파생 — 서비스가 auth 를 재조회하지 않는다.
    return svc.addContactTarget(input, isGuestUser(context.user.id), share);
  });

const update = scoped
  .input(UpdateContactTargetInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ context, input }) => {
    // 담당 범위에 묶인 게스트에게도 연다 — 범위 밖 대상은 NOT_FOUND, 범위 열은 못 바꾼다.
    const share = assertSurveyWriteAccessInShare(context.user.id, input.surveyId);
    // 편집자도 인증된 context 에서 넘긴다 — 「대상 정보 수정 현황」의 누가(게스트도 자기 이메일로).
    await svc.updateContactTarget(
      input,
      isGuestUser(context.user.id),
      contactEditorOf(context.user),
      share,
    );
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
