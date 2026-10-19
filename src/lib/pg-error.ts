/**
 * Postgres 에러 판별 — drizzle-orm + postgres-js 가 던지는 에러 객체의 모양을 읽는다.
 *
 * 실행 환경(드라이버)이 정하는 모양이라 앱 도메인이 아니라 인프라다. 도메인 간 직접 import 가
 * 금지되어 있어 같은 판별이 서버 도메인마다 복제되기 쉬운 자리이기도 하다.
 */

/**
 * Postgres UNIQUE 위반 (SQLSTATE 23505) 감지.
 *
 * postgres-js 는 에러 객체에 `code` 를 싣지만, 래핑되거나 직렬화를 거치면 사라질 수 있어
 * message 문자열 폴백을 함께 둔다. `contact-attempts.service.ts` 의 file-private 헬퍼가
 * 원본이고, drizzle 이 감싼 에러를 위해 cause 를 따라가는 판정이 더해졌다.
 */
export function isUniqueViolation(e: unknown): boolean {
  if (e == null || typeof e !== 'object') return false;
  const err = e as { code?: unknown; message?: unknown; cause?: unknown };
  if (err.code === '23505') return true;
  if (typeof err.message === 'string') {
    if (err.message.includes('23505')) return true;
    if (err.message.toLowerCase().includes('unique')) return true;
  }
  // drizzle 은 드라이버 에러를 DrizzleQueryError("Failed query: …")로 감싸 cause 에 싣는다 —
  // 감싼 쪽 message 에는 SQLSTATE 도 제약 이름도 없어 cause 까지 내려가 봐야 한다.
  if (err.cause !== undefined && err.cause !== e) return isUniqueViolation(err.cause);
  return false;
}

/** drizzle 이 감싼 에러까지 내려가 Postgres SQLSTATE 를 읽는다. 없으면 null. */
function pgErrorCode(e: unknown): string | null {
  let cur: unknown = e;
  for (let depth = 0; depth < 5 && cur != null && typeof cur === 'object'; depth++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * 다시 실행하면 풀리는 트랜잭션 충돌 — 교착(40P01)과 직렬화 실패(40001).
 * Postgres 가 한쪽 트랜잭션을 통째로 되돌린 것이라 같은 작업을 처음부터 다시 돌려도 안전하다.
 */
export function isRetryableTxConflict(e: unknown): boolean {
  const code = pgErrorCode(e);
  return code === '40P01' || code === '40001';
}

/**
 * 트랜잭션 충돌이면 처음부터 다시 실행한다 (기본 3번까지, 짧은 무작위 대기).
 * run 은 트랜잭션 하나를 통째로 여는 함수여야 한다 — 다시 돌 때 조건도 그 시점 데이터로
 * 새로 계산되므로, 겹치는 대상에서는 나중에 끝난 쪽이 이긴다.
 */
export async function retryOnTxConflict<T>(
  run: () => Promise<T>,
  opts: { attempts?: number; onRetry?: (attempt: number, error: unknown) => void } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= attempts || !isRetryableTxConflict(error)) throw error;
      opts.onRetry?.(attempt, error);
      await new Promise((r) => setTimeout(r, 20 + Math.random() * 80 * attempt));
    }
  }
}
