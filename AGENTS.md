# Survey Table Project - 에이전트 참조 문서

## 프로젝트 개요

Next.js 16 기반의 고급 설문조사 빌더 + 운영 플랫폼. 복잡한 질문 유형, 조건부 로직, 버전 스냅샷, 컨택 관리, 메일 캠페인, SPSS/엑셀 내보내기, 분석 기능을 갖춘 엔터프라이즈급 애플리케이션.

---

## 문서 지도

이 파일은 **매 세션 실리는 공통 규칙**만 담는다. 영역별 상세는 그 코드 옆의 `AGENTS.md` 에 있다
(각 폴더의 `CLAUDE.md` 는 그 파일의 심볼릭 링크). Claude Code 는 그 폴더의 파일을 읽을 때 자동으로
싣지만, 다른 도구는 아니므로 **해당 영역을 만지기 전에 직접 읽을 것.**

| 작업 영역                                                                                   | 읽을 문서                                        |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 운영 콘솔 라우트 트리 · 응답 진입 경로(초대 링크·짧은 링크) · API 엔드포인트                | `src/app/AGENTS.md`                              |
| 운영 집계·파티션 · 진척 보고 분류 키                                                        | `src/server/operations/AGENTS.md`                |
| 메일 발송 주소·대체 발송                                                                    | `src/server/mail/AGENTS.md`                      |
| procedure 베이스·인증과 권한(게스트·보기 전용 게스트) · 테스트 모드·테스트 버전             | `src/server/AGENTS.md`                           |
| 쿼터                                                                                        | `src/server/quota/AGENTS.md`                     |
| 문항 수요조사 (조사표·영역 앵커·분할 레이아웃)                                              | `src/server/survey-document/AGENTS.md`           |
| R2 파일 수명주기                                                                            | `src/server/storage-lifecycle/AGENTS.md`         |
| 조사 대상 — 이월 응답 임포트 · 컨택원 배정 · 필터 해석 · ID 목록 검색 · 대상 정보 수정 현황 | `src/server/contacts/AGENTS.md`                  |
| 운영 콘솔 필터 바 구조                                                                      | `src/features/operations/AGENTS.md`              |
| DB 스키마 (테이블·컬럼·관계)                                                                | `src/db/schema/AGENTS.md`                        |
| 마이그레이션 번호 고르기·배열 순서·배포 전후 · DB 드리프트 점검                             | `supabase/AGENTS.md`                             |
| 질문 유형·셀 타입·테이블 검증 규칙 · 행 반복·차례로 열기 · 다국어 설문                      | `src/features/AGENTS.md`                         |
| 숨은 답 지우기 — 저장 경계 순서·조건 평가 컨텍스트·경로 밖 문항·표의 숨은 칸                | `src/lib/survey/AGENTS.md`                       |
| 레이트리밋 · 로깅 · Sentry                                                                  | `src/lib/AGENTS.md`                              |
| 기능 개발 체크리스트 (스펙·리뷰·완료 보고)                                                  | `.agents/skills/write-change-checklist/SKILL.md` |
| 도메인 용어                                                                                 | `CONTEXT.md`                                     |
| 결정 배경                                                                                   | `docs/adr/`                                      |

**변경 이력은 어느 문서에도 쌓지 않는다** — git log 와 ADR 이 그 자리다. 크기 상한(루트 4.5만·영역 3만 자)과 이 표의 등재는 `tests/repo/agent-docs-size.test.ts` 가 강제한다. 새 상세 절은 루트가 아니라
해당 영역 문서에 쓴다.

---

## 기술 스택

버전은 `package.json` 이 정본이라 여기 적지 않는다 — 무엇을 어디에 쓰는지만 적는다.

| 영역           | 기술                                        |
| -------------- | ------------------------------------------- |
| 프레임워크     | Next.js (App Router, Turbopack)             |
| UI 라이브러리  | React (React Compiler)                      |
| 스타일링       | TailwindCSS                                 |
| 컴포넌트       | shadcn/ui (Radix UI)                        |
| 상태관리       | Zustand + Immer                             |
| 데이터 페칭    | TanStack Query                              |
| RPC            | oRPC (server/client/tanstack-query/openapi) |
| 스키마 검증    | Zod                                         |
| 테이블         | TanStack Table                              |
| 텍스트 측정    | @chenglou/pretext                           |
| 리치 에디터    | TipTap                                      |
| 드래그앤드롭   | @dnd-kit                                    |
| ID 생성        | NanoID                                      |
| ORM            | Drizzle ORM                                 |
| DB 드라이버    | postgres (postgres-js)                      |
| 데이터베이스   | PostgreSQL (Supabase)                       |
| 파일 저장소    | Cloudflare R2 (S3 호환)                     |
| 이미지 처리    | sharp                                       |
| HTML sanitize  | sanitize-html                               |
| 이메일 발송    | Resend + React Email                        |
| 이메일 webhook | svix                                        |
| 백그라운드 잡  | Inngest                                     |
| 레이트리밋     | @upstash/ratelimit + @upstash/redis         |
| 로깅           | pino + @axiomhq/js                          |
| PDF 렌더       | pdfjs-dist (조사표 뷰어 + 서버 쪽 수 판독)  |
| 엑셀 생성      | ExcelJS                                     |
| SPSS .sav 생성 | sav-writer                                  |
| 차트           | Recharts + Tremor                           |
| 에러 모니터링  | Sentry (@sentry/nextjs)                     |
| 테스트         | Vitest + Testing Library + MSW + Playwright |
| 언어           | TypeScript (strict)                         |

