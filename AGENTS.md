# Survey Table Project - 에이전트 참조 문서

## 프로젝트 개요

Next.js 16 기반의 고급 설문조사 빌더 + 운영 플랫폼. 복잡한 질문 유형, 조건부 로직, 버전 스냅샷, 컨택 관리, 메일 캠페인, SPSS/엑셀 내보내기, 분석 기능을 갖춘 엔터프라이즈급 애플리케이션.

---

## 문서 지도

이 파일은 **매 세션 실리는 공통 규칙**만 담는다. 영역별 상세는 그 코드 옆의 `AGENTS.md` 에 있다
(각 폴더의 `CLAUDE.md` 는 그 파일의 심볼릭 링크). Claude Code 는 그 폴더의 파일을 읽을 때 자동으로
싣지만, 다른 도구는 아니므로 **해당 영역을 만지기 전에 직접 읽을 것.**

| 작업 영역                                                               | 읽을 문서                                |
| ----------------------------------------------------------------------- | ---------------------------------------- |
| 라우트 트리 · 운영 콘솔·게스트·링크 콘솔 주소                           | `src/app/AGENTS.md`                      |
| 메일 발송 주소·대체 발송 · 컨택원 배정 · 조사 대상 필터 해석            | `src/app/AGENTS.md`                      |
| 서버 트리 · 인증과 권한(capability·팀·소유권·참여자·링크) · 테스트 모드 | `src/server/AGENTS.md`                   |
| 쿼터                                                                    | `src/server/quota/AGENTS.md`             |
| 문항 수요조사 (조사표·영역 앵커·분할 레이아웃)                          | `src/server/survey-document/AGENTS.md`   |
| R2 파일 수명주기                                                        | `src/server/storage-lifecycle/AGENTS.md` |
| 이월 응답 임포트 (추적조사)                                             | `src/server/contacts/AGENTS.md`          |
| DB 스키마 (테이블·컬럼·관계)                                            | `src/db/schema/AGENTS.md`                |
| 프론트 기능 묶음 트리 · 질문 유형·셀 타입·테이블 검증 규칙              | `src/features/AGENTS.md`                 |
| lib 트리 · 레이트리밋 · 로깅 · Sentry                                   | `src/lib/AGENTS.md`                      |
| 도메인 용어                                                             | `CONTEXT.md`                             |
| 결정 배경                                                               | `docs/adr/`                              |

**변경 이력은 어느 문서에도 쌓지 않는다** — git log 와 ADR 이 그 자리다. 새 상세 절은 루트가 아니라
해당 영역 문서에 쓴다.

---

## 기술 스택

| 영역           | 기술                                         | 버전            |
| -------------- | -------------------------------------------- | --------------- |
| 프레임워크     | Next.js (App Router, Turbopack)              | 16.3.8          |
| UI 라이브러리  | React (React Compiler)                       | 19.2.3          |
| 스타일링       | TailwindCSS                                  | 4.x             |
| 컴포넌트       | shadcn/ui (Radix UI)                         | -               |
| 상태관리       | Zustand + Immer                              | 5.0.8 / 11.1.3  |
| 데이터 페칭    | TanStack Query                               | 5.90.11         |
| RPC            | oRPC (server/client/tanstack-query/openapi)  | 1.14.4          |
| 스키마 검증    | Zod                                          | 4.4.3           |
| 인증           | Better Auth (email+password, drizzle 어댑터) | 1.7.1           |
| 테이블         | TanStack Table                               | 8.21.3          |
| 텍스트 측정    | @chenglou/pretext                            | 0.0.5           |
| 리치 에디터    | TipTap                                       | 3.31.3          |
| 드래그앤드롭   | @dnd-kit                                     | -               |
| ID 생성        | NanoID                                       | 5.1.11          |
| ORM            | Drizzle ORM                                  | 0.45.2          |
| DB 드라이버    | postgres (postgres-js)                       | 3.4.7           |
| 데이터베이스   | PostgreSQL (Supabase)                        | -               |
| 파일 저장소    | Cloudflare R2 (S3 호환)                      | -               |
| 이미지 처리    | sharp                                        | 0.35.5          |
| HTML sanitize  | sanitize-html                                | 2.17.0          |
| 이메일 발송    | Resend + React Email                         | 6.12.3          |
| 이메일 webhook | svix                                         | 1.93.0          |
| 백그라운드 잡  | Inngest                                      | 4.4.0           |
| 레이트리밋     | @upstash/ratelimit + @upstash/redis          | 2.0.8 / 1.38.0  |
| 로깅           | pino + @axiomhq/js                           | 10.3.1 / 2.0.0  |
| PDF 렌더       | pdfjs-dist (조사표 뷰어 + 서버 쪽 수 판독)   | 6.3.289         |
| 엑셀 생성      | ExcelJS                                      | 4.4.0           |
| SPSS .sav 생성 | sav-writer                                   | 1.0.0           |
| 차트           | Recharts + Tremor                            | 2.15.4 / 3.18.7 |
| 에러 모니터링  | Sentry (@sentry/nextjs)                      | 10.x            |
| 테스트         | Vitest + Testing Library + MSW + Playwright  | 4.1.0 / 1.60    |
| 언어           | TypeScript (strict)                          | 5.9.3           |

> 참고: `xlsx`, `jszip` 의존성은 제거됨(2026-06-05). 엑셀 생성은 ExcelJS, SPSS는 sav-writer 사용.
> `react-hook-form`, `@tanstack/react-virtual` 도 제거됨(2026-08-22) — 소스 참조가 처음부터 0이었다.
> 폼은 제어 컴포넌트 + zod 로, 목록은 TanStack Table 로 직접 다룬다.
> sharp 0.35는 Vercel libvips 이슈로 `next.config.ts`의 `outputFileTracingIncludes` 우회가 걸려 있다 (업스트림 수정 시 제거).
> TipTap 36개 패키지는 `pnpm-workspace.yaml` overrides 로 한 버전에 묶는다 — `@tiptap/react` 가 `@tiptap/core`·`@tiptap/pm` 을 정확히 같은 버전으로 요구해 일부만 올리면 설치가 갈린다.
> 같은 자리에 `prosemirror-view` 도 묶여 있다. `@tiptap/pm` 은 정확한 버전을 못박는데 형제 `prosemirror-*` 는 `^1.x` 라, 풀어 두면 두 벌이 설치되어 `DecorationSet` 의 private 필드가 서로 다른 선언이 되고 tsc 가 TS2322 를 낸다.
> Better Auth 가 세션의 유일한 출처다 (티켓 02). Supabase 는 DB 호스팅으로만 남고 `@supabase/ssr` 은 제거됐다 —
> `@supabase/supabase-js` 는 유지보수 스크립트(`scripts/*.ts`) 전용으로 남아 있다.

---

## 프로젝트 구조

