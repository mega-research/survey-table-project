const DEFAULT_REDIRECT = '/admin/surveys';

// 브라우저 URL 파서는 탭·개행·CR 등 제어 문자를 제거한 뒤 URL 을 해석하므로,
// "/\t/evil.com" 같은 값이 "//" 검사를 통과하고도 실제로는 "//evil.com"(프로토콜 상대 URL,
// 외부 도메인)으로 정규화될 수 있다. 제어 문자가 섞인 값은 무조건 차단한다.
const CONTROL_CHARS_RE = /[\x00-\x1f]/;

/**
 * 로그인 후 이동할 경로를 안전하게 결정한다.
 *
 * open redirect 방지를 위해 같은 출처의 내부 절대경로만 허용하고,
 * 루트("/")·로그인 페이지는 기본 경로로 대체한다.
 * (구 actions/auth-actions.ts 의 resolveRedirect 를 클라이언트 공용으로 이관)
 */
export function sanitizeRedirectPath(raw: string | null | undefined): string {
  if (typeof raw !== 'string' || raw.length === 0) return DEFAULT_REDIRECT;
  if (CONTROL_CHARS_RE.test(raw)) return DEFAULT_REDIRECT;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) {
    return DEFAULT_REDIRECT;
  }
  const path = raw.split(/[?#]/)[0];
  if (path === '/' || path === '/admin/login') return DEFAULT_REDIRECT;
  return raw;
}