> 참고: `xlsx`, `jszip` 의존성은 제거됨(2026-06-05). 엑셀 생성은 ExcelJS, SPSS는 sav-writer 사용.
> `react-hook-form`, `@tanstack/react-virtual` 도 제거됨(2026-08-22) — 소스 참조가 처음부터 0이었다.
> 폼은 제어 컴포넌트 + zod 로, 목록은 TanStack Table 로 직접 다룬다.
> sharp 0.35는 Vercel libvips 이슈로 `next.config.ts`의 `outputFileTracingIncludes` 우회가 걸려 있다 (업스트림 수정 시 제거).
> TipTap 36개 패키지는 `pnpm-workspace.yaml` overrides 로 한 버전에 묶는다 — `@tiptap/react` 가 `@tiptap/core`·`@tiptap/pm` 을 정확히 같은 버전으로 요구해 일부만 올리면 설치가 갈린다.
> 같은 자리에 `prosemirror-view` 도 묶여 있다. `@tiptap/pm` 은 정확한 버전을 못박는데 형제 `prosemirror-*` 는 `^1.x` 라, 풀어 두면 두 벌이 설치되어 `DecorationSet` 의 private 필드가 서로 다른 선언이 되고 tsc 가 TS2322 를 낸다.

---

## 프로젝트 구조

폴더마다 **무엇이 어디에 사는가와 그 자리의 규칙**만 적는다. 파일 목록은 `ls` 가 정본이다. 경계 규칙은 전부 ESLint 가 강제한다(아래 "데이터 흐름 아키텍처").