```
src/
├── app/                        # Next.js App Router
│                               # 상세 트리 → src/app/AGENTS.md
├── server/                     # oRPC 백엔드 — 코어 + 도메인 12개 (경량 DDD: domain 순수 · procedures 얇음 · services)
│                               # 상세 트리 → src/server/AGENTS.md
├── features/                   # 프론트 기능 묶음 8개 (UI·훅·스토어·query 훅을 기능 단위로 — 레이어 규약 아님, FSD 아님)
│   │                           # 의존 방향(ESLint): survey-builder → survey-response → question-renderer 단방향
│   │                           # operations·analytics·workspace·guest-console·fieldwork-console 은 각각 독립(서로 import 0)
│   │                           # builder → response 는 2건만 남았고 **둘 다 의도된 공유**다(옵션 텍스트 사이드카 저장소).
│   │                           # 인용값 계산이 양쪽에서 같은 입력을 봐야 해서 저장소를 하나로 둔 것 — 떼면 resetResponseState 의 원자적 리셋이 갈린다
│   │                           # UI 가 서버에서 가져올 수 있는 건 없다 — @/server 전면 금지(타입 포함), 모양은 @/shared/contracts 로
│   │                           # 루트 잔류 기준: ① 복수 하위 묶음이 소비하는 공용 조각 ② app 라우트가 직접 여는 진입점만 — 단일 묶음만 소비하면 그 묶음 안으로
│   │                           # 루트 개수는 목표가 아니라 이 기준의 결과다(2026-08-25 전수 실측: 72파일 중 이동 1건). 새 묶음의 진입점은 폴더 안(table-editor 방식), 기존 group-manager·condition-card 는 유지
│                               # 상세 트리 → src/features/AGENTS.md
├── shared/                     # 서버·프론트 양쪽 공용 (feature 직접 import 금지의 탈출구)
│   ├── contracts/              # 서버와 UI 가 합의한 모양 — UI 가 서버에서 가져오는 유일한 출처
│   │                           #   <domain>.ts     JSONB 문서 어휘 SoT (DB 에 저장되는 모양, DB 스키마 $type<> 가 참조, 런타임 의존 없음)
│   │                           #   <domain>-io.ts  경계를 건너는 모양 — RPC 입출력 zod + RSC 가 props 로 넘기는 read model 행
│   │                           #   survey-document.ts(앵커 스냅샷 어휘)·survey-document-io.ts(조사표·앵커 RPC zod) — 2026-09-03 신설
│   │                           # 질문 구조 타입은 @/types/survey 소관(겹침 0). 구 db/schema/schema-types.ts
│   ├── lib/rpc.ts              # 타입드 RPC client: client(plain 호출) + orpc(TanStack utils)
│   ├── lib/work-scope-cookie.ts   # 작업 범위 쿠키 R/W (브라우저 편의값 — 판정은 server/work-scope)
│   ├── lib/work-scope-context.tsx # 작업 범위 React 컨텍스트 — 공급은 workspace(AdminShell), 소비는 survey-builder(목록)
│   │                              # feature 간 직접 import 금지의 탈출구라 모양이 여기 산다 (티켓 08)
│   ├── lib/survey-group-queries.ts # 설문 그룹 쿼리 키 + 목록 조회 옵션 (티켓 12) — 사이드바 트리(workspace)와
│   │                              # 목록·모달(survey-builder)이 같은 캐시를 봐야 해서 여기 산다. mutation 은
│   │                              # 설문 목록 키까지 접어야 해 survey-builder/queries 소유(공유→feature 역전 금지)
│   ├── lib/survey-control.ts   # 설문 운영 제어 공용 로직
│   ├── lib/image-utils.ts      # 브라우저 이미지 리사이즈·압축 (업로드 전 최적화)
│   └── types/test-attempt.ts
│
├── actions/                    # 잔존 서버 액션 — 1파일 (의도적 유지)
│   ├── unsubscribe-actions.ts  # 수신거부 POST form (메일 클라 JS 비활성 환경 + redirect)
│   └── index.ts                # 잔존 사유 주석 배럴 (auth 는 Better Auth 로 이관 완료)
│
├── components/                 # 진짜 공용 UI 만 — features 를 모른다(ESLint)
│   ├── ui/                     # shadcn/ui 기반 컴포넌트 (23개 + rich-text-editor/)
│   ├── auth/                   # logout-button (authClient.signOut 공용 버튼)
│   └── providers/              # Context providers
│
├── stores/                     # error-dialog-store.ts 하나 (전역 에러 다이얼로그). 기능 스토어는 features/<x>/stores
│
├── hooks/                      # 범용 훅 4개 — use-latest-ref · use-media-query · use-formatted-numeric-input · use-auto-grow-textarea(renderer 입력칸·컨택원 수정 ID 목록 칸)
│                               # (기능 전용 훅·query 훅은 features/<x>/hooks·queries 로 흡수, 루트 배럴 없음)
│
├── lib/                        # 인프라 어댑터 + 프론트·서버가 함께 쓰는 계산 (도메인 로직 흡수 완료 — 트래커 E-1)
│                               # 판정은 폴더 이름이 아니라 소비자 실측 — 아래 "src/lib 잔류 기준" 참조
│                               # 상세 트리 → src/lib/AGENTS.md
├── utils/                      # 순수 유틸리티 함수
│   ├── branch-logic / branch-eval.ts # 분기 로직 평가
│   │                           # (renders-as-table·trailing-coalescer 는 features/question-renderer/utils, classify-table 도 거기)
│   ├── choice-source / ranking-source / ranking-shared / choice-group-helpers.ts # 옵션 소스 해석
│   ├── option-code-generator / table-cell-code-generator.ts # 코드 발번 (option-value-remap 은 features/survey-builder/utils)
│   ├── spss-var-name.ts        # SPSS 변수명 생성
│   ├── cell-label / cell-style / cell-library-helpers.ts  # (cell-type-detector·serialize-cell 은 survey-builder 아래로 이동)
│   ├── table-cell-field-policy.ts  # 셀 필드 정책 — TableCell 키마다 폼 소유(owned·kept·dropped)·보관함(carry·drop). 새 필드는 여기 한 줄 없으면 tsc 오류, owned 면 serialize-cell 견본 셀도 넣을 것 (CONTEXT.md 「셀 필드 정책」)
│   ├── table-merge-helpers / table-cell-optimizer.ts  # (table-grid-utils · expand-header-grid 는 question-renderer/utils)
│   ├── mobile-drilldown-repeat-header / mobile-table-display-mode.ts  # 서버도 import — 나머지 mobile-* 는 question-renderer/utils
│   ├── number-format / numeric-input.ts  # (expression-migration 은 survey-builder/condition/utils, header-style 은 table-editor/utils)
│   ├── table-cell-refs.ts      # 표 셀 참조 재배선 (lib/question/row-repeat 가 import 해 공용 잔류). 입력 형식·응답 품질·순위 클릭·보기 그룹 외곽선/섹션 라벨은 소비자가 features 뿐이라 question-renderer/utils 로 (2026-09-15)
│   ├── cell-gate-tree.ts       # 셀 게이팅 조건 트리 순회(잎 수집·컨트롤러 id·잎 매핑·잎 재해석) — 타입만 import 하는 잎 모듈, lib·utils·features 공용
│   ├── dynamic-row-selection-sidecar.ts  # 동적 행 선택 사이드카 키·정제 — lib/survey/response-sidecars 등록부가 import 하므로 공용 구역 (구 question-renderer/utils)
│   └── ...
│
├── db/
│   ├── index.ts                # drizzle(postgres-js) 클라이언트
│   └── schema/                 # Drizzle ORM 스키마 (src/db/schema/AGENTS.md 참조)
│
├── types/                      # 전역 타입·어휘 4파일
│   ├── survey.ts               # 질문 구조 타입 SoT — TableCell·QuestionOption·조건식 등 (986줄, 비테스트 소비 282파일)
│   │                           # shared/contracts/survey 와 심볼 겹침 0. 저쪽은 JSONB 문서 어휘라 역할이 다르다
│   ├── question-types.ts       # 질문 유형 어휘 런타임 SoT — QUESTION_TYPES 배열 ↔ QuestionType 동치를 tsc 로 강제
│   ├── mobile-table-display.ts # 모바일 표 표시 모드 어휘 + 타입 가드
│   └── input-type.ts           # 입력 형식 어휘 SSOT — text·number + 형식 5종(mobile·phone·biz_number·corp_number·email)
├── instrumentation.ts          # Sentry 서버 instrumentation
├── instrumentation-client.ts   # Sentry 클라이언트 instrumentation
└── proxy.ts                    # Next 미들웨어 (세션 쿠키 1차 게이트 + x-pathname 전달)
                                # matcher 는 루트 전수 리터럴 — 어휘는 lib/auth/protected-paths
```

---

## 데이터 흐름 아키텍처 (oRPC — 2026-06-06 전환 완료)

```
클라이언트 컴포넌트/훅
  └─ client.* (plain) 또는 orpc.*.call (TanStack queryFn)   # @/shared/lib/rpc
       └─ POST /api/rpc  →  procedure (.input zod 검증, pub/authed/scoped)
            └─ service (비즈 로직 + drizzle)  →  db

RSC (서버 컴포넌트)
  └─ service 직접 호출 (RPC 자기호출 금지)  # server/<domain>/services · server/read-models/*
```

- 서버 상태는 TanStack Query, 클라이언트 상태는 Zustand로 분리. mutation 후 RSC 데이터 갱신은 `router.refresh()` (revalidatePath는 procedure에서 불가).
- procedure 베이스 5종은 `src/server/AGENTS.md` 의 "인증과 권한" 참조. 모든 베이스는 `rpcLoggingMiddleware`가 붙은 `base` 파생이라 성공/실패가 구조화 로그 1줄로 남는다.
- **표면 선택 원칙**: 브라우저 query/mutation 은 oRPC · RSC 는 service 직접 호출 · 업로드·파일 스트리밍·webhook·sendBeacon·외부 프레임워크 핸들러 마운트(`/api/inngest`·`/api/auth`)는 Route Handler · **JS 없이 동작해야 하는 네이티브 폼과 redirect+쿠키 의미론만 서버 액션**. 서버 액션 0개가 목표가 아니다.
- 그 원칙에 따라 잔존 서버 액션은 `actions/` 1파일뿐 (unsubscribe form — 의도적 유지).
- **서버 도메인 마이그레이션 패턴/함정**: domain zod는 `@/types/survey` 방향 통일 + null-coalescing(as unknown as 금지), service input은 zod infer, `.returning()` 후 non-null throw, 컴포넌트는 hook/helper 시그니처 유지로 무수정. 질문 영속 쓰기는 explicit field set(spread 금지) + `PERSISTED_QUESTION_FIELDS` SSOT 로 tsc 관할 — 신규 컬럼은 SSOT 등재만 하면 모든 쓰기 지점(survey-save values/onConflict, create, duplicate, updateQuestion 순회)이 컴파일 에러로 호명된다. **읽기 방향은 tsc 가 못 잡는다** — 발행 스냅샷·빌더 로드가 공유하는 행→Question 매퍼(`server/read-models/survey-structure.ts` `mapQuestionRow`)도 명시 나열이라, 누락 시 발행 스냅샷에서 값이 조용히 증발한다(noticeBgColor 실사고). 전수 대조는 `server/read-models/map-question-row.test.ts` 가 잡는다.
- 경계는 ESLint 가 강제한다 — 서버 도메인 간 직접 import 금지(공용은 `@/shared` 승격 또는 RPC 경유, 타 도메인 테이블 직접 쿼리는 허용) · 프론트 feature 는 builder→response→renderer 한 방향(operations·analytics·workspace 는 독립) · 공용 구역(components/hooks/stores/utils/lib/types/shared)과 서버는 features 를 import 하지 않음 · UI 는 `@/server` 전면 금지(타입 포함, 모양은 `@/shared/contracts`) · 클라이언트 트리는 `@/db` 값 import 금지. 규칙은 `no-restricted-imports` 의 gitignore 의미론(상위 디렉터리 매치는 negation 불가, 같은 files 에 같은 규칙 블록 둘이면 마지막이 덮어씀) 위에 쓰여 있으니 새 규칙은 프로브 파일로 발화를 확인할 것.

---

## API 엔드포인트

