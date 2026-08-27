import { authed, pub, withRateLimit } from '@/server/orpc';
import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';

import {
  LookupContactByTokenInput,
  LookupContactByTokenOutput,
  RevertUnsubscribeByContactIdInput,
  RevertUnsubscribeByContactIdOutput,
} from '../domain/mail-unsubscribe';
import * as svc from '../services/unsubscribe';

/**
 * 토큰으로 컨택 조회(pub). 무효 토큰이면 service 가 ok=false 반환 — 호출부가 fallback 처리.
 * 읽기 전용이라 익명(공개 수신거부 페이지)도 호출 가능.
 * 공개 토큰 조회이므로 lookup 그룹으로 IP 당 rate limit 한다.
 */
const lookup = pub
  .use(withRateLimit('lookup'))
  .input(LookupContactByTokenInput)
  .output(LookupContactByTokenOutput)
  .handler(({ input }) => svc.lookupContactByToken(input));

/**
 * 운영자 수신거부 해제(authed). 인증 게이트는 authed 미들웨어가 담당하고,
 * 설문 접근은 관문이 판정한다 — surveyId-컨택 일치는 service 가 이어서 확인한다.
 */
const revertByContactId = authed
  .input(RevertUnsubscribeByContactIdInput)
  .output(RevertUnsubscribeByContactIdOutput)
  .handler(async ({ context, input }) => {
    // 수신거부 해제는 컨택 관리 행위라 contacts.manage 를 따른다.
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'contacts.manage');
    return svc.revertUnsubscribeByContactId(input);
  });

export const unsubscribe = {
  lookup,
  revertByContactId,
};
