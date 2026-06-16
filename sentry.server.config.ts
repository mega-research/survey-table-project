// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  ...(process.env['NEXT_PUBLIC_SENTRY_DSN'] !== undefined ? { dsn: process.env['NEXT_PUBLIC_SENTRY_DSN'] } : {}),


  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // PII 비전송: 요청 쿠키(sb-* 세션 JWT)·헤더·IP 가 Sentry 이벤트에 첨부되는 것을 차단.
  // admin 세션 쿠키 유출 → 세션 탈취 시 contact_pii 복호/메일 전권 획득 경로를 봉인.
  // contact_pii 암호화 분리 설계가 텔레메트리로 우회되지 않도록 false 로 둔다.
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: false,
});