```
POST   /api/rpc/[[...rest]]                    # oRPC 핸들러 — 전체 query/mutation (메인 경로)
*      /api/v1/[[...rest]]                     # OpenAPI 핸들러 (ENABLE_PUBLIC_API 게이트, 기본 비활성)
POST   /api/upload/image                       # 이미지 업로드 (multipart, 내부 전용, 삭제는 media.deleteImages RPC)
POST   /api/upload/avatar                      # 아바타 업로드 (세 계정 유형 공통, 정사각 WebP 로 깎아 저장)
POST   /api/upload/mail-attachment             # 메일 첨부 업로드 (삭제는 media.* RPC)
POST   /api/upload/notice-attachment           # 공지 첨부 업로드 (삭제는 media.* RPC)
POST   /api/upload/survey-document             # 조사표 PDF 업로드 (tmp 로 받고 쪽 수 판독, promote 는 attach RPC)
GET    /api/surveys/[surveyId]/export          # SPSS(.sav)/엑셀 export (인증 + export.download 관문, 파일 스트림). raw/raw-split 은 `includeNonRespondents=1` 로 미응답 조사 대상 행 포함 (sav/sps 는 무시). `includePriorAnswers=1` 은 이번 회차에 키가 없는 문항을 이월 응답으로 채운다 — 숨은 문항 strip 뒤에 병합하고 조건 판정은 하지 않되, 「이월값 불러오기」를 끈 문항(`priorAnswerDisabled`)은 현재 빌더 설정 기준으로 비워 둔다. 조사 대상 명단 열은 파라미터 없이 응답 내역 컬럼 설정(`profileColumns`)의 표시 attrs·pii 열을 항상 붙인다 (pii 열이 있으면 PII 평문 → no-store) — Raw 행 조립은 라우트 폴더 로컬 raw-export-load.ts (contacts·operations 를 함께 읽어 한 도메인에 못 둔다. 순수 조각은 lib/analytics/raw-export-rows.ts — 이름이 같아 헷갈리던 것을 로더 쪽 개명으로 갈랐다)
GET    /api/surveys/[surveyId]/export/split-preview  # 분할 export 미리보기 (basis 없으면 `hasContacts` — 다이얼로그가 Raw Data 옵션 영역을 그릴지 판단. basis + `includeNonRespondents=1` 이면 `totalRows`·`nonRespondentRows` 를 더해 반환)
GET    /api/surveys/[surveyId]/contacts/export # 조사 대상 목록 엑셀 다운로드
GET    /api/surveys/[surveyId]/demand-summary  # 문항 수요 집계표 엑셀 (화면의 정렬·필터를 쿼리로 받음)
POST   /api/response/segment                   # 구간 응답 저장 (sendBeacon — REST 유지)
POST   /api/response/draft                     # 이탈 시점 임시 저장 (sendBeacon — REST 유지)
*      /api/inngest                            # Inngest 핸들러
POST   /api/webhooks/resend                    # Resend webhook (svix 검증)
GET    /api/legacy-guest-link/[surveyId]/[[...rest]]  # 옛 게스트 주소 다리 — 옛 운영 콘솔 주소를 직원은 내부 콘솔로, 옛 게스트는 외주 링크(/fw/<token>)로 (307, 전환기 장치)
*      /api/auth/[...all]                      # Better Auth 핸들러 (민감 POST 경로는 auth-sensitive IP rate limit 선적용)
```

---

## 백그라운드 잡 (Inngest)

`server/workflows/jobs/` — 5개 함수 (`jobs/index.ts` 등록). 잡은 여러 도메인의 쓰기를 조율하므로 workflows 층이 집이다.
클라이언트 어댑터(`lib/inngest/client.ts`)만 인프라로 lib 에 남는다.

| 함수                  | 트리거                            | 역할                                                      |
| --------------------- | --------------------------------- | --------------------------------------------------------- |
| `campaignDispatcher`  | event `mail/campaign.queued`      | 캠페인 발송 실행 (수신자 lease 기반)                      |
| `campaignReconciler`  | event `mail/campaign.dispatched`  | 발송 후 1/5/30분 reconcile — sent 멈춤(webhook race) 복구 |
| `r2DeletionExecutor`  | cron `TZ=Asia/Seoul 0 4 * * *`    | R2 유예 삭제 집행 (일 1회)                                |
| `r2KeyRefAudit`       | cron `TZ=Asia/Seoul 0 3 1 * *`    | R2 참조 인덱스 전량 재추출 (월 1회)                       |
| `mailFallbackSweeper` | cron `TZ=Asia/Seoul */10 * * * *` | 대체 발송 누락·큐 미발행 복구 (10분마다)                  |

로컬 dev: `pnpm inngest`. **Inngest 자동 sync가 끊겨 있어 함수 변경 배포 후 대시보드에서 수동 Resync 필요.**

---

## 개발 스크립트

```bash
pnpm dev              # 개발 서버 (Turbopack)
pnpm build            # 프로덕션 빌드 (Turbopack)
pnpm start            # 프로덕션 서버
pnpm lint             # ESLint 검사 (eslint 9 flat config)
pnpm lint:fix         # ESLint 자동 수정
pnpm test             # Vitest 단일 실행 (realdb 스위트는 제외 — 아래 test:integration)
pnpm test:watch       # Vitest watch
pnpm test:coverage    # 커버리지 (spss 계열만 집계)
pnpm test:e2e         # Playwright E2E
pnpm test:integration # 실DB 왕복 (*.realdb.test.ts, 로컬 supabase 54322 필요)
                      # pretest 가드가 「이 브랜치 스키마인가」를 먼저 본다 (아래 주의사항 13)
pnpm db:setup-test    # 테스트 DB 준비 (마이그레이션 전량 재생 = 재생 검증)
pnpm db:drift         # 실 DB ↔ 레포 객체 대조 (아래 "DB 드리프트 점검")
pnpm inngest          # Inngest 로컬 dev 서버
pnpm db:migrate       # 마이그레이션 실행 (_journal.json 기준 — 0019에서 동결, 주의사항 7 참조)
pnpm db:studio        # Drizzle Studio
pnpm survey:backup    # 설문 백업
pnpm survey:restore   # 백업에서 복원
pnpm versions:prune   # 버전 스냅샷 정리 (DRY_RUN 기본, :live 로 실행)
pnpm ledger:seed      # R2 발송 장부 시드
pnpm auth:seed        # 슈퍼어드민 발급/승격 — <email> <name> <password> (기존 계정이면 승격만)
pnpm workspace:seed   # 실전 시드 계획 출력 — 팀 5 + 실사 업체 + 0116 백필 검증 (DRY_RUN 기본)
pnpm workspace:seed:live  # 위를 실제 적용 — 인자로 실사 업체 이름 지정 가능. 재실행 안전
pnpm spss:migrate     # SPSS 필드 마이그레이션 (DRY_RUN 기본, :live 로 실행)
pnpm spss:rollback    # SPSS 필드 롤백 (:live 동일)
pnpm worker:sentry-jandi:dev     # Sentry→잔디 알림 워커 로컬
pnpm worker:sentry-jandi:deploy  # 워커 배포 (Cloudflare)
```

> `pnpm db:generate` / `pnpm db:push` 는 정의는 살아 있으나 **사용 금지** — 마이그레이션은 수동 SQL 관행이다(주의사항 7).

---

## 경로 별칭

```typescript
// tsconfig.json
"@/*" → "./src/*"

// 사용 예시
import { cn } from "@/lib/utils";
import { useSurveyStore } from "@/features/survey-builder/stores/survey-store";
import { Button } from "@/components/ui/button";
```

---

## 환경 변수

```env
# Supabase (DB 호스팅 전용 — 아래 3키는 앱 런타임 미사용, 유지보수 스크립트만 쓴다)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=                  # postgres-js → Supabase Transaction pooler(pgBouncer, 6543). prepare:false 필수

# Cloudflare R2
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_R2_ACCESS_KEY=
CLOUDFLARE_R2_SECRET_KEY=
CLOUDFLARE_R2_BUCKET=
CLOUDFLARE_R2_PUBLIC_URL=

# 메일 (Resend)
RESEND_API_KEY=
RESEND_FROM_DOMAIN=
RESEND_WEBHOOK_SECRET=          # svix 서명 검증
EMAIL_SEND_MODE=

# 앱 / Inngest / Sentry
NEXT_PUBLIC_APP_URL=
INNGEST_*=
SENTRY_*=  NEXT_PUBLIC_SENTRY_DSN=

# Better Auth (lib/auth/server.ts)
BETTER_AUTH_SECRET=             # 세션 서명 비밀키 (openssl rand -base64 32)
BETTER_AUTH_URL=                # baseURL (로컬 http://localhost:3000)
BETTER_AUTH_TRUSTED_ORIGINS=    # 콤마 목록 (baseURL 은 자동 포함)

# PII 암호화
CONTACT_PII_AES_KEY=            # cipher 키 (환경별 분리 필수)
CONTACT_PII_HMAC_KEY=           # blind index 키
DUPLICATE_DETECTION_SALT=       # 중복 감지 해시 솔트

# 레이트리밋 (미설정이면 limiter no-op)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# 로깅 / 기타
AXIOM_TOKEN=  AXIOM_DATASET=  LOG_LEVEL=
ENABLE_PUBLIC_API=              # /api/v1 OpenAPI 표면 게이트 (기본 비활성)
GUEST_SURVEY_GRANTS=            # 옛 게스트 주소 다리의 허용 목록 (<userId>:<surveyId>,… — 설문 id 만 쓴다). 비우면 다리가 꺼진다
```

> 메일/컨택 메타(발신 표시명, 수행기관 등)는 env default 금지. DB 컬럼 또는 attrs로 관리. env는 비밀+인프라 상수만.
> `.env.example`의 `EMAIL_SEND_MODE` 는 코드 참조 0건이다 — 발송 모드 분기가 구현되지 않은 자리다. (`BETTER_AUTH_*` 는 2026-08-25 티켓 01부터 실사용.)

---

## src/lib 잔류 기준

lib 은 도메인의 집이 아니라 **소유자를 특정할 수 없는 것들**의 집이다. 남아도 되는 것은 두 부류뿐이다.

