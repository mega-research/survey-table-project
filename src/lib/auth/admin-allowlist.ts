/**
 * 관리자 allowlist 런타임 가드.
 *
 * authed 미들웨어가 세션 검사(context.user non-null) 통과 후 사용한다.
 * supabase 세션만으로는 임의 가입 계정도 인증 상태가 되므로, 실제 운영자
 * user.id 만 admin 표면에 닿게 하려면 환경별 allowlist 로 한 번 더 거른다.
 *
 * 가용성 우선: ADMIN_USER_IDS 가 미설정/빈 값이면 fail-open(통과)으로 현행
 * 동작을 보존하고, 최초 1회만 경고를 출력한다.
 */

const ENV_KEY = 'ADMIN_USER_IDS';

/**
 * 콤마 분리 raw 문자열을 user.id Set 으로 파싱한다.
 * 각 항목은 trim 하고, 빈 항목은 제거한다. 미설정/빈 값이면 빈 Set.
 */
export function parseAdminAllowlist(raw?: string): Set<string> {
  if (!raw) return new Set();
  const ids = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return new Set(ids);
}

let warnedEmpty = false;

/**
 * 주어진 user.id 가 admin allowlist 에 포함되는지 검사한다.
 *
 * - ADMIN_USER_IDS 미설정/빈 값: fail-open(true) + 최초 1회 console.warn.
 * - 설정됨: Set 멤버십 결과(true/false)를 반환한다.
 */
export function isAdminUserAllowed(userId: string): boolean {
  const allowlist = parseAdminAllowlist(process.env[ENV_KEY]);
  if (allowlist.size === 0) {
    if (!warnedEmpty) {
      warnedEmpty = true;
      console.warn('ADMIN_USER_IDS 미설정 — admin allowlist 가드 비활성');
    }
    return true;
  }
  return allowlist.has(userId);
}

/**
 * 테스트 전용 — 최초 1회 경고 플래그를 초기화한다.
 */
export function resetAdminAllowlistWarningForTest(): void {
  warnedEmpty = false;
}
