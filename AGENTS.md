# Survey Table Project - 에이전트 참조 문서

## 프로젝트 개요

Next.js 16 기반의 고급 설문조사 빌더 + 운영 플랫폼. 복잡한 질문 유형, 조건부 로직, 버전 스냅샷, 컨택 관리, 메일 캠페인, SPSS/엑셀 내보내기, 분석 기능을 갖춘 엔터프라이즈급 애플리케이션.

> 최종 갱신: 2026-09-15 (origin/main 의 9/3~9/15 hotfix·기능 195커밋을 8월 재편 구조로 병합하고 신규 모듈 12개를 소비자 실측대로 feature 안으로 이동 — 자격미달 종료 문구 `screenedOutMessage` 0110 · 단답형·장문형·표 input 셀 응답 품질 검사 `textValidation` 0109(판정 `features/question-renderer/utils/text-quality`, 클라이언트 차단, 손대지 않은 이월 값 면제) · 모바일 표시 방식 「축 단위 카드」 `axis-cards` 0108 · 「행 단위 그룹 카드」 0107 · 「행 단위 카드」 0106 · 보기 그룹 표(table 유형 choiceGroups) · 표 input 셀 `inputWidth`·셀 공통 `hideRightBorder` · 단독 선택 보기 `exclusiveChoice`(`features/question-renderer/utils/exclusive-choice.ts`) · 표 행 반복 `rowRepeatConfig` 0104(`lib/question/row-repeat`) · 좌측 고정 열 `stickyColumnCount` 0105 · 입력 형식 검사 5종(`@/types/input-type`·`@/features/question-renderer/utils/input-format`, ADR 0023) · 문항별 이월값 조건 0102·끄기 0103 · 변동 확인 설문 스위치 0101 · 숨은 문항 응답 삭제(`lib/survey/question-visibility`) · 순위형 보기 클릭 방식 · Raw 내보내기 `includePriorAnswers=1`·명단 열 상시 부착(`includeContactColumns` 폐기)·숨은 문항 값 제외 · Raw 양식 이월 응답 임포트. 직전: 2026-09-03 구조 병합(조사표 survey-document 를 server 11번째 도메인으로 신설). server/=oRPC 도메인 11개 · features/=5개 묶음)

---

## 기술 스택

| 영역           | 기술                                        | 버전            |
| -------------- | ------------------------------------------- | --------------- |
| 프레임워크     | Next.js (App Router, Turbopack)             | 16.3.5          |
| UI 라이브러리  | React (React Compiler)                      | 19.2.3          |
| 스타일링       | TailwindCSS                                 | 4.x             |
| 컴포넌트       | shadcn/ui (Radix UI)                        | -               |
| 상태관리       | Zustand + Immer                             | 5.0.8 / 11.1.3  |
| 데이터 페칭    | TanStack Query                              | 5.90.11         |
| RPC            | oRPC (server/client/tanstack-query/openapi) | 1.14.4          |
| 스키마 검증    | Zod                                         | 4.4.3           |
| 테이블         | TanStack Table                              | 8.21.3          |
| 텍스트 측정    | @chenglou/pretext                           | 0.0.5           |
| 리치 에디터    | TipTap                                      | 3.31.3          |
| 드래그앤드롭   | @dnd-kit                                    | -               |
| ID 생성        | NanoID                                      | 5.1.11          |
| ORM            | Drizzle ORM                                 | 0.45.2          |
| DB 드라이버    | postgres (postgres-js)                      | 3.4.7           |
| 데이터베이스   | PostgreSQL (Supabase)                       | -               |
| 파일 저장소    | Cloudflare R2 (S3 호환)                     | -               |
| 이미지 처리    | sharp                                       | 0.35.4          |
| HTML sanitize  | sanitize-html                               | 2.17.0          |
| 이메일 발송    | Resend + React Email                        | 6.12.3          |
| 이메일 webhook | svix                                        | 1.93.0          |
| 백그라운드 잡  | Inngest                                     | 4.4.0           |
| 레이트리밋     | @upstash/ratelimit + @upstash/redis         | 2.0.8 / 1.38.0  |
| 로깅           | pino + @axiomhq/js                          | 10.3.1 / 2.0.0  |
| PDF 렌더       | pdfjs-dist (조사표 뷰어 + 서버 쪽 수 판독)  | 6.3.289         |
| 엑셀 생성      | ExcelJS                                     | 4.4.0           |
| SPSS .sav 생성 | sav-writer                                  | 1.0.0           |
| 차트           | Recharts + Tremor                           | 2.15.4 / 3.18.7 |
| 에러 모니터링  | Sentry (@sentry/nextjs)                     | 10.x            |
| 테스트         | Vitest + Testing Library + MSW + Playwright | 4.1.0 / 1.60    |
| 언어           | TypeScript (strict)                         | 5.9.3           |

