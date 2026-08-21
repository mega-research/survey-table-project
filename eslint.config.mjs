import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import eslintConfigPrettier from "eslint-config-prettier/flat";

const eslintConfig = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      ".worktrees/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "claudedocs/**",
      ".claude/**",
      ".gstack/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/incompatible-library": "warn",
      "react-hooks/set-state-in-render": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
    },
  },
  {
    // 서버 코드 no-console — pino 로거(@/lib/logger) 사용 강제.
    // 클라이언트(브라우저) 코드는 pino 대상이 아니므로 범위에서 제외한다 (티켓 07 정책).
    // src/lib 는 서버/클라 혼재 — 클라이언트 전용 파일만 ignores 로 명시 제외.
    files: [
      "src/server/**/*.{ts,tsx}",
      "src/app/api/**/*.{ts,tsx}",
      "src/actions/**/*.{ts,tsx}",
      "src/data/**/*.{ts,tsx}",
      "src/lib/**/*.{ts,tsx}",
    ],
    ignores: [
      "src/lib/image-utils.ts",
      "src/lib/mail/mail-attachment-client.ts",
    ],
    rules: {
      "no-console": "error",
    },
  },
  {
    // 일회성 유지보수 스크립트 — 앱 런타임에 포함되지 않고 배포되지도 않는다.
    // 데이터 점검·백필 성격상 any 가 불가피하고 고칠 계획도 없다. 볼 생각 없는 경고를
    // 목록에 남겨두면 목록 자체를 아무도 읽지 않게 되므로 여기서 뺀다.
    // 2026-08-19 실측: 이 완화로 경고 108건 중 63건이 빠지고 남는 45건은 전부
    // react-hooks(React Compiler) 계열 — 실제로 봐야 할 것만 남는다.
    files: ["scripts/**/*.{ts,mts,tsx,mjs,js}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "import/no-anonymous-default-export": "off",
    },
  },
  {
    // 서버 도메인 간 직접 import 금지 (경량 DDD 경계). 공용은 @/shared 로 승격하거나 서버 내부에서는
    // 타 도메인 테이블 직접 쿼리(허용)로 푼다. 자기 도메인 내부는 상대경로를 쓴다(이 패턴은 절대경로 self 도 막는다).
    // 코어(@/server/orpc·context·router 등 1단계 모듈)는 `!@/server/*` 로 허용한다.
    // 주의: gitignore 의미론 — 상위 디렉터리를 매치하는 패턴은 negation 으로 하위를 되살릴 수 없다.
    files: ["src/server/*/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/server/*/**", "!@/server/*"],
              message:
                "서버 도메인 간 직접 import 금지. 공용은 @/shared 로 승격하세요. (자기 도메인 내부는 상대경로 사용)",
            },
            {
              group: ["@/features/*", "@/features/*/**", "**/features/*/**"],
              message: "서버는 features/(UI) 를 import 하지 않습니다.",
            },
          ],
        },
      ],
    },
  },
  // ── 프론트 feature 의존 방향 ────────────────────────────────────────────────
  // survey-builder → survey-response → question-renderer (단방향). operations·analytics 는 독립.
  // question-renderer 는 빌더 미리보기와 응답 페이지 양쪽이 쓰는 렌더러라 어느 쪽도 역참조하지 않는다.
  // 각 블록은 자기 feature(절대경로 내부 import)와 허용 간선만 negation 으로 연다.
  {
    // 렌더러 — 어떤 feature 도 import 하지 않는다
    files: ["src/features/question-renderer/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/features/*",
                "@/features/*/**",
                "**/features/*/**",
                "!@/features/question-renderer",
                "!@/features/question-renderer/**",
                "!**/features/question-renderer/**",
              ],
              message:
                "features/question-renderer 이 import 할 수 있는 다른 feature 는 없음 입니다. 양쪽이 쓰는 조각은 공용 구역(components/ui·hooks·utils·shared)으로 옮기고, 한쪽 전용이면 호출자가 props 로 주입하세요.",
            },
          ],
        },
      ],
    },
  },
  {
    // 응답 페이지 — 렌더러만
    files: ["src/features/survey-response/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/features/*",
                "@/features/*/**",
                "**/features/*/**",
                "!@/features/survey-response",
                "!@/features/survey-response/**",
                "!**/features/survey-response/**",
                "!@/features/question-renderer",
                "!@/features/question-renderer/**",
                "!**/features/question-renderer/**",
              ],
              message:
                "features/survey-response 이 import 할 수 있는 다른 feature 는 question-renderer 입니다. 양쪽이 쓰는 조각은 공용 구역(components/ui·hooks·utils·shared)으로 옮기고, 한쪽 전용이면 호출자가 props 로 주입하세요.",
            },
          ],
        },
      ],
    },
  },
  {
    // 빌더 — 미리보기용 응답 플로우 + 렌더러
    files: ["src/features/survey-builder/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/features/*",
                "@/features/*/**",
                "**/features/*/**",
                "!@/features/survey-builder",
                "!@/features/survey-builder/**",
                "!**/features/survey-builder/**",
                "!@/features/survey-response",
                "!@/features/survey-response/**",
                "!**/features/survey-response/**",
                "!@/features/question-renderer",
                "!@/features/question-renderer/**",
                "!**/features/question-renderer/**",
              ],
              message:
                "features/survey-builder 이 import 할 수 있는 다른 feature 는 survey-response, question-renderer 입니다. 양쪽이 쓰는 조각은 공용 구역(components/ui·hooks·utils·shared)으로 옮기고, 한쪽 전용이면 호출자가 props 로 주입하세요.",
            },
          ],
        },
      ],
    },
  },
  {
    // 운영 콘솔 — 독립
    files: ["src/features/operations/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/features/*",
                "@/features/*/**",
                "**/features/*/**",
                "!@/features/operations",
                "!@/features/operations/**",
                "!**/features/operations/**",
              ],
              message:
                "features/operations 이 import 할 수 있는 다른 feature 는 없음 입니다. 양쪽이 쓰는 조각은 공용 구역(components/ui·hooks·utils·shared)으로 옮기고, 한쪽 전용이면 호출자가 props 로 주입하세요.",
            },
          ],
        },
      ],
    },
  },
  {
    // 분석 — 독립
    files: ["src/features/analytics/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/features/*",
                "@/features/*/**",
                "**/features/*/**",
                "!@/features/analytics",
                "!@/features/analytics/**",
                "!**/features/analytics/**",
              ],
              message:
                "features/analytics 이 import 할 수 있는 다른 feature 는 없음 입니다. 양쪽이 쓰는 조각은 공용 구역(components/ui·hooks·utils·shared)으로 옮기고, 한쪽 전용이면 호출자가 props 로 주입하세요.",
            },
          ],
        },
      ],
    },
  },
  {
    // 공용 구역은 feature 를 모른다 — shared 가 feature 를 import 하면 그 feature 가 사실상 공용이 된 것이다.
    files: [
      "src/components/**/*.{ts,tsx}",
      "src/hooks/**/*.{ts,tsx}",
      "src/stores/**/*.{ts,tsx}",
      "src/utils/**/*.{ts,tsx}",
      "src/lib/**/*.{ts,tsx}",
      "src/types/**/*.{ts,tsx}",
      "src/data/**/*.{ts,tsx}",
      "src/shared/**/*.{ts,tsx}",
      "src/server/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/features/*", "@/features/*/**", "**/features/*/**"],
              message:
                "공용 구역·서버는 features/ 를 import 하지 않습니다. 양쪽이 쓰는 코드는 공용 구역으로 내리세요.",
            },
          ],
        },
      ],
    },
  },
  eslintConfigPrettier,
  {
    // 클라이언트 트리(features/components/hooks/stores/utils)는 DB 런타임을 모른다.
    // 값 import(db 클라이언트·drizzle 테이블)는 서버 모듈(lib/*·features/*/server·app RSC)로 옮긴다.
    // 행 타입(type import)은 허용 — JSONB 어휘는 @/shared/contracts, 행 타입은 $inferSelect seam 으로 남긴다.
    files: ["src/features/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}", "src/hooks/**/*.{ts,tsx}", "src/stores/**/*.{ts,tsx}", "src/utils/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/db", "@/db/**"],
              allowTypeImports: true,
              message:
                "클라이언트 트리에서 DB 값 import 금지. JSONB 어휘는 @/shared/contracts, 쿼리는 서버 모듈로 옮기세요. (type import 는 허용)",
            },
            {
              group: [
                "@/server/*/services/**",
                "@/server/*/procedures/**",
                "@/server/*/services",
                "@/server/*/procedures",
                "@/server/context",
                "@/server/orpc",
                "@/server/router",
                "@/server/handler",
                "@/server/openapi",
                "@/server/rpc-logging",
                "@/server/rpc-error-policy",
                "@/server/rpc-timeout",
                "@/server/health",
              ],
              message:
                "UI 는 서버 모듈을 import 하지 않습니다. 데이터는 RPC(@/shared/lib/rpc) 로, 계약은 @/server/<domain>/domain 또는 @/shared/contracts 로 받으세요.",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
