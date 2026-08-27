# Survey Table Project - 에이전트 참조 문서

## 프로젝트 개요

Next.js 16 기반의 고급 설문조사 빌더 + 운영 플랫폼. 복잡한 질문 유형, 조건부 로직, 버전 스냅샷, 컨택 관리, 메일 캠페인, SPSS/엑셀 내보내기, 분석 기능을 갖춘 엔터프라이즈급 애플리케이션.

> 최종 갱신: 2026-08-27 (역할 모델 v2 티켓 14 재배치 센터 — `/admin/reassignment` 슈퍼어드민 전용 인박스. 팀을 잃은 **사람**(미배치)과 **설문**(배치 대기)을 한곳에서 처리한다. 입구는 팀 관리의 「메가리서치」 카드 하나 — 사이드바 항목도 teamId 딥링크도 없다(팀 경계로 좁힐 수 없는 목록이라 팀장에게 하나라도 열면 전사 열람). `workspace.reassignment` 5종 전부 superadmin. **새 소유자는 목적지 팀의 활성 멤버여야 한다** — 판정 코어의 소유자 분기가 소유 팀 소속일 때만 전권을 주므로 팀 밖 사람을 앉히면 자기 설문을 못 여는 소유자가 생긴다. 일괄 배치는 전부 아니면 전무. 마이그레이션 0091 `survey_ownership_events` — 해산이 `team_id` 를 NULL 로 내려 설문 행에서 지워지는 **출신 팀**을 되짚는 유일한 경로이고, 해산이 설문별 `unassign` 행을 함께 남긴다. 재입사(9-4)는 상태 전이 + 팀 배정을 `server/workflows/user-rehire` 가 한 트랜잭션으로 묶는다. 직전: 티켓 13 팀 해산)

---

## 기술 스택

| 영역           | 기술                                         | 버전            |
| -------------- | -------------------------------------------- | --------------- |
| 프레임워크     | Next.js (App Router, Turbopack)              | 16.2.11         |
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
| 리치 에디터    | TipTap                                       | 3.15.3          |
| 드래그앤드롭   | @dnd-kit                                     | -               |
| ID 생성        | NanoID                                       | 5.1.11          |
| ORM            | Drizzle ORM                                  | 0.45.2          |
| DB 드라이버    | postgres (postgres-js)                       | 3.4.7           |
| 데이터베이스   | PostgreSQL (Supabase)                        | -               |
| 파일 저장소    | Cloudflare R2 (S3 호환)                      | -               |
| 이미지 처리    | sharp                                        | 0.35.3          |
| HTML sanitize  | sanitize-html                                | 2.17.0          |
| 이메일 발송    | Resend + React Email                         | 6.12.3          |
| 이메일 webhook | svix                                         | 1.93.0          |
| 백그라운드 잡  | Inngest                                      | 4.4.0           |
| 레이트리밋     | @upstash/ratelimit + @upstash/redis          | 2.0.8 / 1.38.0  |
| 로깅           | pino + @axiomhq/js                           | 10.3.1 / 2.0.0  |
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
> Better Auth 가 세션의 유일한 출처다 (티켓 02). Supabase 는 DB 호스팅으로만 남고 `@supabase/ssr` 은 제거됐다 —
> `@supabase/supabase-js` 는 유지보수 스크립트(`scripts/*.ts`) 전용으로 남아 있다.

---

## 프로젝트 구조

