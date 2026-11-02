import type { ErrorEvent, EventHint } from '@sentry/nextjs';

import { findPostgresError } from '@/lib/pg-error';

import { scrubQueryParams, stripParamsInterpolation } from './query-params-scrub';

/**
 * 서버 Sentry `beforeSend` — DB 쿼리 바인딩 값을 송신 직전에 지운다.
 *
 * `sendDefaultPii:false` 는 요청 쿠키·헤더·IP 만 막는다. DrizzleQueryError 의 message 에
 * 보간된 바인딩 값(응답 JSONB·명단 값·검색어)은 예외 value 로 그대로 나간다. 규칙은 pino err
 * 직렬화와 같은 `query-params-scrub` 한 정의를 쓴다.
 *
 * 지운 뒤에도 원인은 바로 보여야 한다 — SQL 문장(`$n` 포함)·바인딩 개수·원인 PostgresError 의
 * 타입·메시지·스택은 그대로 두고, 이벤트에 원래 없던 SQLSTATE 를 `pg_code` 태그와 `postgres`
 * 컨텍스트로 더한다.
 */

/**
 * PostgresError 에서 Sentry 로 옮기는 필드 — 스키마 식별자와 서버 위치뿐이다.
 * detail·where·hint·internal_query 는 값(중복 키 `(email)=(…)` 등)을 담을 수 있어 옮기지 않는다.
 */
const PG_CONTEXT_FIELDS = [
  'code',
  'severity',
  'routine',
  'position',
  'schema_name',
  'table_name',
  'column_name',
  'constraint_name',
  'data_type_name',
] as const;

function pickPgContext(pg: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of PG_CONTEXT_FIELDS) {
    const value = pg[field];
    if (typeof value === 'string' || typeof value === 'number') out[field] = String(value);
  }
  return out;
}

export function scrubSentryEvent(event: ErrorEvent, hint: EventHint): ErrorEvent {
  const source = hint.originalException;
  for (const ex of event.exception?.values ?? []) {
    if (typeof ex.value === 'string') ex.value = stripParamsInterpolation(ex.value, source);
  }
  if (typeof event.message === 'string') event.message = stripParamsInterpolation(event.message, source);
  scrubQueryParams(event.logentry, source);
  scrubQueryParams(event.breadcrumbs, source);
  scrubQueryParams(event.extra, source);
  scrubQueryParams(event.contexts, source);

  const pg = findPostgresError(source);
  if (pg) {
    event.tags = { ...event.tags, pg_code: pg.code };
    event.contexts = { ...event.contexts, postgres: pickPgContext(pg) };
  }
  return event;
}
