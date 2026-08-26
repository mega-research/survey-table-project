/**
 * Postgres 에러 판별 — drizzle-orm + postgres-js 가 던지는 에러 객체의 모양을 읽는다.
 *
 * 실행 환경(드라이버)이 정하는 모양이라 앱 도메인이 아니라 인프라다. 도메인 간 직접 import 가
 * 금지되어 있어 같은 판별이 서버 도메인마다 복제되기 쉬운 자리이기도 하다.
 */

/** cause 사슬을 따라갈 최대 깊이 — 순환 cause 에 갇히지 않기 위한 상한. */
const MAX_CAUSE_DEPTH = 5;

/**
 * Postgres UNIQUE 위반 (SQLSTATE 23505) 감지.
 *
 * postgres-js 는 에러 객체에 `code` 를 싣지만, 래핑되거나 직렬화를 거치면 사라질 수 있어
 * message 문자열 폴백을 함께 둔다. `contact-attempts.service.ts` 의 file-private 헬퍼가
 * 원본이다.
 *
 * **cause 사슬을 따라간다.** drizzle 은 쿼리 실패를 `Failed query: ...` 메시지의 평범한
 * Error 로 감싸고 원본 PostgresError 를 `cause` 에 넣는다 — 겉면만 보면 code 도 없고
 * 메시지에 SQLSTATE 도 없어 UNIQUE 위반이 조용히 500 이 된다(2026-08-26 티켓 06 에서
 * teams 이름 중복이 실제로 그렇게 샜다).
 */
export function isUniqueViolation(e: unknown, depth = 0): boolean {
  if (e == null || typeof e !== 'object') return false;
  const err = e as { code?: unknown; message?: unknown; cause?: unknown };
  if (err.code === '23505') return true;
  if (typeof err.message === 'string') {
    if (err.message.includes('23505')) return true;
    if (err.message.toLowerCase().includes('unique')) return true;
  }
  if (depth < MAX_CAUSE_DEPTH && err.cause != null) {
    return isUniqueViolation(err.cause, depth + 1);
  }
  return false;
}
