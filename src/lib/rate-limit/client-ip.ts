/**
 * 신뢰 클라이언트 IP 추출.
 *
 * 신뢰 경계: 클라이언트가 직접 위조할 수 있는 헤더와, 플랫폼/프록시가 덮어써서
 * 위조 불가한 헤더를 구분한다.
 *
 * 우선순위(신뢰 높은 순):
 *  1. x-vercel-forwarded-for — Vercel 이 엣지에서 실제 클라 IP 로 덮어쓰는 단일 값.
 *     클라이언트가 주입해도 Vercel 이 덮어쓰므로 위조 불가.
 *  2. x-real-ip — 리버스 프록시(nginx 등)가 단일 값으로 세팅하는 실제 클라 IP.
 *  3. x-forwarded-for 최좌측 토큰 — 다중 홉 누적 헤더라 클라이언트가 좌측 토큰을
 *     위조 주입할 수 있다. 위 두 헤더가 모두 없을 때의 최후 폴백으로만 쓴다.
 *
 * 1·2 를 3 보다 먼저 보는 이유: Vercel 표준 배포에서는 항상 1 또는 2 가 존재하므로
 * 위조 가능한 3 에 도달하지 않는다. 비-Vercel/프록시 앞단 토폴로지로 옮겨도 단일 값
 * 신뢰 헤더가 있으면 그것을 우선해 leftmost-token 위조로 rate limit 키를 분산시키는
 * 공격을 차단한다. 신뢰 헤더가 전혀 없는 환경에서만 3 의 위조 위험에 노출된다.
 *
 * rate limit 키와 중복 감지 IP 해시의 공통 진입점.
 */

/** 신뢰 추출 실패(헤더 부재)를 나타내는 센티넬. */
export const UNKNOWN_CLIENT_IP = 'unknown';

/**
 * 신뢰 클라이언트 IP 를 추출한다. 추출 불가 시 null 을 반환한다.
 * 호출부가 null 정책(fail-closed / 해시 생략 등)을 직접 결정하게 한다.
 */
export function getTrustedClientIpOrNull(headers: Headers): string | null {
  // 1. Vercel 엣지가 덮어쓰는 단일 값(위조 불가).
  const vercelForwarded = headers.get('x-vercel-forwarded-for')?.trim();
  if (vercelForwarded) {
    return vercelForwarded;
  }

  // 2. 프록시가 세팅하는 단일 값.
  const realIp = headers.get('x-real-ip')?.trim();
  if (realIp) {
    return realIp;
  }

  // 3. 최후 폴백 — 다중 홉 누적 헤더. 최좌측 토큰이 원 발신자이나 클라가 위조 가능.
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) {
      return first;
    }
  }

  return null;
}

/**
 * 신뢰 클라이언트 IP 를 추출한다. 추출 불가 시 'unknown' 센티넬을 반환한다.
 * 문자열 키가 필요한 경로용 래퍼.
 */
export function getTrustedClientIp(headers: Headers): string {
  return getTrustedClientIpOrNull(headers) ?? UNKNOWN_CLIENT_IP;
}
