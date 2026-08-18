import { ORPCError, os } from '@orpc/server';

import { isAdminUserAllowed } from '@/lib/auth/admin-allowlist';
import { isGuestUser } from '@/lib/auth/guest-grants';
import { logger } from '@/lib/logger';
import { getTrustedClientIpOrNull } from '@/lib/rate-limit/client-ip';

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
 * 로그용 role 판정 — 접근제어와 같은 헬퍼(guest-grants/admin-allowlist)를 재사용한다.
 *
 * grant-first: 게스트 grant 보유자는 항상 guest. 그 외 allowlist 통과는 admin
 * (ADMIN_USER_IDS 미설정 fail-open 포함 — 접근제어 판정과 동일하게 기록한다).
 * 둘 다 아니면 user (세션은 있으나 admin 표면 권한이 없는 계정 — pub 표면에서 관측 가능).
 * 비인증은 anonymous.
 *
 * 향후 superadmin/admin/user/guest RBAC 확장 시 이 함수만 교체한다 — 소비처는
 * 열린 string 으로 취급 (LogContext.role 참조).
 */
function resolveLogRole(userId: string | undefined): string {
  if (!userId) return 'anonymous';
  if (isGuestUser(userId)) return 'guest';
  if (isAdminUserAllowed(userId)) return 'admin';
  return 'user';
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
      role: resolveLogRole(context.user?.id),
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
