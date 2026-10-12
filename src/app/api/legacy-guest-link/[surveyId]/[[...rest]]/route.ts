import { type NextRequest, NextResponse } from 'next/server';

import { getSessionCookie } from 'better-auth/cookies';

import {
  LEGACY_GUEST_GRANTS_ENV,
  legacyConsoleStaffPath,
  parseLegacyGuestSurveyIds,
} from '@/lib/auth/legacy-guest-link';
import { withRouteLogging, type RouteLogContext } from '@/lib/logger';
import { getAccessLink } from '@/server/workspace/services/access-links';

/**
 * 옛 게스트 주소의 다리 — `/admin/surveys/<id>/operations[/…]` 로 온 요청을 받는다.
 *
 * `next.config.ts` 의 리다이렉트가 옛 운영 콘솔 주소를 전부 여기로 보내고, 이 라우트가 둘 중
 * 하나로 다시 보낸다.
 *
 *  - **직원**(세션 쿠키가 있다) → `/surveys/<id>/operations/…` — 접두만 걷은 종전의 답.
 *    탭 없는 주소만 응답 현황으로 보낸다(그 주소 자체에는 페이지가 없다).
 *  - **옛 게스트**(세션이 없고, 옛 grant 에 오른 설문이고, 열린 외주 링크가 있다) → `/fw/<token>`.
 *  - 그 밖 → 직원과 같은 주소. 세션이 없으면 1차 게이트가 로그인으로 보낸다.
 *
 * 주소 하나를 직원과 외주가 함께 쓰던 것이 판정이 필요한 이유다. 가르는 것은 세션 쿠키의
 * **존재**뿐이고(1차 게이트와 같은 함수·같은 깊이), 유효성은 도착한 화면이 다시 본다.
 *
 * ## 무엇을 내주는가
 *
 * 인증 없이 열리는 라우트이고, 허용된 설문에 대해서는 **링크의 토큰**을 내준다. 토큰은 주소일
 * 뿐 자격이 아니다 — 그 뒤에 비밀번호 화면이 선다. 그래도 설문 id 만으로 토큰이 나오는 것은
 * 사실이라 대상을 옛 grant 목록으로 좁힌다: 목록 밖의 설문은 링크가 있어도 조회하지 않는다.
 * **이 다리가 서 있는 동안 그 설문들의 링크는 비밀번호 하나로 지켜진다.**
 *
 * 닫힌 링크(중단·종료)를 여기서 가르지 않는다 — `/fw/<token>` 의 입구가 닫힘 안내를 그린다.
 * 옛 주소로 온 업체가 로그인 화면보다 「지금은 닫혀 있다」를 보는 편이 맞다.
 */
async function handleLegacyGuestLink(
  request: NextRequest,
  ctx: RouteLogContext,
  { params }: { params: Promise<{ surveyId: string; rest?: string[] }> },
) {
  const { surveyId, rest = [] } = await params;
  ctx.bind({ surveyId });

  const staffUrl = new URL(legacyConsoleStaffPath(surveyId, rest), request.nextUrl.origin);
  staffUrl.search = request.nextUrl.search;

  if (getSessionCookie(request)) return redirectTo(ctx, staffUrl, 'staff');

  const granted = parseLegacyGuestSurveyIds(process.env[LEGACY_GUEST_GRANTS_ENV]);
  const normalizedId = surveyId.toLowerCase();
  if (!granted.has(normalizedId)) return redirectTo(ctx, staffUrl, 'not_granted');

  const link = await getAccessLink(normalizedId, 'fieldwork');
  if (!link) return redirectTo(ctx, staffUrl, 'no_link');

  return redirectTo(ctx, new URL(`/fw/${link.token}`, request.nextUrl.origin), 'link');
}

/**
 * 임시 리다이렉트(307) + `no-store`.
 *
 * 영구(308)로 주면 브라우저가 답을 기억해, 다리를 걷거나 링크를 다시 발급한 뒤에도 옛
 * 목적지로 간다. 같은 주소의 답이 방문자(직원·외주)에 따라 갈리는 것도 캐시하면 안 되는 이유다.
 */
function redirectTo(ctx: RouteLogContext, url: URL, outcome: string): NextResponse {
  ctx.bind({ outcome });
  const response = NextResponse.redirect(url, 307);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export const GET = withRouteLogging(
  '/api/legacy-guest-link/[surveyId]/[[...rest]]',
  handleLegacyGuestLink,
  { errorMessage: '주소를 옮기는 중 오류가 발생했습니다.' },
);
