import { OpenAPIHandler } from '@orpc/openapi/fetch';

import { scheduleLogFlush } from '@/lib/logger';

import { router } from './router';

export const openapiHandler = new OpenAPIHandler(router, {
  interceptors: [
    async (options) => {
      // procedure 로그는 base 로깅 미들웨어(rpc-logging.ts)가 남긴다 —
      // 여기서는 요청당 1회 Axiom flush 예약만 (미설정이면 no-op).
      scheduleLogFlush();
      return options.next();
    },
  ],
});

/** /api/v1 외부 노출 여부. 기본 비활성(env로만 켬). */
export function isPublicApiEnabled(): boolean {
  return process.env['ENABLE_PUBLIC_API'] === 'true';
}