> 참고: `xlsx`, `jszip` 의존성은 제거됨(2026-06-05). 엑셀 생성은 ExcelJS, SPSS는 sav-writer 사용.
> `react-hook-form`, `@tanstack/react-virtual` 도 제거됨(2026-08-22) — 소스 참조가 처음부터 0이었다.
> 폼은 제어 컴포넌트 + zod 로, 목록은 TanStack Table 로 직접 다룬다.
> sharp 0.35는 Vercel libvips 이슈로 `next.config.ts`의 `outputFileTracingIncludes` 우회가 걸려 있다 (업스트림 수정 시 제거).

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
│   ├── response-filters.ts     # 어느 응답 행이 보이는가 (활성·삭제됨·완료·비테스트) — data-scope 의 형제, 8구역 공용
│   └── <domain>/               # survey-builder · survey-response · survey-document · operations · contacts
│       │                       # · mail · analytics · library · auth · media · quota
│       │                       # survey-document = 조사표 PDF·영역 앵커 (2026-09-03 신설, 자기 테이블 2개·procedures 2·services 4)
│       ├── domain/             # zod 계약 + 순수 규칙 (**client-safe** — server-only·Node·DB 의존 0. zod 는 런타임 의존이라 'import 0' 이 아니다)
│       │                       # UI 도 쓰는 모양은 shared/contracts 소관 — 여기는 그것을 다시 내보내고 서버 전용 입력·규칙만 남긴다
│       ├── procedures/         # oRPC procedure (authed/scoped/pub, 얇은 위임) + colocated *.test.ts
│       └── services/           # 비즈 로직 + drizzle (server-only, requireAuth/revalidatePath 없음)
│                               # 도메인 간 직접 import 금지(ESLint), 내부는 상대경로. 타 도메인 테이블 직접 쿼리는 허용
│   ├── read-models/            # 여러 도메인 테이블을 **읽기만** 하는 projection (설문 구조 · 버전 스냅샷 · 응답 · 보관함 분류 · 컨택 read model · 초대 조회 · 결과코드 · 쿼터 모수 · 설문 제어 플래그 · 템플릿 변수 카탈로그 · 응답내역 컬럼 스킴 · ID 목록 토큰 조회 contact-id-lists · 앵커 행→스냅샷 매퍼 anchor-row)
│   │                           # 자기완결 — 도메인을 import 하지 않는다(ESLint). 구 src/data
│   │                           # survey-structure 의 getSurveyById 는 React cache — **사본을 만들지 말 것**(cache 가 갈리면 RSC dedupe 가 깨진다)
│   │                           # version-snapshot 의 snapshotQuestions 는 비배열을 빈 배열로 접는다 — "구조가 깨졌다" 와 "질문이 없다" 를
│   │                           # 갈라야 하는 자리(응답 이관의 생존 판정 등)에서는 쓰지 말고 호출측이 직접 Array.isArray 로 볼 것
│   ├── workflows/              # 여러 도메인의 **쓰기를 조율**하는 흐름. 이 층만 도메인을 부를 수 있다
│   │                           # 결합을 없애는 게 아니라 한곳에 모아 보이게 하는 자리 — 파일이 늘면 그 자체가 신호다
│   │   ├── test-mail-archive.ts  # 테스트 파티션 메일 보관·삭제 흐름 (mail·contacts 쓰기를 함께 조율)
│   │   └── jobs/                 # Inngest 함수 4개 + index (구 lib/inngest/functions). 잡은 도메인을 부르므로 여기가 집이다
│   └── storage-lifecycle/      # R2 유예 삭제 큐·발송 장부·참조 인덱스 (자체 r2_* 테이블만 만지는 독립 모듈)
│
│   ※ "여러 도메인이 쓴다" 는 공용의 근거가 아니다 — 역할로 묶이지 않으면 제2의 lib 가 된다
│
├── features/                   # 프론트 기능 묶음 5개 (UI·훅·스토어·query 훅을 기능 단위로 — 레이어 규약 아님, FSD 아님)
│   │                           # 의존 방향(ESLint): survey-builder → survey-response → question-renderer 단방향, operations·analytics 독립
│   │                           # builder → response 는 2건만 남았고 **둘 다 의도된 공유**다(옵션 텍스트 사이드카 저장소).
│   │                           # 인용값 계산이 양쪽에서 같은 입력을 봐야 해서 저장소를 하나로 둔 것 — 떼면 resetResponseState 의 원자적 리셋이 갈린다
│   │                           # UI 가 서버에서 가져올 수 있는 건 없다 — @/server 전면 금지(타입 포함), 모양은 @/shared/contracts 로
│   │                           # 루트 잔류 기준: ① 복수 하위 묶음이 소비하는 공용 조각 ② app 라우트가 직접 여는 진입점만 — 단일 묶음만 소비하면 그 묶음 안으로
│   │                           # 루트 개수는 목표가 아니라 이 기준의 결과다(2026-08-25 전수 실측: 72파일 중 이동 1건). 새 묶음의 진입점은 폴더 안(table-editor 방식), 기존 group-manager·condition-card 는 유지
│   ├── survey-builder/         # 설문 편집기 (140개) — importer 그래프의 닫힌 묶음대로 폴더화
│   │   ├── question-list/      # 빌더 질문 목록 (sortable-question-list 진입점, question-test-card·group-header·duplicate-question-table(질문 복제 시 셀 참조·행 반복 참조 재배선))
│   │   ├── survey-document/    # 조사표 오서링 (survey-document-panel 진입점 + anchor-canvas 드래그) — app edit 페이지가 연다
│   │   ├── question-edit/      # 질문 편집 모달 (question-edit-modal → question-basic-tab·table-validation-editor·sum-constraint-editor)
│   │   ├── table-editor/       # 표 질문 편집기 (dynamic-table-editor 진입점 + row-repeat-settings-card 행 반복 설정) + hooks/·utils/·bulk-generator/
│   │   │   └── cell-editor/    # 셀 내용 모달 (cell-content-modal → *-cell-tab·cell-choice/gating-editor) + hooks/use-cell-form·utils/serialize-cell·utils/cell-rich-text(셀 본문 부분 강조 HTML)
│   │   ├── condition/          # 표시조건 편집 사슬 (question-condition-editor → condition-card → expression/value/numeric) + utils/
│   │   ├── lookup/             # LUT 선택·편집·CSV·보관함 (공용 리프 — condition·formula 가 소비)
│   │   ├── formula/            # 수식 편집기 (cell-editor·sum-constraint 양쪽이 소비)
│   │   ├── group-manager/      # 그룹 관리
│   │   ├── hooks/              # 빌더 전용 훅 (use-ensure-survey-in-db·use-survey-sync·use-builder-scroll)
│   │   ├── stores/             # survey-store(빌더 상태)·ui-store(빌더 UI 상태)·test-response-store(미리보기 응답)·preview-response-sources — 구 src/stores
│   │   ├── queries/            # TanStack Query 훅 use-surveys·use-library·use-cell-library·use-survey-documents·use-survey-anchors — 구 src/hooks/queries
│   │   ├── lib/                # changeset·diff-payload·persist-question·variable-generator·saved-question-branch-logic·cell-formula/gating-diagnostics — 구 src/lib/survey-builder
│   │   ├── utils/              # option-value-remap·prune-sum-constraints·input-mode(숫자 모드↔입력 형식 전환)
│   │   └── (루트 26개)          # 복수 묶음이 쓰는 공용 필드 위젯(input-format-select·option-text-settings-editor·text-validation-fields 등) + app 이 직접 여는 모달·패널
│   │                           # 폴더 위상: hooks ← lookup ← condition ← table-editor ← question-edit ← question-list (DAG, 순환 없음)
│   ├── question-renderer/      # 두 화면(빌더 미리보기·응답 페이지)이 함께 쓰는 렌더 조각 (102개) — 어떤 feature 도 import 하지 않는다
│   │   │                       # 질문 렌더러가 주지만 화면 공용 조각도 여기가 집이다 — 응답 헤더·루트 그룹 배지·검증 배너
│   │   │                       # 셀 본문 cell-text·순위형 클릭 ranking-click-select·보기 소스 표 셀 컨트롤 choice-table-cell-control/gated-cell·상세기재 줄 option-text-row·행 단위 그룹 카드 mobile-row-group-cards 도 여기 (2026-09-15 병합 — 스토어 직접 구독 대신 response-sources 주입 계약으로 옮겨 적었다)
│   │   │                       # pdf-page-view(조사표 한 쪽 렌더, 빌더·응답 공용) 도 루트
│   │   ├── cells/              # 표 셀 렌더러
│   │   ├── hooks/              # 표 레이아웃·동적 행·응답 쓰기 채널 훅 + 행 반복 use-row-repeat·입력 형식 use-input-format-field·포커스 use-field-focus
│   │   └── utils/              # 표 그리드·모바일 표시 순수 계산 + renders-as-table·trailing-coalescer·effective-option-texts + anchor-geometry·anchor-outline(조사표 좌표) + ranking-mobile-sections(순위형 모바일 구간) + 입력 형식 파서 input-format·응답 품질 text-quality/cell-text-quality·단독 선택 exclusive-choice·순위 클릭 ranking-click·보기 그룹 외곽선/섹션 라벨 choice-group-outline/section-label (input-format·text-quality/cell-text-quality·exclusive-choice 는 builder·response 도 소비하고 나머지는 렌더러 전용 — 여러 feature 가 쓰는 순수 규칙은 방향상 가장 낮은 renderer 가 소유, 2026-09-15)
│   ├── survey-response/        # 응답 흐름 (flow·lifecycle·step-views) (38개) — 렌더러만 import
│   │   ├── hooks/              # 응답 플로우 훅 + use-client-signals·use-keyboard-open
│   │   ├── lib/                # version-rebase·answer/numeric/required-option-text-validation·admin-edit·quota-gate·hover-follow·split-viewport·format-normalize(제출 전 형식 정규화)·prior-answer-prefill(이월값 프리필·회수)·completion-screen(완료 화면 문구) (순수)
│   │   │                       # response-document-pane(응답 화면 좌측 조사표)·step-views/demand-checklist(판정 체크리스트) 도 이 묶음
│   │   ├── step-views/         # 스텝 단위 화면
│   │   └── stores/             # survey-response-store(실응답)·live-response-sources — 미리보기용 test-response-store 는 survey-builder/stores
│   ├── operations/             # 운영 콘솔 (88개) — contacts·profiles·report·quota·mail-campaign·mail-template·filters·demand(문항 수요 집계 표)
│   │   ├── hooks/              # use-auto-fade-message·use-search-params-mutator
│   │   └── queries/            # use-contacts·use-campaigns·use-file-cleanup
│   └── analytics/              # 차트 및 리포팅 (23개)
│
├── shared/                     # 서버·프론트 양쪽 공용 (feature 직접 import 금지의 탈출구)
│   ├── contracts/              # 서버와 UI 가 합의한 모양 — UI 가 서버에서 가져오는 유일한 출처
│   │                           #   <domain>.ts     JSONB 문서 어휘 SoT (DB 에 저장되는 모양, DB 스키마 $type<> 가 참조, 런타임 의존 없음)
│   │                           #   <domain>-io.ts  경계를 건너는 모양 — RPC 입출력 zod + RSC 가 props 로 넘기는 read model 행
│   │                           #   survey-document.ts(앵커 스냅샷 어휘)·survey-document-io.ts(조사표·앵커 RPC zod) — 2026-09-03 신설
│   │                           # 질문 구조 타입은 @/types/survey 소관(겹침 0). 구 db/schema/schema-types.ts
│   ├── lib/rpc.ts              # 타입드 RPC client: client(plain 호출) + orpc(TanStack utils)
│   ├── lib/survey-control.ts   # 설문 운영 제어 공용 로직
│   ├── lib/image-utils.ts      # 브라우저 이미지 리사이즈·압축 (업로드 전 최적화)
│   └── types/test-attempt.ts
│
├── actions/                    # 잔존 서버 액션 — 3파일 (의도적 유지)
│   ├── auth-actions.ts         # login/logout (redirect+쿠키 의미론이 server action 특화)
│   ├── unsubscribe-actions.ts  # 수신거부 POST form (메일 클라 JS 비활성 환경 + redirect)
│   └── index.ts                # 잔존 사유 주석 포함 배럴
│
├── components/                 # 진짜 공용 UI 만 — features 를 모른다(ESLint)
│   ├── ui/                     # shadcn/ui 기반 컴포넌트 (23개 + rich-text-editor/)
│   └── providers/              # Context providers
│
├── stores/                     # error-dialog-store.ts 하나 (전역 에러 다이얼로그). 기능 스토어는 features/<x>/stores
│
├── hooks/                      # 범용 훅 3개 — use-latest-ref · use-media-query · use-formatted-numeric-input
│                               # (기능 전용 훅·query 훅은 features/<x>/hooks·queries 로 흡수, 루트 배럴 없음)
│
├── lib/                        # 인프라 어댑터 + 프론트·서버가 함께 쓰는 계산 (도메인 로직 흡수 완료 — 트래커 E-1)
│                               # 판정은 폴더 이름이 아니라 소비자 실측 — 아래 "src/lib 잔류 기준" 참조
│   ├── supabase/               # Supabase 클라이언트 (client/server/middleware)
│   ├── auth/ + auth.ts         # admin allowlist, 게스트 grant, 설문 소유권 가드
│   ├── rate-limit/             # Upstash 2단 레이트리밋 + 신뢰 IP 추출
│   ├── logger/                 # pino + Axiom transport, redact, route/context 로깅
│   ├── crypto/                 # PII 암호화 (cipher + blind index, 컨택·응답 공용)
│   ├── contacts/               # 그룹 레벨·업로드 병합 매칭·업로드 제한·결과코드 정규화(result-code-statuses-normalize)·Raw 양식 이월 응답 되읽기 raw-format-import 순수 공용
│   │                           # (엑셀 파서·스킴 헬퍼는 server/contacts, 컬럼 자동감지는 features/operations)
│   ├── operations/             # 운영 콘솔 공유 계산 21파일 — format 짝 12개는 *-format.ts(서버 쌍이 동일 어간 소유) + 공유 판정·필터 9개. UI 도 소비하므로 여기가 정답 (ADR 0016)
│   │                           # contacts-filter-sql.server.ts 는 drizzle 의존 서버 전용 — lib 안 .server.ts 마킹의 예
│   ├── mail/                   # 렌더 미리보기·변수 추출·이미지 클릭영역·상수 4파일 (발송·dispatch·reconcile·빌링은 server/mail)
│   ├── quota/                  # 쿼터 응답 매칭·정규화·달성 상태 계산 quota-status-calc (쿼터 게이트는 features/survey-response/lib/quota-gate)
│   ├── r2-client.ts            # R2 인프라 어댑터 — S3Client 단일 소유자 + 객체 존재 검사 + URL→key
│   ├── r2-env.ts               # R2 env 검증 (SDK 를 모르는 순수 헬퍼)
│   ├── image-utils-server.ts   # 서버 이미지/파일 삭제·복사
│   ├── image-extractor.ts      # 질문에서 이미지 URL 추출
│   ├── spss/                   # SPSS .sav 빌더 + 변수 생성/검증 + 데이터 변환
│   ├── inngest/                # Inngest 클라이언트 어댑터만 (client.ts) — 함수는 server/workflows/jobs
│   ├── question/               # 질문 스키마/정규화/가드/변형 + row-repeat(행 반복 펼치기·판정·참조 재배선 — analytics 가 import 해 lib 잔류)
│   ├── survey/                 # 토큰 치환, 수식·셀 게이팅, 이미지/첨부 promote, PII 보관기한, 응답 헤더 설정, 숨은 문항 판정·strip question-visibility, 이월값 조건 prior-answer-condition, 보기 선택 판독 choice-selection·choice-table-cell-value — 전부 서버·lib 가 소비해 잔류 (컨택 attrs·이월 응답 context 와 이월값 강조는 features/question-renderer, 프리필·형식 정규화는 features/survey-response/lib, 셀 리치텍스트는 table-editor/cell-editor/utils)
│   ├── survey-response/        # 구조 생존 판정 1파일 (테스트 응답 초기화는 server/survey-response, version-rebase 는 features/survey-response/lib)
│   ├── analytics/              # 통계 analyzer + 엑셀/SPSS export 워크북 계산 + row-repeat-usage(내보내기에서 쓰이지 않은 뒤쪽 벌 pruning) (교차분석·필터는 features/analytics)
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
│   ├── table-cell-refs.ts      # 표 셀 참조 재배선 (lib/question/row-repeat 가 import 해 공용 잔류). 입력 형식·응답 품질·순위 클릭·보기 그룹 외곽선/섹션 라벨은 소비자가 features 뿐이라 question-renderer/utils 로 (2026-09-15)
│   ├── dynamic-row-selection-sidecar.ts  # 동적 행 선택 사이드카 키·정제 — lib/survey/response-sidecars 등록부가 import 하므로 공용 구역 (구 question-renderer/utils)
│   └── ...
│
├── db/
│   ├── index.ts                # drizzle(postgres-js) 클라이언트
│   └── schema/                 # Drizzle ORM 스키마 (아래 DB 섹션 참조)
│
├── types/                      # 전역 타입·어휘 4파일
│   ├── survey.ts               # 질문 구조 타입 SoT — TableCell·QuestionOption·조건식 등 (986줄, 비테스트 소비 282파일)
│   │                           # shared/contracts/survey 와 심볼 겹침 0. 저쪽은 JSONB 문서 어휘라 역할이 다르다
│   ├── question-types.ts       # 질문 유형 어휘 런타임 SoT — QUESTION_TYPES 배열 ↔ QuestionType 동치를 tsc 로 강제
│   ├── mobile-table-display.ts # 모바일 표 표시 모드 어휘 + 타입 가드
│   └── input-type.ts           # 입력 형식 어휘 SSOT — text·number + 형식 5종(mobile·phone·biz_number·corp_number·email)
├── instrumentation.ts          # Sentry 서버 instrumentation
├── instrumentation-client.ts   # Sentry 클라이언트 instrumentation
└── proxy.ts                    # Next 미들웨어 (/admin, /analytics 세션 갱신)
```

---

## 데이터베이스 스키마

스키마 파일은 도메인별로 분리: `surveys.ts`, `survey-documents.ts`, `contacts.ts`, `mail.ts`, `mail-billing.ts`, `r2-lifecycle.ts`. JSONB 컬럼의 문서 형태(어휘)는 `src/shared/contracts/<domain>.ts`에 두고 스키마가 `$type<>()`로 참조한다(DB→shared 단방향). 영속 질문 필드 SSOT는 `question-persisted-fields.ts`.

### 설문 도메인 (surveys.ts)

```
surveys                    # 설문 설정
├── id, title, description, slug, privateToken, previewToken
├── isPublic, allowMultipleResponses, showProgressBar, shuffleQuestions, requireLogin
├── endDate, maxResponses, thankYouMessage, screenedOutMessage (자격미달 종료 문구, NULL=완료 문구 폴백, 0110), contactEmail, responseHeader (JSONB)
├── piiRetentionUntil (개인정보 보관기한)
├── contactColumns / testContactColumns (JSONB)  # 컨택리스트 표시 컬럼 스킴 (실/테스트 분리)
│                                 #   컬럼별 플래그: hidden(목록 숨김) · piiType · groupLevel(진척보고 분류 축)
│                                 #   · showInMail(단체 메일 위저드·캠페인 상세 수신자 표에 attrs 컬럼 노출, attrs.* 전용)
├── lookups (JSONB)               # 설문에 복사된 LUT 사본 목록
├── contactResultCodes (JSONB)    # 결과코드 사용자 정의
├── progressColumns (JSONB)       # 진척률 표 컬럼 픽커
├── profileColumns (JSONB)        # 응답 내역 표 컬럼 픽커
├── quotaConfig (JSONB)           # 쿼터 플랜 (NULL = 쿼터 없음) — 라이브 컬럼
├── isPaused, pausedMessage       # 응답 일시중지 — 라이브 컬럼
├── testModeEnabled, testToken    # 테스트 모드 (콘솔 전체가 테스트 파티션으로 전환)
├── priorWaveLabel                # 추적조사 지난 회차 라벨 — 라이브 컬럼
├── priorAnswerImportConfig (JSONB)  # 이월 응답 임포트 확정 매핑 (문항코드 블록 → 문항 id + 값 대응)
├── changeConfirmEnabled          # 문항별 변동 확인 사용 여부(기본 false) — 라이브 컬럼.
│                                 #   false 면 이월 값을 표시되는 문항에 미리 깔고 응답자가 고치면 덮어쓴다
├── requireInviteToken            # invite token 강제 여부
├── forceWideLayout               # 강제 와이드 레이아웃
├── status                        # 'draft' | 'published' ('closed' 는 미구현 어휘 — 쓰는 경로 없음, 종료는 endDate/isPaused 로)
├── currentVersionId              # 현재 활성 배포 버전
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
├── rowRepeatConfig (JSONB)       # 행 반복 — 응답자가 + 로 늘리는 연속 행 묶음 {enabled, templateRowIds, maxRepeats, addLabel}
├── rankingConfig (JSONB)         # 순위형 전용
├── optionsColumns, optionsAlign, mobileOptionsColumns, minSelections, maxSelections, allowOtherOption
├── placeholder, defaultValueTemplate  # 단답형(prefill 토큰 지원)
├── inputType, emptyDefault, numberFormat (JSONB)  # 단답형 입력 모드 (숫자 | 형식 5종)
├── textValidation (JSONB)        # 단답형·장문형 응답 품질 검사 {minLength, maxLength, rejectMeaningless} — 평문 모드 전용, 클라이언트 차단 (0109, features/question-renderer/utils/text-quality)
├── piiEncrypted                  # 응답값 암호화 저장 여부 (단답형·장문형). 표 input 셀은 tableRowsData 의 셀 piiEncrypted
├── questionCode, isCustomSpssVarName, exportLabel, spssVarType, spssMeasure, exportCellOrder  # SPSS export
├── answerQuoteEnabled, answerQuoteName, answerQuoteText  # 이전 응답 인용
├── mobileOriginalTable, mobileTableDisplayMode,  # 표시 방식 auto|drilldown-original-row|row-wise-original|row-cards|row-group-cards|axis-cards|original (0108 CHECK). row-group-cards 는 보기 소스 표 전용 — 행 카드 안을 보기 그룹(축)별 섹션으로 나누고 구분 셀을 제목·설명으로 항상 보임(섹션 제목은 question-renderer/utils/choice-group-section-label). axis-cards 는 보기 그룹이 있는 보기 소스 표 전용 — 축(그룹)마다 카드 하나, 제목은 열 헤더(sticky), 타일은 행 제목(CONTEXT.md "축 단위 카드")
│   mobileDrilldownOmitLeadingColumns,
│   mobileDrilldownRepeatHeaderStartRow/EndRow      # 모바일 표 렌더
├── hideColumnLabels, pageBreakBefore
├── stickyColumnCount            # 좌측 고정 열 개수 (NULL=자동 판정, 0~3=명시 지정)
├── priorAnswerCondition (JSONB), priorAnswerDisabled  # 추적조사 — 문항별 이월값 불러오기 조건(0102, 참→거짓으로 뒤집히면 프리필 회수)·끄기(0103, 켜면 이월값을 깔지 않고 Raw includePriorAnswers 도 비운다)
├── noticeContent, noticeBgColor, requiresAcknowledgment  # 공지 (배경색: NULL=기본 파랑, 'none'=무색, hex=커스텀)
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

