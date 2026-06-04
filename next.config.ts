import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {

  reactCompiler: true,

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
  org: process.env['SENTRY_ORG'], // 환경변수에서 가져오게 설정하는 것이 좋습니다.
  project: process.env['SENTRY_PROJECT'],

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