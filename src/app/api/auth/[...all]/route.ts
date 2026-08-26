import { type NextRequest, NextResponse } from 'next/server';

import { toNextJsHandler } from 'better-auth/next-js';

import { auth } from '@/lib/auth/server';
import { runWithSessionRevocationMark } from '@/lib/auth/session-revocation';
import { withRouteLogging, type RouteLogContext } from '@/lib/logger';
import { getTrustedClientIpOrNull } from '@/lib/rate-limit/client-ip';
import { getRateLimiter } from '@/lib/rate-limit/rate-limiter';

const handlers = toNextJsHandler(auth);

/**
 * HTTP 로 열어두는 POST 경로 — 브라우저가 실제로 부르는 것만.
 *
 * catch-all 이라 허용목록이 없으면 Better Auth 의 **전 엔드포인트**가 열린다. 그러면 앱이
 * oRPC 에 세워둔 계약을 우회할 수 있다 — `update-user` 로 이름 길이·아바타 URL 검증
 * (assertOwnAvatarUrl)을 건너뛰고, `change-password` 로 `revokeOtherSessions:false` 를 보내
 * "다른 기기 로그아웃" 을 꺼버릴 수 있다.
 *
 * 서버가 쓰는 Better Auth 표면(`auth.api.changePassword` 등)은 이 라우트를 거치지 않고
 * 인스턴스를 직접 부르므로, 목록을 좁혀도 앱 동작은 그대로다. 프로필 변경의 유일한 문은
 * oRPC `account` 베이스다.
 */
const ALLOWED_POST_SUBPATHS = new Set(['sign-in/email', 'sign-out']);

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

  // 허용목록 밖은 존재를 알리지 않는다 — 어떤 엔드포인트가 살아 있는지 열거시키지 않는다.
  if (!ALLOWED_POST_SUBPATHS.has(subpath)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

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
  // 세션을 만드는 흐름은 폐기 표식 저장소 안에서 돈다 — 로그인 도중 슈퍼어드민이 재설정하면
  // 세션 생성이 취소된다(티켓 30). 저장소 밖이면 판정하지 않으므로 다른 경로는 영향이 없다.
  return runWithSessionRevocationMark(() => handlers.POST(request));
}

export const GET = withRouteLogging('/api/auth/[...all]', handleGet);
export const POST = withRouteLogging('/api/auth/[...all]', handlePost);
