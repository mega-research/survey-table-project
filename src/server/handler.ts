import { RPCHandler } from '@orpc/server/fetch';
import * as Sentry from '@sentry/nextjs';

import { isUnexpectedRpcError, toWireError } from './rpc-error-policy';
import { router } from './router';

const IS_DEV = process.env.NODE_ENV !== 'production';

/**
 * RPC 핸들러. typed/expected 에러가 아닌 예기치 못한 에러만 Sentry로 캡처한다.
 * (typed domain error는 isDefinedError 경로로 클라이언트가 처리)
 *
 * 노출 정책은 dev/운영이 다르다 — rpc-error-policy 참고.
 * 운영은 기존 마스킹 그대로, dev 는 원문+스택을 클라이언트까지 실어 보낸다.
 */
export const rpcHandler = new RPCHandler(router, {
  interceptors: [
    async (options) => {
      try {
        return await options.next();
      } catch (error) {
        if (isUnexpectedRpcError(error)) {
          // 클라이언트에는 마스킹되므로 서버 로그에도 남긴다. dev 에서는 이게 유일한 원문 창구다.
          if (IS_DEV) console.error('[rpc] unhandled error', error);
          Sentry.captureException(error);
        }
        throw toWireError(error, { dev: IS_DEV });
      }
    },
  ],
});
