// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  ...(process.env['NEXT_PUBLIC_SENTRY_DSN'] !== undefined ? { dsn: process.env['NEXT_PUBLIC_SENTRY_DSN'] } : {}),

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Session Replay
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  integrations: [Sentry.replayIntegration()],

  // PII 비전송: 사용자 IP·요청 컨텍스트가 Sentry 이벤트에 첨부되는 것을 차단.
  // Session Replay 는 기본 마스킹(maskAllText/maskAllInputs)에 의존한다.
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: false,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