```
src/
├── app/                        # Next.js App Router
│   ├── admin/                  # 관리자 인터페이스
│   │   ├── surveys/
│   │   │   ├── create/         # 설문 생성
│   │   │   └── [id]/
│   │   │       ├── edit/       # 설문 편집
│   │   │       ├── preview/    # 빌더 미리보기
│   │   │       ├── analytics/  # 설문별 분석
│   │   │       └── operations/ # 운영 콘솔 (아래 라우트 섹션 참조)
│   │   ├── billing/mail-cost/  # 메일 비용 정산
│   │   ├── file-cleanup/       # R2 유예 삭제 큐 관리
│   │   ├── login/              # 로그인
│   │   └── profile/            # 프로필
│   ├── api/                    # API 라우트 (아래 API 섹션 참조)
│   ├── survey/[id]/            # 공개 설문 응답 페이지 (?invite=<uuid>)
│   ├── i/[code]/               # 짧은 초대 링크 (inviteCode → 응답 페이지)
│   ├── preview/[token]/        # 토큰 미리보기 (previewToken)
│   ├── analytics/              # 분석 대시보드
│   └── unsubscribe/            # 메일 수신거부 (+ /restored)
│
├── server/                     # oRPC 백엔드 — 코어 + 도메인 11개 (경량 DDD: domain 순수 · procedures 얇음 · services)
│   ├── context.ts              # createContext (supabase session + db + headers — RSC·procedure 공용)
│   ├── orpc.ts                 # base + pub / authed(admin) / scoped(게스트 grant) + withRateLimit
│   ├── router.ts               # 전체 도메인 router 합성 (AppRouter)
│   ├── handler.ts              # RPCHandler (+ Sentry onError)
│   ├── openapi.ts              # OpenAPI 핸들러 (ENABLE_PUBLIC_API 게이트)
│   ├── rpc-logging.ts          # 전 procedure 구조화 로그 미들웨어
│   ├── rpc-error-policy.ts     # 에러 → RPC 코드 매핑
│   ├── rpc-timeout.ts          # 타임아웃 가드
│   ├── health.ts               # health procedure (코어 옆)
│   ├── data-scope.ts           # 요청이 어느 파티션(실/테스트)을 보는가 + 쓰기 잠금 — context 와 같은 계층
│   ├── work-scope.ts           # 요청이 어느 **팀 경계**를 보는가 (팀 | 시스템 전체 보기 | 없음) — data-scope 의 형제
│   ├── survey-access.ts        # 설문 capability 판정 단일 정본 — resolveSurveyCapabilities(순수) + denialReasonFor(거부 사유 정본) + assertSurveyCapability(관문)
│   │                           # + assertSurveyCapabilityBatch(여러 설문·여러 capability 를 한 왕복으로 — 담기 200건용, 티켓 12)
│   ├── rpc-survey-access.ts    # 관문의 RPC 어댑터 — assertSurveyCapabilityRpc(not_found→NOT_FOUND 존재 은닉 / forbidden→FORBIDDEN) + toRpcSurveyAccessError
│   │                           # + assertSurveyCapabilityBatchRpc(배치 짝)
│   │                           # + assertScopedSurveyCapabilityRpc(scoped 표면용 — env grant 게스트는 grant 일치, 내부는 capability. 티켓 21 이 통합)
│   ├── page-survey-access.ts   # 관문의 RSC 페이지 어댑터 — assertSurveyCapabilityPage(사유 불문 notFound 접기)
│   │                           # + assertSurveyConsolePageAccess(게스트 허용 콘솔 페이지용 — requireAuth 포함, viewer 반환)
│   ├── response-filters.ts     # 어느 응답 행이 보이는가 (활성·삭제됨·완료·비테스트) — data-scope 의 형제, 8구역 공용
│   └── <domain>/               # survey-builder · survey-response · operations · contacts
│       │                       # · mail · analytics · library · auth · media · quota · workspace
│       ├── domain/             # zod 계약 + 순수 규칙 (**client-safe** — server-only·Node·DB 의존 0. zod 는 런타임 의존이라 'import 0' 이 아니다)
│       │                       # UI 도 쓰는 모양은 shared/contracts 소관 — 여기는 그것을 다시 내보내고 서버 전용 입력·규칙만 남긴다
│       ├── procedures/         # oRPC procedure (authed/scoped/pub, 얇은 위임) + colocated *.test.ts
│       └── services/           # 비즈 로직 + drizzle (server-only, requireAuth/revalidatePath 없음)
│                               # 도메인 간 직접 import 금지(ESLint), 내부는 상대경로. 타 도메인 테이블 직접 쿼리는 허용
│   ├── read-models/            # 여러 도메인 테이블을 **읽기만** 하는 projection (설문 구조 · 버전 스냅샷 · 응답 · 보관함 분류 · 컨택 read model · 초대 조회 · 결과코드 · 쿼터 모수 · 설문 제어 플래그 · 템플릿 변수 카탈로그 · 응답내역 컬럼 스킴 · 팀 멤버십 · 활성 팀 목록)
│   │                           # 자기완결 — 도메인을 import 하지 않는다(ESLint). 구 src/data
│   │                           # survey-structure 의 getSurveyById 는 React cache — **사본을 만들지 말 것**(cache 가 갈리면 RSC dedupe 가 깨진다)
│   │                           # version-snapshot 의 snapshotQuestions 는 비배열을 빈 배열로 접는다 — "구조가 깨졌다" 와 "질문이 없다" 를
│   │                           # 갈라야 하는 자리(응답 이관의 생존 판정 등)에서는 쓰지 말고 호출측이 직접 Array.isArray 로 볼 것
│   ├── workflows/              # 여러 도메인의 **쓰기를 조율**하는 흐름. 이 층만 도메인을 부를 수 있다
│   │                           # 결합을 없애는 게 아니라 한곳에 모아 보이게 하는 자리 — 파일이 늘면 그 자체가 신호다
│   │   ├── test-mail-archive.ts  # 테스트 파티션 메일 보관·삭제 흐름 (mail·contacts 쓰기를 함께 조율)
│   │   ├── user-rehire.ts        # 재입사 — 상태 전이(auth)와 팀 배정(workspace)을 한 트랜잭션으로 (티켓 14)
│   │   └── jobs/                 # Inngest 함수 4개 + index (구 lib/inngest/functions). 잡은 도메인을 부르므로 여기가 집이다
│   └── storage-lifecycle/      # R2 유예 삭제 큐·발송 장부·참조 인덱스 (자체 r2_* 테이블만 만지는 독립 모듈)
│
│   ※ "여러 도메인이 쓴다" 는 공용의 근거가 아니다 — 역할로 묶이지 않으면 제2의 lib 가 된다
│
├── features/                   # 프론트 기능 묶음 8개 (UI·훅·스토어·query 훅을 기능 단위로 — 레이어 규약 아님, FSD 아님)
│   │                           # 의존 방향(ESLint): survey-builder → survey-response → question-renderer 단방향
│   │                           # operations·analytics·workspace·guest-console·fieldwork-console 은 각각 독립(서로 import 0)
│   │                           # builder → response 는 2건만 남았고 **둘 다 의도된 공유**다(옵션 텍스트 사이드카 저장소).
│   │                           # 인용값 계산이 양쪽에서 같은 입력을 봐야 해서 저장소를 하나로 둔 것 — 떼면 resetResponseState 의 원자적 리셋이 갈린다
│   │                           # UI 가 서버에서 가져올 수 있는 건 없다 — @/server 전면 금지(타입 포함), 모양은 @/shared/contracts 로
│   │                           # 루트 잔류 기준: ① 복수 하위 묶음이 소비하는 공용 조각 ② app 라우트가 직접 여는 진입점만 — 단일 묶음만 소비하면 그 묶음 안으로
│   │                           # 루트 개수는 목표가 아니라 이 기준의 결과다(2026-08-25 전수 실측: 72파일 중 이동 1건). 새 묶음의 진입점은 폴더 안(table-editor 방식), 기존 group-manager·condition-card 는 유지
│   ├── survey-builder/         # 설문 편집기 + 설문 목록 (139개) — importer 그래프의 닫힌 묶음대로 폴더화
│   │   ├── survey-list/        # 설문 목록 (survey-list-view 진입점, 티켓 08 — .pen FLOW 6)
│   │   │                       # 툴바(상태 칩·검색·정렬)·상세 검색 패널·페이지네이션·카드 + 순수 파이프라인
│   │   │                       # (survey-list-pipeline)·버튼 노출 근사(survey-list-capability — 판정은 서버)
│   │   │   └── groups/         # 설문 그룹 UI (티켓 12 — .pen FLOW 2): 관리 모달(CRUD·dnd 정렬)·
│   │   │                       # 담기 패널(미분류 전용)·삭제 확인·카드 케밥 이동 서브메뉴·그룹 화면 머리
│   │   ├── question-list/      # 빌더 질문 목록 (sortable-question-list 진입점, question-test-card·group-header)
│   │   ├── question-edit/      # 질문 편집 모달 (question-edit-modal → question-basic-tab·table-validation-editor·sum-constraint-editor)
│   │   ├── table-editor/       # 표 질문 편집기 (dynamic-table-editor 진입점) + hooks/·utils/·bulk-generator/
│   │   │   └── cell-editor/    # 셀 내용 모달 (cell-content-modal → *-cell-tab·cell-choice/gating-editor) + hooks/use-cell-form·utils/serialize-cell
│   │   ├── condition/          # 표시조건 편집 사슬 (question-condition-editor → condition-card → expression/value/numeric) + utils/
│   │   ├── lookup/             # LUT 선택·편집·CSV·보관함 (공용 리프 — condition·formula 가 소비)
│   │   ├── formula/            # 수식 편집기 (cell-editor·sum-constraint 양쪽이 소비)
│   │   ├── group-manager/      # 그룹 관리
│   │   ├── hooks/              # 빌더 전용 훅 (use-ensure-survey-in-db·use-survey-sync·use-builder-scroll)
│   │   ├── stores/             # survey-store(빌더 상태)·ui-store(빌더 UI 상태)·survey-list-ui-store(목록 필터·페이지)·test-response-store(미리보기 응답)·preview-response-sources — 구 src/stores
│   │   ├── queries/            # TanStack Query 훅 use-surveys·use-survey-groups·use-library·use-cell-library — 구 src/hooks/queries
│   │   ├── lib/                # changeset·diff-payload — 구 src/lib/survey-builder
│   │   ├── utils/              # option-value-remap
│   │   └── (루트 24개)          # 복수 묶음이 쓰는 공용 필드 위젯 + app 이 직접 여는 모달·패널
│   │                           # 폴더 위상: hooks ← lookup ← condition ← table-editor ← question-edit ← question-list (DAG, 순환 없음)
│   ├── question-renderer/      # 두 화면(빌더 미리보기·응답 페이지)이 함께 쓰는 렌더 조각 (76개) — 어떤 feature 도 import 하지 않는다
│   │   │                       # 질문 렌더러가 주지만 화면 공용 조각도 여기가 집이다 — 응답 헤더·루트 그룹 배지·검증 배너
│   │   ├── cells/              # 표 셀 렌더러
│   │   ├── hooks/              # 표 레이아웃·동적 행·응답 쓰기 채널 훅
│   │   └── utils/              # 표 그리드·모바일 표시 순수 계산 + renders-as-table·trailing-coalescer·effective-option-texts
│   ├── survey-response/        # 응답 흐름 (flow·lifecycle·step-views) (28개) — 렌더러만 import
│   │   ├── hooks/              # 응답 플로우 훅 + use-client-signals·use-keyboard-open
│   │   ├── lib/                # version-rebase·answer/numeric/required-option-text-validation·admin-edit·quota-gate (순수)
│   │   ├── step-views/         # 스텝 단위 화면
│   │   └── stores/             # survey-response-store(실응답)·live-response-sources — 미리보기용 test-response-store 는 survey-builder/stores
│   ├── operations/             # 운영 콘솔 (84개) — contacts·profiles·report·quota·mail-campaign·mail-template·filters
│   │   ├── hooks/              # use-auto-fade-message·use-search-params-mutator
│   │   └── queries/            # use-contacts·use-campaigns·use-file-cleanup
│   ├── analytics/              # 차트 및 리포팅 (23개)
│   ├── workspace/              # 워크스페이스 관리 (21개, 티켓 03 신설) — 사용자 관리 + 내 프로필 + 팀 관리 + admin 셸
│   │   │                       # + 재배치 센터. 진입점은 폴더 안
│   │   ├── admin-shell/        # admin 공통 셸 (티켓 08, .pen FLOW 6-1) — admin-shell 진입점(레이아웃이 연다)
│   │   │                       # + sidebar(로고·메뉴)·team-switcher(팀 전환+메가리서치)·sidebar-profile(프로필·로그아웃)
│   │   │                       # + sidebar-menu(순수 메뉴 판정 — 미배치는 프로필만)
│   │   │                       # + sidebar-group-tree(설문 그룹 트리 — 그룹 화면 입구, 티켓 12). 범위 전환 시 쿠키 기록
│   │   │                       # + 전체 캐시 무효화 + router.refresh 를 한 곳에서 처리한다
│   │   ├── field-styles.ts     # 폼 필드 클래스 — 사용자 관리 모달 3종과 프로필·팀 모달이 함께 쓴다(루트 잔류 기준 ①)
│   │   ├── user-management/    # user-management-view 진입점 + user-create-modal + user-row-actions
│   │   │                       # + user-reset-password-modal · user-rehire-modal + user-vocabulary
│   │   │                       # + queries/use-users
│   │   │                       # 케밥이 여는 액션은 availableUserStatusActions(전이표)가 정한다 — 화면이 표를 따로 들지 않는다
│   │   ├── profile/            # profile-view 진입점 + queries/use-profile — **세 계정 유형 공통 화면**(.pen FLOW 3-2)
│   │   │                       # 게스트·실사도 여기로 들어오며 이름·아바타·비밀번호만 보인다(이메일·직책은 내부만)
│   │   ├── reassignment/       # 재배치 센터 (티켓 14 — .pen FLOW 8-2~8-4·9-2): reassignment-view 진입점
│   │                       # + survey-reassign-view(단건 8-4) + user-assign-modal(8-3) + survey-assign-bar(9-2)
│   │                       # + assignment-fields(목적지·소유자·공개 범위 공유 필드) + reassignment-vocabulary
│   │                       # + queries/use-reassignment
│   └── team-management/    # team-list-view·team-detail-view 진입점 + team-form-modal(생성·설정 겸용)
│   │                           # + member-add-modal(pull 검색) · team-member-row(직책 인라인·역할·제외)
│   │                           # + queries/use-teams. 목록은 슈퍼어드민, 상세는 팀 소속도 연다(.pen FLOW 7)
│   ├── guest-console/          # 게스트 홈 (티켓 05 스텁) — 부여 설문 목록은 티켓 21·22
│   └── fieldwork-console/      # 실사 홈 (티켓 05 스텁) — 초대 설문·조사 대상은 티켓 24~27
│
├── shared/                     # 서버·프론트 양쪽 공용 (feature 직접 import 금지의 탈출구)
│   ├── contracts/              # 서버와 UI 가 합의한 모양 — UI 가 서버에서 가져오는 유일한 출처
│   │                           #   <domain>.ts     JSONB 문서 어휘 SoT (DB 에 저장되는 모양, DB 스키마 $type<> 가 참조, 런타임 의존 없음)
│   │                           #   <domain>-io.ts  경계를 건너는 모양 — RPC 입출력 zod + RSC 가 props 로 넘기는 read model 행
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
├── hooks/                      # 범용 훅 3개 — use-latest-ref · use-media-query · use-formatted-numeric-input
│                               # (기능 전용 훅·query 훅은 features/<x>/hooks·queries 로 흡수, 루트 배럴 없음)
│
├── lib/                        # 인프라 어댑터 + 프론트·서버가 함께 쓰는 계산 (도메인 로직 흡수 완료 — 트래커 E-1)
│                               # 판정은 폴더 이름이 아니라 소비자 실측 — 아래 "src/lib 잔류 기준" 참조
│   ├── auth/ + auth.ts         # 인증 어댑터 + 가드. server.ts=Better Auth 인스턴스 · client.ts=브라우저 authClient
│   │                           # · safe-redirect=로그인 복귀 경로 정제 · protected-paths=proxy/레이아웃 공용 AUTH_PAGES
│   │                           # · guest-grants=게스트 grant(티켓 21에서 계정 모델로 교체) · require-admin-page
│   │                           # · guest-viewer. auth.ts=requireAuth/getCurrentUser
│   ├── rate-limit/             # Upstash 2단 레이트리밋 + 신뢰 IP 추출
│   ├── logger/                 # pino + Axiom transport, redact, route/context 로깅
│   ├── crypto/                 # PII 암호화 (cipher + blind index, 컨택·응답 공용)
│   ├── contacts/               # 그룹 레벨·업로드 병합 매칭·업로드 제한·결과코드 정규화(result-code-statuses-normalize) 순수 공용
│   │                           # (엑셀 파서·스킴 헬퍼는 server/contacts, 컬럼 자동감지는 features/operations)
│   ├── operations/             # 운영 콘솔 공유 계산 19파일 — format 짝 11개는 *-format.ts(서버 쌍이 동일 어간 소유) + 공유 판정·필터 8개. UI 도 소비하므로 여기가 정답 (ADR 0016)
│   │                           # contacts-filter-sql.server.ts 는 drizzle 의존 서버 전용 — lib 안 .server.ts 마킹의 예
│   ├── mail/                   # 렌더 미리보기·변수 추출·이미지 클릭영역·상수 4파일 (발송·dispatch·reconcile·빌링은 server/mail)
│   ├── quota/                  # 쿼터 응답 매칭·정규화·달성 상태 계산 quota-status-calc (쿼터 게이트는 features/survey-response/lib/quota-gate)
│   ├── r2-client.ts            # R2 인프라 어댑터 — S3Client 단일 소유자 + 객체 존재 검사 + URL→key
│   ├── r2-env.ts               # R2 env 검증 (SDK 를 모르는 순수 헬퍼)
│   ├── image-utils-server.ts   # 서버 이미지/파일 삭제·복사
│   ├── image-extractor.ts      # 질문에서 이미지 URL 추출
│   ├── spss/                   # SPSS .sav 빌더 + 변수 생성/검증 + 데이터 변환
│   ├── inngest/                # Inngest 클라이언트 어댑터만 (client.ts) — 함수는 server/workflows/jobs
│   ├── question/               # 질문 스키마/정규화/가드/변형
│   ├── survey/                 # 토큰 치환, 수식·셀 게이팅, 이미지/첨부 promote, PII 보관기한, 응답 헤더 설정 (컨택 attrs context 는 features/question-renderer)
│   ├── survey-response/        # 구조 생존 판정 1파일 (테스트 응답 초기화는 server/survey-response, version-rebase 는 features/survey-response/lib)
│   ├── analytics/              # 통계 analyzer + 엑셀/SPSS export 워크북 계산 (교차분석·필터는 features/analytics)
│   ├── duplicate-detection/    # 중복 감지 신호 타입 1파일 (판정 로직은 server/survey-response)
│   ├── lookup/                 # LUT 룩업
│   ├── upload/                 # 업로드 정책(첨부·이미지) + 라우트 진입 가드(route-guard)
│   ├── sanitize.ts             # HTML sanitize (서버: jsdom 금지, sanitize-html 사용)
│   ├── survey-url.ts           # 설문 URL 조립
│   ├── option-text-read.ts     # 응답에서 옵션 텍스트 입력값 읽기
│   ├── option-value-code-migration.ts  # 옵션 value→optionCode 일괄 마이그레이션 순수 로직
│   ├── date-formatters.ts      # 날짜·시각 표시 공통 포매터
│   ├── get-error-message.ts    # 에러 → 사용자 표시 메시지
│   ├── pg-error.ts             # Postgres 에러 판별 (SQLSTATE 23505 등) — 드라이버 모양을 읽는 인프라 헬퍼
│   ├── fake-data-generator.ts  # 테스트용 더미 응답 생성
│   └── utils.ts                # 공통 유틸리티 (cn())
│
├── utils/                      # 순수 유틸리티 함수
│   ├── branch-logic / branch-eval.ts # 분기 로직 평가
│   │                           # (renders-as-table·trailing-coalescer 는 features/question-renderer/utils, classify-table 도 거기)
│   ├── choice-source / ranking-source / ranking-shared / choice-group-helpers.ts # 옵션 소스 해석
│   ├── option-code-generator / table-cell-code-generator.ts # 코드 발번 (option-value-remap 은 features/survey-builder/utils)
│   ├── spss-var-name.ts        # SPSS 변수명 생성
│   ├── cell-label / cell-style / cell-library-helpers.ts  # (cell-type-detector·serialize-cell 은 survey-builder 아래로 이동)
│   ├── table-merge-helpers / table-cell-optimizer.ts  # (table-grid-utils · expand-header-grid 는 question-renderer/utils)
│   ├── mobile-drilldown-repeat-header / mobile-table-display-mode.ts  # 서버도 import — 나머지 mobile-* 는 question-renderer/utils
│   ├── number-format / numeric-input.ts  # (expression-migration 은 survey-builder/condition/utils, header-style 은 table-editor/utils)
│   └── ...
│
├── db/
│   ├── index.ts                # drizzle(postgres-js) 클라이언트
│   └── schema/                 # Drizzle ORM 스키마 (아래 DB 섹션 참조)
│
├── types/                      # 전역 타입·어휘 3파일
│   ├── survey.ts               # 질문 구조 타입 SoT — TableCell·QuestionOption·조건식 등 (808줄, 소비 237파일)
│   │                           # shared/contracts/survey 와 심볼 겹침 0. 저쪽은 JSONB 문서 어휘라 역할이 다르다
│   ├── question-types.ts       # 질문 유형 어휘 런타임 SoT — QUESTION_TYPES 배열 ↔ QuestionType 동치를 tsc 로 강제
│   └── mobile-table-display.ts # 모바일 표 표시 모드 어휘 + 타입 가드
├── instrumentation.ts          # Sentry 서버 instrumentation
├── instrumentation-client.ts   # Sentry 클라이언트 instrumentation
└── proxy.ts                    # Next 미들웨어 (/admin, /analytics 세션 쿠키 1차 게이트 + x-pathname 전달)
```

