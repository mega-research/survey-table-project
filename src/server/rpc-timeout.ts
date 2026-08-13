import * as Sentry from '@sentry/nextjs';

/**
 * duration 계측 중복 정리 방침 (2026-08-06, logging-pino):
 * base 로깅 미들웨어(rpc-logging.ts)가 전 RPC 에 durationMs 를 기록하므로 사후
 * 분석은 pino 로그로 충분하다. 이 Slow RPC 경고는 완료를 기다리지 않고 임계 초과
 * "시점"에 즉시 Sentry 로 알리는 타이머라 성격이 다르며, request 단위(procedure
 * 경로는 URL 로만 추정)라는 점도 다르다. durationMs 기반 알림(Axiom 등)이 구성되면
 * 이 Sentry 경고는 제거 후보다 — 제거는 별도 작업으로 한다.
 */
export const RPC_SLOW_REQUEST_WARNING_MS = 10_000;

export function scheduleSlowRpcWarning(
  request: Request,
  timeoutMs = RPC_SLOW_REQUEST_WARNING_MS,
) {
  const startedAt = Date.now();
  const timer = setTimeout(() => {
    const path = getRequestPath(request.url);

    Sentry.captureMessage('Slow RPC request', {
      level: 'warning',
      tags: {
        operation: 'rpc_slow_request',
        method: request.method,
        path,
      },
      extra: {
        elapsedMs: Date.now() - startedAt,
        timeoutMs,
        url: request.url,
      },
    });
  }, timeoutMs);

  return () => clearTimeout(timer);
}

function getRequestPath(url: string) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
