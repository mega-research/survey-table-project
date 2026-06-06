import { authed, pub } from '@/server/orpc';

import {
  LookupContactByTokenInput,
  LookupContactByTokenOutput,
  RevertUnsubscribeByContactIdInput,
  RevertUnsubscribeByContactIdOutput,
} from '../../domain/mail-unsubscribe';
import * as svc from '../services/mail-unsubscribe.service';

/**
 * 토큰으로 컨택 조회(pub). 무효 토큰이면 service 가 ok=false 반환 — 호출부가 fallback 처리.
 * 읽기 전용이라 익명(공개 수신거부 페이지)도 호출 가능.
 */
const lookup = pub
  .input(LookupContactByTokenInput)
  .output(LookupContactByTokenOutput)
  .handler(({ input }) => svc.lookupContactByToken(input));

/**
 * 운영자 수신거부 해제(authed). surveyId scope 일치 검증은 service 가 수행.
 * 인증 게이트는 authed 미들웨어가 담당(원본 requireAuth 대체).
 */
const revertByContactId = authed
  .input(RevertUnsubscribeByContactIdInput)
  .output(RevertUnsubscribeByContactIdOutput)
  .handler(({ input }) => svc.revertUnsubscribeByContactId(input));

export const unsubscribe = {
  lookup,
  revertByContactId,
};
