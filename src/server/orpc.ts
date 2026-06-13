import { ORPCError, os } from '@orpc/server';

import { getTrustedClientIpOrNull } from '@/lib/rate-limit/client-ip';
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
 *
 * 신뢰 IP 추출 불가(헤더 부재)면 fail-closed 로 거부한다. 식별 불가한 익명 요청들이
 * 단일 'unknown' 버킷을 공유하면 상호 한도 잠식/약 DoS 가 되므로, 공유 버킷 대신
 * 차단한다(Vercel 표준 배포는 항상 신뢰 헤더가 채워져 이 경로에 도달하지 않음).
 */
export function withRateLimit(group: RateLimitGroup) {
  return base.middleware(async ({ context, next }) => {
    const ip = getTrustedClientIpOrNull(context.headers ?? new Headers());
    if (ip === null) {
      throw new ORPCError('TOO_MANY_REQUESTS', {
        message: '요청을 식별할 수 없습니다. 잠시 후 다시 시도해 주세요.',
      });
    }
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