1. **인프라** — 외부 자원·프로세스 경계를 감싸는 어댑터(`logger`·`rate-limit`·`supabase`·`inngest`·`crypto`·`r2-env`). 앱 도메인이 아니라 실행 환경에 속해 어느 feature 도 소유하지 않는다.
2. **서버와 프론트가 함께 쓰는 계산** — 두 런타임이 각자 구현하면 규칙이 갈리는 것(`survey/substitute-tokens`·`survey-url`·`sanitize`·`analytics/analyzer`·`question/*`).

**판정은 폴더 이름이 아니라 소비자 실측으로 한다** (`node .scratch/tools/lib-final.mjs`).
`src/server`·`src/app`·`src/actions` 중 하나라도 부르면 **잔류**, `features`·`components` 만 부르면 lib 을 떠난다.

행선지:

- 소비자가 **한 feature 뿐**이면 그 feature 안으로. 그 feature 의 기존 `lib/`·`utils/`·`hooks/` 관례를 따르고 **새 하위 폴더를 만들지 않는다**.
- **여러 feature 나 `components/ui`** 가 부르면 공용 구역으로. **순수 함수는 `src/utils/`**, **DOM·네트워크·React 를 만지는 런타임 조각은 `src/shared/lib/`**.
- 단 feature 간 방향(`survey-builder → survey-response → question-renderer`)이 허용하면 **하위 feature 에 두는 것이 공용 구역보다 낫다** — 특히 렌더러가 주입받는 컨텍스트는 렌더러가 소유한다.
- **옮기면 공용 구역(`lib`·`utils`)이 `features` 를 가리키게 되는 파일은 그대로 둔다.** 그 역전은 ESLint 금지 사항이고, 프론트만 쓰는 것처럼 보여도 공용 구역 소비자가 하나라도 있으면 잔류가 정답이다.

### 재수출 원칙

모듈을 옮긴 뒤 옛 자리에 `export { X }` 를 남길지의 기준은 **정의가 몇 곳이냐**다.

- **허용** — 정의가 한 곳이고, 되내보내는 자리가 소비자에게 자연스러운 묶음일 때.
  `types/survey.ts` 가 `shared/contracts/survey` 의 `GroupNameDesign`·`SurveyResponseHeaderConfig` 를
  되내보내는 것이 그 예다. 소비자 대부분이 `Question`·`QuestionGroup` 과 같은 문장에서 함께 받으므로
  import 를 한 자리에 두는 편이 낫고, 정의가 하나뿐이라 드리프트가 생길 수 없다.
- **금지** — 구현을 감춘 척하는 얕은 모듈, 그리고 **옛 이름으로 가는 통로만 남기는 relay**.
  호출자가 옛 이름을 계속 거치면 새 경계가 가짜가 된다. 소비자를 새 집으로 재배선하고 통로를 지운다.

판정은 소비자 실측으로 한다. **여러 줄 `import { ... } from` 블록은 한 줄 grep 으로 안 잡히니
파일 단위로 세거나 tsc 에게 물을 것** — 2026-08-25 리뷰에서 이 착시로 살아 있는 재수출을 죽은 것으로 오판했다.

---

## 코드 컨벤션

### 파일 명명

- 컴포넌트: `kebab-case.tsx` (예: `question-edit-modal.tsx`)
- 스토어/유틸/액션/타입: `kebab-case.ts`
- **server/ 트리는 무접미사** (ADR 0016) — `.service.ts`·`.server.ts` 금지, 폴더가 계층을 말한다. 메타테스트(`tests/repo/server-tree-naming.test.ts`)가 강제
- **`.server.ts` 는 lib 등 공유 트리 전용** — "공유 트리 속 서버 전용" 표시. 마킹은 내용물 기준(server-only·DB·서버 env 의존)이며 소비자 기준 금지
- **서버 파일과 같은 어간의 lib 공유 계산은 역할 접미사** — `-format` 기본(예: `drop-funnel-format.ts` ↔ server `drop-funnel.ts`), 서버가 어간을 소유
- **도메인명 접두 제거는 services 층 한정** — `domain/` 의 `mail-*`·`contact-*` 는 접두가 아니라 DB 테이블·도메인 어휘와 정합하는 개념명이라 유지한다 (예: `mail-campaign` ↔ `mail_campaigns`)

### 컴포넌트 구조

```typescript
// 1. 임포트
import { useState } from "react";
import { useSurveyStore } from "@/features/survey-builder/stores/survey-store";
import { Button } from "@/components/ui/button";

// 2. 타입 정의
interface Props {
  questionId: string;
  onSave: (data: QuestionData) => void;
}

// 3. 컴포넌트
export function QuestionEditor({ questionId, onSave }: Props) {
  const { questions, updateQuestion } = useSurveyStore();
  const [isEditing, setIsEditing] = useState(false);

  const handleSave = () => { /* ... */ };

  return <div>{/* JSX */}</div>;
}
```

### 경계 스키마와 z.custom

`z.custom<T>()` 은 **검증 함수를 주지 않으면 런타임에 아무것도 보지 않는다** — 타입만 붙고 값은
그대로 흐른다. 반대로 `z.object()`(및 `.partial()`)는 unknown 키를 **버린다**(`src/zod-unknown-key-contract.test.ts`
가 실측으로 못 박는다).

그래서 **요청 객체를 DB 쓰기로 넘기는 입력 스키마에는 z.custom 을 쓰지 않는다.** 실제로
`UpdateSurveyDataSchema` 가 z.custom 이던 시절 서비스가 그 객체를 drizzle `.set()` 에 펼쳐,
`survey.edit` 만 가진 팀원이 `ownerUserId` 를 실어 소유자 전권으로 승격하고 `deletedAt` 으로
삭제 관문까지 우회했다(2026-08-27). 지금은 `.strict()` allowlist + 서비스의 명시 필드 대입 두
겹이다.

z.custom 이 남아도 되는 자리는 둘이다 — **출력 스키마**(요청자가 못 만진다)와 **JSONB 리프
필드**(`options`·`displayCondition`·`attachments`·`scheme` 등. 값이 JSONB 컬럼으로만 가고 권한
컬럼에 닿지 않으며, 형태 드리프트는 로더 정규화가 받는다). 그 경우에도 **쓰기는 명시 필드
대입**이어야 한다 — 스프레드 한 줄이면 위 사고가 재현된다.

### 언어/스타일

- 문서/주석은 한국어, 변수명/함수명은 영어.
- 코드(주석/로그/UI 텍스트/라벨)에 이모지 금지.
- git commit 메시지는 한국어: `feat: OOO 기능 추가` 형식, 괄호 `()` 금지.

---

## 디자인 시스템

디자인 언어 참조는 [DESIGN.md](DESIGN.md). Apple 웹 디자인 시스템 기반이며, **폰트는 SF Pro 대신 Wanted Sans Variable로 통일**한다.