survey_documents           # 조사표 — 설문에 붙는 PDF (설문당 여러 행 허용). 이 표와 아래 앵커 표는 survey-documents.ts
├── id, surveyId, fileKey (R2 survey/document/), filename, pageCount, order
└── createdAt, updatedAt

survey_document_anchors    # 영역 앵커 — 조사표 쪽 위의 사각형 (한 대상에 여럿)
├── id, surveyId, documentId
├── questionId / groupId          # nullable FK 둘 + CHECK 정확히 하나 (종류는 파생)
├── page, x, y, w, h              # 쪽 번호 + 정규화 0~1 (화면 픽셀 저장 안 함)
└── order, createdAt

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

contact_prior_answers      # 이월 응답 — 지난 회차 응답 한 벌 (추적조사)
├── id, contactTargetId (UNIQUE, ON DELETE CASCADE)
├── answers (JSONB)        # survey_responses.questionResponses 와 동형
└── createdAt, updatedAt

contact_attempts           # 컨택 결과 회차
├── id, contactTargetId, attemptNo
├── resultCode, note, createdBy
└── createdAt  (UNIQUE contactTargetId+attemptNo)

contact_id_lists           # 필터 붙여넣기 ID 목록 저장 (0084) — 인라인 상한 2,000개 초과분
├── id, surveyId (cascade), ids (JSONB 정수 배열, 중복 제거·오름차순), idCount
├── createdBy, createdAt
└── URL 에는 `list:<id>:<count>` 토큰만 실림. 캠페인 filterSnapshot 이 토큰을 보존하므로 만료·정리 없음
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
surveys (1) ─┬─ (N) survey_documents ── (N) survey_document_anchors
             ├─ (N) question_groups ── parentGroupId (self-ref)
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
                 ├─ (N) contact_attempts (결과 회차)
                 └─ (1) contact_prior_answers (이월 응답)

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
│   ├── prior-answers             # 이월 응답 임포트 (추적조사) — 아래 참조
│   ├── upload                    # 업로드 이력
│   └── upload/new                # 엑셀 업로드 마법사
├── report                        # 전시회/그룹별 진척률 리포트 (slice 4)
│   └── columns                   # 리포트 컬럼 픽커
├── quota                         # 쿼터 플랜 + 실시간 달성 현황
├── demand                        # 문항 수요 집계 (조사표가 붙은 설문에서만 탭이 나온다)
└── mail/                         # 메일 캠페인
    ├── templates                 # 템플릿 목록 → new, [mid]/edit
    └── campaigns                 # 캠페인 목록 → new, [cid]

