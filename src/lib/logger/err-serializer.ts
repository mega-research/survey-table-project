import pino from 'pino';

/**
 * err 직렬화 안전망 — DrizzleQueryError 의 쿼리 바인딩 값 유출 차단.
 *
 * drizzle-orm 은 모든 쿼리 실패를 DrizzleQueryError 로 래핑하는데,
 * 1) message 가 `Failed query: ${query}\nparams: ${params}` 형태라 바인딩 값
 *    (응답 JSONB·컨택 attrs 등 PII)이 문자열에 보간되고 — redact 로는 못 막는다,
 * 2) query/params 가 enumerable own property 라 pino 기본 err serializer 가
 *    로그 객체에 그대로 복사하며,
 * 3) stack 첫 줄에도 message 가 포함된다.
 *
 * 그래서 표준 직렬화 후 결과 트리를 재귀 순회해 query/params 류 키를 제거하고
 * message/stack 의 params 보간 구간을 잘라낸다 (cause 체인 포함).
 */

const STRIP_KEYS = new Set(['query', 'params', 'parameters']);

/** message/stack 문자열에서 "params: ..." 보간 구간 제거 */
function stripParamsInterpolation(text: string): string {
  return text.replace(/\nparams:[\s\S]*$/, '\nparams: [Stripped]');
}

function scrub(node: unknown, depth: number): void {
  if (depth > 4 || node === null || typeof node !== 'object') return;
  const record = node as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (STRIP_KEYS.has(key)) {
      record[key] = '[Stripped]';
      continue;
    }
    if ((key === 'message' || key === 'stack') && typeof value === 'string') {
      record[key] = stripParamsInterpolation(value);
      continue;
    }
    scrub(value, depth + 1);
  }
}

/** pino serializers.err 용 — 표준 직렬화 + PII 스트립 */
export function serializeError(err: Error): pino.SerializedError {
  const serialized = pino.stdSerializers.err(err);
  scrub(serialized, 0);
  return serialized;
}
