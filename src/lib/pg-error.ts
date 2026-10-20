/**
 * Postgres 에러 판별 — drizzle-orm + postgres-js 가 던지는 에러 객체의 모양을 읽는다.
 *
 * 실행 환경(드라이버)이 정하는 모양이라 앱 도메인이 아니라 인프라다. 도메인 간 직접 import 가
 * 금지되어 있어 같은 판별이 서버 도메인마다 복제되기 쉬운 자리이기도 하다.
 */

/** cause 사슬을 따라갈 최대 깊이 — 순환 cause 에 갇히지 않기 위한 상한. */
const MAX_CAUSE_DEPTH = 5;

/**
 * 메시지 폴백에서 UNIQUE 위반으로 인정할 문구 — **Postgres 자신의 표현만** 본다.
 *
 * 예전에는 `unique` 한 단어만 있어도 참이었다. cause 사슬을 따라가게 되면서 drizzle 이
 * 붙이는 `Failed query: <SQL 원문>` 메시지까지 검사 대상이 됐고, 그 안에는 인덱스·컬럼 이름이
 * 그대로 실린다 — `unique` 가 이름에 들어간 스키마에서는 아무 에러나 UNIQUE 위반으로 읽힌다.
 */
const UNIQUE_VIOLATION_PHRASES = ['23505', 'duplicate key', 'unique constraint'];

function matchesUniqueViolation(e: unknown, depth: number): boolean {
  if (e == null || typeof e !== 'object') return false;
  const err = e as { code?: unknown; message?: unknown; cause?: unknown };
  if (err.code === '23505') return true;
  if (typeof err.message === 'string') {
    const message = err.message.toLowerCase();
    if (UNIQUE_VIOLATION_PHRASES.some((phrase) => message.includes(phrase))) return true;
  }
  if (depth < MAX_CAUSE_DEPTH && err.cause != null) {
    return matchesUniqueViolation(err.cause, depth + 1);
  }
  return false;
}

/**
 * Postgres UNIQUE 위반 (SQLSTATE 23505) 감지.
 *
 * postgres-js 는 에러 객체에 `code` 를 싣지만, 래핑되거나 직렬화를 거치면 사라질 수 있어
 * message 문자열 폴백을 함께 둔다. `contact-attempts.service.ts` 의 file-private 헬퍼가 원본이다.
 *
 * **cause 사슬을 따라간다.** drizzle 은 쿼리 실패를 `Failed query: ...` 메시지의 평범한
 * Error 로 감싸고 원본 PostgresError 를 `cause` 에 넣는다 — 겉면만 보면 code 도 없고
 * 메시지에 SQLSTATE 도 없어 UNIQUE 위반이 조용히 500 이 된다(2026-08-26 티켓 06 에서
 * teams 이름 중복이 실제로 그렇게 샜다).
 */
export function isUniqueViolation(e: unknown): boolean {
  return matchesUniqueViolation(e, 0);
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
