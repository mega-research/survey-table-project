import * as z from 'zod';

import { authed } from '@/server/orpc';
import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';

import { UpdateResultCodesInput } from '../domain/contact-result-code';
import * as svc from '../services/contact-result-codes';

const update = authed
  .input(UpdateResultCodesInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ context, input }) => {
    // 결과코드 어휘 정의는 스킴 편집과 같은 관리 표면이다 — 회차 쓰기(writeAttempts)와 가른다.
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'contacts.manage');
    await svc.updateResultCodes(input.surveyId, input.codes);
    return { ok: true as const };
  });

export const resultCodes = {
  update,
};
