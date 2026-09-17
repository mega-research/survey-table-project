import { ORPCError } from '@orpc/server';
import * as z from 'zod';

import { isExternalAccount } from '@/shared/contracts/auth';
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
  SetContactTargetMemoInput,
  UpdateContactTargetInput,
} from '../domain/contact-target';
import * as svc from '../services/contact-targets';
import { generateTestContacts } from '../services/test-contacts';

/**
 * 서비스의 0행 거부를 RPC 어휘로 옮긴다 (티켓 15).
 *
 * `contact-targets` 는 영향 0행을 `Error('NOT_FOUND')` 로 던진다 — WHERE 에 surveyId 가
 * 함께 걸려 있어 **타 설문 컨택을 지목하면 여기로 온다**. 매핑이 없으면 rpc-error-policy 가
 * 500 으로 마스킹해, 정확히 거부된 요청이 화면에는 「내부 오류」로 보인다.
 */
function rethrowContactNotFound(error: unknown): never {
  if (error instanceof Error && error.message === 'NOT_FOUND') {
    throw new ORPCError('NOT_FOUND', { message: '대상 컨택을 찾을 수 없습니다.' });
  }
  throw error;
}

const add = scoped
  .input(AddContactTargetInput)
  .output(ContactTargetRowSchema)
  .handler(async ({ context, input }) => {
    // 대상 추가는 명단 관리다 — 실사원의 회차 쓰기(writeAttempts)와 갈라 manage 를 요구한다.
    await assertScopedSurveyCapabilityRpc(context.user, input.surveyId, 'contacts.manage');
    // 인증된 context 에서 1회 파생 — 서비스가 auth 를 재조회하지 않는다.
    return svc.addContactTarget(input, isExternalAccount(context.user.userType));
  });

const update = scoped
  .input(UpdateContactTargetInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ context, input }) => {
    await assertScopedSurveyCapabilityRpc(context.user, input.surveyId, 'contacts.manage');
    await svc.updateContactTarget(input, isExternalAccount(context.user.userType)).catch(rethrowContactNotFound);
    return { ok: true as const };
  });

/**
 * 메모·연락 방법만 쓰는 좁은 표면 (티켓 26 — 티켓 25 가 여기로 넘겼다).
 *
 * 요구 capability 가 `contacts.manage` 가 아니라 **`contacts.writeAttempts`** 인 것이
 * 이 표면의 존재 이유다. 실사는 결과 회차를 쓰지만 명단은 못 고친다(ADR-0019) — 두
 * 필드가 `update` 와 같은 문에 있으면 그 구분이 사라진다.
 */
const setMemo = scoped
  .input(SetContactTargetMemoInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ context, input }) => {
    await assertScopedSurveyCapabilityRpc(context.user, input.surveyId, 'contacts.writeAttempts');
    await svc
      .setContactTargetMemo(input, isExternalAccount(context.user.userType))
      .catch(rethrowContactNotFound);
    return { ok: true as const };
  });

const remove = authed
  .input(DeleteContactTargetInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'contacts.manage');
    await svc.deleteContactTarget(input, isExternalAccount(context.user.userType)).catch(rethrowContactNotFound);
    return { ok: true as const };
  });

const generateTest = authed
  .input(GenerateTestContactsInput)
  .output(GenerateTestContactsResult)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'contacts.manage');
    return generateTestContacts(input, isExternalAccount(context.user.userType));
  });

export const targets = {
  add,
  update,
  setMemo,
  remove,
  generateTest,
};