```
src/
├── app/                        # Next.js App Router
│   ├── admin/surveys/[id]/     # edit(빌더) · preview · analytics · operations(운영 콘솔 — `src/app/AGENTS.md`)
│   ├── admin/                  # billing/mail-cost · file-cleanup · login · profile · surveys/create
│   ├── api/                    # 아래 API 절
│   ├── survey/[id]/            # 공개 응답 페이지 (?invite=<uuid>) · i/[code]/ 짧은 초대 링크 · preview/[token]/
│   └── analytics/ · unsubscribe/
│
├── server/                     # oRPC 백엔드 — 코어 + 도메인 11개 (경량 DDD: domain 순수 · procedures 얇음 · services)
│   ├── (코어)                  # context · orpc(base·pub·authed·scoped·withRateLimit) · router · handler · openapi · rpc-logging · rpc-error-policy · rpc-timeout · health
│   │                           # data-scope = 요청이 어느 파티션(실/테스트)을 보는가 + 쓰기 잠금, response-filters = 어느 응답 행이 보이는가(8구역 공용)
│   ├── <domain>/               # survey-builder · survey-response · survey-document · operations · contacts · mail · analytics · library · auth · media · quota
│   │   ├── domain/             # zod 계약 + 순수 규칙. **client-safe** (server-only·Node·DB 의존 0). UI 도 쓰는 모양은 shared/contracts 소관 — 여기는 다시 내보내고 서버 전용 입력·규칙만
│   │   ├── procedures/         # authed/scoped/pub, 얇은 위임 + 옆에 *.test.ts
│   │   └── services/           # 비즈 로직 + drizzle (server-only, requireAuth/revalidatePath 없음)
│   │                           # 도메인 간 직접 import 금지, 내부는 상대경로. 타 도메인 테이블 직접 쿼리는 허용
│   ├── read-models/            # 여러 도메인 테이블을 **읽기만** 하는 projection. 도메인을 import 하지 않는다
│   │                           # survey-structure 의 getSurveyById 는 React cache — 사본을 만들지 말 것(RSC dedupe 가 깨진다)
│   │                           # version-snapshot 의 snapshotQuestions 는 비배열을 빈 배열로 접는다 — "구조가 깨졌다"와 "질문이 없다"를
│   │                           # 갈라야 하는 자리(응답 이관의 생존 판정 등)에서는 쓰지 말고 호출측이 직접 Array.isArray 로 볼 것
│   ├── workflows/              # 여러 도메인의 **쓰기를 조율**하는 흐름. 도메인을 부를 수 있는 유일한 층 — 파일이 늘면 그 자체가 신호다
│   │                           # test-mail-archive · test-version(ensureTestVersion) · jobs/(Inngest 함수 — 아래 백그라운드 잡 절)
│   └── storage-lifecycle/      # R2 유예 삭제 큐·발송 장부·참조 인덱스 (자기 r2_* 테이블만 만지는 독립 모듈)
│
│   ※ "여러 도메인이 쓴다"는 공용의 근거가 아니다 — 역할로 묶이지 않으면 제2의 lib 가 된다
│
├── features/                   # 프론트 기능 묶음 5개 (기능 단위 폴더 — 레이어 규약 아님, FSD 아님)
│   │                           # 방향: survey-builder → survey-response → question-renderer 단방향, operations·analytics 독립
│   │                           # builder → response 는 2건만 남았고 둘 다 의도된 공유다(옵션 텍스트 사이드카 저장소 —
│   │                           #   인용값 계산이 양쪽에서 같은 입력을 봐야 한다. 떼면 resetResponseState 의 원자적 리셋이 갈린다)
│   │                           # UI 는 @/server 전면 금지(타입 포함) — 모양은 @/shared/contracts 로
│   │                           # 루트 잔류 기준: ① 복수 하위 묶음이 소비하는 공용 조각 ② app 라우트가 직접 여는 진입점. 단일 묶음만 쓰면 그 묶음 안으로.
│   │                           #   새 묶음의 진입점은 폴더 안(table-editor 방식)
│   ├── survey-builder/         # 설문 편집기. 폴더 위상: hooks ← lookup ← condition ← table-editor ← question-edit ← question-list (DAG)
│   │                           # question-list · survey-document(조사표 오서링) · question-edit · table-editor(+cell-editor·bulk-generator) · condition
│   │                           # lookup(LUT, 공용 리프) · formula · group-manager · hooks · stores(survey-store·ui-store·test-response-store) · queries · lib · utils
│   ├── question-renderer/      # 빌더 미리보기·응답 페이지가 함께 쓰는 렌더 조각. 어떤 feature 도 import 하지 않는다 — 스토어 대신 response-sources 주입 계약으로 값을 받는다
│   │                           # 화면 공용 조각(응답 헤더·루트 그룹 배지·검증 배너·cell-text·survey-locale-context)도 여기가 집
│   │                           # cells/ · hooks/ · utils/(표 그리드·모바일 표시 투영·입력 형식·응답 품질·단독 선택 …)
│   │                           # 여러 feature 가 쓰는 순수 규칙(input-format·text-quality·exclusive-choice)은 방향상 가장 낮은 이 묶음이 소유
│   ├── survey-response/        # 응답 흐름 (flow·lifecycle·step-views). 렌더러만 import
│   │                           # hooks/ · lib/(순수 — version-rebase·검증·프리필·완료 문구·언어별 글자) · step-views/ · stores/(survey-response-store 실응답)
│   ├── operations/             # 운영 콘솔 — contacts·profiles·report·quota·mail-campaign·mail-template·filters·demand + hooks/·queries/
│   └── analytics/              # 차트·리포팅
│
├── shared/                     # 서버·프론트 양쪽 공용 (feature 직접 import 금지의 탈출구)
│   ├── contracts/              # 서버와 UI 가 합의한 모양 — UI 가 서버에서 가져오는 유일한 출처
│   │                           #   <domain>.ts    JSONB 문서 어휘 SoT (DB 스키마 $type<> 가 참조, 런타임 의존 없음)
│   │                           #   <domain>-io.ts 경계를 건너는 모양 — RPC 입출력 zod + RSC 가 props 로 넘기는 read model 행
│   │                           # 질문 구조 타입은 @/types/survey 소관(겹침 0)
│   └── lib/                    # rpc(client + orpc) · survey-control · image-utils(브라우저 이미지 압축)
│
├── actions/                    # 잔존 서버 액션 3파일 — 의도적 유지(auth login/logout · 수신거부 POST form). 아래 "표면 선택 원칙"
├── components/                 # 진짜 공용 UI(ui/ shadcn · providers/) — features 를 모른다
├── stores/                     # error-dialog-store 하나. 기능 스토어는 features/<x>/stores
├── hooks/                      # 범용 훅 4개(use-latest-ref · use-media-query · use-formatted-numeric-input · use-auto-grow-textarea). 기능 훅은 features 안
├── lib/                        # 인프라 어댑터 + 서버·프론트가 함께 쓰는 계산 — 무엇이 남는지는 아래 "src/lib 잔류 기준"
│                               # survey/ = 응답 판정 공용(question-visibility·answer-path·answerable-scope·table-cell-visibility·pii-retention …, 주의사항 14)
│                               # operations/ = 운영 콘솔 공유 계산(서버 쌍은 *-format.ts, ADR 0016), lib 안 서버 전용은 .server.ts 마킹(contacts-filter-sql.server.ts)
│                               # mail/ · contacts/ · quota/ · spss/ · analytics/ · question/(row-repeat 포함) · crypto/ · logger/ · rate-limit/ · supabase/ · inngest/(client 만)
│                               # r2-client.ts 가 S3Client 의 단일 소유자다 — R2 클라이언트를 새로 만들지 말 것
├── utils/                      # 순수 유틸리티 — 공용 구역이라 lib·server 도 쓴다
│                               # table-cell-field-policy.ts = 셀 필드 정책. TableCell 새 필드는 여기 한 줄 없으면 tsc 오류, owned 면 serialize-cell 견본 셀도 넣을 것
│                               # conditional-table-layout(응답 표 가시 투영 — 렌더러·차단 검증·저장 경계 strip 공용) · cell-gate-tree · survey-language · system-strings
├── db/                         # index.ts(drizzle postgres-js) · schema/(`src/db/schema/AGENTS.md`)
├── types/                      # 전역 타입·어휘 — survey.ts(질문 구조 SoT, shared/contracts 와 겹침 0) · question-types(배열 ↔ 타입 동치를 tsc 로 강제)
│                               # mobile-table-display · input-type(입력 형식 SSOT) · survey-locale
├── instrumentation*.ts         # Sentry
└── proxy.ts                    # Next 미들웨어 (/admin, /analytics 세션 갱신)
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
- procedure 베이스 3종은 `src/server/AGENTS.md` 「인증과 권한」 참조. 모든 베이스는 `rpcLoggingMiddleware`가 붙은 `base` 파생이라 성공/실패가 구조화 로그 1줄로 남는다.
- **표면 선택 원칙**: 브라우저 query/mutation 은 oRPC · RSC 는 service 직접 호출 · 업로드·파일 스트리밍·webhook·sendBeacon 은 Route Handler · **JS 없이 동작해야 하는 네이티브 폼과 redirect+쿠키 의미론만 서버 액션**. 서버 액션 0개가 목표가 아니다.
- 그 원칙에 따라 잔존 서버 액션은 `actions/` 3파일뿐 (auth login/logout + unsubscribe form — 의도적 유지).
- **서버 도메인 마이그레이션 패턴/함정**: domain zod는 `@/types/survey` 방향 통일 + null-coalescing(as unknown as 금지), service input은 zod infer, `.returning()` 후 non-null throw, 컴포넌트는 hook/helper 시그니처 유지로 무수정. 질문 영속 쓰기는 explicit field set(spread 금지) + `PERSISTED_QUESTION_FIELDS` SSOT 로 tsc 관할 — 신규 컬럼은 SSOT 등재만 하면 모든 쓰기 지점(survey-save values/onConflict, create, duplicate, updateQuestion 순회)이 컴파일 에러로 호명된다. **읽기 방향은 tsc 가 못 잡는다** — 발행 스냅샷·빌더 로드가 공유하는 행→Question 매퍼(`server/read-models/survey-structure.ts` `mapQuestionRow`)도 명시 나열이라, 누락 시 발행 스냅샷에서 값이 조용히 증발한다(noticeBgColor 실사고). 전수 대조는 `server/read-models/map-question-row.test.ts` 가 잡는다.
- 경계는 ESLint 가 강제한다 — 서버 도메인 간 직접 import 금지(공용은 `@/shared` 승격 또는 RPC 경유, 타 도메인 테이블 직접 쿼리는 허용) · 프론트 feature 는 builder→response→renderer 한 방향 · 공용 구역(components/hooks/stores/utils/lib/types/shared)과 서버는 features 를 import 하지 않음 · UI 는 `@/server` 전면 금지(타입 포함, 모양은 `@/shared/contracts`) · 클라이언트 트리는 `@/db` 값 import 금지. 규칙은 `no-restricted-imports` 의 gitignore 의미론(상위 디렉터리 매치는 negation 불가, 같은 files 에 같은 규칙 블록 둘이면 마지막이 덮어씀) 위에 쓰여 있으니 새 규칙은 프로브 파일로 발화를 확인할 것.

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
pnpm test:integration # 실DB 왕복 (*.realdb.test.ts) — 워크트리 공유 DB(postgres)를 쓴다
pnpm db:setup-test    # 공유 테스트 DB 를 통째로 다시 만든다 — 형제 워크트리의 realdb 가 깨진다
pnpm db:isolated <이름> # 내 브랜치 전용 테스트 DB(같은 컨테이너, 마이그레이션 전량 재생 = 재생 검증). 실행은 출력된 URL 로
                      #   RUN_REALDB=1 DATABASE_URL=<URL> pnpm exec vitest run <realdb 파일> · 지우기 `--drop`
pnpm worktree:new <브랜치> [시작점] # .claude/worktrees 에 워크트리 생성 + env·공유 자료 링크 + 설치 (아래 Worktree bootstrap)
pnpm db:drift         # 실 DB ↔ 레포 객체 대조 (supabase/AGENTS.md 「DB 드리프트 점검」)
pnpm db:size          # 실 DB 테이블·인덱스 크기와 인덱스 사용 횟수 (읽기 전용 — 대량 작업 뒤·배포 전에 보고, 부풀었으면 손으로 REINDEX CONCURRENTLY)
pnpm inngest          # Inngest 로컬 dev 서버
pnpm deploy:wait [sha] # main 에 푸시한 커밋의 Vercel 배포가 끝날 때까지 기다렸다가 결과 한 줄 (에이전트는 백그라운드로)
pnpm sentry:issues [id | --query 검색어] # Sentry 미해결 이슈·최근 이벤트 태그 조회 (읽기 전용, .env.local 의 SENTRY_READ_TOKEN)
pnpm review:codex <base> [--spec PRD] [초점] # Codex 적대적 리뷰 — 체크리스트·한국어 출력을 붙여 부른다 (에이전트는 백그라운드로)
pnpm db:migrate       # 마이그레이션 실행 (_journal.json 기준 — 0019에서 동결, 주의사항 7 참조)
pnpm db:studio        # Drizzle Studio
pnpm survey:backup    # 설문 백업
pnpm survey:restore   # 백업에서 복원
pnpm survey:find · survey:vars · survey:dump · survey:render  # 운영 설문 문구로 찾기 · 변수명 계산 · 응답 화면 그려 보기 (survey-ops 스킬 — 설문 고치기 도우미 포함)
pnpm versions:prune   # 버전 스냅샷 정리 (DRY_RUN 기본, :live 로 실행)
pnpm ledger:seed      # R2 발송 장부 시드
pnpm spss:migrate     # SPSS 필드 마이그레이션 (DRY_RUN 기본, :live 로 실행)
pnpm spss:rollback    # SPSS 필드 롤백 (:live 동일)
pnpm worker:sentry-jandi:dev     # Sentry→잔디 알림 워커 로컬
pnpm worker:sentry-jandi:deploy  # 워커 배포 (Cloudflare)
```

