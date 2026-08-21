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
      "src/features/*/server/**/*.{ts,tsx}",
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
    files: ["src/features/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/features/*/**"],
              message:
                "feature 간 직접 import 금지. 공용은 @/shared로 승격하거나 RPC(@/shared/lib/rpc)를 경유하세요. (자기 feature 내부는 상대경로 사용)",
            },
          ],
        },
      ],
    },
  },
  {
    // components 의존 방향: survey-builder → survey-response → question-renderer (단방향).
    // question-renderer 는 빌더 미리보기와 응답 페이지 양쪽이 쓰는 렌더러라 어느 쪽도 역참조하지 않는다.
    // 글롭은 components/ 아래로 한정한다 — @/features/survey-builder 는 oRPC 도메인이라 import 해도 된다.
    files: ["src/components/question-renderer/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/components/survey-builder",
                "@/components/survey-builder/**",
                "@/components/survey-response",
                "@/components/survey-response/**",
                "**/components/survey-builder/**",
                "**/components/survey-response/**",
              ],
              message:
                "question-renderer 는 survey-builder · survey-response 를 import 하지 않습니다. 양쪽이 쓰는 조각이면 question-renderer 로 옮기고, 한쪽 전용이면 호출자가 props 로 주입하세요.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/components/survey-response/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/components/survey-builder",
                "@/components/survey-builder/**",
                "**/components/survey-builder/**",
              ],
              message:
                "survey-response 는 survey-builder 를 import 하지 않습니다. 양쪽이 쓰는 렌더러는 @/components/question-renderer 에 있습니다.",
            },
          ],
        },
      ],
    },
  },
  eslintConfigPrettier,
  {
    // 클라이언트 트리(components/hooks/stores/utils)는 DB 런타임을 모른다.
    // 값 import(db 클라이언트·drizzle 테이블)는 서버 모듈(lib/*·features/*/server·app RSC)로 옮긴다.
    // 행 타입(type import)은 허용 — JSONB 어휘는 @/shared/contracts, 행 타입은 $inferSelect seam 으로 남긴다.
    files: ["src/components/**/*.{ts,tsx}", "src/hooks/**/*.{ts,tsx}", "src/stores/**/*.{ts,tsx}", "src/utils/**/*.{ts,tsx}"],
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
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