- **코드 SoT**: 디자인 토큰의 실제 source of truth는 [globals.css](src/app/globals.css)의 `:root` CSS 변수 + `@theme inline` 매핑. DESIGN.md는 목표 명세, globals.css가 현재 구현.
- **적용 범위 주의**: DESIGN.md 명세는 Apple 마케팅/쇼케이스 사이트 기준(17px body, 80px 섹션, 저밀도 tile). **설문 빌더·운영 콘솔은 고밀도 도구 UI**라 토큰(색·radius·그림자 절제·weight ladder)만 참조하고 마케팅 스케일/밀도는 적용하지 않는다. Apple 정통 스케일은 랜딩·공개 응답 페이지(`/survey`)에 적합.
- **색상 명세 정렬(2026-06-11)**: DESIGN.md 블루 계열을 코드 버튼 관행으로 갱신 — primary `#3b82f6`(blue-500), hover `#2563eb`(blue-600), on-dark `#60a5fa`(blue-400). 잔여 갭: globals.css `--primary`(#007aff) 토큰 불일치, 버튼 radius `rounded-lg`(명세 pill), `shadow-sm` 사용(명세 금지), `font-medium`(500, 명세 제외) — 코드 정렬은 별도 작업.

---

## 쓰기 변경 체크리스트

데이터를 쓰거나 권한·외부 호출이 걸린 변경은 **스펙(PRD) 단계**와 **적대적 리뷰 단계** 두 번 이 절을 거친다. 2026-10-19 컨택원 배정에서 테스트·리뷰가 통과한 뒤에야 동시성·일관성 문제가 질문으로 드러났다 — 스펙에 적히지 않은 성질은 TDD 가 테스트를 만들지 않고, 리뷰도 눈에 띄는 버그에서 멈춘다.

### 1. 변경 종류를 먼저 정한다

| 변경 종류                    | 예                                | 볼 항목                                                       |
| ---------------------------- | --------------------------------- | ------------------------------------------------------------- |
| 읽기만 하는 화면·문구        | 라벨, 정렬, 표시 방식             | 인가 · 기밀성                                                 |
| 한 행을 쓰는 작업            | 상세에서 한 명 바꾸기             | + 정확성 · 멱등성 · 중복 방지 · 원자성                        |
| 여러 행을 한꺼번에 쓰는 작업 | 교체 적용, 명단 업로드, 일괄 배정 | 아래 항목 전부 — 특히 동시성 · 데드락 · 경쟁 상태 · 격리 수준 |
| 외부 서비스·비동기 작업      | 메일 발송, Inngest, webhook       | + 가용성 · 재시도 · 최종 일관성 · 장애 복구 · 로그            |

### 2. 항목마다 답을 적는다

답은 셋 중 하나다 — **지킨다(어떻게)** / **해당 없음(이유)** / **일부러 안 지킨다(이유)**. 이유 없는 "해당 없음"은 답이 아니다. 추상적으로 다시 생각하지 말고 **이 레포에 이미 있는 장치를 썼는가**로 확인한다.

| 항목                 | 질문                                                                                                                        | 이 레포에서 확인할 것                                                                                                                                                                                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 정확성               | 경계값·빈 조건·자기가 바꾸는 값을 조건으로 다시 읽는 경우에도 맞는가? 해석 못 한 입력을 조용히 버려 범위가 넓어지지 않는가? | 쓰기 경로는 해석 실패를 거부한다(컨택원 교체 적용·단체 메일 `fetchCandidateIds` 선례). 조건 판정은 `COALESCE(…, FALSE)`                                                                                                                                                                                  |
| 멱등성 · 재시도      | 같은 요청이 두 번 오거나 실패 후 재시도해도 결과가 같은가?                                                                  | "결과 상태를 정하는" 쓰기인가. 교착·직렬화 실패는 `retryOnTxConflict`(lib/pg-error)                                                                                                                                                                                                                      |
| 중복 방지            | 중복 행이 생길 수 있는가?                                                                                                   | DB 유일 제약 + `isUniqueViolation`(drizzle 이 감싼 `cause` 까지 본다). 앱 쪽 존재 확인만으로 막지 않는다                                                                                                                                                                                                 |
| 동시성 · 경쟁 상태   | 같은 대상을 두 사람이 동시에? 다른 대상끼리 겹치면? 누가 이기는가?                                                          | 쓰기 파티션은 `lockWriteScope`, 같은 묶음 직렬화는 행 `FOR UPDATE`, 셀·키 단위 직렬화는 `pg_advisory_xact_lock`(쿼터 진행 중 마감 선례)                                                                                                                                                                  |
| 데드락               | 여러 행을 다른 순서로 잠그는 작업끼리 엇갈리는가?                                                                           | 잠금 순서 통일 또는 한 줄 세우기, 최소한 `retryOnTxConflict`                                                                                                                                                                                                                                             |
| 격리 수준 · 트랜잭션 | 읽고 나서 쓰는 사이 데이터가 바뀌면? 두 문장이 서로의 결과를 다시 읽는가?                                                   | 기본은 READ COMMITTED 다. 판정과 쓰기를 한 문장으로 묶거나(교체 적용 단일 UPDATE 선례) 행을 잠근다                                                                                                                                                                                                       |
| 원자성 · 장애 복구   | 중간에 실패하면 반쯤 바뀐 상태가 남는가?                                                                                    | 한 `db.transaction` 안인가. 트랜잭션 밖 부수 효과(메일·R2·큐 발행)는 커밋 뒤에, 유실 시 복구 경로(sweeper·유예 큐)가 있는가                                                                                                                                                                              |
| 무결성               | 지켜야 할 규칙을 DB 가 막는가, 코드만 막는가?                                                                               | FK · CHECK · UNIQUE 로 막을 수 있으면 마이그레이션에 넣는다. 코드로만 막으면 그 사실과 쓰기 경로 목록을 스펙에 적는다                                                                                                                                                                                    |
| 일관성 · 최종 일관성 | 화면 숫자·미리보기·실제 결과가 같은 기준·같은 시점인가? 비동기면 언제 맞춰지는가?                                           | 표시·필터·정렬이 같은 SQL 식을 공유하는가(`matchedResponseSubquery` 등). 비동기는 reconcile·sweeper 가 있는가                                                                                                                                                                                            |
| 인증 · 인가          | 권한 없는 사용자·외부 주체·다른 설문 사용자가 들어오면?                                                                     | `authed`/`scoped` 베이스 + 핸들러 첫 줄 capability 관문(`assertSurveyCapabilityRpc`·`assertScopedSurveyCapabilityRpc`), RSC 는 `requireAdminPage` + `assertSurveyCapabilityPage`, 외부 주체 판정은 `isExternalActor`/`isExternalViewer`. 설문 id 를 받는 새 표면은 `cross-team-idor-rpc` 인벤토리에 등재 |
| 기밀성               | 개인정보 평문이 화면·RSC props·로그·내보내기로 나가는가?                                                                    | 목록·패널은 마스킹 힌트만, 로그는 `redact` 경로, 평문을 내보내면 no-store                                                                                                                                                                                                                                |
| 가용성               | 외부 API·DB 가 느리거나 죽으면? 실패하면 사용자에게 뭐가 보이는가?                                                          | 레이트리밋 fail 방향(`withRateLimit`), 타임아웃, 재시도·안내 문구                                                                                                                                                                                                                                        |
| 확장성               | 트래픽·데이터가 10배면?                                                                                                     | 인덱스, 페이지 상한, 한 요청이 도는 행 수, URL·바인드 파라미터 한계                                                                                                                                                                                                                                      |
| 관측성               | 문제가 나면 로그로 원인을 찾을 수 있는가?                                                                                   | RPC 는 `rpcLoggingMiddleware` 가 1줄 남긴다. 재시도·충돌·조용한 폴백은 따로 경고 로그                                                                                                                                                                                                                    |

### 3. 단계별 쓰는 법

- **스펙(PRD) 단계**: 1의 변경 종류와 2의 답을 PRD 의 「Implementation Decisions」 또는 별도 절에 적는다. 「지킨다」로 적은 항목은 수락 기준이 되고, 티켓·TDD 가 그 테스트를 만든다(동시성·데드락은 실DB 테스트 — `*.realdb.test.ts`).
- **적대적 리뷰 단계**: 초점 문구로 이 절을 넘긴다. 예 —
  `/codex:adversarial-review AGENTS.md 「쓰기 변경 체크리스트」 항목별로 실패 시나리오를 찾고, 문제없는 항목도 근거를 적어줘. 결과는 한국어로`
- **리뷰를 받은 뒤**: 지적마다 실DB 테스트로 먼저 재현하고(RED) 고친다. 재현이 안 되면 그 근거를 남긴다.

---

## 주의사항

1. **타입 안전성**: Drizzle ORM + TypeScript strict. JSONB 컬럼은 `src/shared/contracts/*`의 타입으로 `.$type<...>()` 지정. 클라이언트 트리(features/components/hooks/stores/utils)는 `@/db` 값 import 금지(ESLint, type 은 허용).

   **함정: Drizzle 의 `text(..., { enum: [...] })` 는 TypeScript 전용이라 SQL CHECK 를 만들지 않는다.** 실제 제약은 마이그레이션이 손으로 쓴 별도 목록이고, 스키마 파일의 `check()` 블록도 또 하나의 사본이다 — 어휘 배열(`@/types/*`)만 고치고 배포하면 tsc 는 통과하는데 새 값을 담은 INSERT 가 CHECK 제약에서 깨진다. 어휘를 늘릴 때는 배열·`check()`·마이그레이션 셋을 함께 볼 것 (`mobile_table_display_mode` 가 그 예).

2. **상태 관리**: 서버 상태는 TanStack Query, 클라이언트 상태는 Zustand(+Immer).

3. **응답 페이지는 snapshot 기반**: 빌더 수정은 publish 전까지 응답 페이지 미반영. "테스트 모드 OK + 응답 페이지 NG" 패턴이면 publish 누락 먼저 의심. 단, `quotaConfig`·`isPaused`·`pausedMessage`는 스냅샷 밖 라이브 컬럼이라 즉시 반영된다.

4. **테이블 질문**: `tableColumns`, `tableRowsData`, `tableHeaderGrid`, `tableValidationRules`, `dynamicRowConfigs`, `rowRepeatConfig`, `sumConstraints` JSONB 사용. choice 응답값은 `cell.id`.

   **행 차례로 열기**(`stagedRowsConfig`, 0132)는 행 반복과 또 다른 기능이다(ADR 0028) — 저작자가 직접 만든 평범한 행 묶음을 처음 N행만 보이고 `+` 로 한 행씩 연다. **구조를 펼치지도 접지도 않는다.** 묶음의 행은 평범한 행이라 선택 칸·셀 게이팅·합계 제약이 그대로 동작하고, 내보내기 열은 열림 여부와 무관하게 항상 나간다(행 반복의 미사용 벌 pruning 없음). 열린 행 수는 저장하지 않고 값에서 파생한다 — `max(처음 보이는 행 수, 값이 있는 마지막 묶음 행)`(`features/question-renderer/utils/staged-rows.ts` 의 `deriveOpenStagedCount`, 게이팅으로 닫힌 칸의 값은 없는 것으로 친다). **필수 판정도 같은 함수를 쓴다** — 그 뒤의 묶음 행만 필수에서 빠진다(`stagedOptionalCellIds`). 행 반복의 「1벌만」과 다르다. `−` 는 마지막으로 연 행의 값을 비우고 닫는다. 버튼 줄은 묶음 바로 아래에 선다: 데스크톱 표는 격자 한 줄(`use-dynamic-row-layout` 의 `stagedControl`)이고 묶음을 가로지르는 세로 병합 칸은 `_gridRowSpanExtra`(런타임 전용)로 그 줄까지 덮는다 — 가로지르는 칸이 왼쪽 끝에 붙어 있지 않거나 같은 표에 동적 행 셀렉터가 있으면 병합을 앵커에서 쪼갠다. 모바일 「항목 단위 카드」는 블록마다(`MobileItemCards` 의 `afterRows`), 그 밖의 모바일 표시 방식은 표 아래에 한 번. 묶음에 넣을 수 없는 행은 행 반복 행·동적 행 그룹 행·표시 조건 행·**보기 옵션(choice_opt)·순위 옵션(ranking_opt) 셀이 든 행**이고(`validateStagedRows`) — 그 선택은 행의 칸 값이 아니라 표 응답 안 예약 키·문항 응답에 저장돼, 열린 수 파생·닫을 때 값 비우기·필수 범위가 따라가지 못한다 — 표가 바뀌어 묶음이 깨지면(`isStagedRowsIntact`) 설정을 **명시적 null** 로 끈다(`question-table-fields.tsx`). 응답 화면과 검증은 저장된 설정을 그대로 믿지 않고 `resolveStagedRows` 로 구조가 성립할 때만 동작시킨다(깨졌으면 전부 보인다). 열린 수에는 **응답 칸(게이팅 가능 유형)의 값만** 센다 — 계산 칸은 저장 경계가 값을 주입해(빈 행도 '0') 세면 저장 전후로 열린 수가 달라진다. 설정 카드는 테이블 유형 문항에만 나온다(보기·순위 문항의 내장 표는 다른 렌더러라 설정을 읽지 않는다). 문항 복제는 `remapStagedRowIds` 로 행 id 를 옮긴다. 순수 로직이 lib 이 아니라 renderer 에 있는 것은 소비자가 features 뿐이어서다.

   **행 반복**(`rowRepeatConfig`)은 동적 행 그룹과 다른 기능이다 — 저쪽은 빌더가 만들어 둔 행 풀에서 응답자가 고르는 것이고, 이쪽은 같은 모양의 칸을 원하는 벌 수만큼(최대 20) 반복하는 것이다. 설정은 분리하고 렌더 파이프라인(`use-dynamic-rows`)만 공유한다. 구조에는 저장 시점에 최대 벌까지 **실제로 펼쳐 둔다**(`lib/question/row-repeat.ts` 의 `expandRepeatRows`) — 응답값 키가 발행 스냅샷 안의 `cell.id` 로 유지되어 저장 경계·초안·이월 임포트·관리자 편집이 전부 무변경이다. **펼치기는 멱등**이어야 한다(이미 있는 벌은 행·셀 id 를 그대로 두고 템플릿 구조 변경만 전파). 표에 반복 블록을 켜면 그 표의 `rowCode` 를 **명시 발번**한다 — `buildTableCellVarName` 의 제로패딩 자릿수가 `rows.length` 기준이라 20벌로 펼치는 순간 같은 표의 비반복 행 변수명이 `r1` → `r01` 로 통째 바뀌기 때문이다. 내보내기는 모수 전체를 1회 스캔해(`lib/analytics/row-repeat-usage.ts`) 아무도 채우지 않은 뒤쪽 벌의 열을 뺀다(설문 전체 기준 — 분할 파일 간 열 구성이 갈리지 않도록). 필수 검증은 1벌만 본다.

5. **다단계 선택**: `selectLevels` 배열로 3단계까지. 부모 선택에 따라 동적 로딩.

6. **export 라벨**: `cell.exportLabel || generateExportLabel(questionCode_열_행)` 폴백 필수 (빌더는 placeholder만 표시, DB null 흔함).

7. **마이그레이션 — 수동 SQL 관행**: drizzle `_journal.json`은 **0019에서 동결**됐고 0020 이후는 전부 손으로 쓴 `.sql`을 `supabase/migrations/`에 두고 Supabase MCP `apply_migration` 또는 직접 SQL로 적용한다. 새 파일을 추가하면 **반드시 `supabase/migrations/manual-migrations.json`의 `migrations`에 tag(확장자 제외 파일명)를 등재**해야 한다 — 미등재는 추적 불가 drift로 보고 CI(`.github/migration-journal-gate.ts`)가 차단한다. `pnpm db:generate`/`db:push`는 이 관행과 충돌하므로 쓰지 않는다. `TRUNCATE CASCADE` 금지 (ON DELETE SET NULL 무시).

   **새 마이그레이션은 빈 DB에서 재생 가능해야 한다.** 2026-08-19부터 테스트 DB는 `drizzle-kit push`가 아니라 마이그레이션 전량 재생으로 만들어진다(`scripts/setup-test-db.sh`). 즉 `pnpm db:setup-test`가 곧 재생 검증이며, 기존 상태를 전제한 문장을 넣으면 거기서 깨진다. 실 DB에만 있고 레포에 없는 객체는 `pnpm db:drift`가 잡는다 — 자세한 내용은 아래 "DB 드리프트 점검" 참조.

8. **앱 생성값 NOT NULL 컬럼은 2단계 배포**: nullable 추가 + 백필(배포 전) → 앱 배포 → `SET NOT NULL`(라이브 후). 한 번에 걸면 구버전 앱 INSERT가 깨진다.

9. **서버 sanitize**: jsdom 의존 라이브러리 금지 (isomorphic-dompurify 크래시). `sanitize-html` 사용.

10. **테스트**: 단위 테스트의 집은 SUT 소스 옆이다(ADR 0017, 전면 colocation — 2026-08-25 실측 src 466파일). 명명은 소스 어간 정합 — 1:1은 `<소스>.test.ts(x)`, 한 소스의 측면 시리즈는 `<어간>-<측면>.test.ts`, 여러 소스를 가로지르는 시나리오는 주 SUT 폴더에 주제명(app 라우트는 `route.test.ts`/`route-<측면>.test.ts`, 교차 라우트는 서술명). ESLint 경계가 colocation 을 막으면 의존 방향이 허용하는 쪽 SUT 폴더에 둔다(예: branch-logic-drift 는 공용 구역→server 금지라 server 도메인 쪽, 빌더 프리뷰 스토어 배선 테스트는 renderer 의 feature import 금지라 빌더 stores 쪽). 양쪽 다 막히는 교차 feature 계약은 `tests/repo` 로(예: measurement-font). `tests/` 에는 계층·계약 스위트만 산다 — `integration/`(service 모킹 패턴: top-level `vi.mock` + `vi.mocked`, realdb 포함)·`e2e/`·`repo/`(src 밖 소스·레포 계약)·fixtures/helpers/stubs/setup. 이 배치는 메타테스트(`tests/repo/test-tree-layout.test.ts`)가 강제한다. Vitest include 는 `tests/**` + `src/**/*.test.{ts,tsx}` + `workers/`, `.tsx` 는 jsdom 프로젝트 자동 분기(DOM 이 필요한 `.ts` 만 `DOM_TS_TESTS` 등재). 실DB 왕복은 `*.realdb.test.ts` — `pnpm test:integration`(로컬 supabase 54322 필요), 일반 `pnpm test`에서는 스킵. `tests/integration/profiles-row-actions.test.ts`의 오랜 flaky 는 2026-08-19 에 수리했다. 원인은 그 파일이 `@/db/schema` 에 `vi.mock` 을 두 번 걸고 있던 것이다 — 같은 경로에 두 번 걸면 어느 팩토리가 이기는지 보장되지 않고, `{ __table }` 만 주는 쪽이 이기면 `col.__col` 이 undefined 라 mock `eq()` 가 항상 false 를 반환해 모든 조건 조회가 빈 결과가 된다. 그 결과 14건 중 12건이 `SurveyOwnershipError:not_found` 로 무너졌다. "전체 스위트에서만 모킹 간섭으로 깨진다"·"격리하면 항상 통과" 두 진단 모두 틀렸고, 중복 제거 후 전체 스위트에 포함해도 통과해 2단 격리 구조와 `ISOLATED_FLAKY_TESTS` 를 걷어냈다. **같은 모듈에 `vi.mock` 을 두 번 걸지 말 것.**

11. **vitest의 `server-only` stub 사각지대**: 클라이언트/서버 경계 위반은 테스트가 통과해도 빌드에서만 드러난다. 경계를 건드렸으면 `pnpm build`로 확인할 것.

12. **로컬 테스트 DB 는 워크트리 공용이다**: `question-demand-survey`·`tracking-survey`·`workspace-roles-v2` 가 같은 Supabase 컨테이너 하나(`project_id = survey-table-project`, 54322)를 쓴다. `config.toml` 이 추적 파일이라 포트·project_id 를 워크트리별로 가를 수 없다. `db:setup-test` 는 **전체 드롭 + 그 워크트리 마이그레이션만 재생**이므로 형제의 스키마를 통째로 덮는다. `pnpm test:integration` 앞에 `scripts/check-test-db-schema.mjs` 가드가 붙어 있어 스키마가 이 브랜치 것이 아니면 **재생하라는 메시지 하나로 멈춘다** — 그 가드가 없던 동안 47파일 전멸이 코드 회귀처럼 보였다. 가드는 DB 에 마커를 심지 않는다(심으면 `db:drift` 가 레포에 없는 객체로 잡는다) — 마이그레이션 파일에서 기대 테이블을 뽑아 대조하고, 판정이 애매하면 통과시킨다.

    **마이그레이션 번호는 그보다 조용한 축이다.** 브랜치들이 같은 base 에서 갈라지면 같은 번호를 서로 다른 뜻으로 선점할 수 있고(실제로 0101·0102 가 그랬다), CI 게이트는 **태그 전체**만 보므로 접두 중복을 잡지 못한다(`0003_*`·`0009_*`·`0019_*` 가 이미 공존한다). 새 마이그레이션 번호는 **세 워크트리의 최댓값 + 1** 로 잡고, 재생 순서는 파일명이 아니라 `manual-migrations.json` **배열**이므로 **두 번째로 병합하는 쪽은 배열 끝에 append** 한다(번호순 삽입 금지).

13. **drizzle 함정**: timestamptz optimistic lock은 PG μs ↔ JS ms 정밀도 차로 거짓 충돌 (version int 또는 string mode 사용). `ANY(${arr})` 바인딩 금지 (length=1 silent unwrap) → `inArray`/`sql.join`. jsonb 컬럼에 `JSON.stringify` 바인딩 금지 (이중 인코딩) → 객체 그대로 전달.

14. **응답 루트 사이드카**: `questionResponses` 최상위의 `__` 접두 키(`__optTexts__` 기타/상세 기재, `__changeConfirm__` 추적조사 변동 확인)는 실존 문항이 아니라 저장 경계마다 분기가 필요하다 — 분리를 빠뜨리면 `saveDraft` 는 소속 검증에서 500 이 되고 `complete` 는 멤버십 필터에서 값을 조용히 버린다(둘 다 실제로 겪은 사고). 키와 정제 함수는 `lib/survey/response-sidecars.ts` 한 곳에 등록하고, 저장 경계는 `splitRootSidecars`/`isPersistedRootSidecarKey`/`sanitizeRootSidecar` 로만 판정한다. 등록되지 않은 `__` 키는 **저장에서 빠지고 경고 로그만 남는다** — 거부하면 등록을 빠뜨린 키 하나가 그 응답자의 초안 저장을 통째로 막는다(부분 저장이 없다). 문항 id 는 UUID 라 `__` 접두를 가질 수 없어 진짜 답변이 이 분기로 새지 않는다. `__dynamicRowSelections__` 는 2026-09-09 에 등재했다.

    **키 상수는 import 0 인 잎 모듈이 소유하고, 어느 키 모듈도 등록부를 되부르면 안 된다.** 순환이 닫히면 등록부가 남의 상수를 초기화 전에 읽어 계산 키가 `undefined` 로 등록되고, 그 사이드카가 등록 목록에서 **조용히 빠진다** — 저장이 거부가 아니라 누락으로 끝나므로 아무도 모른다. 2026-09-16 에 실제로 닫혀 있었고(`__optTexts__` 를 `lib/option-text-read.ts` 로 내려 끊었다), 순환을 만든 것은 등록부의 직접 import 가 아니라 `prior-answers → response-sidecars` 라는 **전이 closure 안쪽 간선**이었다. 그래서 등록부에 새 import 를 들일 때는 그 모듈의 closure 가 등록부로 돌아오지 않는지 봐야 한다. `lib/survey/response-sidecars-import-order.test.ts` 가 소스를 읽어 이 간선을 막고, 등록 키 집합 전체를 리터럴로 못박는다 — 키 문자열은 `question_responses` JSONB 에 그대로 저장되므로 개명하면 이미 저장된 응답의 사이드카가 고아가 된다.

15. **문항 가시성**: 표시 조건으로 숨겨진 문항의 응답은 **그 순간 지워진다. 되돌려도 살아나지 않는다** (2026-09-07 결정 — 세션 되돌리기 버퍼는 검토 후 미채택). 판정·삭제는 `lib/survey/question-visibility.ts` 의 `resolveVisibleQuestionIds`/`stripHiddenQuestionValues` 한 곳이다. 복제 금지 — 셀 게이팅(`cell-gating.ts`)과 같은 규약. 저장 경계 순서는 **숨은 문항 strip → 게이팅 strip → calc 재계산**이고, 완료 제출(페이로드·빈 complete)과 관리자 수정은 이 순서를 직접 조립하지 않고 **응답 확정** `server/survey-response/services/answer-finalization.ts` 의 `loadFinalizationMaterial`(잠금 밖) + `finalizeAnswers`(동기, 잠금 아래 가능)를 거친다 — 세 단계는 설문 구성·변경 유무와 무관하게 늘 돌고, 등록 사이드카 정제·자격미달 판정·암호화까지 한 번에 낸다(2026-10-19 — 계산 칸·게이팅 칸 유무로 건너뛰던 시절 표시 조건만 있는 설문의 빈 complete 와 안 고친 이탈 응답의 관리자 저장이 strip 을 빠뜨렸다). **초안·구간 저장에는 걸지 않는다.** 그쪽 answers 는 더티 키만 담은 부분 패치이고 저장이 jsonb 합집합 병합이라, strip 을 걸면 조건이 참조하는 상류 문항이 패치에 없어 멀쩡한 답이 지워진다. 새 저장 경로를 만들 때 이 구분을 지킬 것.

    **표 행도 같다**(2026-09-29): 보기 그룹 표(table)에서 행 표시조건으로 숨은 행의 셀 값·`__choiceGroups` 선택·`__optTexts__` 항목도 `stripHiddenQuestionValues` 가 지운다(문항 숨김과 번갈아 고정점 수렴). 필수 판정은 숨은 행·열의 보기 그룹을 뺀다 — `resolveChoiceGroupVisibleCellIds`(numeric-validation) 로 만든 집합을 `isQuestionAnswered`·`collectUnfilledChoiceGroup*`·`resolveGroupedRequiredMessage` 에 **같이** 넘길 것(하나라도 빠지면 「빨갛지 않은데 다음이 막힘」). 레거시 보기 소스 표(radio/checkbox)는 동적 행 선택이 표 응답 밖에 있어 이 필터를 쓰지 않는다.

16. **응답 종결 판정은 `status` 로 한다 — `is_completed` 는 종결 게이트가 아니다**: 자격미달(`screened_out`)은 완료 수 분자에서 빠지도록 `is_completed=false` 로 저장된다(`response-completion` 의 `isCompleted: !screenedOut`). 그래서 `is_completed` 를 "끝난 응답인가" 게이트로 쓰면 자격미달만 조용히 빠진다 — 재응답 허용이 `ok:true` 를 돌려주면서 아무것도 안 하던 사고가 이것이다(2026-09-21 수리). 어휘와 술어는 `shared/contracts/survey-response.ts` 가 SSOT 다: 열림 `isOpenResponseStatus` · 종결 `isConcludedResponseStatus` · 재응답 허용 대상 `isReeditableResponseStatus`(completed·screened_out). `is_completed=false` 를 쿼리에 쓰는 것 자체는 무방하나(열린 행 **후보** 조회 범위), 판정은 반드시 status 술어로 한 번 더 한다 — `lifecycle`·`response-row-create` 의 컨택 재사용 조회가 그 패턴이다.

17. **자격미달은 제출 시점에만 정해지지 않는다**: 관리자 응답 수정(`saveAdminEdit`)이 종결 응답(completed·screened_out)에 대해 `detectScreenOut` 을 다시 돌려 `completed ⇄ screened_out` 을 양방향으로 오간다(2026-09-21). 판정 재료는 평문 `finalResponses`(숨은 문항 strip → 게이팅 strip → calc 재계산 **이후**, PII 암호화 **이전**)여야 분기 매칭이 성립한다. `in_progress` 는 응답자 세션 중이라, `quotaful_out`·`bad` 는 자격미달과 다른 축의 종결이라 재판정하지 않는다. 스냅샷을 못 얻으면 재판정을 건너뛰고 기존 상태를 보존한다(calc 재계산과 같은 fail-safe). 바뀐 문항이 없어도 확정·재판정한다 — 판정은 응답 확정의 `screenedOut` 이다.

18. **설문 종료는 「새로 들어오는 사람」만 막는다 — 진행 중 응답은 끝까지 제출된다**(ADR-0030): 응답 접수 판정표(`server/survey-response/domain/acceptance.ts`)의 `survey_closed` 는 **신규 진입과 재응답 허용**만 거부하고 완료 제출·진행 중 계속은 통과시킨다(마감일과 같은 결 — 즉시 전면 중단의 수단은 `isPaused` 다). 술어가 **설문 행만** 본다: 종료는 버전 행을 건드리지 않아 버전은 published 로 남으므로 「설문 또는 버전」으로 물으면 새 응답이 그대로 들어온다. 반대로 `status_not_published` 는 closed 를 「발행된 적 있는 설문」으로 통과시킨다 — 한 술어에 섞으면 완료 게이트가 종료된 설문의 진행 중 응답을 미배포로 잘라낸다. **첫 화면 차단도 같은 범위다**: 종료된 설문은 이어 갈 것이 없는 방문자에게만 접수 종료 화면(`not_accepting`)을 그린다. 「이어 갈 것」은 서버가 초대 토큰의 조사 대상에게 열린 응답이 있는지 본 값(`SurveyControl.resumableByInvite`)과 브라우저의 세션 키 둘로 판정한다(`use-duplicate-guard` 의 `closedEntry`) — 중단처럼 무조건 첫 화면에서 막으면 새로고침 한 번에 진행 중 응답이 버려진다. 새 접수 게이트를 만들 때 종료를 중단과 같은 줄에 넣지 말 것.

---

## CI 게이트

`.github/workflows/ci.yml` — 변경 범위 판별 후 아래를 순차 실행한다. 로컬에서 미리 돌려야 할 것은 `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm test`.

| 게이트                | 스크립트                            | 역할                                          |
| --------------------- | ----------------------------------- | --------------------------------------------- |
| 공급망 보안 감사      | `.github/audit-gate.ts`             | 감사 리포트 평가 (리포트 누락 시 fail-closed) |
| RLS 하드닝            | `.github/rls-gate.ts`               | 마이그레이션의 RLS 정책 검증                  |
| 마이그레이션 드리프트 | `.github/migration-journal-gate.ts` | 미등재 `.sql` + 접두 번호 중복 차단           |

통합/E2E 잡은 로컬 supabase를 띄워 `pnpm test:integration` + `pnpm test:e2e`(Playwright chromium)를 돌린다.

---

## 마이그레이션 번호

파일명 접두는 재생 순서가 **아니다**. 순서는 `manual-migrations.json` 배열이 쥐고 있고 `scripts/migration-order.mjs`가 그대로 따른다 (`0003`·`0009`·`0019`는 이미 접두가 중복된다). 그래도 새 중복은 CI가 막는다 — 번호로 최신을 읽을 수 없게 되고 순서를 눈으로 확인할 수 없기 때문이다. 여러 브랜치가 같은 DB를 만지는 동안 각자 다음 번호를 집으면 이 상태가 재생산된다.

- 새 마이그레이션은 **디스크에 없는 다음 번호**를 쓴다. 다른 브랜치가 이미 쓴 번호도 피한다
- **나중에 병합하는 쪽은 `manual-migrations.json` 배열 끝에 append 한다.** 번호순으로 끼워 넣지 않는다 — 그 배열이 곧 빈 DB 재생 순서다
- 그래서 번호와 배열 순서가 어긋나 보일 수 있다. 만지는 객체가 서로소면 정상이다
- **역할 모델 v2 번호 재배치 (2026-09-17)**: v2 의 12개가 staging 의 0101~0110(main 계열)과 같은 숫자라 **0111~0122** 로 밀었다(상대 순서 유지). 매핑 — 0101→0111 better_auth_tables · 0102→0112 better_auth_v2_reconcile · 0103→0113 users_organization · 0104→0114 users_sessions_revoked_at · 0105→0115 teams_and_memberships · 0106→0116 surveys_team_scoping · 0107→0117 survey_groups · 0108→0118 survey_ownership_events · 0109→0119 survey_participants · 0110→0120 fieldwork_orgs · 0111→0121 contact_actor_fk_to_app_users · 0112→0122 response_fieldwork_attribution. 적용 이력 테이블이 없어 DB 작업은 없다 — 스테이징 DB 에는 이미 옛 번호로 적용돼 있고, 프로덕션 적용 대상은 **0112~0122**(0111 은 선반영 재현용이라 적용 금지)
- **외주 실사 링크 0126·0127** (2026-09-29, ADR-0026) — 링크 행(`survey_fieldwork_links`)과
  귀속 칸 둘(`contact_attempts.fieldwork_link_id`·`survey_responses.fieldwork_link_id`).
  두 칸을 한 마이그레이션에 넣은 것은 **배타 CHECK 가 두 테이블에서 같은 모양이어야** 하기
  때문이다 — 나눠 쓰면 뒤에 오는 쪽이 앞의 결정을 다시 읽어야 하고 그 사이에 한쪽만 제약
  없는 창이 생긴다. 응답 쪽 칸은 0127 이 만들고 **채우는 것은 대리 응답 경로**다
- **외주 실사 링크 0133** (2026-09-30, ADR-0027) — 단건 메일·응답 수정의 귀속 칸
  (`mail_campaigns.fieldwork_link_id`·`response_edit_logs.fieldwork_link_id`, 0127 과 같은 배타 CHECK
  모양). 빈 DB 재생·재적용 멱등은 임시 DB 로 확인했다. **처음 번호는 0128 이었다** — main 이 같은
  시기에 0128~0132 를 운영 DB 에 먼저 적용해 2026-10-12 병합 때 0133 으로 옮겼다(스테이징 DB 에는
  옛 번호로 적용돼 있고 본문은 그대로라 DB 작업은 없다)
- **링크 테이블 개명 0134** (2026-10-12, ADR-0029) — `survey_fieldwork_links` → `survey_access_links`,
  `kind`(NOT NULL default `'fieldwork'` — 기본값이 있어 2단계 배포가 필요 없다)·`client_tabs`,
  활성 링크 UNIQUE 를 `(survey_id)` → `(survey_id, kind)` 로. 이름이 박힌 인덱스·CHECK·PK·FK 를
  함께 옮겼다(Postgres 는 테이블 개명 때 따라 바꾸지 않는다). **귀속 칸 `fieldwork_link_id` 넷은
  이름을 그대로 둔다** — 채우는 것이 외주 링크뿐이다. 재적용이 까다롭다: 0126 의
  `CREATE TABLE IF NOT EXISTS` 가 옛 이름의 빈 껍데기를 다시 세우므로 0134 가 그것을 지운다(행이
  있으면 멈춘다). **테이블 개명은 옛 코드와 양립하지 않는다** — 스테이징은 푸시 직전에 적용하고,
  프로덕션은 0126·0127·0133·0134 를 함께 적용한다(그 테이블이 아직 없다)
- **main 계열 0124·0125** (2026-09-17): main 이 같은 날 0111·0112 로 만든 입력칸 높이·제목 서식본은 위 역할 모델 v2 번호(0111~0123)와 겹쳐 staging 병합 전에 0124·0125 로 옮겼다 — 번호 기록 표가 DB 에 없어 파일 이름만 바뀌고 이미 적용한 DB 는 그대로다
- **main 계열 0128~0132** (2026-09-30\~10-06): 0128 「행별 척도」 CHECK 갱신 · 0129 「항목 단위 카드」 CHECK 갱신 · 0130 최대 선택 개수 연동 `max_selections_source` · 0131 항목 단위 카드 블록 시작 열 `mobile_item_card_block_columns` · 0132 행 차례로 열기 `staged_rows_config`. main 이 0126·0127(외주 링크)을 비워 두고 0128 부터 썼다. **0128 과 0129 는 같은 CHECK(`mobile_table_display_mode`)를 차례로 갈아끼우므로 배열에서 이 순서를 지킬 것** — 0128 을 뒤에 재생하면 `item-cards` 가 빠진다. 배열은 0126·0127 뒤에 0128\~0132, 그 뒤에 0133 이다(0133 은 0126 의 링크 테이블만 전제하고 main 쪽 다섯과 만지는 객체가 서로소다)
- **main 계열 0135~0137** (2026-10-16\~10-19): 0135 메일 대체 발송 `mail_campaigns.parent_campaign_id`·kind `fallback`·`mail_recipients.email_column_key`/`source_recipient_id`·`next_fallback_run_number` · 0136 컨택원 배정 `contact_assignments`·`contact_targets.assignment_id` · 0137 대체 발송 처리 대기 `mail_recipients.fallback_pending_at`. main 이 staging 의 0133·0134(외주 링크 귀속·링크 테이블 개명)를 비워 두고 0135 부터 썼다. 배열은 0134 뒤에 0135\~0137 이다. 0133 과 0135 는 둘 다 `mail_campaigns` 에 칸·제약을 더하지만 이름이 겹치지 않는다(0133 은 `fieldwork_link_id`·배타 CHECK, 0135 는 `parent_campaign_id`·kind CHECK)

---

## DB 드리프트 점검

`pnpm db:drift [prod|staging]` — 실 DB와 레포가 만들어내는 DB(로컬 테스트 DB)의 객체 목록을 대조한다. 테이블·컬럼·enum·함수·인덱스·RLS·정책·anon 권한·이벤트 트리거(public 함수 연결 — 활성 상태·연결 함수 본문 해시·SECDEF·search_path·소유자 포함)를 보고, 이름이 같은데 정의가 다른 인덱스도 잡는다. 모든 조회는 READ ONLY 트랜잭션이다.

`migration-journal-gate`는 디렉터리에 있는 `.sql`이 등재됐는지만 본다. **파일로 쓰지 않고 실 DB에 직접 적용한 SQL은 그 검사에 걸리지 않는다** — 실제로 `lookup_contact_by_invite_token` 함수와 컬럼 6개가 그렇게 들어와 몇 달간 방치됐다(2026-08-19 발견·복구). 이 스크립트가 그 반대 방향을 본다.

- 전제: 먼저 `pnpm db:setup-test`로 로컬 테스트 DB가 최신이어야 한다. **로컬 supabase 도커는 워크트리 공용 단일 인스턴스라 다른 브랜치가 재생하면 통째로 바뀐다** — `setup-test-db.sh`가 `_repo_meta.migration_stamp`에 재생 지문을 찍고 `db:drift`가 대조해, 남의 DB와 대조하려 하면 exit 2로 멈춘다 (조용히 틀린 결과를 내던 것을 2026-08-31에 잡았다)
- 알려진 차이는 `supabase/drift-allowlist.json`에 **사유와 함께** 등재한다. 사유가 `미결`로 시작하면 결정이 남은 항목이며 매 실행 노출된다
- 비-UNIQUE 성능 인덱스는 동작 무관이라 참고 카운트로만 센다
- **배포 전에 돌릴 것.** 도구를 만든 것보다 정기적으로 돌리는 것이 값어치다

---

## Agent skills

### Issue tracker

이슈는 레포 내 `.scratch/<feature-slug>/` 아래 로컬 마크다운 파일로 관리. See `docs/agents/issue-tracker.md`.

### Triage labels

트리아지 라벨은 기본 어휘 그대로 사용 (needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

단일 컨텍스트 — 루트 `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

### Worktree bootstrap

- `superpowers:using-git-worktrees`로 프로젝트 로컬 worktree를 만들 때는 메인 checkout의 런타임 환경을 우선 공유한다.
- worktree 의 `node_modules` 는 **심볼릭 링크하지 않고 `pnpm install --frozen-lockfile` 로 실제 설치한다**(전역 store 하드링크라 십여 초). pnpm 11 의 `verify-deps-before-run` 이 링크된 `node_modules` 를 이물로 보고 자동 `pnpm install` 을 돌리는데, 모듈 퍼지 확인에서 멈춰 명령이 실행되지 않은 채 exit 0 으로 끝나고, 퍼지가 진행되면 링크 너머 메인 checkout 의 `node_modules` 가 지워진다 (2026-08-25 발견, 2026-10-06 재발).
- 메인 checkout에 존재하는 ignored 환경 파일(`.env`, `.env.local`, `.env.development`, `.env.development.local`)은 내용을 읽거나 출력하지 않고 worktree에 심볼릭 링크한다.
- worktree 준비 완료를 보고하기 전에 의존성 링크와 환경 파일 링크가 유효한지 확인한다.

### 문서 갱신

`update-docs` 스킬(`.agents/skills/update-docs/`)이 이 레포용 대조표를 갖고 있다. 코드가 문서와 어긋났을 때 이 스킬을 따른다 — 갱신 대상은 루트·영역 `AGENTS.md`(위 "문서 지도")와 `CONTEXT.md` 이고, `docs/superpowers/plans`·`specs` 와 ADR 본문은 시점 기록물이라 최신화 대상이 아니다.

> `CLAUDE.md` 는 같은 폴더의 `AGENTS.md` 를 가리키는 심볼릭 링크다(루트와 영역 문서 모두). 문서 수정은 항상 `AGENTS.md` 에 한다.
