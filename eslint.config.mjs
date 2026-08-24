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
    // src/lib 에는 더 이상 클라이언트 전용 파일이 없다(프론트 전용 조각은 feature·공용 구역으로
    // 이관 완료). 남은 예외는 파일 단위 ignores 가 아니라 인라인 eslint-disable 로 표시한다.
    files: [
      "src/server/**/*.{ts,tsx}",
      "src/app/api/**/*.{ts,tsx}",
      "src/actions/**/*.{ts,tsx}",
      "src/lib/**/*.{ts,tsx}",
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
    // 서버 층 구조. 도메인은 서로를 모르고, 공용은 역할이 붙은 층으로만 뺀다.
    //   core(server/*.ts)          — oRPC·context·로깅·요청 스코프 판정. 누구나 읽는다
    //   read-models/               — 여러 도메인 테이블을 읽기만 하는 projection. 자기완결(도메인을 모른다)
    //   storage-lifecycle/         — R2 수명주기. 자체 테이블만 만지는 독립 모듈
    //   workflows/                 — 여러 도메인의 쓰기를 조율하는 흐름. **여기만 도메인을 부를 수 있다**
    //   <domain>/                  — 자기 도메인. 타 도메인 직접 import 금지, 내부는 상대경로
    // "여러 도메인이 쓴다" 는 공용의 근거가 아니다 — 역할로 묶이지 않으면 제2의 lib 가 된다.
    files: ["src/server/*/**/*.{ts,tsx}"],
    ignores: ["src/server/workflows/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/server/*/**",
                "!@/server/*",
                "!@/server/read-models/**",
                "!@/server/storage-lifecycle/**",
                "!@/server/workflows/**",
              ],
              message:
                "서버 도메인 간 직접 import 금지. 읽기 전용 projection 은 @/server/read-models, 여러 도메인 쓰기 조율은 @/server/workflows 로 빼세요. (자기 도메인 내부는 상대경로)",
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
  {
    // workflows 는 여러 도메인의 쓰기를 조율하는 것이 존재 이유라 도메인 호출이 허용된다.
    // 결합을 없애는 게 아니라 한곳에 모아 보이게 하는 층이다 — 파일이 늘면 그 자체가 신호다.
    files: ["src/server/workflows/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
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
            {
              // 렌더러는 응답이 어디에 사는지 모른다. 원본은 response-sources 로 주입받는다.
              group: ["@/stores", "@/stores/**", "**/stores/**"],
              message:
                "question-renderer 는 스토어를 직접 구독하지 않습니다. 응답 원본은 response-sources(주입 계약)로 받고, zustand 어댑터는 호출하는 feature 가 소유하세요.",
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
    // 클라이언트 트리(features/components/hooks/stores/utils/shared)는 DB 런타임을 모른다.
    // 값 import(db 클라이언트·drizzle 테이블)는 서버 모듈(lib/*·features/*/server·app RSC)로 옮긴다.
    // 행 타입(type import)은 허용 — JSONB 어휘는 @/shared/contracts, 행 타입은 $inferSelect seam 으로 남긴다.
    files: [
      "src/features/**/*.{ts,tsx}",
      "src/components/**/*.{ts,tsx}",
      "src/hooks/**/*.{ts,tsx}",
      "src/stores/**/*.{ts,tsx}",
      "src/utils/**/*.{ts,tsx}",
      "src/shared/**/*.{ts,tsx}",
    ],
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
              // UI 는 @/server 아래 어떤 것도 import 하지 않는다 — 타입도 예외가 아니다.
              // 계약(zod 스키마·RSC 가 props 로 넘기는 행 모양)은 @/shared/contracts 가 소유하고,
              // 데이터는 RPC(@/shared/lib/rpc) 로 받는다. 타입만 허용하는 예외를 하나 열어두면
              // 그 파일이 나중에 server-only·Node·DB 를 끌어와도 UI 가 계속 가리키게 된다.
              group: ["@/server", "@/server/**"],
              message:
                "UI 는 @/server 를 import 하지 않습니다(타입 포함). 서버와 UI 가 함께 쓰는 모양은 @/shared/contracts 로 올리고, 데이터는 RPC(@/shared/lib/rpc) 로 받으세요.",
            },
          ],
        },
      ],
    },
  },
  {
    // shared 중 이 파일 하나만 @/server 를 가리킬 수 있다.
    // oRPC 타입드 클라이언트는 RouterClient<typeof router> 를 만들기 위해 router 타입이
    // 필요하고, 그 타입은 서버가 소유한다 — shared 로 내리면 서버가 shared 를 되가리켜
    // 순환이 된다. 통로를 이 파일 하나로 고정해야 shared/contracts 가 같은 문으로
    // @/server 를 끌어오는 일을 막을 수 있다(그 순간 UI 의 @/server 금지가 우회된다).
    // 이 블록은 위 클라이언트 트리 블록보다 뒤에 와야 한다 — 같은 규칙 이름이라
    // 뒤가 앞을 덮어쓰는 성질로 @/server 금지만 걷어내고 @/db 금지는 그대로 남긴다.
    files: ["src/shared/lib/rpc.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/db", "@/db/**"],
              allowTypeImports: true,
              message:
                "타입드 RPC 클라이언트는 DB 를 알 이유가 없습니다. 행 모양은 @/shared/contracts 로 올리세요. (type import 는 허용)",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
