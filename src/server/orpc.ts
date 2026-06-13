import { ORPCError, os } from '@orpc/server';

import { getTrustedClientIp } from '@/lib/rate-limit/client-ip';
import { getRateLimiter, type RateLimitGroup } from '@/lib/rate-limit/rate-limiter';

import type { ORPCContext } from './context';

/** 모든 procedure의 뿌리. 컨텍스트 타입만 박는다. */
export const base = os.$context<ORPCContext>();

/** 응답자(공개) 베이스 — 인증 불필요. */
export const pub = base;

/**
 * rate limit 미들웨어 팩토리. pub 프로시저에 .use(withRateLimit(group)) 로 부착한다.
 *
 * 키 = group + ':' + 신뢰 클라이언트 IP. 한도 초과 시 TOO_MANY_REQUESTS.
 * Upstash env 미설정이면 limiter 가 no-op(항상 통과)이라 가용성에 영향 없음.
 */
export function withRateLimit(group: RateLimitGroup) {
  return base.middleware(async ({ context, next }) => {
    const ip = getTrustedClientIp(context.headers ?? new Headers());
    const { success } = await getRateLimiter().limit(`${group}:${ip}`);
    if (!success) {
      throw new ORPCError('TOO_MANY_REQUESTS', {
        message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
      });
    }
    return next();
  });
}

/**
 * 관리자 베이스 — supabase 세션 필수.
 * 통과하면 context.user가 non-null로 좁혀진다.
 */
export const authed = base.use(({ context, next }) => {
  if (!context.user) {
    throw new ORPCError('UNAUTHORIZED', { message: '인증이 필요합니다.' });
  }
  return next({ context: { user: context.user } });
});
