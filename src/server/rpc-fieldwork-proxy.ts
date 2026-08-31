import 'server-only';

import { ORPCError } from '@orpc/server';

import type { AuthUser } from '@/shared/contracts/auth';

import { type FieldworkProxy, resolveFieldworkProxy } from './fieldwork-proxy';

/**
 * 대행 판정의 RPC 어댑터 — `rpc-survey-access`·`rpc-work-scope` 와 같은 자리 (티켓 27).
 *
 * 코어는 RPC 어휘를 모른다. 「완료된 대상은 대행할 수 없다」는 정책이고, 그것이 FORBIDDEN
 * 이라는 것과 사용자에게 무엇이라 말하는가는 표면의 사정이다 — 두 응답 procedure 가 같은
 * 문자열을 각자 들고 있으면 한쪽만 고쳐지는 날이 온다.
 */
export async function resolveProxyForResponseRpc(
  user: AuthUser | null,
  surveyId: string,
  inviteToken: string | null,
): Promise<FieldworkProxy> {
  const proxy = await resolveFieldworkProxy(user, surveyId, inviteToken);
  if (proxy.kind === 'blocked') {
    throw new ORPCError('FORBIDDEN', { message: '이미 응답이 완료된 대상입니다.' });
  }
  return proxy;
}
