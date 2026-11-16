import { type NextRequest, NextResponse } from 'next/server';

import { getSessionCookie } from 'better-auth/cookies';

import { readFieldworkLinkSessions } from '@/lib/auth/access-link-session';
import {
  isLegacyBridgeSurvey,
  legacyBridgePasswordPath,
  legacyConsoleStaffPath,
} from '@/lib/auth/legacy-guest-link';
import { withRouteLogging, type RouteLogContext } from '@/lib/logger';
import { resolveLinkActorForSurvey } from '@/server/access-link';
import {
  hasEverIssuedAccessLink,
  listAccessLinks,
} from '@/server/workspace/services/access-links';

/**
 * 옛 게스트 주소의 다리 — `/admin/surveys/<id>/operations[/…]` 로 온 요청을 받는다.
 *
 * `next.config.ts` 의 리다이렉트가 옛 운영 콘솔 주소를 전부 여기로 보내고, 이 라우트가 다시 보낸다.
 *
 *  - **직원**(세션 쿠키가 있다) → `/surveys/<id>/operations/…` — 접두만 걷은 종전의 답.
 *  - **옛 게스트**(세션이 없고, 옛 grant 에 오른 설문이고, 열린 외주 링크가 있다) → 링크가 하나면
 *    `/fw/<token>`, 여럿이면 이 브라우저의 세션이 고른 링크 또는 다리 비밀번호 화면(아래).
 *  - **보기 전용이던 옛 게스트**(고객사 — 같은 조건인데 그 설문에 외주 링크가 **발급된 적이 없고**
 *    클라이언트 링크가 열려 있다) → `/client/<token>`. 그 자리는 클라이언트 링크가 이어받았다(ADR-0029).
 *  - 그 밖 → 직원과 같은 주소. 세션이 없으면 1차 게이트가 로그인으로 보낸다.
 *
 * **외주 링크가 한 번이라도 발급된 설문은 클라이언트 링크로 보내지 않는다 — 종료된 뒤에도.** 그 설문의
 * 옛 주소는 외주 업체도 쓰던 주소라, 외주 링크를 종료한 뒤 이 주소가 클라이언트 링크를 내주면 종료된
 * 업체가 고객 화면의 입구를 받는다(두 링크의 비밀번호가 같으면 그대로 들어간다 — 2026-11-16 적대적 리뷰).
 * 한 설문에 외주와 고객사가 함께 있던 경우 주소만으로는 누구인지 알 수 없고 외주 쪽이 종전 동작이다 —
 * 그 설문의 고객사는 새 주소를 따로 받아야 한다. 이때 **두 링크의 비밀번호가 같으면 고객사가 외주
 * 입구에서 그 비밀번호로 외주 콘솔에 들어간다** — 그런 설문은 비밀번호를 다르게 발급한다.
 *
 * 주소 하나를 직원과 외주가 함께 쓰던 것이 판정이 필요한 이유다. 가르는 것은 세션 쿠키의
 * **존재**뿐이고(1차 게이트와 같은 함수·같은 깊이), 유효성은 도착한 화면이 다시 본다.
 *
 * ## 무엇을 내주는가
 *
 * 인증 없이 열리는 라우트이고, 허용된 설문에 대해서는 **링크의 토큰**(외주, 없으면 클라이언트)을 내준다. 토큰은 주소일
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

  const normalizedId = surveyId.toLowerCase();
  if (!isLegacyBridgeSurvey(normalizedId)) return redirectTo(ctx, staffUrl, 'not_granted');

  const links = await listAccessLinks(normalizedId, 'fieldwork');
  if (links.length === 0) {
    // 외주 링크가 있었던 설문이면 여기서 끝난다 — 종료된 업체의 북마크에 클라이언트 링크를 내주지 않는다.
    if (await hasEverIssuedAccessLink(normalizedId, 'fieldwork')) {
      return redirectTo(ctx, staffUrl, 'no_link');
    }
    // 열린 클라이언트 링크는 설문당 하나뿐이다(부분 UNIQUE) — 고를 것이 없다.
    const [clientLink] = await listAccessLinks(normalizedId, 'client');
    if (!clientLink) return redirectTo(ctx, staffUrl, 'no_link');
    return redirectTo(
      ctx,
      new URL(`/client/${clientLink.token}`, request.nextUrl.origin),
      'client_link',
    );
  }
  const linkEntry = (token: string) => new URL(`/fw/${token}`, request.nextUrl.origin);
  if (links.length === 1) return redirectTo(ctx, linkEntry(links[0]!.token), 'link');

  // 외주 링크가 여럿이면 주소만으로는 어느 업체의 링크인지 정할 수 없다(fieldwork-multi-company
  // 티켓 10). 아무 링크로나 보내면 남의 업체 주소를 내주므로 **이 브라우저가 든 세션**으로 고른다 —
  // RPC 의 주체 판정(`resolveLinkActorForSurvey`)과 같은 함수라 「유효한 세션이 정확히 하나」의
  // 뜻(서명 + 비밀번호 변경 시각 대조 + 닫힘)이 두 자리에서 갈리지 않는다.
  const chosen = await resolveLinkActorForSurvey(
    readFieldworkLinkSessions(request.headers),
    normalizedId,
  );
  const chosenLink =
    chosen.kind === 'ok' ? links.find((link) => link.id === chosen.actor.linkId) : undefined;
  if (chosenLink) return redirectTo(ctx, linkEntry(chosenLink.token), 'link_by_session');

  // 세션이 없거나 둘 이상 살아 있거나 끊겼으면 비밀번호로 고른다 — 다리 전용 화면이고, 업체
  // 목록·이름표·조사 이름을 그리지 않는다(`app/fw/legacy/[surveyId]`).
  return redirectTo(
    ctx,
    new URL(legacyBridgePasswordPath(normalizedId), request.nextUrl.origin),
    'password',
  );
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