> `scripts/` 바로 아래는 공유(추적)하는 스크립트, `scripts/private/` 는 공유하지 않는 일회성 스크립트(gitignore)다 — `package.json` 명령·CI·문서가 부르는 스크립트는 `scripts/` 바로 아래에 둘 것. `survey:backup` 이 부르는 `scripts/private/backup-survey.ts` 는 이미 없는 `src/data` 를 import 해 지금 동작하지 않는다.
> `pnpm db:generate` / `pnpm db:push` 는 정의는 살아 있으나 **사용 금지** — 마이그레이션은 수동 SQL 관행이다(주의사항 7).

---

## 경로 별칭

`@/*` → `./src/*` (tsconfig.json).

---

## 환경 변수

```env
# Supabase
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

# PII 암호화
CONTACT_PII_AES_KEY=            # cipher 키 (환경별 분리 필수)
CONTACT_PII_HMAC_KEY=           # blind index 키
DUPLICATE_DETECTION_SALT=       # 중복 감지 해시 솔트

# 권한
ADMIN_USER_IDS=                 # admin 표면 허용 supabase user.id 콤마 목록. 미설정 시 fail-open + 경고
GUEST_SURVEY_GRANTS=            # "<userId>:<surveyId>[,...]" 게스트 설문 위임
SURVEY_LIST_GROUPS=             # "<묶음 이름>=<surveyId>,<surveyId>[;...]" 설문 목록에서 카드 한 장으로 접어 두는 묶음 (임시 — staging 병합·승격 때 버린다, lib/survey-list-groups.server.ts)

# 레이트리밋 (미설정이면 limiter no-op)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# 로깅 / 기타
AXIOM_TOKEN=  AXIOM_DATASET=  LOG_LEVEL=
ENABLE_PUBLIC_API=              # /api/v1 OpenAPI 표면 게이트 (기본 비활성)
```

