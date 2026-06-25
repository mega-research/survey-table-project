import * as Sentry from '@sentry/nextjs';

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