/admin/billing/mail-cost          # 메일 비용 정산
/admin/file-cleanup               # R2 유예 삭제 큐 (대기/이력/취소)
```

응답 페이지 진입 경로: `/survey/[id]?invite=<uuid>` 또는 짧은 링크 `/i/<inviteCode>`. invite 해석 → contact_targets lookup → survey_responses.contactTargetId 매칭. 토큰 무효 시 안내 화면 + 익명 응답 폴백. **수신거부(unsubscribed_at)·부정 결과코드는 초대 링크 응답을 막지 않는다** (2026-09-01 결정 — 수신거부는 메일 채널 해지일 뿐; 단체 메일 제외·모수 제외는 각자 경로가 담당). 완료 응답이 있는 토큰만 `token_already_used` 로 차단. surveyId가 UUID인 경우 private_token fallback 필요. 빌더 미리보기는 `/preview/<previewToken>`.

> 운영 집계는 `server/operations/services` 에서 SQL 집계로 수행 (aggregate + format + wrapper 패턴 — 공유 format 짝은 `lib/operations/*-format.ts`, UI 도 소비하므로 lib 이 정답). 정확한 통계는 `question_responses` JSONB 기준 (response_answers는 saveResponse/saveAdminEdit 에서만 채워짐).
> 콘솔 조회·쓰기는 `loadOperationsDataScope`가 결정한 실/테스트 파티션(`is_test`)에 갇힌다. 엑셀·SPSS export 라우트도 같은 스코프를 탄다. 신규 집계 쿼리는 스코프 필터를 빠뜨리지 말 것.
> 조사 대상·단체 메일 위저드의 시스템ID/attrs 컬럼 검색은 **엑셀 열 붙여넣기 ID 목록**을 받는다 (`lib/operations/range-list.ts` — 공백·개행·탭·콤마 구분, 중복 제거). 단일 컬럼 인라인 상한 2,000개(URL 헤더 한계), 초과분은 `contacts.idLists.create` 로 `contact_id_lists` 에 저장하고 `q=list:<uuid>:<count>` 토큰으로 검색한다. 파서는 동기라 페이지/서비스가 `loadIdListsForValues`(`server/read-models/contact-id-lists.ts`) 로 토큰을 먼저 읽어 `parseClausesFromUrl(…, { idLists })` 에 넘긴다 — 새 파싱 지점을 만들면 이 단계를 빠뜨리지 말 것. 「전체」 컬럼 검색의 200개 상한은 컬럼 곱연산 SQL 보호용으로 별개다.

---

## 질문 유형

| 타입          | 설명               | 주요 속성                                                                                                              |
| ------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `text`        | 단답형 텍스트      | placeholder, defaultValueTemplate, inputType(숫자·형식 5종), emptyDefault, numberFormat, textValidation                |
| `textarea`    | 장문형 텍스트      | textValidation(최소 글자 수·의미 없는 입력 거부)                                                                       |
| `radio`       | 단일 선택          | options, choiceGroups, allowOtherOption, optionsAlign                                                                  |
| `checkbox`    | 복수 선택          | options, choiceGroups, allowOtherOption, minSelections, maxSelections                                                  |
| `select`      | 드롭다운 단일 선택 | options, allowOtherOption                                                                                              |
| `multiselect` | 드롭다운 복수 선택 | selectLevels (다단계 — 옵션 리스트는 selectLevels 내부 소유)                                                           |
| `ranking`     | 순위형             | rankingConfig, optionsSource (manual\|table)                                                                           |
| `table`       | 매트릭스/그리드    | tableColumns, tableRowsData, tableHeaderGrid, tableValidationRules, dynamicRowConfigs, rowRepeatConfig, sumConstraints |
| `notice`      | 안내문             | noticeContent, noticeBgColor, requiresAcknowledgment                                                                   |

공통: `requiredMessage`(필수 미응답 문구), `hideTitle`, `pageBreakBefore`(수동 페이지 나눔), `answerQuote*`(이전 응답 인용), `displayCondition`.

- **그룹별 필수**: `ChoiceGroup.required`/`requiredMessage` (JSONB) — 미설정이면 질문 레벨 `required` 상속. 질문 필수여도 특정 그룹만 해제하거나 그 반대가 가능하며, 문구는 그룹 → 질문 → 기본 순 폴백.
- **단독 선택 보기**: `QuestionOption.exclusiveChoice` · `TableCell.exclusiveChoice`(choice_opt 셀) — 「없음 · 해당 없음 · 모름」류. 체크박스 그룹 안에서 이것을 고르면 나머지가 풀리고 다른 보기를 고르면 이것이 풀린다(대칭, 단독끼리도 배타). 범위는 속한 그룹(일반 체크박스 문항은 문항 전체)이고, `exclusiveScope: 'table'` 이면 그 표의 모든 그룹을 비우고 필수·완료 판정도 표의 그룹 전부를 충족으로 본다(`hasTableExclusiveSelected`). 이 보기 하나로 최소 선택 수를 충족한 것으로 본다. 규칙은 `features/question-renderer/utils/exclusive-choice.ts` 하나이고 세 표면(일반 체크박스 · 레거시 보기 소스 표 · 보기 그룹 표)이 같이 쓴다. 명시 플래그만 동작하며 라벨 추정은 없다. JSONB 라 마이그레이션 없음. 분기 규칙의 `exclusive-check` 와 다른 개념 — CONTEXT.md "단독 선택 보기".
- **필수 마스터 전파**: 질문 편집 모달의 "필수 질문" 토글 조작 시 표의 인터랙티브 셀 필수(게이팅 셀은 `requiredWhenEnabled`)와 그룹 오버라이드를 일괄 재설정한다. 상속이 아닌 조작 시점 복사 — `docs/adr/0021` · CONTEXT.md "필수 마스터 전파".
- **입력 형식**: `inputType`(단답형·표 input 셀)·`textInputType`(보기 상세기재)은 `'text' | 'number'` 에 더해 형식 5종(`mobile` · `phone` · `biz_number` · `corp_number` · `email`)을 받는다. 값 목록은 `@/types/input-type` 이 SSOT 이고 zod 두 곳(`lib/question/schema.ts`, `server/survey-builder/domain/question.ts`)이 그 상수를 쓴다. **형식과 `number` 는 배타** — 형식을 고르면 숫자 서식·초기값·계산 검증이 붙지 않는다. 판정·정규화·실패 사유는 `@/features/question-renderer/utils/input-format` 의 `parseInputFormat` 하나에서 나오고, 차단은 `NumericIssue.kind: 'format'`(클라이언트 전용)이다. 타이핑 단계에서는 번호 형식 4종이 **숫자와 하이픈만** 받는다(`filterFormatTyping`, 훅 `useInputFormatField.handleChange` — 세 표면 공용, 이메일은 제외). 정돈(자동 하이픈)은 여전히 blur 때 한 번이다. 이메일은 타이핑을 막지 않는 대신 한글·전각 글자를 검사 사유 `non_ascii`(「이메일은 영문·숫자로만 입력해 주세요」)로 blur·다음에서 막는다 — 한글 조합 중 글자를 떨어뜨리면 자판이 고장 난 것처럼 보이고 붙여넣기에서 조용히 다른 주소가 되기 때문이다. **DB 마이그레이션 없음** — `input_type` 은 enum·CHECK 없는 text 컬럼이고 셀·보기 쪽은 JSONB 안이다. 자세한 규약은 CONTEXT.md "입력 형식" · `docs/adr/0023`.
- **순위형 입력 방식** `rankingConfig.inputMode` (JSONB, 마이그레이션 없음): 미지정·`'dropdown'` 이면 **기존처럼 순위마다 드롭다운**, `'click'` 이면 보기를 눌러 순위를 매긴다 — 비어 있는 가장 낮은 순위에 들어가고 다시 누르면 해제(뒤 순위 당김), 요약 줄에 `1순위 [보기번호]` 칩 + 순위초기화, 기타·상세기재 입력칸은 그 보기 행 안에 있고 순위가 매겨져야 활성화. 순수 로직은 `features/question-renderer/utils/ranking-click.ts`, UI 조각은 `features/question-renderer/ranking-click-select.tsx`. 표 소스는 내장 표의 `ranking_opt` 셀을 `TablePreview renderCell` 로 같은 얼굴로 그리고, 그룹별 순위는 그룹마다 요약 줄·표는 하나. 응답 모양(`{rank, optionValue}[]`)은 두 방식이 같아 저장·검증·내보내기 무변경. **표 안 ranking 셀은 항상 드롭다운이고, `allowDuplicateRanks` 가 켜지면 클릭을 골라도 드롭다운**이다(클릭으로는 같은 보기를 두 순위에 둘 수 없다).
- **좌측 고정 열**: `stickyColumnCount` — 표를 그리는 문항(table + 내장 테이블을 쓰는 radio/checkbox/ranking) 공용. NULL=자동 판정(왼쪽부터 연속된 정적 셀 열까지), 0=고정 안 함, 1~3=명시 지정. 기본을 0 이 아니라 NULL 로 둔 것은 회귀 방지다 — 0 이 기본이면 지금 고정된 표가 전부 풀린다. 명시 지정도 "스크롤할 열이 남는가"(지정값 ≥ 전체 열 수면 비활성)·"뷰포트 60% 를 넘지 않는가"(최소 1열 유지) 두 가드는 통과해야 한다. 또 고정 경계는 colspan 셀 한가운데를 자르지 않는다 — 본문이 `cellIndex < stickyColCount` 로 sticky 를 걸어, 여러 열을 덮는 셀이 sticky 가 되면 스크롤 시 뒤쪽 열 위를 덮으며 따라오기 때문이다(척도 응답이 colspan 으로 전 열을 덮는 표는 지정해도 라벨 열까지만 고정된다). 판정은 `features/question-renderer/utils/table-grid-utils.ts` 의 `computeStickyLeftColumns`. 가로(헤더) 고정은 옵션이 아니라 표 길이에 따른 자동 그대로다.

### 테이블 질문 셀 타입

- `text`: 텍스트 표시 / `image`: 이미지 / `video`: 비디오 링크
- `checkbox` / `radio` / `select`: 선택 입력
- `input`: 텍스트 입력 (inputType `number` 시 숫자만, 형식 5종 지정 시 형식 검사, 평문 모드면 `textValidation` 응답 품질 검사 — 최소 글자 수·의미 없는 입력 거부). `inputWidth`(px)를 주면 셀 폭을 채우지 않고 그 너비로 고정되며 셀 가로 정렬을 따르고 오른쪽 단위 글자가 바로 뒤에 붙는다(레거시 보기 소스 표의 input 셀도 같음. 세로 카드 — 모바일 행 카드·드릴다운 카드 목록 — 만 `ignoreInputWidth` 로 무시하고, 드릴다운 안 원본 행 표·행별 원본 같은 px 격자는 적용). 셀 공통 `hideRightBorder` 는 응답 화면·미리보기에서 오른쪽 세로선을 안 그려 다음 셀과 한 칸처럼 이어 보이게 한다(빌더 편집 격자는 그대로) — 년 칸 | 월 칸 같은 "한 셀에 입력 둘" 요구는 이 둘로 푼다. 좌측 고정 열의 마지막 셀에 켜면 고정 영역과 스크롤 영역 사이 선도 사라지니 거기엔 쓰지 말 것. 격자선 클래스는 `features/question-renderer/utils/table-grid-utils.ts` 의 `getCellBorderClasses` 하나다. `piiEncrypted` 셀 플래그로 그 셀 응답값만 암호화 저장 (질문 단위 토글과 같은 규칙, 파기 스윕은 0085 — 이월 응답 파기 0095 와 합본한 현행 본문은 0100)
- `ranking`: 셀 내부 랭킹 (셀별 옵션 + 순위 드롭다운 N개)
- `ranking_opt`: 이 셀이 질문 레벨 ranking 의 옵션 소스
- `choice_opt`: 이 셀이 질문 레벨 radio/checkbox 의 옵션 소스
- `calc`: 수식 기반 읽기 전용 계산 셀

> **셀 본문 부분 강조** (`cell.contentHtml`, 2026-09-10): 셀 편집 모달의 "셀 텍스트 내용"은 굵게·글자색·변수 삽입만 있는 축소 편집기(`components/ui/rich-text-editor/inline-rich-text-editor.tsx`, 스키마는 `inline-cell-extensions.ts`)다. **정본은 여전히 평문 `content`** 이고, 글자 일부에 색·굵게가 있을 때만 `contentHtml` 을 곁에 둔다(`serialize-cell.ts` 가 마크 유무로 판정, 마이그레이션 없음). 내보내기·SPSS 라벨·보기 라벨 파생·행 높이 측정·행 라벨 비교는 전부 평문을 보므로 무변경이고, 화면 표시만 `CellText`(`features/question-renderer/cell-text.tsx`) 가 서식본을 우선한다 — 토큰 치환은 `resolveCellTextHtml`, sanitize 는 `sanitizeCellHtml`(문단·줄바꿈·strong·span color 만). 셀 본문을 새로 그리는 자리를 만들면 평문을 직접 흘리지 말고 `CellText` 에 `html` 까지 넘길 것. 문단 = 평문의 한 줄이라 "첫 줄만 굵게"는 첫 문단에 걸린다.

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
- procedure 베이스 3종은 아래 "인증과 권한" 참조. 모든 베이스는 `rpcLoggingMiddleware`가 붙은 `base` 파생이라 성공/실패가 구조화 로그 1줄로 남는다.
- **표면 선택 원칙**: 브라우저 query/mutation 은 oRPC · RSC 는 service 직접 호출 · 업로드·파일 스트리밍·webhook·sendBeacon 은 Route Handler · **JS 없이 동작해야 하는 네이티브 폼과 redirect+쿠키 의미론만 서버 액션**. 서버 액션 0개가 목표가 아니다.
- 그 원칙에 따라 잔존 서버 액션은 `actions/` 3파일뿐 (auth login/logout + unsubscribe form — 의도적 유지).
- **서버 도메인 마이그레이션 패턴/함정**: domain zod는 `@/types/survey` 방향 통일 + null-coalescing(as unknown as 금지), service input은 zod infer, `.returning()` 후 non-null throw, 컴포넌트는 hook/helper 시그니처 유지로 무수정. 질문 영속 쓰기는 explicit field set(spread 금지) + `PERSISTED_QUESTION_FIELDS` SSOT 로 tsc 관할 — 신규 컬럼은 SSOT 등재만 하면 모든 쓰기 지점(survey-save values/onConflict, create, duplicate, updateQuestion 순회)이 컴파일 에러로 호명된다. **읽기 방향은 tsc 가 못 잡는다** — 발행 스냅샷·빌더 로드가 공유하는 행→Question 매퍼(`server/read-models/survey-structure.ts` `mapQuestionRow`)도 명시 나열이라, 누락 시 발행 스냅샷에서 값이 조용히 증발한다(noticeBgColor 실사고). 전수 대조는 `server/read-models/map-question-row.test.ts` 가 잡는다.
- 경계는 ESLint 가 강제한다 — 서버 도메인 간 직접 import 금지(공용은 `@/shared` 승격 또는 RPC 경유, 타 도메인 테이블 직접 쿼리는 허용) · 프론트 feature 는 builder→response→renderer 한 방향 · 공용 구역(components/hooks/stores/utils/lib/types/shared)과 서버는 features 를 import 하지 않음 · UI 는 `@/server` 전면 금지(타입 포함, 모양은 `@/shared/contracts`) · 클라이언트 트리는 `@/db` 값 import 금지. 규칙은 `no-restricted-imports` 의 gitignore 의미론(상위 디렉터리 매치는 negation 불가, 같은 files 에 같은 규칙 블록 둘이면 마지막이 덮어씀) 위에 쓰여 있으니 새 규칙은 프로브 파일로 발화를 확인할 것.

---

## API 엔드포인트

```
POST   /api/rpc/[[...rest]]                    # oRPC 핸들러 — 전체 query/mutation (메인 경로)
*      /api/v1/[[...rest]]                     # OpenAPI 핸들러 (ENABLE_PUBLIC_API 게이트, 기본 비활성)
POST   /api/upload/image                       # 이미지 업로드 (multipart, 삭제는 media.deleteImages RPC)
POST   /api/upload/mail-attachment             # 메일 첨부 업로드 (삭제는 media.* RPC)
POST   /api/upload/notice-attachment           # 공지 첨부 업로드 (삭제는 media.* RPC)
POST   /api/upload/survey-document             # 조사표 PDF 업로드 (tmp 로 받고 쪽 수 판독, promote 는 attach RPC)
GET    /api/surveys/[surveyId]/export          # SPSS(.sav)/엑셀 export (인증 필요, 파일 스트림). raw/raw-split 은 `includeNonRespondents=1` 로 미응답 조사 대상 행 포함 (sav/sps 는 무시). `includePriorAnswers=1` 은 이번 회차에 키가 없는 문항을 이월 응답으로 채운다 — 숨은 문항 strip 뒤에 병합하고 조건 판정은 하지 않되, 「이월값 불러오기」를 끈 문항(`priorAnswerDisabled`)은 현재 빌더 설정 기준으로 비워 둔다. 조사 대상 명단 열은 파라미터 없이 응답 내역 컬럼 설정(`profileColumns`)의 표시 attrs·pii 열을 항상 붙인다 (pii 열이 있으면 PII 평문 → no-store) — Raw 행 조립은 라우트 폴더 로컬 raw-export-rows.ts (contacts·operations 를 함께 읽어 한 도메인에 못 둔다)
GET    /api/surveys/[surveyId]/export/split-preview  # 분할 export 미리보기 (basis 없으면 `hasContacts` — 다이얼로그가 Raw Data 옵션 영역을 그릴지 판단. basis + `includeNonRespondents=1` 이면 `totalRows`·`nonRespondentRows` 를 더해 반환)
GET    /api/surveys/[surveyId]/contacts/export # 조사 대상 목록 엑셀 다운로드
GET    /api/surveys/[surveyId]/demand-summary  # 문항 수요 집계표 엑셀 (화면의 정렬·필터를 쿼리로 받음)
POST   /api/response/segment                   # 구간 응답 저장 (sendBeacon — REST 유지)
POST   /api/response/draft                     # 이탈 시점 임시 저장 (sendBeacon — REST 유지)
*      /api/inngest                            # Inngest 핸들러
POST   /api/webhooks/resend                    # Resend webhook (svix 검증)
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

- 세션은 Supabase Auth (`lib/supabase/*`), `proxy.ts` 미들웨어가 `/admin`·`/analytics`에서 세션을 갱신한다.
- procedure 베이스 3종 (`server/orpc.ts`):
  - **`pub`** — 인증 불필요 (응답자 표면: 응답 mutation·공개 설문 조회·컨택 attrs·수신거부 lookup). 남용 방지가 필요한 표면은 `.use(withRateLimit(group))` 부착.
  - **`authed`** — 세션 + `ADMIN_USER_IDS` allowlist. grant-first: 게스트 유저는 allowlist fail-open 여부와 무관하게 FORBIDDEN.
  - **`scoped`** — 세션 + (admin allowlist ∨ 게스트 grant). **이 베이스를 쓰는 procedure는 핸들러 첫 줄에서 `assertSurveyAccess(context.user.id, input.surveyId)` 호출 필수** (유일한 예외: surveyId가 없는 `media.deleteMailAttachmentTmp`).
- 게스트 계정: `GUEST_SURVEY_GRANTS="<userId>:<surveyId>[,...]"` env로 설문 단위 위임 (한 유저가 복수 설문 grant 가능). 무권한 설문 콘솔 진입 시 강제 로그아웃 → 로그인 후 원래 목적지 복귀 (`lib/auth/guest-grants.ts`).
- allowlist 미설정이면 fail-open(인증된 모든 유저 통과) + 최초 1회 경고. 게스트 콘솔은 전역 테스트 모드와 무관하게 항상 실데이터를 본다.

---

## 레이트리밋과 로깅

- **레이트리밋** (`lib/rate-limit/`): Upstash Redis 2단 판정(`isRateLimitedTwoTier`). 입력의 sessionId/responseId를 클라이언트 축으로 삼아 `group:ip:clientId`로 같은 NAT 뒤 응답자를 격리하고, `group-ip:ip` 전체 가드가 식별자 회전 남용을 막는다. **UPSTASH env 미설정이면 limiter가 no-op(항상 통과)**. 신뢰 IP 헤더 부재 시에만 fail-closed.
- **로깅** (`lib/logger/`): pino + Axiom transport(2026-09-11 프로덕션·프리뷰 `AXIOM_TOKEN`/`AXIOM_DATASET=survey-prod` 등록으로 켜짐). `base`의 `rpcLoggingMiddleware`가 최전방이라 인증·레이트리밋 거부까지 기록된다. PII 마스킹은 `redact.ts` 소관.
- **Sentry**: RPC 의 진짜 장애(비-ORPCError 예외·INTERNAL_SERVER_ERROR)만 로깅 미들웨어가 `rpc`·`code`·`role`·`surveyId` 태그와 `rpc <이름>` 트랜잭션명을 붙여 보낸다(`isSentryWorthyRpcError`). 코드 있는 거부(UNAUTHORIZED·FORBIDDEN·TOO_MANY_REQUESTS 등)는 로그만 남긴다. 핸들러 인터셉터는 procedure 밖 예외의 최후 창구이고 `isSentryCaptured` 표식으로 중복 전송을 막는다. 클라이언트는 브라우저·확장 주입 스크립트 오류(`__firefox__`·`window.ethereum`·extension URL)를 `ignoreErrors`/`denyUrls` 로 거른다.

---

## R2 파일 수명주기

R2 영구 객체 삭제의 유일한 경로는 유예 삭제 큐다 (`server/storage-lifecycle/`).

- `r2_deletion_candidates` — 등록 후 7일 유예, cron 집행자가 장부·전역 참조를 재확인한 키만 삭제.
- `r2_sent_keys` — 발송된 메일 콘텐츠에서 추출한 키의 append-only 장부. **장부에 오른 키는 참조 유무와 무관하게 영구 보존** (수신함 참조는 DB로 복원 불가).
- `r2_key_refs` — 참조 인덱스. 유지가 아니라 **재생성** 구조(불변 소스는 삽입 시 1회, 가변 소스는 주기 전량 재추출)이며 집행 판정에서 삭제 권한이 없는 사전 필터다.

관리 UI는 `/admin/file-cleanup`. 결정 배경은 `docs/adr/0015-r2-deferred-deletion-and-sent-ledger.md`.

> **JS 로 R2 객체를 읽는 표면은 버킷 CORS 가 필요하다.** 기존 사용처는 전부 `<img>`·메일 HTML 이라
> CORS 없이 동작했고, 그래서 버킷에 정책이 없어도 아무도 몰랐다. 조사표 뷰어(pdf.js)가 `fetch` 로
> 읽는 첫 표면이고, 정책이 없으면 브라우저가 `Failed to fetch` 한 줄만 남긴 채 막는다 —
> 서버에서 `curl` 하면 200 이라 파일 문제로 오해하기 쉽다. 새 버킷·새 공개 도메인을 붙일 때는
> `AllowedMethods: GET/HEAD`, `AllowedHeaders: range`, `ExposeHeaders: content-range·accept-ranges`
> 를 함께 넣을 것 (pdf.js 는 부분 요청을 쓴다).

---

## 쿼터

`surveys.quota_config` (JSONB, NULL = 쿼터 없음) + `features/operations/quota` + `lib/quota/`.

- 차원(`questionId` 바인딩, `choice` | `numeric`) × 카테고리 조합 셀에 목표치를 둔다. 셀은 sparse — 목표가 있는 조합만.
- `enabled=false`면 정의·집계만 하고 응답자를 차단하지 않는다. 마감 차단 시 응답 status는 `quotaful_out`.
- **publish 없이 즉시 반영되는 라이브 컬럼** (`isPaused`/`pausedMessage`와 동일 취급).
- 실시간 달성률은 완료 응답 기준 — `docs/adr/0002-quota-realtime-from-completed-answers.md`.

---

## 문항 수요조사 (조사표 + 영역 앵커 + 분할 레이아웃)

지난 회차 종이 조사표(PDF)를 놓고 "이 문항을 다음 회차에도 쓸 것인가"를 묻는 설문 형식.
**신설된 것은 셋뿐이다** — 조사표·영역 앵커·분할 레이아웃. 질문 유형·조건부 표시·쿼터·컨택·초대·
메일·SPSS/엑셀 export 는 전부 기존 것을 그대로 쓴다.

- **조사표** `survey_documents` (0097) — 설문당 여러 행. 파일은 R2 영구 네임스페이스 `survey/document/`.
  업로드는 `tmp/survey-document/` → attach 에서 promote. 쪽 수는 서버가 파일을 열어 읽는다
  (`server/survey-document/services/pdf-page-count.ts`). **R2 참조 표면 SSOT 등재 필수.**
- **영역 앵커** `survey_document_anchors` (0098) — 쪽 번호 + 정규화 0~1. 한 대상에 사각형 여럿.
  대상 참조는 `question_id`/`group_id` nullable FK 둘 + CHECK 정확히 하나 (종류 구분값은 파생).
- **분할 레이아웃** — 설정이 아니라 **파생**이다. 토글 0개. **페이지마다** 판정한다: 앵커 걸린
  항목을 담은 페이지만 좌 조사표 / 우 질문 50:50 이고, 조사표에 등록되지 않은 페이지는 일반
  문항 페이지로 나온다(안내문 → 다음 → 조사표). 판정은 `utils/group-ordering.ts` 의
  `resolveSplitSteps` — **구조 기준**이라 조건부로 숨은 질문의 앵커도 센다.
  좌측에 _그리는_ 것은 표시되는 항목 것만이다. 레이아웃은 구조에서, 표시는 조건에서.
  경계를 넘나들면 뷰어가 언마운트되므로 pdf.js 문서는 주소별로 캐시한다
  (`pdf-page-view.tsx` 의 `openedDocs`). 진행바는 **설문 전체**에서 뺀다 — 페이지마다
  넣었다 뺐다 하면 넘길 때 머리 부분이 들썩인다.
- **수명 분리**: 조사표 파일 참조는 라이브, 앵커는 발행 스냅샷에 freeze, 교체 가드 없음 —
  `docs/adr/0020-survey-document-live-anchors-frozen.md`. 다른 조사표로 바꾸면 **에러 없이
  잘못 그려진다**는 것이 받아들인 위험이다.
- **판단 항목은 평범한 radio** — 필요함 / 필요하지 않음 **2지선다**. 판정 없이 의견만 내는
  것은 없다. **문항 의견은 짝 문항**이다 — 판단 항목 바로 뒤의 `textarea`, 문항코드 `부모코드_T`
  (ADR 0022). 짝 판정은 `lib/survey/judgement-item.ts` 의 `resolveOpinionPairs` — 코드 규약과
  "바로 다음 순서" **둘 다** 맞아야 짝이고, 어긋나면 일반 문항으로 그린다. 체크리스트는 짝을 부모
  행에 접어 그리고(세 번째 버튼은 판정이 아니라 서술 칸 토글), 집계는 의견을 분모에서 뺀다.
  `_T` 문항은 `isCustomSpssVarName=true` 로 두어야 export 가 자동 변수명으로 덮어쓰지 않는다.
  선택지 사이드카(`__optTexts__`·`_text` 변수)는 **기타 상세기재**용이라 이 형식에서는 쓰지 않는다.
- **운영 관례**: 이 형식은 `requireInviteToken` 을 **켜는 것을 관례로 한다**(신설 없음, 기존 설정).
  익명 응답 한 건이 n=5 짜리 집계를 흔든다. `allowMultipleResponses` 는 켜지 않는다 —
  같은 사람의 응답이 여러 건 쌓여 집계 분모가 이중 계산된다. 제출 후 수정은 관리자 편집 화면으로.
- 조사표는 설문 단위라 테스트 파티션과 무관하다 — 테스트 모드도 같은 파일을 쓰고 별도 업로드가 없다.
- 모바일은 진입 시 뷰포트 폭으로 설문 전체를 안내 화면으로 막는다. **관리자 응답 편집만 면제** —
  이 스펙이 만드는 유일한 조건 분기다.

---

## 이월 응답 임포트 (추적조사)

지난 회차 rawdata 를 조사 대상에게 붙이는 화면. `현황 > 조사 대상 > 이월 응답 임포트`.
명단 업로드와 **분리된 화면**이다 — 매핑은 문항이 있어야 가능해 시점이 다르고, 명단 업로드의
replace 모드는 조사 대상을 지우고 다시 넣어 이미 발송한 개별 링크를 죽인다.

**양식이 둘이고 첫 단계에서 사람이 고른다.** 파일을 올리면 3행에 이 설문의 SPSS 변수명이
보이는지로 추측해 알려주고, 확정은 사람이 한다.

- **Raw 양식** — 우리 Raw Data 내보내기 파일에 값만 채워 받은 것. 3행 SPSS 변수명이 기계
  식별자라 같은 설문으로 열 정의를 다시 만들어 짝을 짓는다. **열 이어주기 단계가 없다.**
  왼쪽 메타 열은 1~3행 세로 병합이라 3행이 비어 있어 변수 열과 저절로 갈린다.
- **임의 엑셀** — 헤더의 문항코드로 블록을 나눠 사람이 문항에 이어준다. 값은 선택지 라벨로
  맞추고, 안 맞는 값은 그 자리에서 이어줄 수 있다(확정은 `priorAnswerImportConfig` 에 보관).

**조사 대상은 명단의 attrs 열 하나로 찾는다.** 담당자가 엑셀의 대조 열과 명단의 attrs 항목을
각각 고른다. 시스템ID·pii 는 후보가 아니다 — 클라이언트가 만든 파일에는 우리 시스템ID 가 없고,
pii 는 암호문이라 대조하려면 blind index 경로를 타야 한다.

**모호한 대조값은 붙이지 않는다.** 파일 안에서 두 번 나온 값과 명단 쪽에 같은 값을 가진 대상이
둘 이상인 값은 양쪽 다 건드리지 않고 화면에 나열한다. attrs 는 유일함이 보장되지 않아 동명이인이
반드시 나오고, 잘못 붙은 이월 응답은 응답 화면에서 남의 지난 답으로 보인다.

**되읽지 않는 열이 규칙으로 정해져 있다.** 변동 확인(`_CHG`)은 지난 회차 답이 아니라 이번 회차에
응답자가 밝힌 행위 기록이고, 공지 동의·동의 일시는 이번 회차에 다시 받는다. 조용히 버리지 않고
목록으로 보고한다. **빈칸은 키를 만들지 않는다** — 이월 응답의 문항 키 집합이 변동 확인 변수를
만들 문항을 정하므로, 빈칸이 키가 되면 지난 답 없는 문항에도 변수가 생긴다.

쓰기는 조사 대상당 통째 교체다. 파일에 행이 없는 대상은 손대지 않는다. 실행 전 미리보기(dry run)가
적재 없이 같은 보고를 낸다.

> 왕복(내보내기 → 임포트)이 값을 보존하는지는 `raw-format-round-trip.test.ts` 가 전 문항 유형을
> 한 설문에 담아 지킨다. 내보내기에 새 열 종류가 생기면 "되돌리지 못한 열" 단언에서 먼저 걸린다.

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

4. **테이블 질문**: `tableColumns`, `tableRowsData`, `tableHeaderGrid`, `tableValidationRules`, `dynamicRowConfigs`, `rowRepeatConfig`, `sumConstraints` JSONB 사용. choice 응답값은 `cell.id`.

   **행 반복**(`rowRepeatConfig`)은 동적 행 그룹과 다른 기능이다 — 저쪽은 빌더가 만들어 둔 행 풀에서 응답자가 고르는 것이고, 이쪽은 같은 모양의 칸을 원하는 벌 수만큼(최대 20) 반복하는 것이다. 설정은 분리하고 렌더 파이프라인(`use-dynamic-rows`)만 공유한다. 구조에는 저장 시점에 최대 벌까지 **실제로 펼쳐 둔다**(`lib/question/row-repeat.ts` 의 `expandRepeatRows`) — 응답값 키가 발행 스냅샷 안의 `cell.id` 로 유지되어 저장 경계·초안·이월 임포트·관리자 편집이 전부 무변경이다. **펼치기는 멱등**이어야 한다(이미 있는 벌은 행·셀 id 를 그대로 두고 템플릿 구조 변경만 전파). 표에 반복 블록을 켜면 그 표의 `rowCode` 를 **명시 발번**한다 — `buildTableCellVarName` 의 제로패딩 자릿수가 `rows.length` 기준이라 20벌로 펼치는 순간 같은 표의 비반복 행 변수명이 `r1` → `r01` 로 통째 바뀌기 때문이다. 내보내기는 모수 전체를 1회 스캔해(`lib/analytics/row-repeat-usage.ts`) 아무도 채우지 않은 뒤쪽 벌의 열을 뺀다(설문 전체 기준 — 분할 파일 간 열 구성이 갈리지 않도록). 필수 검증은 1벌만 본다.

5. **다단계 선택**: `selectLevels` 배열로 3단계까지. 부모 선택에 따라 동적 로딩.

6. **export 라벨**: `cell.exportLabel || generateExportLabel(questionCode_열_행)` 폴백 필수 (빌더는 placeholder만 표시, DB null 흔함).

7. **마이그레이션 — 수동 SQL 관행**: drizzle `_journal.json`은 **0019에서 동결**됐고 0020 이후는 전부 손으로 쓴 `.sql`을 `supabase/migrations/`에 두고 Supabase MCP `apply_migration` 또는 직접 SQL로 적용한다. 새 파일을 추가하면 **반드시 `supabase/migrations/manual-migrations.json`의 `migrations`에 tag(확장자 제외 파일명)를 등재**해야 한다 — 미등재는 추적 불가 drift로 보고 CI(`.github/migration-journal-gate.ts`)가 차단한다. `pnpm db:generate`/`db:push`는 이 관행과 충돌하므로 쓰지 않는다. `TRUNCATE CASCADE` 금지 (ON DELETE SET NULL 무시).

   **새 마이그레이션은 빈 DB에서 재생 가능해야 한다.** 2026-08-19부터 테스트 DB는 `drizzle-kit push`가 아니라 마이그레이션 전량 재생으로 만들어진다(`scripts/setup-test-db.sh`). 즉 `pnpm db:setup-test`가 곧 재생 검증이며, 기존 상태를 전제한 문장을 넣으면 거기서 깨진다. 실 DB에만 있고 레포에 없는 객체는 `pnpm db:drift`가 잡는다 — 자세한 내용은 아래 "DB 드리프트 점검" 참조.

8. **앱 생성값 NOT NULL 컬럼은 2단계 배포**: nullable 추가 + 백필(배포 전) → 앱 배포 → `SET NOT NULL`(라이브 후). 한 번에 걸면 구버전 앱 INSERT가 깨진다.

9. **서버 sanitize**: jsdom 의존 라이브러리 금지 (isomorphic-dompurify 크래시). `sanitize-html` 사용.

10. **테스트**: 단위 테스트의 집은 SUT 소스 옆이다(ADR 0017, 전면 colocation — 2026-08-25 실측 src 466파일). 명명은 소스 어간 정합 — 1:1은 `<소스>.test.ts(x)`, 한 소스의 측면 시리즈는 `<어간>-<측면>.test.ts`, 여러 소스를 가로지르는 시나리오는 주 SUT 폴더에 주제명(app 라우트는 `route.test.ts`/`route-<측면>.test.ts`, 교차 라우트는 서술명). ESLint 경계가 colocation 을 막으면 의존 방향이 허용하는 쪽 SUT 폴더에 둔다(예: branch-logic-drift 는 공용 구역→server 금지라 server 도메인 쪽, 빌더 프리뷰 스토어 배선 테스트는 renderer 의 feature import 금지라 빌더 stores 쪽). 양쪽 다 막히는 교차 feature 계약은 `tests/repo` 로(예: measurement-font). `tests/` 에는 계층·계약 스위트만 산다 — `integration/`(service 모킹 패턴: top-level `vi.mock` + `vi.mocked`, realdb 포함)·`e2e/`·`repo/`(src 밖 소스·레포 계약)·fixtures/helpers/stubs/setup. 이 배치는 메타테스트(`tests/repo/test-tree-layout.test.ts`)가 강제한다. Vitest include 는 `tests/**` + `src/**/*.test.{ts,tsx}` + `workers/`, `.tsx` 는 jsdom 프로젝트 자동 분기(DOM 이 필요한 `.ts` 만 `DOM_TS_TESTS` 등재). 실DB 왕복은 `*.realdb.test.ts` — `pnpm test:integration`(로컬 supabase 54322 필요), 일반 `pnpm test`에서는 스킵. `tests/integration/profiles-row-actions.test.ts`의 오랜 flaky 는 2026-08-19 에 수리했다. 원인은 그 파일이 `@/db/schema` 에 `vi.mock` 을 두 번 걸고 있던 것이다 — 같은 경로에 두 번 걸면 어느 팩토리가 이기는지 보장되지 않고, `{ __table }` 만 주는 쪽이 이기면 `col.__col` 이 undefined 라 mock `eq()` 가 항상 false 를 반환해 모든 조건 조회가 빈 결과가 된다. 그 결과 14건 중 12건이 `SurveyOwnershipError:not_found` 로 무너졌다. "전체 스위트에서만 모킹 간섭으로 깨진다"·"격리하면 항상 통과" 두 진단 모두 틀렸고, 중복 제거 후 전체 스위트에 포함해도 통과해 2단 격리 구조와 `ISOLATED_FLAKY_TESTS` 를 걷어냈다. **같은 모듈에 `vi.mock` 을 두 번 걸지 말 것.**

11. **vitest의 `server-only` stub 사각지대**: 클라이언트/서버 경계 위반은 테스트가 통과해도 빌드에서만 드러난다. 경계를 건드렸으면 `pnpm build`로 확인할 것.

12. **drizzle 함정**: timestamptz optimistic lock은 PG μs ↔ JS ms 정밀도 차로 거짓 충돌 (version int 또는 string mode 사용). `ANY(${arr})` 바인딩 금지 (length=1 silent unwrap) → `inArray`/`sql.join`. jsonb 컬럼에 `JSON.stringify` 바인딩 금지 (이중 인코딩) → 객체 그대로 전달.

13. **응답 루트 사이드카**: `questionResponses` 최상위의 `__` 접두 키(`__optTexts__` 기타/상세 기재, `__changeConfirm__` 추적조사 변동 확인)는 실존 문항이 아니라 저장 경계마다 분기가 필요하다 — 분리를 빠뜨리면 `saveDraft` 는 소속 검증에서 500 이 되고 `complete` 는 멤버십 필터에서 값을 조용히 버린다(둘 다 실제로 겪은 사고). 키와 정제 함수는 `lib/survey/response-sidecars.ts` 한 곳에 등록하고, 저장 경계는 `splitRootSidecars`/`isPersistedRootSidecarKey`/`sanitizeRootSidecar` 로만 판정한다. 등록되지 않은 `__` 키는 **저장에서 빠지고 경고 로그만 남는다** — 거부하면 등록을 빠뜨린 키 하나가 그 응답자의 초안 저장을 통째로 막는다(부분 저장이 없다). 문항 id 는 UUID 라 `__` 접두를 가질 수 없어 진짜 답변이 이 분기로 새지 않는다. `__dynamicRowSelections__` 는 2026-09-09 에 등재했다.

14. **문항 가시성**: 표시 조건으로 숨겨진 문항의 응답은 **그 순간 지워진다. 되돌려도 살아나지 않는다** (2026-09-07 결정 — 세션 되돌리기 버퍼는 검토 후 미채택). 판정·삭제는 `lib/survey/question-visibility.ts` 의 `resolveVisibleQuestionIds`/`stripHiddenQuestionValues` 한 곳이다. 복제 금지 — 셀 게이팅(`cell-gating.ts`)과 같은 규약. 저장 경계 순서는 **숨은 문항 strip → 게이팅 strip → calc 재계산**. **초안·구간 저장에는 걸지 않는다.** 그쪽 answers 는 더티 키만 담은 부분 패치이고 저장이 jsonb 합집합 병합이라, strip 을 걸면 조건이 참조하는 상류 문항이 패치에 없어 멀쩡한 답이 지워진다. 새 저장 경로를 만들 때 이 구분을 지킬 것.

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
- 메인과 worktree의 `package.json`, `pnpm-lock.yaml`이 같으면 worktree의 `node_modules`를 메인 checkout의 `node_modules`를 가리키는 심볼릭 링크로 구성한다. 두 파일이 다르면 링크하지 말고 별도 설치가 필요함을 먼저 알린다.
- 메인 checkout에 존재하는 ignored 환경 파일(`.env`, `.env.local`, `.env.development`, `.env.development.local`)은 내용을 읽거나 출력하지 않고 worktree에 심볼릭 링크한다.
- worktree 준비 완료를 보고하기 전에 의존성 링크와 환경 파일 링크가 유효한지 확인한다.

### 문서 갱신

`update-docs` 스킬(`.agents/skills/update-docs/`)이 이 레포용 대조표를 갖고 있다. 코드가 문서와 어긋났을 때 이 스킬을 따른다 — 갱신 대상은 `AGENTS.md`·`CONTEXT.md` 이고, `docs/superpowers/plans`·`specs` 와 ADR 본문은 시점 기록물이라 최신화 대상이 아니다.

> `CLAUDE.md` 는 `AGENTS.md` 를 가리키는 심볼릭 링크다. 문서 수정은 항상 `AGENTS.md` 에 한다.
