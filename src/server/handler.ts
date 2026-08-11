import { RPCHandler } from '@orpc/server/fetch';
import * as Sentry from '@sentry/nextjs';

import { logger, scheduleLogFlush } from '@/lib/logger';

import { isUnexpectedRpcError, toWireError } from './rpc-error-policy';
import { router } from './router';

const IS_DEV = process.env.NODE_ENV !== 'production';

/**
 * RPC 핸들러. typed/expected 에러가 아닌 예기치 못한 에러만 Sentry로 캡처한다.
 * (typed domain error는 isDefinedError 경로로 클라이언트가 처리)
 *
 * 노출 정책은 dev/운영이 다르다 — rpc-error-policy 참고.
 * 운영은 기존 마스킹 그대로, dev 는 원문+스택을 클라이언트까지 실어 보낸다.
 *
 * 역할 분리: 오류 추적은 Sentry, 운영 기록은 pino — 이중 아님. procedure 단위
 * 접근 로그(성공/실패 1줄 + durationMs)는 base 로깅 미들웨어(rpc-logging.ts)가
 * 남기고, 이 인터셉터는 procedure 밖(디코드·라우팅 등) 단계의 예외까지 포함해
 * 마스킹 전 원문을 기록하는 최후 창구다.
 */
export const rpcHandler = new RPCHandler(router, {
  interceptors: [
    async (options) => {
      // 요청당 1회 — 응답 반환 후 Axiom 배치 flush 예약 (Axiom 미설정이면 no-op)
      scheduleLogFlush();
      try {
        return await options.next();
      } catch (error) {
        if (isUnexpectedRpcError(error)) {
          // 클라이언트에는 마스킹되므로 서버 로그에 원문을 남긴다.
          logger.error({ err: error }, '[rpc] unhandled error');
          Sentry.captureException(error);
        }
        throw toWireError(error, { dev: IS_DEV });
      }
    },
  ],
});
