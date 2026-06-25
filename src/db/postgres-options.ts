export const DATABASE_STATEMENT_TIMEOUT_MS = 30_000;
export const DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS = 30_000;
export const DATABASE_LOCK_TIMEOUT_MS = 10_000;

type RuntimeEnvironment = 'production' | 'development' | 'test' | string | undefined;

export function createPostgresOptions(nodeEnv: RuntimeEnvironment = process.env.NODE_ENV) {
  return {
    // Supabase Transaction pooler(6543, pgBouncer) 사용 → prepare: false 필수.
    prepare: false,
    // Vercel 서버리스 인스턴스 하나는 여러 요청을 동시에 처리한다.
    // max:1 은 동시 요청을 직렬화해 pool 대기만으로 300초 timeout 을 만들 수 있다.
    max: nodeEnv === 'production' ? 5 : 10,
    idle_timeout: 20,
    connect_timeout: 10,
    max_lifetime: 60 * 30,
    connection: {
      // Vercel 300초 timeout 전에 DB가 명시적으로 실패하게 만들어 Sentry/oRPC 경로로 관측한다.
      statement_timeout: DATABASE_STATEMENT_TIMEOUT_MS,
      idle_in_transaction_session_timeout: DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS,
      lock_timeout: DATABASE_LOCK_TIMEOUT_MS,
    },
  };
}
