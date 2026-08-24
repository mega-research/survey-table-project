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
  eslintConfigPrettier,
];

export default eslintConfig;
