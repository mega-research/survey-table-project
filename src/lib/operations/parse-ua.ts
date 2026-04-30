/**
 * UA 파서 유틸리티 — 외부 라이브러리 없이 정규식으로 플랫폼·브라우저 분류
 *
 * tablet 감지 한계 (의도적):
 *   iOS 13+ iPad는 기본적으로 "Request Desktop Site"가 켜져 있어
 *   Mac UA를 보내므로 여기서는 tablet으로 잡히지 않는다.
 *   현재는 legacy iPad UA 문자열 및 "Tablet" 키워드만 감지한다.
 *   slice 2 이후에 더 정교한 감지가 필요하다면 추가 시그널을 고려할 것.
 */

export type Platform = 'desktop' | 'mobile' | 'tablet'
export type Browser = 'Chrome' | 'Firefox' | 'Safari' | 'Edge' | 'Other'

export function parsePlatform(ua: string | null | undefined): Platform {
  if (!ua) return 'desktop'
  if (/iPad|Tablet/i.test(ua)) return 'tablet'
  if (/Mobile|Android|iPhone/i.test(ua)) return 'mobile'
  return 'desktop'
}

export function parseBrowser(ua: string | null | undefined): Browser {
  if (!ua) return 'Other'
  // 순서가 중요:
  //   Edge UA에는 "Chrome"이 포함되고, Chrome UA에는 "Safari"가 포함되므로
  //   더 구체적인 패턴을 먼저 검사한다.
  if (/Edg\//i.test(ua)) return 'Edge'
  if (/Firefox\//i.test(ua)) return 'Firefox'
  if (/Chrome\//i.test(ua)) return 'Chrome'
  if (/Safari\//i.test(ua)) return 'Safari'
  return 'Other'
}

/**
 * Platform enum → 운영 콘솔 표시용 한국어 라벨.
 * null / 미식별은 "—" 로 fallback.
 */
export function formatPlatformKo(platform: Platform | null | undefined): string {
  if (!platform) return '—'
  switch (platform) {
    case 'desktop': return 'PC'
    case 'mobile': return '모바일'
    case 'tablet': return '태블릿'
    default: return '—'
  }
}