---

## 데이터베이스 스키마

스키마 파일은 도메인별로 분리: `auth.ts`, `workspace.ts`, `surveys.ts`, `contacts.ts`, `mail.ts`, `mail-billing.ts`, `r2-lifecycle.ts`. JSONB 컬럼의 문서 형태(어휘)는 `src/shared/contracts/<domain>.ts`에 두고 스키마가 `$type<>()`로 참조한다(DB→shared 단방향). 영속 질문 필드 SSOT는 `question-persisted-fields.ts`. `users.status`·`users.user_type` 컬럼 어휘와 **허용 상태 전이표**(`USER_STATUS_TRANSITIONS`) SSOT는 `shared/contracts/auth.ts`, 사용자 관리 RPC 입출력은 `shared/contracts/auth-io.ts`. 팀 어휘(`teams.status`·`team_members.role`·감사 action)와 팀 관리 권한 술어는 `shared/contracts/workspace.ts`, 팀 RPC 입출력은 `shared/contracts/workspace-io.ts`.

### 인증 도메인 (auth.ts — Better Auth 관할)

```
users                      # 계정 (Better Auth user 모델 + 확장 컬럼)
├── id (uuid PK — 앱이 crypto.randomUUID() 생성, DB default 없음)
├── name, email (UNIQUE), emailVerified, image
├── status                 # pending|active|rejected|suspended|departed — pending/rejected 는
│                          # 도달 불가 어휘(공개 가입 폐기, ADR-0018). DB default 'pending' 은 안전장치
├── isSuperadmin, jobTitle
├── organization           # 게스트 소속 기관 메모 (0086, nullable) — internal 은 팀·fieldwork 는 업체에서 소속을 얻는다
├── userType               # internal|guest|fieldwork (0085, NOT NULL default 'internal' + CHECK)
└── createdAt, updatedAt

sessions                   # 세션 (30일 만기 + 하루 1회 사용 시 연장)
├── id, token (UNIQUE), userId (FK cascade)
├── expiresAt, ipAddress, userAgent
└── createdAt, updatedAt

accounts                   # 크리덴셜 (비밀번호 해시 보유)
├── id, userId (FK cascade), accountId, providerId
├── issuer                 # better-auth 1.7 필수 — 이메일+비밀번호는 'local:credential'
│                          # UNIQUE(issuer, accountId)
├── password (해시), OAuth 토큰류(미사용 nullable)
└── createdAt, updatedAt

verifications              # 토큰 검증 (identifier 인덱스) — 현재 미사용(이메일 재설정 없음)

user_status_events         # 계정 상태 전이 감사 (append-only)
├── id, userId (FK restrict), fromStatus, toStatus
├── changedBy (FK restrict), reason
└── createdAt
```

> **선반영 주의**: 프로덕션·스테이징에는 5테이블이 2026-07-14 선반영돼 있다. `0084_better_auth_tables.sql` 은
> **빈 DB 재생 전용 — 프로덕션·스테이징에 적용 금지**, 적용 대상은 `0085_better_auth_v2_reconcile.sql`
> (user_type + issuer 백필 + 어댑터 기대 인덱스)뿐이다. RLS 5테이블 전부 ON(정책 0 = deny-all).

### 워크스페이스 도메인 (workspace.ts — 팀·멤버십)

```
teams                      # 팀 = 설문 소유·접근 경계 (0088)
├── id, name (전체 조직 경로 포함 표시명), order
├── status                 # active | archived — 해산은 삭제가 아니라 archived (ADR-0011, 티켓 13)
├── archivedBy, archivedAt
└── createdAt, updatedAt   (UNIQUE partial(name) WHERE status='active')

team_members               # 소속의 단일 정본 (ADR-0008)
├── id, teamId (FK restrict), userId (FK restrict)
├── role                   # leader | member
└── createdAt              (UNIQUE(teamId, userId) — 서로 다른 팀 겸직은 허용)

team_lifecycle_events      # 팀 감사 (append-only) — 팀 자체 + 멤버 구성
├── id, teamId (FK restrict)
├── action                 # create|rename|dissolve | member_add|member_role|member_remove
├── targetUserId           # 멤버 사건의 대상 (팀 자체 사건은 NULL)
├── changedBy (FK restrict), metadata (JSONB — 사건 시점 팀 이름·역할)
└── createdAt

survey_groups              # 팀 공용 설문 그룹 = 정리용 폴더 (0090, 티켓 12)
├── id, teamId (FK restrict), name, order
├── createdBy (FK restrict)
└── createdAt, updatedAt   (UNIQUE(teamId, name) — 팀 안에서만 유일)

survey_ownership_events    # 설문 소유 팀·소유자 이동 감사 (0091, 티켓 14 — append-only)
├── id, surveyId (FK **cascade**)
├── action                 # unassign(해산) | assign(재배치 센터) | transfer(승계·티켓 19)
├── fromOwnerId, toOwnerId, fromTeamId, toTeamId (전부 FK restrict, nullable)
├── changedBy (FK restrict), metadata (JSONB — 사건 시점 설문 제목·팀 이름·공개 범위)
└── createdAt              (INDEX (surveyId, createdAt DESC))
```

> `survey_id` 만 CASCADE 인 이유: 현행 설문 삭제가 하드 삭제라(`deleteSurvey` → `tx.delete`)
> RESTRICT 로 걸면 감사 행 하나가 설문 삭제를 영구히 막는다. 형제 감사인 `response_edit_logs`
> 도 같은 이유로 CASCADE 다. 나머지 FK 는 RESTRICT — 사람과 팀은 하드 삭제되지 않는다.

> 멤버 제외는 `team_members` 행을 지운다 — "누가 언제 누구를 뺐는가" 는 감사 행에만 남는다.
> 「메가리서치」(시스템 전체 보기)는 팀이 아니라 슈퍼어드민의 가상 범위라 `teams` 에 행이 없다(ADR-0006).
> archived 팀의 멤버십 행은 감사용으로 남지만 **유효 소속이 아니다** — 조회는 `server/read-models/team-memberships.ts`
> 의 `getActiveTeamMemberships` 하나로 모은다(팀 관리와 설문 접근 판정이 함께 보므로 도메인이 아니라 read-model 이다).
> `surveys.team_id` 는 티켓 07 이, `survey_groups` 는 티켓 12 가 붙였다. `survey_participants` 는 아직 없다(티켓 18).
> **그룹은 접근 권한이 아니라 정리용 묶음이다** — 담겼다는 사실이 판정에 들어가지 않는다.
> `surveys.survey_group_id` 의 FK 는 `ON DELETE SET NULL` 이라 그룹 삭제는 설문을 미분류로
> 되돌릴 뿐이다. 그룹은 팀 소유물이므로 **설문이 팀을 옮기면 `survey_group_id` 도 NULL 로
> 내려야 한다** — 복합 FK 로 강제하지 못한 이유(MATCH SIMPLE 은 team_id NULL 을 건너뛰고
> MATCH FULL 은 그룹 없는 정상 설문을 위반으로 만든다)는 0090 헤더에 있고, 지키는 것은
> 서비스(잠긴 값 재검증)와 조회(team_id 동시 일치 조인)다. 팀 해산·재배치·승계(티켓 13·14·19)의 계약이다.

### 설문 도메인 (surveys.ts)

```
surveys                    # 설문 설정
├── id, title, description, slug, privateToken, previewToken
├── isPublic, allowMultipleResponses, showProgressBar, shuffleQuestions, requireLogin
├── endDate, maxResponses, thankYouMessage, contactEmail, responseHeader (JSONB)
├── piiRetentionUntil (개인정보 보관기한)
├── contactColumns / testContactColumns (JSONB)  # 컨택리스트 표시 컬럼 스킴 (실/테스트 분리)
├── lookups (JSONB)               # 설문에 복사된 LUT 사본 목록
├── contactResultCodes (JSONB)    # 결과코드 사용자 정의
├── progressColumns (JSONB)       # 진척률 표 컬럼 픽커
├── profileColumns (JSONB)        # 응답 내역 표 컬럼 픽커
├── quotaConfig (JSONB)           # 쿼터 플랜 (NULL = 쿼터 없음) — 라이브 컬럼
├── isPaused, pausedMessage       # 응답 일시중지 — 라이브 컬럼
├── testModeEnabled, testToken    # 테스트 모드 (콘솔 전체가 테스트 파티션으로 전환)
├── requireInviteToken            # invite token 강제 여부
├── forceWideLayout               # 강제 와이드 레이아웃
├── status                        # 'draft' | 'published' ('closed' 는 미구현 어휘 — 쓰는 경로 없음, 종료는 endDate/isPaused 로)
├── currentVersionId              # 현재 활성 배포 버전
├── teamId                        # 소유 팀 (0089, nullable — 배치 대기면 NULL)
├── visibility                    # team | invite_only — invite_only 는 **소유 팀 팀원에게만** 숨김
├── ownerUserId, createdBy        # 소유자·작성자 (0089, 2단계 배포 중이라 아직 nullable)
├── surveyGroupId                 # 소속 그룹 (NULL = 미분류, FK ON DELETE SET NULL — 0090)
├── ownershipStatus               # normal | succession_pending (승계 전이는 티켓 19)
├── assignmentStatus              # assigned | assignment_pending — teamId 와 CHECK 로 한 몸
├── deletedAt (soft delete)
└── createdAt, updatedAt

question_groups            # 질문 그룹 (계층 구조, self-reference)
├── id, surveyId, parentGroupId, name, description
├── order, color, collapsed, hideName, nameDesign (JSONB)
├── displayCondition (JSONB)
└── createdAt, updatedAt

questions                  # 개별 질문
├── id, surveyId, groupId
├── type                   # text|textarea|radio|checkbox|select|multiselect|ranking|table|notice
├── title, description, required, requiredMessage, order, hideTitle
├── options, selectLevels, choiceGroups (JSONB)
├── tableTitle, tableColumns, tableRowsData, tableHeaderGrid (JSONB)  # 테이블
├── tableValidationRules, dynamicRowConfigs, sumConstraints (JSONB)   # 검증/합계 제약
├── rankingConfig (JSONB)         # 순위형 전용
├── optionsColumns, optionsAlign, mobileOptionsColumns, minSelections, maxSelections, allowOtherOption
├── placeholder, defaultValueTemplate  # 단답형(prefill 토큰 지원)
├── inputType, emptyDefault, numberFormat (JSONB)  # 단답형 숫자 입력 모드
├── piiEncrypted                  # 응답값 암호화 저장 여부 (단답형·장문형)
├── questionCode, isCustomSpssVarName, exportLabel, spssVarType, spssMeasure, exportCellOrder  # SPSS export
├── answerQuoteEnabled, answerQuoteName, answerQuoteText  # 이전 응답 인용
├── mobileOriginalTable, mobileTableDisplayMode,
│   mobileDrilldownOmitLeadingColumns,
│   mobileDrilldownRepeatHeaderStartRow/EndRow      # 모바일 표 렌더
├── hideColumnLabels, pageBreakBefore
├── noticeContent, requiresAcknowledgment  # 공지
├── imageUrl, videoUrl
├── displayCondition (JSONB)      # 조건부 표시
└── createdAt, updatedAt

survey_responses           # 수집된 응답
├── id, surveyId, questionResponses (JSONB)
├── isCompleted, startedAt, completedAt
├── userAgent, sessionId, ipHash, fpHash, deviceId  # 중복 감지 신호
├── isTest                        # 테스트 파티션 여부
├── metadata (JSONB), lastEditedAt, deletedAt
├── versionId                     # 응답 시점 버전
├── status                        # in_progress|completed|screened_out|quotaful_out|bad|drop (어휘·열림/종결 술어 SSOT: shared/contracts/survey-response.ts)
├── platform, browser, currentStepId, pageVisits (JSONB)  # 운영 현황 추적
├── lastActivityAt, totalSeconds, progressPct, visibleStepIndex, visibleStepTotal
├── contactTargetId               # 컨택 매칭 (FK는 마이그레이션에서 ALTER로 생성)
└── createdAt
└── UNIQUE(surveyId, sessionId)   # 동시 INSERT race 차단

test_response_attempts     # 테스트 응답 회차 (초기화·재응답 추적)
├── id, responseId, sessionId, status, startedAt, supersededAt
└── UNIQUE partial(responseId) WHERE status='active'

survey_versions            # 설문 버전 스냅샷 (불변)
├── id, surveyId, versionNumber
├── status                        # 'published' | 'superseded' ('closed' 미구현)
├── snapshot (JSONB)              # 배포 시점 전체 설문 구조 (prune 시 NULL 가능)
├── changeNote, publishedAt, closedAt, prunedAt, deletedAt
└── createdAt

response_edit_logs         # 관리자 응답 편집 이력
├── id, responseId, contactTargetId, surveyId, action
├── editedBy, editorEmail
├── changedQuestions (JSONB), changedCount
└── createdAt

response_answers           # 정규화된 응답 (빠른 필터링)
├── id, responseId, questionId
├── textValue, arrayValue (JSONB), objectValue (JSONB)
├── questionType (역정규화)
└── createdAt

saved_questions            # 질문 보관함
├── id, question (JSONB), name, description
├── tags, category, usageCount, isPreset
└── createdAt, updatedAt

saved_lookups              # LUT 보관함
├── id, name, description, tags, category
├── columns (JSONB), rows (JSONB)
├── usageCount, isPreset
└── createdAt, updatedAt

saved_cells                # 셀 보관함
├── id, cell (JSONB), name, cellType, usageCount
└── createdAt, updatedAt

question_categories        # 질문 카테고리
├── id, name, color, icon, order
└── createdAt
```

