import { isDefinedError, ORPCError } from '@orpc/server';

/**
 * RPC 에러 노출 정책.
 *
 * oRPC 의 toORPCError 는 ORPCError 가 아닌 모든 예외를 code=INTERNAL_SERVER_ERROR,
 * message='Internal server error' 로 갈아끼우고 원본은 cause 에만 남긴다. cause 는
 * 직렬화되지 않으므로 클라이언트는 원인을 알 수 없다.
 *
 * 운영에서는 그 마스킹이 맞다(스택·내부 메시지 유출 방지). dev 에서는 정반대로,
 * 마스킹 때문에 500 의 원인을 서버 터미널 없이는 볼 수 없어 디버깅 비용이 크다.
 */

/**
 * Sentry/콘솔 캡처 대상인지.
 * typed domain error(defined)는 클라이언트가 isDefinedError 로 처리하는 정상 경로라 제외한다.
 */
export function isUnexpectedRpcError(error: unknown): boolean {
  return !isDefinedError(error);
}

/** 에러의 사람이 읽을 수 있는 요약. name 을 붙여 어떤 예외인지 바로 드러낸다. */
function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/**
 * 클라이언트로 내보낼 에러로 변환한다.
 *
 * - 운영(dev=false): 원본 그대로 — oRPC 가 기존대로 마스킹한다.
 * - dev + ORPCError: 그대로. oRPC 나 procedure 가 의도적으로 실은 code/message/data 를 덮지 않는다.
 * - dev + 그 외: 원문 메시지와 스택을 실은 ORPCError 로 교체해 브라우저에서도 원인이 보이게 한다.
 */
export function toWireError(error: unknown, opts: { dev: boolean }): unknown {
  if (!opts.dev) return error;
  if (error instanceof ORPCError) return error;

  return new ORPCError('INTERNAL_SERVER_ERROR', {
    message: describe(error),
    data: {
      name: error instanceof Error ? error.name : typeof error,
      ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
    },
    cause: error,
  });
}
