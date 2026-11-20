import { saltedHash } from '@/lib/duplicate-detection/salted-hash.server';
import { getTrustedClientIpOrNull } from '@/lib/rate-limit/client-ip';

import type { ClientSignals, ServerSignals } from '@/lib/duplicate-detection/types';

// 솔트 검증과 해시 식은 `lib/duplicate-detection/salted-hash.server` 가 쥔다 — 메일 링크 클릭의 IP 해시와
// 같은 식이어야 나중에 맞춰 볼 수 있다. 솔트가 없으면 그 모듈이 import 시점에 던진다.

/**
 * 헤더에서 IP 를 추출한다. rate limit 과 동일한 신뢰 추출 경로(getTrustedClientIpOrNull)를 공유한다.
 * 추출 불가면 null 을 반환해 ipHash 를 만들지 않는다(IP 신호 부재). 위조 가능한 leftmost
 * x-forwarded-for 보다 위조 불가한 단일 값 헤더(x-vercel-forwarded-for/x-real-ip)를 우선한다.
 */
export function extractIp(h: Headers): string | null {
  return getTrustedClientIpOrNull(h);
}

export function computeSignals(h: Headers, client: ClientSignals): ServerSignals {
  const ip = extractIp(h);
  const ua = h.get('user-agent') ?? '';

  // deviceId/UA/screen 등 클라이언트 핑거프린트는 soft anti-abuse 신호일 뿐이다.
  // 클라이언트가 위조/초기화할 수 있으므로(시크릿 모드, storage 차단, UA 스푸핑)
  // 하드 차단의 근거로 삼지 않고, 서버 신호(ipHash)와 병행하는 보조 지표로만 쓴다.

  const fpInput = [
    ua,
    client.screen,
    client.tz,
    client.lang,
    client.platform,
  ].join('|');

  return {
    // 종전 식 그대로(다듬지 않는다) — 이미 저장된 해시와 같은 값이 나와야 한다.
    ipHash: ip ? saltedHash(ip) : null,
    fpHash: saltedHash(fpInput),
    deviceId: client.deviceId,
  };
}