### 컨택 도메인 (contacts.ts)

```
contact_uploads            # 컨택 명단 엑셀 업로드 이력
├── id, surveyId, filename
├── uploadedRows, mergedRows, errorRows, skippedRows
├── mode                   # 업로드 병합 방식 (기본 replace)
├── mapping (JSONB), uploadedBy
└── createdAt

contact_targets            # 컨택 = 응답 대상
├── id, surveyId
├── resid                  # 설문별 자동 발번 — UI 라벨은 "시스템ID"
├── isTest                 # 테스트 파티션 여부
├── groupValue, attrs (JSONB)     # 엑셀 한 행 통째 Record<string,string>
├── inviteToken (UUID, UNIQUE)    # /survey/[id]?invite=<token>
├── inviteCode (UNIQUE)           # /i/<code> 짧은 초대 링크
├── unsubscribeToken (UUID, UNIQUE), unsubscribedAt
├── uploadId, responseId, respondedAt  # 응답 매칭
├── memo, contactMethod
└── createdAt, updatedAt  (UNIQUE surveyId+isTest+resid)

contact_pii                # 컨택 PII 분리 저장 (암호화)
├── id, contactTargetId
├── fieldType, columnKey
├── cipher                 # 암호문
├── blindIndex             # 검색용 blind index
├── maskHint
└── createdAt  (UNIQUE contactTargetId+columnKey)

contact_attempts           # 컨택 결과 회차
├── id, contactTargetId, attemptNo
├── resultCode, note, createdBy
└── createdAt  (UNIQUE contactTargetId+attemptNo)
```

### 메일 도메인 (mail.ts, mail-billing.ts)

```
mail_templates             # 메일 템플릿
├── id, surveyId, name, subject, bodyHtml
├── fromLocal, fromName, replyTo
├── attachments (JSONB), variablesUsed (JSONB)
├── deletedAt
└── createdAt, updatedAt

mail_campaigns             # 발송 회차
├── id, surveyId, mailTemplateId, runNumber, title
├── kind                   # bulk | 단건 발송 등 캠페인 종류
├── isTest                 # 테스트 파티션 여부
├── *Snapshot (subject/bodyHtml/from/replyTo/attachments/filter)  # 발송 시점 스냅샷
├── status                 # draft|queued|sending|completed|partial|cancelled
├── recipientCount, queuedCount, sentCount, deliveredCount,
│   openedCount, bouncedCount, complainedCount, failedCount,
│   skippedUnsubscribedCount  # webhook이 atomic delta로 갱신
├── createdBy, scheduledAt, startedAt, completedAt, archivedAt
└── createdAt, updatedAt  (UNIQUE surveyId+isTest+runNumber)

mail_recipients            # 수신자별 status + Resend message id
├── id, campaignId, contactTargetId
├── emailSnapshot, inviteTokenSnapshot
├── status                 # queued|sending|sent|delivered|opened|bounced|complained|failed|skipped_unsubscribed
├── resendMessageId, errorReason
├── sendAttemptedAt, sendLeaseToken, sendLeaseExpiresAt, sendPayloadSnapshot  # 중복 발송 방지 lease
├── sentAt, deliveredAt, openedAt, bouncedAt, complainedAt, archivedAt
└── createdAt, updatedAt  (UNIQUE campaignId+contactTargetId)

webhook_events             # Resend webhook idempotency dedupe (id = svix-id)
├── id, source, eventType, receivedAt

mail_billing_periods       # 메일 비용 정산 (요금제+결제일 시계열)
├── id, startDate (UNIQUE), billingDayOfMonth, planLabel
├── monthlyFeeKrw, includedEmails, overagePer1kKrw
├── note, createdBy
└── createdAt, updatedAt
```

### R2 파일 수명주기 (r2-lifecycle.ts)

```
r2_deletion_candidates     # 유예 삭제 큐 — R2 영구 객체 삭제의 유일한 경로
├── id, key, source, reason
├── status                 # pending|cancelled|kept|deleted|failed
└── registeredAt, executeAfter(등록 후 7일), resolvedAt, resultNote

r2_sent_keys               # 발송 장부 (append-only) — 오른 키는 영구 보존, 어떤 경로도 삭제 안 함
├── key (PK), firstSentAt

r2_key_refs                # 파생 참조 인덱스 (사전 필터일 뿐 삭제 권한 없음)
├── key, sourceTable, sourceId, extractedAt
```

### 주요 관계

```
surveys (1) ─┬─ (N) question_groups ── parentGroupId (self-ref)
             ├─ (N) questions
             ├─ (N) survey_responses ─┬─ (N) response_answers
             │                        ├─ (N) response_edit_logs
             │                        ├─ (N) test_response_attempts
             │                        └─ (1) contact_targets [optional 매칭]
             ├─ (N) survey_versions ── (N) survey_responses [versionId]
             ├─ (N) contact_uploads ── (N) contact_targets
             ├─ (N) mail_templates ── (N) mail_campaigns
             └─ (N) mail_campaigns ── (N) mail_recipients ── (1) contact_targets

contact_targets ─┬─ (N) contact_pii (암호화 PII)
                 └─ (N) contact_attempts (결과 회차)

saved_questions / saved_lookups / saved_cells / question_categories (standalone)
mail_billing_periods / webhook_events (standalone)
r2_deletion_candidates / r2_sent_keys / r2_key_refs (standalone — 키 문자열로만 연결)
```

---

## 운영 콘솔 라우트

```
/admin/surveys/[id]/operations/
├── overview                      # 응답 현황 (slice 1)
├── profiles                      # 응답 내역 (slice 2)
│   ├── [responseId]/edit         # 응답 상세/수정
│   └── columns                   # 응답 내역 컬럼 픽커
├── contacts                      # 조사 대상 = 컨택리스트 (slice 3)
│   ├── [contactId]               # 컨택 상세
│   ├── columns                   # 컬럼 스킴 편집
│   ├── new                       # 컨택 수동 추가
│   ├── result-codes              # 결과코드 설정
│   ├── upload                    # 업로드 이력
│   └── upload/new                # 엑셀 업로드 마법사
├── report                        # 전시회/그룹별 진척률 리포트 (slice 4)
│   └── columns                   # 리포트 컬럼 픽커
├── quota                         # 쿼터 플랜 + 실시간 달성 현황
└── mail/                         # 메일 캠페인
    ├── templates                 # 템플릿 목록 → new, [mid]/edit
    └── campaigns                 # 캠페인 목록 → new, [cid]

/admin/surveys?group=<groupId>    # 그룹 화면 (티켓 12 — 브레드크럼 + 폴더 제목 + 「그룹 편집」, 목록 툴바는 그룹 범위로)
/admin/users                      # 사용자 관리 (슈퍼어드민 전용 — 유형·상태 필터 + 계정 직접 생성 + 행 케밥의 상태 전이·비밀번호 재설정)
/admin/teams                      # 팀 관리 (슈퍼어드민 전용 — 메가리서치 카드 + 팀 카드 + 새 팀)
/admin/teams/[teamId]             # 팀 상세 (슈퍼어드민 + 그 팀 소속 — 멤버 표·직책 인라인·역할·제외·팀원 추가)
/admin/reassignment               # 재배치 센터 (슈퍼어드민 전용 — 미배치 사용자 / 배치 대기 설문 두 탭 + 일괄 배치 바)
/admin/reassignment/surveys/[surveyId]  # 단건 설문 재배치 (새 소유자·목적지 팀·공개 범위 원자 확정)
/admin/profile                    # 내 프로필 — **세 계정 유형 공통**. /admin 아래지만 내부 전용이 아니다(ACCOUNT_PAGES)
/admin/billing/mail-cost          # 메일 비용 정산
/admin/file-cleanup               # R2 유예 삭제 큐 (대기/이력/취소)

/guest                            # 게스트 홈 (티켓 05 스텁 — 부여 설문 목록은 티켓 22)
/fieldwork                        # 실사 홈 (티켓 05 스텁 — 초대 설문 목록은 티켓 25)
```

응답 페이지 진입 경로: `/survey/[id]?invite=<uuid>` 또는 짧은 링크 `/i/<inviteCode>`. invite 해석 → contact_targets lookup → survey_responses.contactTargetId 매칭. 토큰 무효 시 안내 화면 + 익명 응답 폴백. surveyId가 UUID인 경우 private_token fallback 필요. 빌더 미리보기는 `/preview/<previewToken>`.

> 운영 집계는 `server/operations/services` 에서 SQL 집계로 수행 (aggregate + format + wrapper 패턴 — 공유 format 짝은 `lib/operations/*-format.ts`, UI 도 소비하므로 lib 이 정답). 정확한 통계는 `question_responses` JSONB 기준 (response_answers는 saveResponse/saveAdminEdit 에서만 채워짐).
> 콘솔 조회·쓰기는 `loadOperationsDataScope`가 결정한 실/테스트 파티션(`is_test`)에 갇힌다. 신규 집계 쿼리는 스코프 필터를 빠뜨리지 말 것.

---

## 질문 유형

| 타입          | 설명               | 주요 속성                                                                                             |
| ------------- | ------------------ | ----------------------------------------------------------------------------------------------------- |
| `text`        | 단답형 텍스트      | placeholder, defaultValueTemplate, inputType, emptyDefault, numberFormat                              |
| `textarea`    | 장문형 텍스트      | -                                                                                                     |
| `radio`       | 단일 선택          | options, choiceGroups, allowOtherOption, optionsAlign                                                 |
| `checkbox`    | 복수 선택          | options, choiceGroups, allowOtherOption, minSelections, maxSelections                                 |
| `select`      | 드롭다운 단일 선택 | options, allowOtherOption                                                                             |
| `multiselect` | 드롭다운 복수 선택 | selectLevels (다단계 — 옵션 리스트는 selectLevels 내부 소유)                                          |
| `ranking`     | 순위형             | rankingConfig, optionsSource (manual\|table)                                                          |
| `table`       | 매트릭스/그리드    | tableColumns, tableRowsData, tableHeaderGrid, tableValidationRules, dynamicRowConfigs, sumConstraints |
| `notice`      | 안내문             | noticeContent, requiresAcknowledgment                                                                 |

공통: `requiredMessage`(필수 미응답 문구), `hideTitle`, `pageBreakBefore`(수동 페이지 나눔), `answerQuote*`(이전 응답 인용), `displayCondition`.

### 테이블 질문 셀 타입

