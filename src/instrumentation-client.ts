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

  // 브라우저·확장 프로그램이 페이지에 심는 자기 스크립트의 오류는 우리 코드가 아니다.
  // 스택에 우리 번들 프레임이 없고 응답 진행에도 영향이 없어 이슈만 어지럽힌다.
  // - __firefox__: Firefox iOS 계열(Brave iOS 포함)의 읽기 모드 주입 스크립트
  // - window.ethereum: Brave 지갑·MetaMask 등 지갑 확장 주입
  ignoreErrors: [
    /__firefox__/,
    /window\.ethereum/,
    /ResizeObserver loop (limit exceeded|completed with undelivered notifications)/,
  ],
  denyUrls: [
    /^chrome-extension:\/\//i,
    /^moz-extension:\/\//i,
    /^safari-(web-)?extension:\/\//i,
    /extensions\//i,
  ],
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
