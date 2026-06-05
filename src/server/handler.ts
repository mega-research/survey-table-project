import { isDefinedError, onError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import * as Sentry from '@sentry/nextjs';

import { router } from './router';

/**
 * RPC 핸들러. typed/expected 에러가 아닌 예기치 못한 에러만 Sentry로 캡처한다.
 * (typed domain error는 isDefinedError 경로로 클라이언트가 처리)
 */
export const rpcHandler = new RPCHandler(router, {
  interceptors: [
    onError((error) => {
      // typed domain error는 클라이언트가 isDefinedError로 처리하므로 캡처 제외.
      // 예기치 못한 infrastructure 에러만 Sentry로 보낸다.
      if (!isDefinedError(error)) {
        Sentry.captureException(error);
      }
    }),
  ],
});
