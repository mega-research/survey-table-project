// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

import { scrubSentryEvent } from "./src/lib/logger/sentry-before-send";

Sentry.init({
  ...(process.env['NEXT_PUBLIC_SENTRY_DSN'] !== undefined ? { dsn: process.env['NEXT_PUBLIC_SENTRY_DSN'] } : {}),


  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // PII 비전송: 요청 쿠키(sb-* 세션 JWT)·헤더·IP 가 Sentry 이벤트에 첨부되는 것을 차단.
  // admin 세션 쿠키 유출 → 세션 탈취 시 contact_pii 복호/메일 전권 획득 경로를 봉인.
  // contact_pii 암호화 분리 설계가 텔레메트리로 우회되지 않도록 false 로 둔다.
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: false,

  // DB 쿼리 바인딩 값 스트립: DrizzleQueryError 의 message 에 보간된 params(응답 JSONB·명단 값)는
  // sendDefaultPii 로 막히지 않는다. pino err 직렬화와 같은 규칙으로 지우고, SQL·SQLSTATE 는 남긴다.
  // edge·client 는 DB 를 부르지 않아 걸지 않는다.
  beforeSend: scrubSentryEvent,
});
