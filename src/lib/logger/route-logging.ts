import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { NextResponse, type NextRequest } from 'next/server';
import type { Logger } from 'pino';

import { getTrustedClientIpOrNull } from '@/lib/rate-limit/client-ip';

import { scheduleLogFlush } from './flush';
import { withContext, type LogContext } from './with-context';

/**
 * REST 라우트 로깅 래퍼 (oRPC 미들웨어 밖의 라우트 전용 관문).
 *
 * sendBeacon 제약(draft/segment)·파일 스트림(export)·multipart(upload)·webhook 등
 * oRPC 인터셉터를 못 거치는 라우트에 method·route·status·durationMs·ip 를 자동
 * 바인딩한 access 로그를 남긴다. userId 등 인증 이후에만 알 수 있는 값은 핸들러가
 * `ctx.bind()` 로 주입한다.
 *
 * allowlist 관례: bind 에 싣는 값은 식별자·경로·건수뿐이다. body/answers/attrs 등
 * JSONB 컨테이너와 PII 평문 금지 (with-context.ts 참조).
 */

/** 핸들러에 전달되는 로깅 컨텍스트. */
export interface RouteLogContext {
  /**
   * access 로그(및 이후 `log`)에 합쳐질 필드를 주입한다.
   * 인증 이후 확보되는 userId·role, 파싱 이후 확보되는 대상 id·건수 등.
   */
  bind(fields: LogContext): void;
  /** 현재까지 바인딩된 컨텍스트가 붙은 child logger — 라우트 내부 로그 지점에서 사용. */
  readonly log: Logger;
}

interface RouteLoggingOptions {
  /** 비인증 주체 라우트의 출처 표기 (예: 'resend-webhook'). */
  source?: string;
  /** unhandled error 시 500 응답 body 의 error 메시지 (기존 라우트별 문구 유지용). */
  errorMessage?: string;
  /**
   * unhandled error 의 Sentry 캡처 여부 (기본 true).
   * sendBeacon 계열(draft/segment)처럼 기존에 Sentry 미캡처였고 DB 순단 시 대량
   * 발생 가능한 고볼륨 익명 라우트는 false 로 기존 동작을 유지한다 — 기록은
   * pino error 로그가 담당.
   */
  sentry?: boolean;
  /** Sentry 캡처 시 붙일 태그 (기존 라우트별 태그 유지용, 예: operation). */
  sentryTags?: Record<string, string>;
}

type RouteHandler<A extends unknown[]> = (
  req: NextRequest,
  ctx: RouteLogContext,
  ...args: A
) => Promise<Response> | Response;

/**
 * 라우트 핸들러를 로깅 래퍼로 감싼다.
 *
 * - `route` 는 동적 세그먼트를 패턴 문자열로 유지한다 (예: '/api/surveys/[surveyId]/export').
 * - 핸들러가 정상 반환하면 status 기준(5xx=error, 그 외 info)으로 access 로그 1건.
 * - 핸들러가 throw 하면 err 포함 error 로그 + Sentry 캡처 + 일반화된 500 JSON 응답.
 *   라우트별 에러 응답 성형(401/400 등)은 핸들러 안에서 처리하고, 예기치 못한
 *   에러만 여기까지 전파시키는 구조를 전제한다.
 * - 응답 직전 scheduleLogFlush() 로 서버리스 freeze 전 Axiom flush 를 예약한다.
 */
export function withRouteLogging<A extends unknown[]>(
  route: string,
  handler: RouteHandler<A>,
  options: RouteLoggingOptions = {},
): (req: NextRequest, ...args: A) => Promise<Response> {
  return async (req, ...args) => {
    const startedAt = Date.now();
    const ip = getTrustedClientIpOrNull(req.headers);
    const base: LogContext = {
      route,
      method: req.method,
      ...(ip !== null ? { ip } : {}),
      ...(options.source !== undefined ? { source: options.source } : {}),
    };
    const bound: LogContext = {};
    const ctx: RouteLogContext = {
      bind(fields) {
        Object.assign(bound, fields);
      },
      get log() {
        return withContext({ ...base, ...bound });
      },
    };

    try {
      const res = await handler(req, ctx, ...args);
      const durationMs = Date.now() - startedAt;
      const line = { status: res.status, durationMs };
      if (res.status >= 500) {
        ctx.log.error(line, 'REST 요청 처리');
      } else {
        ctx.log.info(line, 'REST 요청 처리');
      }
      return res;
    } catch (error) {
      // 핸들러가 성형하지 못한 예기치 못한 에러 — 기존 최외곽 catch-all 을 대체한다.
      const durationMs = Date.now() - startedAt;
      ctx.log.error({ err: error, status: 500, durationMs }, 'REST 요청 처리 실패');
      if (options.sentry !== false) {
        if (options.sentryTags !== undefined) {
          Sentry.captureException(error, { tags: options.sentryTags });
        } else {
          Sentry.captureException(error);
        }
      }
      return NextResponse.json(
        { error: options.errorMessage ?? '요청 처리 중 오류가 발생했습니다.' },
        { status: 500 },
      );
    } finally {
      scheduleLogFlush();
    }
  };
}