- `text`: 텍스트 표시 / `image`: 이미지 / `video`: 비디오 링크
- `checkbox` / `radio` / `select`: 선택 입력
- `input`: 텍스트 입력 (inputType `number` 시 숫자만)
- `ranking`: 셀 내부 랭킹 (셀별 옵션 + 순위 드롭다운 N개)
- `ranking_opt`: 이 셀이 질문 레벨 ranking 의 옵션 소스
- `choice_opt`: 이 셀이 질문 레벨 radio/checkbox 의 옵션 소스
- `calc`: 수식 기반 읽기 전용 계산 셀

> 테이블-소스 choice 응답값은 `cell.id` 임. value-match displayCondition에 코드("3" 등)를 넣으면 영구 미스매치. `resolveChoiceOptions` 사용.

### 테이블 검증 규칙

- 분기형(`tableValidationRules`): `exclusive-check` 배타적 선택 / `required-combination` 필수 조합 / `any-of` 최소 하나 / `all-of` 모두 선택 / `none-of` 선택 불가
- 합계형(`sumConstraints`): 좌변(선택 셀 합계 또는 `leftExpr` 수식) `eq|ne|gte|lte|gt|lt` 우변(리터럴 또는 `targetExpr` 수식), `tolerance`는 eq/ne 전용 절대 오차
- 차단 검증과 분기 규칙은 분리된 개념 — `docs/adr/0013-blocking-validation-separate-from-branch-rules.md` 참조

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
- procedure 베이스 5종은 아래 "인증과 권한" 참조. 모든 베이스는 `rpcLoggingMiddleware`가 붙은 `base` 파생이라 성공/실패가 구조화 로그 1줄로 남는다.
- **표면 선택 원칙**: 브라우저 query/mutation 은 oRPC · RSC 는 service 직접 호출 · 업로드·파일 스트리밍·webhook·sendBeacon·외부 프레임워크 핸들러 마운트(`/api/inngest`·`/api/auth`)는 Route Handler · **JS 없이 동작해야 하는 네이티브 폼과 redirect+쿠키 의미론만 서버 액션**. 서버 액션 0개가 목표가 아니다.
- 그 원칙에 따라 잔존 서버 액션은 `actions/` 1파일뿐 (unsubscribe form — 의도적 유지).
- **서버 도메인 마이그레이션 패턴/함정**: domain zod는 `@/types/survey` 방향 통일 + null-coalescing(as unknown as 금지), service input은 zod infer, `.returning()` 후 non-null throw, 컴포넌트는 hook/helper 시그니처 유지로 무수정. 질문 영속 쓰기는 explicit field set(spread 금지) + `PERSISTED_QUESTION_FIELDS` SSOT 로 tsc 관할 — 신규 컬럼은 SSOT 등재만 하면 모든 쓰기 지점(survey-save values/onConflict, create, duplicate, updateQuestion 순회)이 컴파일 에러로 호명된다.
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
GET    /api/surveys/[surveyId]/export          # SPSS(.sav)/엑셀 export (인증 + export.download 관문, 파일 스트림)
GET    /api/surveys/[surveyId]/export/split-preview  # 분할 export 미리보기
GET    /api/surveys/[surveyId]/contacts/export # 조사 대상 목록 엑셀 다운로드
POST   /api/response/segment                   # 구간 응답 저장 (sendBeacon — REST 유지)
POST   /api/response/draft                     # 이탈 시점 임시 저장 (sendBeacon — REST 유지)
*      /api/inngest                            # Inngest 핸들러
POST   /api/webhooks/resend                    # Resend webhook (svix 검증)
*      /api/auth/[...all]                      # Better Auth 핸들러 (민감 POST 경로는 auth-sensitive IP rate limit 선적용)
```

---

## 백그라운드 잡 (Inngest)

`server/workflows/jobs/` — 4개 함수 (`jobs/index.ts` 등록). 잡은 여러 도메인의 쓰기를 조율하므로 workflows 층이 집이다.
클라이언트 어댑터(`lib/inngest/client.ts`)만 인프라로 lib 에 남는다.

| 함수                 | 트리거                           | 역할                                                      |
| -------------------- | -------------------------------- | --------------------------------------------------------- |
| `campaignDispatcher` | event `mail/campaign.queued`     | 캠페인 발송 실행 (수신자 lease 기반)                      |
| `campaignReconciler` | event `mail/campaign.dispatched` | 발송 후 1/5/30분 reconcile — sent 멈춤(webhook race) 복구 |
| `r2DeletionExecutor` | cron `TZ=Asia/Seoul 0 4 * * *`   | R2 유예 삭제 집행 (일 1회)                                |
| `r2KeyRefAudit`      | cron `TZ=Asia/Seoul 0 3 1 * *`   | R2 참조 인덱스 전량 재추출 (월 1회)                       |

로컬 dev: `pnpm inngest`. **Inngest 자동 sync가 끊겨 있어 함수 변경 배포 후 대시보드에서 수동 Resync 필요.**

---

## 인증과 권한

- **세션은 Better Auth**(ADR-0018). 인스턴스는 `lib/auth/server.ts` — email+password, UUID user id,
  30일 세션 + 하루 1회 사용 시 연장, `disableSignUp`(공개 가입 없음)·`autoSignIn` 없음·이메일 비밀번호
  재설정 없음(분실은 슈퍼어드민이 새 임시 비밀번호를 지정). sign-in 전 비활성 상태(active 외)를 차단하며
  실패 응답은 미존재 계정과 바디·타이밍까지 동일(더미 해시). 시드는 `pnpm auth:seed`.
- **계정 수명주기**는 `server/auth`(도메인 규칙 + 서비스)와 `/admin/users` 행 케밥이 담당한다.
  허용 전이는 `shared/contracts/auth.ts` 의 `USER_STATUS_TRANSITIONS` 하나가 정하고, 서버 강제
  (`resolveUserStatusTransition`)와 화면 메뉴(`availableUserStatusActions`)가 같은 표를 본다 —
  화면이 표를 따로 들면 "메뉴엔 있는데 누르면 CONFLICT" 가 된다. 전이는 advisory lock + 행 잠금
  아래에서 처리하고(마지막 슈퍼어드민 동시 정지 경합 차단), **모든 전이·재설정이 대상 세션을 전부
  끊고 `user_status_events` 에 감사 행을 남긴다**(재설정은 상태가 그대로라 from=to). 마지막 active
  슈퍼어드민 가드는 "이 전이로 active 가 0명이 되는가"만 묻는다 — 대상이 이미 비활성이면 적용하지
  않는다(그러지 않으면 정지된 슈퍼어드민을 영영 정리할 수 없다). 퇴사의 멤버십·소유권 정리와
  재입사의 팀 배정은 티켓 06·14·19 소관이라 아직 없다.
- **팀 멤버십은 소속의 단일 정본이다**(ADR-0008, 티켓 06). 팀 관리 표면은 `server/workspace` 가
  담당하고 관문은 두 겹이다 — procedure 의 `assertTeamManager` 가 **입력의 teamId 로** 팀장
  여부를 묻고(어딘가의 팀장이면 통과시키는 순간 A팀 팀장이 B팀 멤버를 만진다), 서비스가
  대상의 소속·상태·유형을 다시 본다. 특히 직책 수정은 **대상이 그 팀 소속인지** 확인해야
  한다 — 확인이 빠지면 팀장이 userId 만 갈아끼워 타 팀·미배치·슈퍼어드민의 직책을 바꾼다.
  팀 목록·생성·이름 변경은 조직 구조를 다루므로 `superadmin` 전용이고, 상세는 `authed` 로
  열되 **슈퍼어드민·그 팀 팀장**이 아니면 NOT_FOUND(존재를 알려주지 않는다). 팀원 추가는
  **pull 모델**이라 미배치 internal active 만 검색·추가되며, 타 팀 active 멤버를 당기는
  겸직 생성은 슈퍼어드민만 할 수 있다. 판정 경합은 팀 키 advisory lock(같은 사람을 두
  팀에서 동시에 당기는 경합은 사용자 키)으로 직렬화하고, 멤버 추가·역할 변경·제외는
  `team_lifecycle_events` 에 감사 행을 남긴다.
- **설문 그룹은 접근 권한이 아니라 정리용 묶음이다**(티켓 12, .pen FLOW 2). 그래서 관문이
  두 갈래다 — **그룹 구조**(목록·생성·이름 변경·정렬·삭제·담기 후보 조회)는 팀 공용이라
  슈퍼어드민 또는 그 팀 active 멤버면 팀장·팀원을 가리지 않고, **설문을 넣고 빼는 것**만
  그 설문의 `survey.edit` + `surveyGroup.manage` 를 함께 요구한다. 전자만 보면 참여자
  (티켓 18)가 남의 팀 폴더를 재배치하고, 후자만 보면 팀원이 못 고치는 설문을 옮긴다.
  **그룹 mutation 은 트랜잭션 안에서 `teams` 행을 `FOR SHARE` 로 잡고 active 를 다시 본다** —
  관문의 확인은 별도 왕복이라 그 사이 해산이 커밋되면 감사 계보로 남겨야 할 archived 팀의 그룹
  행이 수정·삭제된다(`collect`·`move` 는 잠근 설문 행의 `teamId` 로 이미 잡힌다).
  판정은 `assertSurveyCapabilityBatchRpc` 로 한 왕복에 끝낸다(담기는 최대 200건이고
  하나라도 막히면 트랜잭션 하나라 전부 거부다). `groupId` 만 받는 표면(이름 변경·삭제)은
  **타 팀 그룹을 없는 그룹과 같은 NOT_FOUND 로 접는다** — 사유가 갈리면 id 스캔으로 타 팀
  그룹의 존재가 확인된다. 담기 후보의 `canMove` 는 근사가 아니라 서버 판정 그대로다
  (주체 한 번 + `resolveSurveyCapabilities` 를 행마다). 담기·이동은 그룹 행 → 설문 행
  순서로 `FOR UPDATE` 를 잡고 **잠긴 값으로** 팀 일치·미분류 여부를 다시 본다. 그룹 이동은
  `surveys.updatedAt` 을 건드리지 않는다 — 폴더에 넣는 일은 내용 수정이 아니고, 건드리면
  「최신 수정순」 기본 정렬이 담기 한 번에 통째로 뒤집힌다. 화면 쪽은 그룹 화면이 목록의
  다른 상태가 아니라 **주소**(`/admin/surveys?group=<id>`)이며, 사이드바 그룹 트리가 그
  입구다. 지목한 그룹이 목록에 없으면(삭제됨·타 팀 id) 좁힘 자체를 하지 않아 빈 화면에
  갇히지 않는다.
- **설문 접근 판정은 `server/survey-access.ts` 하나가 한다**(티켓 07, 스펙 §8). `data-scope` 가
  "어느 파티션을 보는가" 를 정하듯 이쪽이 "무엇을 할 수 있는가" 를 정하는 코어다. 순수 함수
  `resolveSurveyCapabilities` 의 **순서가 곧 정책**이다 — 계정 유형 → 슈퍼어드민 → 팀 미배치 →
  배치 대기 → **소유자(소유 팀 소속일 때만)** → 소유 팀 팀장 → 참여자 → 팀 공개 설문의 팀원.
  소유자 분기가 소유 팀 소속을 함께 묻는 것이 이 코어의 **revocation 계약**이다 — 소유자
  일치만 보면 A팀 설문 소유자가 A팀에서 제외돼도 다른 팀 겸직이 남아 있는 한(팀 미배치 가드는
  "아무 팀에나 속했는가"만 묻는다) 그 설문 전권을 계속 행사한다. 팀을 접근 경계로 삼는 계약이
  제외로 끊기지 않으면 경계가 아니다(Codex 적대적 리뷰). 설문이 고아가 되지는 않는다 — 소유 팀
  팀장과 슈퍼어드민이 언제나 남고 정식 이전은 티켓 19 다. `invite_only` 는 마지막
  하나(팀원)만 지운다: v2 에서 그 뜻이 "소유 팀 **팀원에게만** 숨김" 으로 바뀌었고, 팀장까지 막으면
  팀장이 자기 팀 설문을 관리할 수 없어 승계·해산이 잠긴다. 팀 미배치 사용자는 **초대 설문을 포함해**
  전부 차단이고(CONTEXT.md 「팀 미배치 사용자」), 배치 대기 설문은 소유자에게도 닫힌다 — 팀이 정해지기
  전에는 아무도 열 수 없다(ADR-0006). 게스트·실사는 부여 모델이 붙기 전까지 기본 거부다(티켓 21·24).
  매트릭스 테스트는 표를 옮겨 열마다 검증한다 — 프리셋 상수를 다시 읽어 비교하면 구현이 스스로를
  채점해 매트릭스가 바뀌어도 GREEN 이 유지된다.
- **작업 범위는 `server/work-scope.ts` 가 정한다.** 팀 | 시스템 전체 보기(메가리서치) | 없음 셋이며,
  폴백은 마지막 유효 팀 → 첫 active 팀 → 없음이다(.pen FLOW 6-1). 화면이 보내는 값은 편의일 뿐이라
  서버가 멤버십으로 다시 해석한다 — 내 팀이 아닌 teamId 는 **접고**(쿠키에 남은 해산 팀으로 화면이
  잠기지 않게), 일반 사용자의 `system` 요청은 **거부한다**(조용히 접으면 부분 목록을 전체로 착각한다).
  요청이 범위를 지목하지 않으면 `work_scope` 쿠키를 읽는다(이름 SSOT 는 `shared/contracts/workspace.ts`).
  설문 목록 응답은 **해석된 범위**를 함께 돌려준다 — 요청과 다를 수 있어 화면이 그것을 정답으로 삼는다.
  화면 쪽은 사이드바 팀 스위처(티켓 08)가 담당한다 — `app/admin/layout.tsx` 가 같은 판정 코어로 초기
  범위를 해석해 `AdminShell` 에 넘기고(무효 쿠키는 거부가 아니라 기본 범위로 접는다 — 쿠키는 편의값),
  전환은 쿠키 기록 + 전체 쿼리 캐시 무효화 + `router.refresh` 로 처리한다. 목록 쿼리 키에는 항상
  해석된 범위가 들어가 팀 간 캐시가 섞이지 않고, 팀 미배치는 조회 자체를 하지 않는다(.pen FLOW 9-1).
- **설문을 만드는 경로 넷(빌더 자동 생성·명시 생성·복제·전체 저장 생성 모드)은 전부
  `resolveNewSurveyOwnership` 로 소유·배치 컬럼을 채운다.** 시스템 전체 보기는 teams 행이 아니라
  조회 범위라 소유 목적지가 될 수 없고(.pen 6-2), 팀 미배치도 만들 수 없다 — 서버가
  `SurveyOwnershipRequiredError` 로 막고 화면은 버튼을 비활성으로 둔다. 복제본은 원본의
  팀·공개 범위를 잇는다(팀을 잇지 않으면 배치 대기로 떨어져 만든 사람조차 목록에서 못 본다).
  복제·기존 행 ensure 는 원본에 **survey.edit** 을 요구한다 — 열람만 가진 주체가 사본의 전권을
  얻거나 타 팀 설문의 존재를 확인하는 우회를 막는다.
- **관문 배선(티켓 09·10 완료분)**: 빌더·분석·운영 콘솔 도메인의 surveyId procedure 전수가
  handler 첫 줄에서 capability 관문을 지난다. 매핑 — 조회 survey.view · 운영 제어·현황 조회
  operations.view · 응답 조회·응답 관리 4종·응답 상세 편집 responses.view · 컨택 열람
  contacts.view · 컨택 관리·업로드·결과코드 어휘·수신거부 해제 contacts.manage · 결과코드
  회차 쓰기 contacts.writeAttempts · 메일 조회 mail.view · 캠페인·템플릿·발송 mail.send ·
  내보내기 export.download · mutation(운영 제어·쿼터 저장·컬럼 픽커 저장 포함) survey.edit ·
  발행 survey.publish · 삭제 survey.delete · 분석 analytics.view. **단 분석 RSC 화면 둘
  (`/analytics/[surveyId]`·`/admin/surveys/[id]/analytics`)은 `responses.view` 도 요구한다** —
  `getResponsesWithAnswers` 로 복호화된 원문 응답과 응답자 추적 필드를 클라이언트 props 로
  직렬화하므로 RSC payload 에 그대로 실린다(analytics **RPC** 는 집계 스키마로만 나가 종전대로
  analytics.view 다). 두 화면이 갈리지 않게 `tests/repo/analytics-page-guards.test.ts` 가 묶는다.
  거부 사유의 정본은 코어
  `denialReasonFor` 하나다 — **survey.view 가 없으면 forbidden 이 아니라 not_found**(id 스캔으로
  타 팀 설문 존재 확인 차단), 보이는 설문의 권한 부족만 forbidden. authed 표면은
  `assertSurveyCapabilityRpc`, **scoped 표면(게스트 허용 콘솔)은 `assertScopedSurveyCapabilityRpc`**
  — env grant 게스트는 grant 일치(불일치 FORBIDDEN), 내부 계정은 capability(티켓 21 이 통합).
  `control.get` 만 관문 NOT_FOUND 를 null 로 접는다(미저장 설문의 빌더 헤더 10초 폴링 OFF 폴백
  규약). `saveWithDetails` 만 관문이 procedure 가 아니라 **서비스 트랜잭션 안**에 있다 — 생성/갱신
  한 입구라 존재 판정과 쓰기를 갈라놓으면 tombstone 부활·생성 레이스가 된다. 무관문 예외는
  셋뿐이고 전부 사유가 주석에 있다 — 보관함(library, surveyId 없는 조직 공용)·
  `uploads.parsePreview`(무상태 엑셀 파싱)·`media.deleteMailAttachmentTmp`(tmp 키 검증 의존).
  billing 은 설문 스코프가 아닌 전역 정산이라 범위 밖. 옛 `assertSurveyAccess`(orpc.ts)·
  `SurveyOwnershipError`(require-survey-ownership)는 걷었다. **REST 표면(티켓 11)**: export 3종
  (export·split-preview·contacts export)은 `server/rest-survey-access.ts` 의
  `checkScopedSurveyCapabilityRest`(not_found→404 존재 은닉·forbidden→403, env grant 게스트는
  grant 일치)로 `export.download` 를 지고, 게스트의 grant 설문 export 현행 유지·항상 차단 전환은
  티켓 21 몫이다. 업로드 REST 3종은 surveyId 없는 tmp 네임스페이스 전용이라 의도된 면제
  (`lib/upload/route-guard.ts` 주석) — 영구 승격 경로(설문 저장·템플릿 저장·media.*)가 관문을 진다.
- **팀 해산은 확정 즉시, 한 트랜잭션, 되돌릴 수 없다**(ADR-0011, 티켓 13, .pen FLOW 8-1).
  `workspace.teams.dissolve`(superadmin 전용, 팀 관리 목록의 카드 케밥이 유일한 진입점)가
  팀 `archived` + 소속 설문 배치 대기(`teamId=null`·`assignment_pending`·`surveyGroupId=null`)
  - 감사 행을 함께 쓴다. **`team_members` 행은 지우지 않는다** — 유효 소속 판정
    (`getActiveTeamMemberships`)이 active 팀만 조인하므로 팀원은 그 순간 자동으로 미배치가 되고,
    행을 지우면 "해산 시점 명부" 가 어디에도 안 남는다. 확인 문구(팀 이름 재입력) 대조는 화면과
    **서버 양쪽**에 있다 — 화면만 검사하면 raw RPC 한 번으로 팀이 사라진다. 잠금은 멤버 변경과
    **같은 팀 키**(`lockTeamMembers`)를 쓰고 최종 UPDATE 에 `status='active'` 조건을 함께 건다:
    잠금만으로는 앞선 해산 뒤에 락을 받은 두 번째가 감사 행을 더 쓰고 archivedBy 를 덮는다.
    **해산 취소 procedure 를 만들지 말 것** — 확인 모달의 "되돌릴 수 없습니다" 가 거짓이 되고
    정식 복구 경로는 재배치 센터(티켓 14)다. 해산 뒤에도 **공개 응답·예약 메일·Inngest 잡·
    게스트 콘솔은 계속 돈다**(그 경로들이 팀 컬럼을 읽지 않는 것이 근거다 — 새 응답 게이트를
    만들 때 `teamId`·`assignmentStatus` 를 끌어들이면 그 약속이 깨진다). 「해산이 끝이어야
    하는데 열려 있던」 경로 셋도 함께 닫혔다 — 슈퍼어드민은 관문을 소속 조회 없이 통과하므로
    archived 팀의 **멤버 명부**(members 3종에 `requireActiveTeam`)·**그룹 쓰기**
    (`getSurveyGroupTeamId` 가 active 팀만)·**새 설문 귀속**(`resolveNewSurveyOwnership` 이
    쓰기 직전 재확인)에 계속 닿을 수 있었다.
- **재배치 센터는 팀 경계로 좁힐 수 없는 목록이라 슈퍼어드민 전용이다**(티켓 14, .pen FLOW
  8-2~8-4·9-2). `/admin/reassignment` 는 팀 관리의 「메가리서치」 카드가 유일한 입구고
  사이드바 항목도 `teamId` 딥링크도 없다 — 여기 있는 사람과 설문은 **어느 팀에도 속하지
  않아** 팀장에게 하나라도 열면 그 순간 전사 열람이 된다. `workspace.reassignment` 5종
  (`inbox`·`pendingSurvey`·`ownerCandidates`·`assignUser`·`assignSurveys`)이 전부 superadmin
  베이스이며, 페이지도 `requireSuperadminPage` 라 두 경로의 권한 축이 같다.
  - **새 소유자는 목적지 팀의 활성 멤버여야 한다**(`OwnerNotInTeamError`). 이것이 이 티켓의
    핵심 불변식이다 — `resolveSurveyCapabilities` 의 소유자 분기는 **소유 팀 소속일 때만**
    전권을 주므로(티켓 13 하드닝), 팀 밖 사람을 앉히면 배치는 성공하는데 그 소유자가 자기
    설문을 못 여는 설문이 만들어지고 화면에는 아무 경고도 뜨지 않는다. 후보 목록
    (`listOwnerCandidates`)과 서버 검증이 **같은 모집단**을 보는 것이 그 계약이다.
  - **단건(8-4)과 일괄(9-2)은 같은 RPC** 다. 단건은 목록 길이가 1 인 경우일 뿐이라 나누면
    「전부 아니면 전무」 규칙이 두 벌이 된다. 없는 id 와 「배치 대기가 아닌」 id 는 **같은
    사유**로 접는다 — 갈라 말하면 재배치 주소가 전체 설문의 존재 확인 창구가 된다.
  - 잠금 순서는 **팀 멤버 → 팀 행 `FOR SHARE` → 설문 id 오름차순**으로 해산·담기와 같다.
    맞추는 것이 목적이 아니라 배치가 해산의 **정확히 반대 방향 이동**이라 서로를 기다려야 한다.
    배치는 `survey_group_id` 를 NULL 로 둔다(그룹은 팀 소유물 — 새 팀에서는 미분류).
  - 인박스 목록은 **200건 상한, 지표는 전체 수**다. 0089 백필이 팀 도입 이전 설문 전부를
    배치 대기로 세워 초기 운영에서 수천 건일 수 있다 — 화면이 「상위 N건」임을 말한다.
  - **배치 취소 표면을 만들지 말 것.** 인박스는 처리하는 곳이지 되돌리는 곳이 아니다(해산에
    취소가 없는 것과 같은 이유). 되돌리려면 정식 이전(티켓 19)을 쓴다.
- **배치 대기 설문의 「출신 팀」은 `survey_ownership_events` 에만 남는다**(0091, 티켓 14).
  해산이 `surveys.team_id` 를 NULL 로 내리므로 설문 행에는 출처가 없고, 팀 쪽 `dissolve`
  감사는 **규모**(surveyCount)만 적을 뿐 어느 설문인지 적지 않는다. 그래서 `dissolveTeam` 이
  설문별 `unassign` 행을 함께 쓴다 — 이 행이 없으면 .pen 8-4 의 「현재 소유 팀 · 해산됨」도,
  "누가 이 설문을 저 팀으로 옮겼는가" 도 답할 수 없다. 티켓 19 승계가 `transfer` 로 이어 쓴다.
- **재입사는 상태 전이와 팀 배정이 한 트랜잭션이다**(티켓 14, .pen FLOW 9-4). 퇴사가 유효
  소속을 끊어놓았으므로 상태만 되돌리면 로그인만 되는 미배치로 되살아나 재배치 센터로 다시
  흘러간다 — 「새 소속으로 다시 시작합니다」라고 말하는 화면이 목적지를 안 받으면 그 문장이
  거짓이 된다. 두 도메인의 쓰기라 `server/workflows/user-rehire` 가 묶는다(도메인끼리는 서로를
  못 부른다). **순서가 계약이다** — ① 상태 전이 ② **옛 활성 소속 정리** ③ 새 소속 배정.
  - ①이 먼저인 이유: 배정의 `assertMemberAssignable` 이 대상의 재직 여부를 본다. 뒤집으면
    재입사가 자기 자신의 재직 검사(퇴사 상태)에 걸린다.
  - ②가 **없으면 기능이 통째로 죽는다**: 퇴사는 `team_members` 행을 지우지 않으므로(팀 상세가
    비활성 멤버를 표식과 함께 계속 보여줘야 한다) 팀이 있던 사람은 전원 「이미 다른 팀에
    소속됨」으로 막힌다. 정리는 `clearActiveMembershipsInTx` 가 `member_remove` 감사와 함께
    한다. **마지막 팀장 가드는 부르지 않는다** — 세는 것이 활성 팀장인데 대상은 이미 퇴사라,
    부르면 유일한 팀장이 퇴사한 팀에서 재입사가 영구히 막힌다.
  - `teamId`·`teamRole` 은 계약상 **nullable** 이고 **유형별로** 강제된다. guest·fieldwork 는
    멤버십이 금지고(스펙 §1) 슈퍼어드민은 팀 소속과 무관하므로, 필수로 두면 그 계정들은 한 번
    퇴사한 뒤 영영 돌아올 수 없다. 화면도 그 계정에는 두 칸을 아예 감춘다.
  - 배정 실패는 워크플로가 `RehireTeamAssignmentError` 로 **사유 문구만 보존해** 감싼다 —
    워크스페이스 도메인 에러를 그대로 올리면 auth procedure 가 그 도메인을 import 해야 한다.
- **마지막 팀장 가드가 지키는 것은 "관리자가 남는가" 이지 "leader 행이 남는가" 가 아니다.**
  세는 것은 **활성** 팀장이고, **대상이 비활성이면 아예 묻지 않는다** — 그러지 않으면 유일한
  팀장이 퇴사한 순간 강등도 제외도 거부되어(활성 팀장 0명) 팀이 유령 팀장에 잠긴다.
- **RSC 페이지는 자기 가드를 갖는다.** App Router 는 소프트 내비게이션에서 상위 레이아웃을
  다시 돌리지 않는다 — 콘솔 RSC 는 procedure 가 아니라 service 를 직접 부르므로 레이아웃만
  믿으면 세션이 폐기된 뒤에도 데이터를 읽는다. 서버 데이터를 부르는 `page.tsx` 는 전부
  `requireAuth`·`requireAdminPage`·`assertSurveyConsolePageAccess` 중 하나를 부르고,
  `tests/repo/rsc-page-guards.test.ts` 가 빠뜨림을 잡는다(무인증 응답자 표면만 허용 목록).
  설문 콘솔 페이지의 capability 는 `[id]` 레이아웃이 survey.view 를 한 번 접고 leaf 가 자기
  정밀 관문을 가진다 — 게스트 허용 화면은 `assertSurveyConsolePageAccess(surveyId, cap)`,
  게스트 차단 화면(컬럼 스킴·결과코드·업로드·쿼터)은 `requireAdminPage` +
  `assertSurveyCapabilityPage` 짝. 구 `assertGuestSurveyPageAccess`(guest-page-guard)는 티켓 10
  이 걷었다.
- **세션 폐기는 표식으로 경합까지 닫는다.** 재설정·상태 전이는 세션을 지우면서
  `users.sessions_revoked_at`(0087)을 갱신하고, 로그인은 시작 시점의 값을 읽어뒀다가 세션을
  만들기 직전에 다시 읽어 다르면 생성을 취소한다(`lib/auth/session-revocation.ts`).
  시각의 대소가 아니라 **같은 컬럼의 두 번 읽기**라 앱·DB 시계 오차와 무관하다.
  표식은 **먼저 찍힌 것이 이긴다** — 흐름 도중 다시 읽어 덮으면 막으려던 창이 그대로 열린다.
- **`/api/auth` POST 는 허용목록이다**(`sign-in/email`·`sign-out`). catch-all 이 전 엔드포인트를
  열어두면 `update-user` 로 아바타 URL 검증을, `change-password` 로 다른 기기 로그아웃을
  우회할 수 있다. 서버는 `auth.api.*` 를 직접 부르므로 목록을 좁혀도 앱 동작은 그대로다.
- **게이트는 2단이다.** `proxy.ts` 는 세션 쿠키 존재만 보는 1차 게이트(DB 미조회)로
  `/admin`·`/analytics`·`/guest`·`/fieldwork` 진입을 거르고 `x-pathname` 요청 헤더를 넘긴다.
  쿠키 유효성·계정 상태(active)·**계정 유형**·게스트 경로 제한은 `app/admin/layout.tsx`·
  `app/analytics/layout.tsx` 가 서버에서 재검증한다. 유형 구역(`/guest`·`/fieldwork`)은 페이지의
  `requireAccountTypePage` 가 본다. 비로그인 접근을 허용하는 경로 목록은
  `lib/auth/protected-paths.ts` 의 `AUTH_PAGES` 한 곳에 있고(현재 `/admin/login` 뿐), 유형과 무관하게
  열리는 admin 경로는 같은 파일의 `ACCOUNT_PAGES`(현재 `/admin/profile` 뿐)다.
- **로그인**은 `authClient.signIn.email`(클라이언트)로 세션을 만든 뒤 `/admin/login` 으로 되돌아오고,
  목적지 해석은 그 페이지(RSC)가 한다 — 게스트 grant 가 서버 설정이라 클라이언트가 결정할 수 없다.
  복귀 경로는 `lib/auth/safe-redirect.ts` 가 정제한다(내부 절대경로만, 제어 문자 차단).
  로그아웃은 `components/auth/logout-button.tsx` 의 `authClient.signOut`.
- REST 라우트·RSC 는 `lib/auth.ts` 의 `requireAuth`(세션 + status='active' + userType='internal')를 쓴다 — oRPC `authed` 와
  같은 정책이라 REST 가 형제 우회 경로가 되지 않는다. admin 전용 RSC 는 `requireAdminPage` 가 게스트도 막고, 전역 관리 RSC 는 `requireSuperadminPage` 가 슈퍼어드민만 통과시킨다(둘 다 거부는 notFound).
- procedure 베이스 5종 (`server/orpc.ts`):
  - **`pub`** — 인증 불필요 (응답자 표면: 응답 mutation·공개 설문 조회·컨택 attrs·수신거부 lookup). 남용 방지가 필요한 표면은 `.use(withRateLimit(group))` 부착.
  - **`authed`** — 세션 + `status === 'active'` + `userType === 'internal'` + 게스트 grant 아님. 비활성 계정은 세션이 이미 있어도 FORBIDDEN(발급 후 상태가 바뀐 경우).
  - **`superadmin`** — `authed` + `isSuperadmin`. 전역 관리 표면(사용자 관리·계정 상태 전이·비밀번호 재설정, 이후 실사 업체) 전용. 페이지 쪽 짝은 `requireSuperadminPage`.
  - **`account`** — 세션 + active. **계정 유형을 보지 않는다.** 프로필처럼 "누구든 자기 것만 만지는" 표면 전용(`auth.getProfile`·`updateProfile`·`updatePassword`). 아바타 정책 상수는 `lib/upload/image-policy.ts` 의 `AVATAR_UPLOAD_POLICY` 한 곳에 있고 라우트와 화면이 같은 값을 본다. 자기 것만 만진다는 보장은 베이스가 아니라 handler 가 한다 — 대상 id 를 입력에서 받지 말고 `context.user.id` 를 쓸 것. REST 짝은 `requireActiveAccount`, 페이지 짝은 `requireAccountTypePage`.
  - **`scoped`** — 세션 + active (게스트 포함). **베이스는 유형으로 막지 않지만 handler 관문이 막는다** — env grant 게스트는 grant 일치로, 내부 계정은 capability 로 판정하고, grant 없는 guest·fieldwork 유형은 capability 코어의 계정 유형 게이트가 기본 거부한다(티켓 21·24 가 실제 조회로 바꾼다). 인증 가드는 `account` 와 글자까지 같지만 **별개의 베이스로 둔다** — 지는 계약이 달라서(이쪽은 설문 일치 강제, 저쪽은 자기 것만), 별칭으로 묶으면 한쪽을 조일 때 다른 쪽 전 표면이 조용히 따라 바뀐다. **이 베이스를 쓰는 procedure는 핸들러 첫 줄에서 `assertScopedSurveyCapabilityRpc(context.user, input.surveyId, '<cap>')` 호출 필수** (유일한 예외: surveyId가 없는 `media.deleteMailAttachmentTmp`).
- **계정 유형 게이트**: `authed`·`requireAuth` 는 `userType === 'internal'` 만 통과시킨다(`isInternalUser`,
  세션에 실려 오는 값). 사용자 관리에서 발급한 guest·fieldwork 계정은 로그인은 되지만 내부 표면
  (설문·운영·export·업로드)에는 들어오지 못한다. 각자의 콘솔은 `scoped` 등 자기 가드로 열린다.
  `readSessionUser` 의 안전 기본값은 'guest' — 값이 없으면 내부를 열지 않는 쪽으로 접는다.
- **유형별 목적지**(티켓 05): 홈 표의 SSOT 는 `lib/auth/account-home.ts` 의 `ACCOUNT_HOME_PATH`
  (internal→`/admin/surveys` · guest→`/guest` · fieldwork→`/fieldwork`). 로그인 직후 목적지는
  `resolvePostLoginDestination` 이 정한다 — 게스트·실사가 요청한 내부 경로는 자기 홈으로 접는다
  (그대로 보내면 admin 게이트가 되돌려 보내 로그인 화면을 오가는 루프가 된다). admin·analytics
  레이아웃은 비내부 계정을 자기 홈으로 **리다이렉트**하고(존재를 감출 이유가 없어 notFound 가 아니다),
  `ACCOUNT_PAGES`(현재 `/admin/profile`)만 비켜준다. 설문 단위 env grant 게스트는 이 축과 별개로
  살아 있다 — 그 모델의 목적지는 grant 설문 콘솔이라 `guestPostLoginRedirect` 가 먼저 갈라진다
  (티켓 21 에서 두 축이 합쳐진다).
- **프로필은 세 유형 공통**(.pen FLOW 3-2, `/admin/profile`). 본인이 바꾸는 것은 이름·아바타·비밀번호
  뿐이다 — `UpdateProfileInput` 에 이메일·직책·소속이 없는 것이 이 표면의 정의다. 내부 계정은
  이메일·직책을 읽기 전용으로 보고, 게스트·실사에게는 그 두 칸이 아예 보이지 않는다(스펙 §10). 비밀번호 변경은 **다른 기기 세션만 끊고 현재 세션은 남긴다**(슈퍼어드민 재설정이 전부 끊는
  것과 갈리는 지점). 아바타는 전용 라우트 `/api/upload/avatar` 가 정사각 WebP 로 깎아 저장하고,
  서비스가 그 URL 이 우리 R2 공개 URL 인지 확인한다(외부 주소면 남의 서버가 우리 화면에 그림을 그린다).
- 게스트 계정: `GUEST_SURVEY_GRANTS="<userId>:<surveyId>[,...]"` env로 설문 단위 위임 (한 유저가 복수 설문 grant 가능). 무권한 설문 콘솔 진입 시 강제 로그아웃(`/admin/logout`) → 로그인 후 원래 목적지 복귀 (`lib/auth/guest-grants.ts`). 계정 발급 모델(`users.user_type='guest'`)로의 교체는 티켓 21.
- 게스트 콘솔은 전역 테스트 모드와 무관하게 항상 실데이터를 본다.

---

## 레이트리밋과 로깅

- **레이트리밋** (`lib/rate-limit/`): Upstash Redis 2단 판정(`isRateLimitedTwoTier`). 입력의 sessionId/responseId를 클라이언트 축으로 삼아 `group:ip:clientId`로 같은 NAT 뒤 응답자를 격리하고, `group-ip:ip` 전체 가드가 식별자 회전 남용을 막는다. **UPSTASH env 미설정이면 limiter가 no-op(항상 통과)**. 신뢰 IP 헤더 부재 시에만 fail-closed. `/api/auth` 민감 POST 경로는 `auth-sensitive`(IP 당 10회/10분, 단일 축) 버킷을 라우트에서 선적용한다.
- **로깅** (`lib/logger/`): pino + Axiom transport. `base`의 `rpcLoggingMiddleware`가 최전방이라 인증·레이트리밋 거부까지 기록된다. PII 마스킹은 `redact.ts` 소관.

---

## R2 파일 수명주기

R2 영구 객체 삭제의 유일한 경로는 유예 삭제 큐다 (`server/storage-lifecycle/`).

- `r2_deletion_candidates` — 등록 후 7일 유예, cron 집행자가 장부·전역 참조를 재확인한 키만 삭제.
- `r2_sent_keys` — 발송된 메일 콘텐츠에서 추출한 키의 append-only 장부. **장부에 오른 키는 참조 유무와 무관하게 영구 보존** (수신함 참조는 DB로 복원 불가).
- `r2_key_refs` — 참조 인덱스. 유지가 아니라 **재생성** 구조(불변 소스는 삽입 시 1회, 가변 소스는 주기 전량 재추출)이며 집행 판정에서 삭제 권한이 없는 사전 필터다.

관리 UI는 `/admin/file-cleanup`. 결정 배경은 `docs/adr/0015-r2-deferred-deletion-and-sent-ledger.md`.

---

## 쿼터

`surveys.quota_config` (JSONB, NULL = 쿼터 없음) + `features/quota` + `lib/quota/`.

- 차원(`questionId` 바인딩, `choice` | `numeric`) × 카테고리 조합 셀에 목표치를 둔다. 셀은 sparse — 목표가 있는 조합만.
- `enabled=false`면 정의·집계만 하고 응답자를 차단하지 않는다. 마감 차단 시 응답 status는 `quotaful_out`.
- **publish 없이 즉시 반영되는 라이브 컬럼** (`isPaused`/`pausedMessage`와 동일 취급).
- 실시간 달성률은 완료 응답 기준 — `docs/adr/0002-quota-realtime-from-completed-answers.md`.

---

## 테스트 모드

설문 단위 토글(`surveys.testModeEnabled` + `testToken`)로 운영 콘솔 전체가 테스트 파티션으로 전환된다. 파티션 키는 `is_test` 컬럼(`contact_targets`, `survey_responses`, `mail_campaigns`)이며, `contact_targets`의 resid UNIQUE도 `(surveyId, isTest, resid)`다.

- 읽기/쓰기 파티션은 `server/data-scope.ts`의 `loadOperationsDataScope`가 단일 결정한다. 신규 집계·목록 쿼리는 이 스코프를 반드시 태울 것.
- 게스트는 항상 real 파티션(읽기/쓰기 모두) — read/write 비대칭을 막기 위한 의도적 처리.
- 테스트 응답 회차는 `test_response_attempts`가 추적(활성 회차는 responseId당 1개).

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
import { useSurveyStore } from "@/stores/survey-store";
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

# 권한
GUEST_SURVEY_GRANTS=            # "<userId>:<surveyId>[,...]" 게스트 설문 위임

# 레이트리밋 (미설정이면 limiter no-op)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# 로깅 / 기타
AXIOM_TOKEN=  AXIOM_DATASET=  LOG_LEVEL=
ENABLE_PUBLIC_API=              # /api/v1 OpenAPI 표면 게이트 (기본 비활성)
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
- **server/ 트리는 무접미사** (ADR 0016) — `.service.ts`·`.server.ts` 금지, 폴더가 계층을 말한다. 메타테스트(`tests/unit/server-tree-naming.test.ts`)가 강제
- **`.server.ts` 는 lib 등 공유 트리 전용** — "공유 트리 속 서버 전용" 표시. 마킹은 내용물 기준(server-only·DB·서버 env 의존)이며 소비자 기준 금지
- **서버 파일과 같은 어간의 lib 공유 계산은 역할 접미사** — `-format` 기본(예: `drop-funnel-format.ts` ↔ server `drop-funnel.ts`), 서버가 어간을 소유
- **도메인명 접두 제거는 services 층 한정** — `domain/` 의 `mail-*`·`contact-*` 는 접두가 아니라 DB 테이블·도메인 어휘와 정합하는 개념명이라 유지한다 (예: `mail-campaign` ↔ `mail_campaigns`)

### 컴포넌트 구조

```typescript
// 1. 임포트
import { useState } from "react";
import { useSurveyStore } from "@/stores/survey-store";
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
그대로 흐른다. 반대로 `z.object()`(및 `.partial()`)는 unknown 키를 **버린다**(`tests/unit/
zod-unknown-key-contract.test.ts` 가 실측으로 못 박는다).

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