> 메일/컨택 메타(발신 표시명, 수행기관 등)는 env default 금지. DB 컬럼 또는 attrs로 관리. env는 비밀+인프라 상수만.
> `.env.example`의 `BETTER_AUTH_*` 와 `EMAIL_SEND_MODE` 는 코드 참조 0건이다 — 전자는 미착수 전환 계획의 잔재, 후자는 발송 모드 분기가 구현되지 않은 자리다.

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

### 언어/스타일

- 문서/주석은 한국어, 변수명/함수명은 영어.
- 코드(주석/로그/UI 텍스트/라벨)에 이모지 금지.
- **Prettier 는 게이트가 아니다** — 설정(`.prettierrc`)은 편집기 저장용이고 CI·스크립트 어디에도 연결돼 있지 않다. src 의 60%(1,953파일 중 1,189, 2026-11-11)가 `prettier --check` 를 통과하지 못하므로 그 결과로 내 변경을 판단하지 말고, 고치는 파일을 통째로 다시 포맷하지도 않는다(무관한 diff 가 미병합 브랜치와 충돌한다). 포맷 게이트는 staging 승격 뒤 한 번에 전량 포맷하면서 붙인다.
- git commit 메시지는 한국어: `feat: OOO 기능 추가` 형식, 괄호 `()` 금지.

---

## 디자인 시스템

디자인 언어 참조는 [DESIGN.md](DESIGN.md), 제품 사실(누가 쓰는가·원칙)은 [PRODUCT.md](PRODUCT.md) — impeccable 이 UI 작업 때 둘을 읽는다. Apple 웹 디자인 시스템 기반이며, **폰트는 SF Pro 대신 Wanted Sans Variable로 통일**한다.

