import { ORPCError, os } from '@orpc/server';

import { logger } from '@/lib/logger';
import { getTrustedClientIpOrNull } from '@/lib/rate-limit/client-ip';
import type { UserType } from '@/shared/contracts/auth';

import type { ORPCContext } from './context';

/**
 * 전 RPC 구조화 로깅 미들웨어.
 *
 * base(orpc.ts)에 부착되어 pub/authed/scoped 파생 전 procedure 를 하나로 커버한다.
 * handler 인터셉터가 아니라 base 미들웨어인 이유: procedure 경로(path)·검증 전 입력·
 * 컨텍스트에 접근할 수 있고, RPCHandler(/api/rpc)와 OpenAPIHandler(/api/v1) 양쪽을
 * 핸들러 수정 없이 동일하게 커버한다.
 *
 * allowlist 관례: 바인딩은 식별자(rpc·userId·role·ip·surveyId)와 durationMs 뿐이다.
 * input/output 본문·JSONB 컨테이너·PII 평문은 싣지 않는다 — redact 는 안전망일 뿐.
 */

/**
 * 로그용 role 판정 — **계정 유형**이 곧 역할이다 (티켓 21).
 *
 * 예전에는 env grant 목록(guest-grants)을 다시 읽어 게스트를 가렸다. 계정 모델로 바뀌면서
 * 그 출처가 세션 자신이 됐고, 그 덕에 실사도 뭉개지지 않고 자기 이름으로 남는다.
 * 비인증은 anonymous.
 *
 * 소비처는 열린 string 으로 취급한다 (LogContext.role 참조).
 */
function resolveLogRole(user: { userType: UserType } | null | undefined): string {
  if (!user) return 'anonymous';
  return user.userType === 'internal' ? 'admin' : user.userType;
}

/**
 * 입력에서 surveyId 만 안전 추출한다.
 *
 * 최상위 객체의 surveyId string 키 외에는 접근하지 않는다 — input 본문에는
 * attrs·questionResponses 등 JSONB/PII 가 통째로 실릴 수 있어 로그 반입 금지.
 */
function extractSurveyIdOrUndefined(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return undefined;
  }
  const value = (input as Record<string, unknown>)['surveyId'];
  return typeof value === 'string' ? value : undefined;
}

export const rpcLoggingMiddleware = os
  .$context<ORPCContext>()
  .middleware(async ({ context, path, next }, input: unknown) => {
    const startedAt = Date.now();
    // 누가(userId·role)·어디서(ip)·무엇을(rpc·surveyId) — 성공/실패 공통 바인딩
    const fields = {
      rpc: path.join('.'),
      userId: context.user?.id,
      role: resolveLogRole(context.user),
      ip: getTrustedClientIpOrNull(context.headers ?? new Headers()) ?? undefined,
      surveyId: extractSurveyIdOrUndefined(input),
    };

    try {
      const result = await next();
      logger.info({ ...fields, durationMs: Date.now() - startedAt }, '[rpc] 완료');
      return result;
    } catch (error) {
      // 비-ORPCError 는 wire 에서 INTERNAL_SERVER_ERROR 로 마스킹된다(rpc-error-policy)
      // — 로그 code 도 같은 값으로 맞춰 클라이언트 관측과 대조 가능하게 한다.
      logger.error(
        {
          ...fields,
          durationMs: Date.now() - startedAt,
          code: error instanceof ORPCError ? error.code : 'INTERNAL_SERVER_ERROR',
          err: error,
        },
        '[rpc] 실패',
      );
      throw error;
    }
  });
