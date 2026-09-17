const DEFAULT_REDIRECT = '/admin/surveys';

// 브라우저 URL 파서는 탭·개행·CR 등 제어 문자를 제거한 뒤 URL 을 해석하므로,
// "/\t/evil.com" 같은 값이 "//" 검사를 통과하고도 실제로는 "//evil.com"(프로토콜 상대 URL,
// 외부 도메인)으로 정규화될 수 있다. 제어 문자가 섞인 값은 무조건 차단한다.
const CONTROL_CHARS_RE = /[\x00-\x1f]/;

/**
 * open redirect 방지 — 같은 출처 내부 절대경로만 통과, 그 외 null.
 *
 * 외부 URL('https://…')·프로토콜 상대('//evil')·백슬래시 우회('/\\evil')·제어 문자를 막는다.
 * 반환이 null 이면 "쓸 수 없는 값" 이라는 뜻이라, 파라미터를 아예 붙이지 않는 자리
 * (강제 로그아웃 라우트)가 쓴다.
 */
export function sanitizeInternalPath(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  if (CONTROL_CHARS_RE.test(raw)) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null;
  return raw;
}

/**
 * 로그인 후 이동할 경로를 안전하게 결정한다.
 *
 * sanitizeInternalPath 와 같은 규칙을 쓰되, 목적지는 반드시 있어야 하므로 거부된 값과
 * 루트("/")·로그인 페이지를 기본 경로로 대체한다.
 * (구 actions/auth-actions.ts 의 resolveRedirect 를 클라이언트 공용으로 이관)
 */
export function sanitizeRedirectPath(raw: string | null | undefined): string {
  const path = sanitizeInternalPath(raw);
  if (path === null) return DEFAULT_REDIRECT;
  const pathname = path.split(/[?#]/)[0];
  if (pathname === '/' || pathname === '/admin/login') return DEFAULT_REDIRECT;
  return path;
}