- **코드 SoT**: 디자인 토큰의 실제 source of truth는 [globals.css](src/app/globals.css)의 `:root` CSS 변수 + `@theme inline` 매핑. DESIGN.md는 목표 명세, globals.css가 현재 구현.
- **적용 범위 주의**: DESIGN.md 명세는 Apple 마케팅/쇼케이스 사이트 기준(17px body, 80px 섹션, 저밀도 tile). **설문 빌더·운영 콘솔은 고밀도 도구 UI**라 토큰(색·radius·그림자 절제·weight ladder)만 참조하고 마케팅 스케일/밀도는 적용하지 않는다. Apple 정통 스케일은 랜딩·공개 응답 페이지(`/survey`)에 적합.
- **색상 명세 정렬(2026-06-11)**: DESIGN.md 블루 계열을 코드 버튼 관행으로 갱신 — primary `#3b82f6`(blue-500), hover `#2563eb`(blue-600), on-dark `#60a5fa`(blue-400). 잔여 갭: globals.css `--primary`(#007aff) 토큰 불일치, 버튼 radius `rounded-lg`(명세 pill), `shadow-sm` 사용(명세 금지), `font-medium`(500, 명세 제외) — 코드 정렬은 별도 작업.

---

## 기능 개발 체크리스트

모든 기능 개발·수정은 **스펙(PRD) 단계**와 **적대적 리뷰 단계** 두 번
`write-change-checklist` 스킬(`.agents/skills/write-change-checklist/SKILL.md`)을 거친다 — 축은 셋(백엔드 · 프론트엔드 ·
개인정보·컴플라이언스)이고, 변경 종류를 정한 뒤 항목마다 「지킨다(어떻게) / 해당 없음(이유) / 일부러 안 지킨다(이유)」를
이 레포의 기존 장치로 답한다. 스펙에 적히지 않은 성질은 TDD 가 테스트를 만들지 않고, 리뷰도 눈에 띄는 버그에서 멈춘다.

**완료를 보고할 때도** 고른 변경 종류의 항목마다 한 줄씩 답을 붙인다 — 「지킨다」는 그것을 지키는 테스트 이름, 나머지는 이유. 화면 확인이 필요한 항목은 사용자가 어느 화면·기기에서 무엇을 볼지 적는다. 요청이 없어도 한다.

---

## 주의사항

1. **타입 안전성**: Drizzle ORM + TypeScript strict. JSONB 컬럼은 `src/shared/contracts/*`의 타입으로 `.$type<...>()` 지정. 클라이언트 트리(features/components/hooks/stores/utils)는 `@/db` 값 import 금지(ESLint, type 은 허용).

   **함정: Drizzle 의 `text(..., { enum: [...] })` 는 TypeScript 전용이라 SQL CHECK 를 만들지 않는다.** 실제 제약은 마이그레이션이 손으로 쓴 별도 목록이고, 스키마 파일의 `check()` 블록도 또 하나의 사본이다 — 어휘 배열(`@/types/*`)만 고치고 배포하면 tsc 는 통과하는데 새 값을 담은 INSERT 가 CHECK 제약에서 깨진다. 어휘를 늘릴 때는 배열·`check()`·마이그레이션 셋을 함께 볼 것 (`mobile_table_display_mode` 가 그 예).

2. **상태 관리**: 서버 상태는 TanStack Query, 클라이언트 상태는 Zustand(+Immer).

3. **응답 페이지는 snapshot 기반**: 빌더 수정은 publish 전까지 실응답 페이지 미반영. 테스트 링크·테스트 대상자 링크·관리자 미리보기는 **저장본(테스트 버전)** 을 보므로 저장만 하면 반영된다(2026-10-23, `src/server/AGENTS.md` 「테스트 모드」) — "테스트 링크 OK + 응답 페이지 NG" 패턴이면 publish 누락 먼저 의심. 공개 미리보기 `/preview/<token>` 은 배포본이다. 단, `quotaConfig`·`isPaused`·`pausedMessage`·`endRedirects`·`allowMultipleResponses`는 스냅샷 밖 라이브 컬럼이라 즉시 반영된다.

4. **테이블 질문**: `tableColumns`, `tableRowsData`, `tableHeaderGrid`, `tableValidationRules`, `dynamicRowConfigs`, `rowRepeatConfig`, `sumConstraints` JSONB 사용. choice 응답값은 `cell.id`.

   행 반복(`rowRepeatConfig`) · 행 차례로 열기(`stagedRowsConfig`) · 열 차례로 열기(`revealStep`) · 안 쓴 열·행 빼기는 서로 다른 기능이다. 행 반복은 저장할 때 최대 벌까지 **실제로 펼쳐 두고**(펼치기는 멱등), 켜면 그 표의 `rowCode` 를 명시 발번한다 — 안 그러면 같은 표의 변수명이 `r1` → `r01` 로 통째 바뀐다. 상세와 함정은 `src/features/AGENTS.md` 「행 반복과 차례로 열기」.

5. **다단계 선택**: `selectLevels` 배열로 3단계까지. 부모 선택에 따라 동적 로딩.

6. **export 라벨**: `cell.exportLabel || generateExportLabel(questionCode_열_행)` 폴백 필수 (빌더는 placeholder만 표시, DB null 흔함).

7. **마이그레이션 — 수동 SQL 관행**: drizzle `_journal.json`은 **0019에서 동결**됐고 0020 이후는 전부 손으로 쓴 `.sql`을 `supabase/migrations/`에 두고 Supabase MCP `apply_migration` 또는 직접 SQL로 적용한다. 새 파일을 추가하면 **반드시 `supabase/migrations/manual-migrations.json`의 `migrations`에 tag(확장자 제외 파일명)를 등재**해야 한다 — 미등재는 추적 불가 drift로 보고 CI(`.github/migration-journal-gate.ts`)가 차단한다. `pnpm db:generate`/`db:push`는 이 관행과 충돌하므로 쓰지 않는다. `TRUNCATE CASCADE` 금지 (ON DELETE SET NULL 무시). **번호를 고르기 전에 `supabase/AGENTS.md` 를 읽을 것** — staging 이 쓰고 있어 비워 둔 번호, 배열 순서, 배포 전·뒤 적용 구분이 거기 있다.

   **새 마이그레이션은 빈 DB에서 재생 가능해야 한다.** 2026-08-19부터 테스트 DB는 `drizzle-kit push`가 아니라 마이그레이션 전량 재생으로 만들어진다(`scripts/setup-test-db.sh`). 즉 `pnpm db:setup-test`(공유 DB)·`pnpm db:isolated <이름>`(전용 DB)이 곧 재생 검증이며, 기존 상태를 전제한 문장을 넣으면 거기서 깨진다. 실 DB에만 있고 레포에 없는 객체는 `pnpm db:drift`가 잡는다 — 자세한 내용은 `supabase/AGENTS.md`.

8. **앱 생성값 NOT NULL 컬럼은 2단계 배포**: nullable 추가 + 백필(배포 전) → 앱 배포 → `SET NOT NULL`(라이브 후). 한 번에 걸면 구버전 앱 INSERT가 깨진다.

9. **서버 sanitize**: jsdom 의존 라이브러리 금지 (isomorphic-dompurify 크래시). `sanitize-html` 사용.

10. **테스트**: 단위 테스트의 집은 SUT 소스 옆이다(ADR 0017, 전면 colocation — 2026-08-25 실측 src 466파일). 명명은 소스 어간 정합 — 1:1은 `<소스>.test.ts(x)`, 한 소스의 측면 시리즈는 `<어간>-<측면>.test.ts`, 여러 소스를 가로지르는 시나리오는 주 SUT 폴더에 주제명(app 라우트는 `route.test.ts`/`route-<측면>.test.ts`, 교차 라우트는 서술명). ESLint 경계가 colocation 을 막으면 의존 방향이 허용하는 쪽 SUT 폴더에 둔다(예: branch-logic-drift 는 공용 구역→server 금지라 server 도메인 쪽, 빌더 프리뷰 스토어 배선 테스트는 renderer 의 feature import 금지라 빌더 stores 쪽). 양쪽 다 막히는 교차 feature 계약은 `tests/repo` 로(예: measurement-font). `tests/` 에는 계층·계약 스위트만 산다 — `integration/`(service 모킹 패턴: top-level `vi.mock` + `vi.mocked`, realdb 포함)·`e2e/`·`repo/`(src 밖 소스·레포 계약)·fixtures/helpers/stubs/setup. 이 배치는 메타테스트(`tests/repo/test-tree-layout.test.ts`)가 강제한다. Vitest include 는 `tests/**` + `src/**/*.test.{ts,tsx}` + `workers/`, `.tsx` 는 jsdom 프로젝트 자동 분기(DOM 이 필요한 `.ts` 만 `DOM_TS_TESTS` 등재). 실DB 왕복은 `*.realdb.test.ts` — `pnpm test:integration`(로컬 supabase 54322 필요), 일반 `pnpm test`에서는 스킵. **같은 모듈에 `vi.mock` 을 두 번 걸지 않는다** — 어느 팩토리가 이기는지 보장되지 않아 간헐 실패가 「모킹 간섭」으로 오진된다(`tests/repo/vi-mock-once.test.ts` 가 막는다). 서버 로그는 테스트 출력에 싣지 않는다(`tests/setup.ts` 가 `LOG_LEVEL=silent`) — 볼 때는 `LOG_LEVEL=debug` 를 앞에 붙인다. 실DB 실행은 대상 DB 의 재생 지문이 이 브랜치와 다르면 시작 전에 멈춘다(`tests/realdb-global-setup.ts`).

11. **vitest의 `server-only` stub 사각지대**: 클라이언트/서버 경계 위반은 테스트가 통과해도 빌드에서만 드러난다. 경계를 건드렸으면 `pnpm build`로 확인할 것.

12. **drizzle 함정**: timestamptz optimistic lock은 PG μs ↔ JS ms 정밀도 차로 거짓 충돌 (version int 또는 string mode 사용). `ANY(${arr})` 바인딩 금지 (length=1 silent unwrap) → `inArray`/`sql.join` — ESLint 가 막는다. jsonb 컬럼에 `JSON.stringify` 바인딩 금지 (이중 인코딩) → 객체 그대로 전달.

13. **응답 루트 사이드카**: `questionResponses` 최상위의 `__` 접두 키(`__optTexts__` 기타/상세 기재, `__changeConfirm__` 추적조사 변동 확인)는 실존 문항이 아니라 저장 경계마다 분기가 필요하다 — 분리를 빠뜨리면 `saveDraft` 는 소속 검증에서 500 이 되고 `complete` 는 멤버십 필터에서 값을 조용히 버린다(둘 다 실제로 겪은 사고). 키와 정제 함수는 `lib/survey/response-sidecars.ts` 한 곳에 등록하고, 저장 경계는 `splitRootSidecars`/`isPersistedRootSidecarKey`/`sanitizeRootSidecar` 로만 판정한다. 등록되지 않은 `__` 키는 **저장에서 빠지고 경고 로그만 남는다** — 거부하면 등록을 빠뜨린 키 하나가 그 응답자의 초안 저장을 통째로 막는다(부분 저장이 없다). 문항 id 는 UUID 라 `__` 접두를 가질 수 없어 진짜 답변이 이 분기로 새지 않는다. `__dynamicRowSelections__` 는 2026-09-09 에 등재했다. `__prefillEdits__`(고친 프리필 칸 id — 응답 확정이 계산해 덮어쓴다, CONTEXT.md 「고친 프리필 따로 내보내기」)는 2026-11-05.

    **키 상수는 import 0 인 잎 모듈이 소유하고, 어느 키 모듈도 등록부를 되부르면 안 된다.** 순환이 닫히면 등록부가 남의 상수를 초기화 전에 읽어 계산 키가 `undefined` 로 등록되고, 그 사이드카가 등록 목록에서 **조용히 빠진다** — 저장이 거부가 아니라 누락으로 끝나므로 아무도 모른다. 2026-09-16 에 실제로 닫혀 있었고(`__optTexts__` 를 `lib/option-text-read.ts` 로 내려 끊었다), 순환을 만든 것은 등록부의 직접 import 가 아니라 `prior-answers → response-sidecars` 라는 **전이 closure 안쪽 간선**이었다. 그래서 등록부에 새 import 를 들일 때는 그 모듈의 closure 가 등록부로 돌아오지 않는지 봐야 한다. `lib/survey/response-sidecars-import-order.test.ts` 가 소스를 읽어 이 간선을 막고, 등록 키 집합 전체를 리터럴로 못박는다 — 키 문자열은 `question_responses` JSONB 에 그대로 저장되므로 개명하면 이미 저장된 응답의 사이드카가 고아가 된다.

14. **문항 가시성**: 표시 조건으로 숨겨진 문항의 응답은 **그 순간 지워진다. 되돌려도 살아나지 않는다** (2026-09-07 결정). 판정·삭제는 `lib/survey` 한 곳이고 복제 금지다. 완료 제출과 관리자 수정은 순서를 직접 조립하지 않고 응답 확정(`server/survey-response/services/answer-finalization.ts`)을 거친다. **초안·구간 저장에는 strip 을 걸지 않는다** — 그쪽 answers 는 더티 키만 담은 부분 패치라, 조건이 참조하는 상류 문항이 없어 멀쩡한 답이 지워진다. 새 저장 경로를 만들 때 이 구분을 지킬 것. 저장 경계 순서 · 조건 평가 컨텍스트 · 경로 밖 문항 · 표의 숨은 칸은 `src/lib/survey/AGENTS.md`.

15. **응답 종결 판정은 `status` 로 한다 — `is_completed` 는 종결 게이트가 아니다**: 자격미달(`screened_out`)은 완료 수 분자에서 빠지도록 `is_completed=false` 로 저장된다(`response-completion` 의 `isCompleted: !screenedOut`). 그래서 `is_completed` 를 "끝난 응답인가" 게이트로 쓰면 자격미달만 조용히 빠진다 — 재응답 허용이 `ok:true` 를 돌려주면서 아무것도 안 하던 사고가 이것이다(2026-09-21 수리). 어휘와 술어는 `shared/contracts/survey-response.ts` 가 SSOT 다: 열림 `isOpenResponseStatus` · 종결 `isConcludedResponseStatus` · 재응답 허용 대상 `isReeditableResponseStatus`(completed·screened_out). `is_completed=false` 를 쿼리에 쓰는 것 자체는 무방하나(열린 행 **후보** 조회 범위), 판정은 반드시 status 술어로 한 번 더 한다 — `lifecycle`·`response-row-create` 의 컨택 재사용 조회가 그 패턴이다.

16. **자격미달은 제출 시점에만 정해지지 않는다**: 관리자 응답 수정(`saveAdminEdit`)이 종결 응답(completed·screened_out)에 대해 `detectScreenOut` 을 다시 돌려 `completed ⇄ screened_out` 을 양방향으로 오간다(2026-09-21). 판정 재료는 평문 `finalResponses`(숨은 문항 strip → 게이팅 strip → calc 재계산 **이후**, PII 암호화 **이전**)여야 분기 매칭이 성립한다. `in_progress` 는 응답자 세션 중이라, `quotaful_out`·`bad` 는 자격미달과 다른 축의 종결이라 재판정하지 않는다. 스냅샷을 못 얻으면 재판정을 건너뛰고 기존 상태를 보존한다(calc 재계산과 같은 fail-safe). 바뀐 문항이 없어도 확정·재판정한다 — 판정은 응답 확정의 `screenedOut` 이다.

17. **`useEffectEvent` 를 `React.memo`·`forwardRef` 컴포넌트 안에 쓰지 말 것**: React 19.2.3 은 그런 컴포넌트의 `useEffectEvent` 를 갱신하지 않아 이벤트가 첫 렌더 값을 계속 읽는다(dev·prod 둘 다). 컴포넌트 단위로 걸리므로 그 컴포넌트가 부르는 훅 안에 숨어 있어도 같다. ref 가 필요하면 forwardRef 대신 React 19 의 `ref` prop 을, memo 가 필요하면 바깥 컴포넌트를 memo 로 두고 안쪽은 일반 함수 컴포넌트로 둔다. `tests/repo/effect-event-in-memo.test.ts` 가 막는다 — **React 를 올리면 제약이 풀렸는지 확인하고 그 테스트를 지울 것.**

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

## Agent skills

### Issue tracker

이슈는 레포 내 `.scratch/<feature-slug>/` 아래 로컬 마크다운 파일로 관리. See `docs/agents/issue-tracker.md`.

### Triage labels

트리아지 라벨은 기본 어휘 그대로 사용 (needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

단일 컨텍스트 — 루트 `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

### Worktree bootstrap

- 워크트리는 `pnpm worktree:new <브랜치> [시작점]` 으로 만든다(이미 있는 경로면 링크·설치만 다시). 링크할 것·하지 않을 것과 그 이유는 `scripts/worktree-bootstrap.sh` 머리 주석이 정본이다 — 요점은 env·`.scratch`·`pencil`·`docs` 미추적 하위는 링크, `node_modules` 는 실제 설치.
- 그 워크트리의 realdb 테스트는 `pnpm db:isolated <이름>` 으로 만든 DB 에서 돌린다. 공유 DB 를 리셋하는 `db:setup-test` 는 형제 워크트리가 없을 때만.

### 문서 갱신

`update-docs` 스킬(`.agents/skills/update-docs/`)이 이 레포용 대조표를 갖고 있다. 코드가 문서와 어긋났을 때 이 스킬을 따른다 — 갱신 대상은 `AGENTS.md`·`CONTEXT.md` 이고, `docs/superpowers/plans`·`specs` 와 ADR 본문은 시점 기록물이라 최신화 대상이 아니다.

> `CLAUDE.md` 는 `AGENTS.md` 를 가리키는 심볼릭 링크다. 문서 수정은 항상 `AGENTS.md` 에 한다.
