import { type NextRequest, NextResponse } from 'next/server';

import { toNextJsHandler } from 'better-auth/next-js';

import { auth } from '@/lib/auth/server';
import { withRouteLogging, type RouteLogContext } from '@/lib/logger';
import { getTrustedClientIpOrNull } from '@/lib/rate-limit/client-ip';
import { getRateLimiter } from '@/lib/rate-limit/rate-limiter';

const handlers = toNextJsHandler(auth);

/**
 * rate limit 을 적용할 민감 경로. 로그인이 본체다 — sign-up 은 disableSignUp 으로,
 * 비밀번호 재설정 요청은 sendResetPassword 미구성으로 이미 막혀 있지만(ADR-0018),
 * 어느 쪽이든 크리덴셜·계정 존재를 탐침하는 표면이라 belt-and-suspenders 로 함께 제한한다.
 */
const SENSITIVE_SUBPATHS = new Set([
  'sign-in/email',
  'sign-up/email',
  'request-password-reset',
  'forget-password',
]);

function subpathOf(request: NextRequest): string {
  return request.nextUrl.pathname.replace(/^\/api\/auth\//, '');
}

async function handleGet(request: NextRequest, ctx: RouteLogContext): Promise<Response> {
  ctx.bind({ authPath: subpathOf(request) });
  return handlers.GET(request);
}

/**
 * POST 는 민감 경로에 한해 IP 기준 rate limit 을 선적용한 뒤 Better Auth 에 위임.
 * 신뢰 IP 를 못 얻으면(로컬 환경 등) 제한 없이 통과 — 공유 버킷 오염을 만들지 않기
 * 위해 건너뛴다. Vercel 배포에서는 신뢰 헤더가 항상 채워진다.
 * limiter 호출 실패는 fail-open (oRPC isRateLimited 와 동일 정책).
 */
async function handlePost(request: NextRequest, ctx: RouteLogContext): Promise<Response> {
  const subpath = subpathOf(request);
  ctx.bind({ authPath: subpath });
  if (SENSITIVE_SUBPATHS.has(subpath)) {
    const ip = getTrustedClientIpOrNull(request.headers);
    if (ip !== null) {
      try {
        const { success } = await getRateLimiter().limit(`auth-sensitive:${ip}`);
        if (!success) {
          return NextResponse.json(
            { error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' },
            { status: 429 },
          );
        }
      } catch (err) {
        ctx.log.error({ err }, '[rate-limit] auth-sensitive limiter 호출 실패 — fail-open 통과');
      }
    }
  }
  return handlers.POST(request);
}

export const GET = withRouteLogging('/api/auth/[...all]', handleGet);
export const POST = withRouteLogging('/api/auth/[...all]', handlePost);