## 주의사항

1. **타입 안전성**: Drizzle ORM + TypeScript strict. JSONB 컬럼은 `src/shared/contracts/*`의 타입으로 `.$type<...>()` 지정. 클라이언트 트리(features/components/hooks/stores/utils)는 `@/db` 값 import 금지(ESLint, type 은 허용).

2. **상태 관리**: 서버 상태는 TanStack Query, 클라이언트 상태는 Zustand(+Immer).

3. **응답 페이지는 snapshot 기반**: 빌더 수정은 publish 전까지 응답 페이지 미반영. "테스트 모드 OK + 응답 페이지 NG" 패턴이면 publish 누락 먼저 의심. 단, `quotaConfig`·`isPaused`·`pausedMessage`는 스냅샷 밖 라이브 컬럼이라 즉시 반영된다.

4. **테이블 질문**: `tableColumns`, `tableRowsData`, `tableHeaderGrid`, `tableValidationRules`, `dynamicRowConfigs`, `sumConstraints` JSONB 사용. choice 응답값은 `cell.id`.

5. **다단계 선택**: `selectLevels` 배열로 3단계까지. 부모 선택에 따라 동적 로딩.

6. **export 라벨**: `cell.exportLabel || generateExportLabel(questionCode_열_행)` 폴백 필수 (빌더는 placeholder만 표시, DB null 흔함).

