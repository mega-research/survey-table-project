import pino from 'pino';

import { scrubQueryParams } from './query-params-scrub';

/**
 * err 직렬화 안전망 — DrizzleQueryError 의 쿼리 바인딩 값 유출 차단.
 *
 * 표준 직렬화 후 결과 트리(cause 체인 포함)를 `query-params-scrub` 규칙으로 훑는다.
 * Sentry beforeSend(`sentry-before-send`)가 같은 규칙을 쓴다 — 무엇을 지우는지는 그 파일 머리 참조.
 */

/** pino serializers.err 용 — 표준 직렬화 + PII 스트립 */
export function serializeError(err: Error): pino.SerializedError {
  const serialized = pino.stdSerializers.err(err);
  scrubQueryParams(serialized, err);
  return serialized;
}
