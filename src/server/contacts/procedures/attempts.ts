import { ORPCError } from '@orpc/server';
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

/**
 * 서비스의 0행 거부를 RPC 어휘로 옮긴다 (티켓 15).
 *
 * `contact-attempts` 는 대상 컨택을 찾지 못하면 `Error('NOT_FOUND')` 를 던진다 — 조회에
 * surveyId 가 함께 걸려 있어 **타 설문 컨택을 지목하면 여기로 온다**. 매핑이 없으면
 * rpc-error-policy 가 500 으로 마스킹해, 정확히 거부된 요청이 「내부 오류」로 보인다.
 */
function rethrowAttemptNotFound(error: unknown): never {
  if (error instanceof Error && error.message === 'NOT_FOUND') {
    throw new ORPCError('NOT_FOUND', { message: '대상 컨택을 찾을 수 없습니다.' });
  }
  throw error;
}

const add = scoped
  .input(AddContactAttemptInput)
  .output(AttemptResultSchema)
  .handler(async ({ context, input }) => {
    // 결과코드 회차 쓰기는 실사원도 갖는 유일한 쓰기라 contacts.manage 가 아니라 writeAttempts.
    await assertScopedSurveyCapabilityRpc(context.user, input.surveyId, 'contacts.writeAttempts');
    // 인증된 context 에서 1회 파생 — 서비스가 auth 를 재조회하지 않는다.
    return svc.addAttempt(input, isGuestUser(context.user.id)).catch(rethrowAttemptNotFound);
  });

const update = scoped
  .input(UpdateContactAttemptInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ context, input }) => {
    await assertScopedSurveyCapabilityRpc(context.user, input.surveyId, 'contacts.writeAttempts');
    await svc.updateAttempt(input, isGuestUser(context.user.id)).catch(rethrowAttemptNotFound);
    return { ok: true as const };
  });

const remove = scoped
  .input(DeleteContactAttemptInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ context, input }) => {
    await assertScopedSurveyCapabilityRpc(context.user, input.surveyId, 'contacts.writeAttempts');
    await svc.deleteAttempt(input, isGuestUser(context.user.id)).catch(rethrowAttemptNotFound);
    return { ok: true as const };
  });

export const attempts = {
  add,
  update,
  remove,
};