7. **마이그레이션 — 수동 SQL 관행**: drizzle `_journal.json`은 **0019에서 동결**됐고 0020 이후는 전부 손으로 쓴 `.sql`을 `supabase/migrations/`에 두고 Supabase MCP `apply_migration` 또는 직접 SQL로 적용한다. 새 파일을 추가하면 **반드시 `supabase/migrations/manual-migrations.json`의 `migrations`에 tag(확장자 제외 파일명)를 등재**해야 한다 — 미등재는 추적 불가 drift로 보고 CI(`.github/migration-journal-gate.ts`)가 차단한다. `pnpm db:generate`/`db:push`는 이 관행과 충돌하므로 쓰지 않는다. `TRUNCATE CASCADE` 금지 (ON DELETE SET NULL 무시).

   **새 마이그레이션은 빈 DB에서 재생 가능해야 한다.** 2026-08-19부터 테스트 DB는 `drizzle-kit push`가 아니라 마이그레이션 전량 재생으로 만들어진다(`scripts/setup-test-db.sh`). 즉 `pnpm db:setup-test`가 곧 재생 검증이며, 기존 상태를 전제한 문장을 넣으면 거기서 깨진다. 실 DB에만 있고 레포에 없는 객체는 `pnpm db:drift`가 잡는다 — 자세한 내용은 아래 "DB 드리프트 점검" 참조.

