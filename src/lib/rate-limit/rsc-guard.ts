import 'server-only';

import { headers } from 'next/headers';

import { getTrustedClientIpOrNull } from './client-ip';
import { isRateLimitedTwoTier, type RateLimitGroup } from './rate-limiter';

/**
 * RSC 라우트용 rate limit 판정 — 한도 초과면 true.
 *
 * 공개 진입 라우트가 서버에서 직접 조회를 마치면 그 조회는 procedure 를 지나지 않아
 * `withRateLimit` 이 세지 못한다. 같은 일을 하는 두 문 중 한쪽만 계측되면 계측이 없는
 * 쪽으로 그대로 걸어 들어갈 수 있다(2026-08-25 실측: `public-read` 버킷이 소진돼 잠긴
 * IP 가 같은 순간 `/i/<code>` 로는 60/60 통과). 이 함수가 그 문에 같은 버킷을 건다.
 *
 * **IP 추출 실패 시 정책이 procedure 와 반대다 — 여기는 fail-open 이다.**
 * `withRateLimit` 은 식별 불가 요청이 단일 'unknown' 버킷을 공유하며 서로의 한도를
 * 잠식하는 것을 막으려 fail-closed 지만, 이 라우트는 응답자가 설문에 들어오는 유일한
 * 입구다. 헤더가 없다는 이유로 막으면 정상 응답자가 링크를 열지 못한다 — 남용 방어보다
 * 진입 보장이 앞선다. (Vercel 표준 배포는 항상 신뢰 헤더를 채우므로 이 분기는 로컬·
 * 비표준 프록시에서만 도달한다.)
 *
 * clientId 는 null 이다. 진입 시점에는 sessionId/responseId 가 아직 없고, `public-read` 는
 * IP_WIDE_GROUPS 미등재라 키가 `group:ip` 단일 버킷이 된다 — 같은 조회를 RPC 로 하던
 * 때와 같은 버킷·같은 한도다.
 */
export async function isRscRateLimited(group: RateLimitGroup): Promise<boolean> {
  const ip = getTrustedClientIpOrNull(await headers());
  if (ip === null) return false;
  return isRateLimitedTwoTier(group, ip, null);
}
