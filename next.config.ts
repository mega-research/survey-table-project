import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

// 전역 보안 헤더 정의.
// next.config 의 headers() 가 소비하는 순수 함수로 분리해 단위 테스트에서 직접 검증한다.
// 전 라우트('/(.*)') 에 동일 헤더를 적용한다.
// 주의: CSP(Content-Security-Policy) 는 nonce plumbing 이 필요하므로 WS 후속 사이클에서 도입한다.
export function securityHeaders() {
  return [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
        {
          key: "Permissions-Policy",
          value:
            "camera=(), microphone=(), geolocation=(), interest-cohort=()",
        },
      ],
    },
  ];
}

const nextConfig: NextConfig = {

  reactCompiler: true,

  // 전역 안전 보안 헤더 (전 라우트 적용). 정의는 securityHeaders() 참조.
  async headers() {
    return securityHeaders();
  },

  // Server Actions body 크기 제한 (기본값 1MB → 30MB)
  // saveSurveyWithDetails에서 설문 전체 데이터를 전송하므로 제한 확대 필요
  experimental: {
    serverActions: {
      bodySizeLimit: '30mb',
    },
    // 미들웨어/프록시 요청 본문 크기 제한 (기본값 10MB → 30MB)
    // /admin/:path* 미들웨어가 서버 액션 요청을 먼저 처리하므로 이 제한도 확대 필요
    proxyClientMaxBodySize: '30mb',
  },

  // 2. 타입스크립트 에러 확인 (빌드 시 타입 검증)
  typescript: {
    ignoreBuildErrors: false,
  },
};

// 4. Sentry 설정 적용 (기본값 유지)
export default withSentryConfig(nextConfig, {
  ...(process.env['SENTRY_ORG'] !== undefined ? { org: process.env['SENTRY_ORG'] } : {}),
  ...(process.env['SENTRY_PROJECT'] !== undefined ? { project: process.env['SENTRY_PROJECT'] } : {}),

  // 배포 시 소스맵 업로드 로그 숨김 (CI/CD 로그 깔끔하게)
  silent: !process.env['CI'],

  // 클라이언트 업로드 용량 제한 해제 (Sentry 이슈 방지)
  widenClientFileUpload: true,

  // React 컴포넌트 이름 추적 활성화
  reactComponentAnnotation: {
    enabled: true,
  },

  // Sentry 터널링 (광고 차단기 우회하여 에러 수집)
  tunnelRoute: "/monitoring",

  // 불필요한 로그 끄기
  disableLogger: true,

  // Vercel 배포 시 자동 모니터링 활성화
  automaticVercelMonitors: true,
});