8. **앱 생성값 NOT NULL 컬럼은 2단계 배포**: nullable 추가 + 백필(배포 전) → 앱 배포 → `SET NOT NULL`(라이브 후). 한 번에 걸면 구버전 앱 INSERT가 깨진다.

9. **서버 sanitize**: jsdom 의존 라이브러리 금지 (isomorphic-dompurify 크래시). `sanitize-html` 사용.

10. **테스트**: Vitest include는 `tests/` + `src/**/*.test.ts`(colocated procedure/service 테스트) + `workers/`. service 모킹은 `tests/integration` 패턴(top-level `vi.mock` + `vi.mocked`). 실DB 왕복은 `*.realdb.test.ts` — `pnpm test:integration`(로컬 supabase 54322 필요), 일반 `pnpm test`에서는 스킵. `tests/integration/profiles-row-actions.test.ts`의 오랜 flaky 는 2026-08-19 에 수리했다. 원인은 그 파일이 `@/db/schema` 에 `vi.mock` 을 두 번 걸고 있던 것이다 — 같은 경로에 두 번 걸면 어느 팩토리가 이기는지 보장되지 않고, `{ __table }` 만 주는 쪽이 이기면 `col.__col` 이 undefined 라 mock `eq()` 가 항상 false 를 반환해 모든 조건 조회가 빈 결과가 된다. 그 결과 14건 중 12건이 `SurveyOwnershipError:not_found` 로 무너졌다. "전체 스위트에서만 모킹 간섭으로 깨진다"·"격리하면 항상 통과" 두 진단 모두 틀렸고, 중복 제거 후 전체 스위트에 포함해도 통과해 2단 격리 구조와 `ISOLATED_FLAKY_TESTS` 를 걷어냈다. **같은 모듈에 `vi.mock` 을 두 번 걸지 말 것.**

11. **vitest의 `server-only` stub 사각지대**: 클라이언트/서버 경계 위반은 테스트가 통과해도 빌드에서만 드러난다. 경계를 건드렸으면 `pnpm build`로 확인할 것.

12. **drizzle 함정**: timestamptz optimistic lock은 PG μs ↔ JS ms 정밀도 차로 거짓 충돌 (version int 또는 string mode 사용). `ANY(${arr})` 바인딩 금지 (length=1 silent unwrap) → `inArray`/`sql.join`. jsonb 컬럼에 `JSON.stringify` 바인딩 금지 (이중 인코딩) → 객체 그대로 전달.

---

## CI 게이트

`.github/workflows/ci.yml` — 변경 범위 판별 후 아래를 순차 실행한다. 로컬에서 미리 돌려야 할 것은 `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm test`.

| 게이트                | 스크립트                            | 역할                                          |
| --------------------- | ----------------------------------- | --------------------------------------------- |
| 공급망 보안 감사      | `.github/audit-gate.ts`             | 감사 리포트 평가 (리포트 누락 시 fail-closed) |
| RLS 하드닝            | `.github/rls-gate.ts`               | 마이그레이션의 RLS 정책 검증                  |
| 마이그레이션 드리프트 | `.github/migration-journal-gate.ts` | `manual-migrations.json` 미등재 `.sql` 차단   |

통합/E2E 잡은 로컬 supabase를 띄워 `pnpm test:integration` + `pnpm test:e2e`(Playwright chromium)를 돌린다.

---

## DB 드리프트 점검

`pnpm db:drift [prod|staging]` — 실 DB와 레포가 만들어내는 DB(로컬 테스트 DB)의 객체 목록을 대조한다. 테이블·컬럼·enum·함수·인덱스·RLS·정책·anon 권한·이벤트 트리거(public 함수 연결 — 활성 상태·연결 함수 본문 해시·SECDEF·search_path·소유자 포함)를 보고, 이름이 같은데 정의가 다른 인덱스도 잡는다. 모든 조회는 READ ONLY 트랜잭션이다.

`migration-journal-gate`는 디렉터리에 있는 `.sql`이 등재됐는지만 본다. **파일로 쓰지 않고 실 DB에 직접 적용한 SQL은 그 검사에 걸리지 않는다** — 실제로 `lookup_contact_by_invite_token` 함수와 컬럼 6개가 그렇게 들어와 몇 달간 방치됐다(2026-08-19 발견·복구). 이 스크립트가 그 반대 방향을 본다.

- 전제: 먼저 `pnpm db:setup-test`로 로컬 테스트 DB가 최신이어야 한다
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
- 메인과 worktree의 `package.json`, `pnpm-lock.yaml`이 같으면 worktree의 `node_modules`를 메인 checkout의 `node_modules`를 가리키는 심볼릭 링크로 구성한다. 두 파일이 다르면 링크하지 말고 별도 설치가 필요함을 먼저 알린다.
- 메인 checkout에 존재하는 ignored 환경 파일(`.env`, `.env.local`, `.env.development`, `.env.development.local`)은 내용을 읽거나 출력하지 않고 worktree에 심볼릭 링크한다.
- worktree 준비 완료를 보고하기 전에 의존성 링크와 환경 파일 링크가 유효한지 확인한다.

### 문서 갱신

`update-docs` 스킬(`.agents/skills/update-docs/`)이 이 레포용 대조표를 갖고 있다. 코드가 문서와 어긋났을 때 이 스킬을 따른다 — 갱신 대상은 `AGENTS.md`·`CONTEXT.md` 이고, `docs/superpowers/plans`·`specs` 와 ADR 본문은 시점 기록물이라 최신화 대상이 아니다.

> `CLAUDE.md` 는 `AGENTS.md` 를 가리키는 심볼릭 링크다. 문서 수정은 항상 `AGENTS.md` 에 한다.
