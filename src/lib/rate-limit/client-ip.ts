/**
 * 신뢰 클라이언트 IP 추출.
 *
 * x-forwarded-for 는 프록시 체인을 거치며 "client, proxy1, proxy2" 형태로 쌓인다.
 * 최좌측 토큰이 실제 클라이언트(원 발신자)이므로 그 값을 신뢰 추출한다.
 * 부재 시 x-real-ip 로 폴백하고, 둘 다 없으면 'unknown'.
 *
 * 주의: 신뢰 경계는 우리 인프라(프록시/엣지)가 x-forwarded-for 를 올바르게
 * 세팅한다는 전제에 의존한다. rate limit 키와 중복 감지 IP 해시의 공통 진입점.
 */
export function getTrustedClientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    // 최좌측 토큰 = 실제 클라이언트. 콤마 분리 후 트림.
    const first = forwarded.split(',')[0]?.trim();
    if (first) {
      return first;
    }
  }

  const realIp = headers.get('x-real-ip')?.trim();
  if (realIp) {
    return realIp;
  }

  return 'unknown';
}
