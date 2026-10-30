# Survey Table Project - 에이전트 참조 문서

## 프로젝트 개요

Next.js 16 기반의 고급 설문조사 빌더 + 운영 플랫폼. 복잡한 질문 유형, 조건부 로직, 버전 스냅샷, 컨택 관리, 메일 캠페인, SPSS/엑셀 내보내기, 분석 기능을 갖춘 엔터프라이즈급 애플리케이션.

> 최종 갱신: 2026-10-29. 날짜별 변경 이력은 `git log -- AGENTS.md CONTEXT.md` 로 본다 — 여기에 쌓지 않는다.

---

## 기술 스택

| 영역           | 기술                                        | 버전            |
| -------------- | ------------------------------------------- | --------------- |
| 프레임워크     | Next.js (App Router, Turbopack)             | 16.4.2          |
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
| 이미지 처리    | sharp                                       | 0.35.5          |
| HTML sanitize  | sanitize-html                               | 2.18.1          |
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
| 테스트         | Vitest + Testing Library + MSW + Playwright | 4.1.12 / 1.60   |
| 언어           | TypeScript (strict)                         | 5.9.3           |

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
│   ├── admin/surveys/[id]/     # edit(빌더) · preview · analytics · operations(운영 콘솔 — 아래 라우트 절)
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
├── db/                         # index.ts(drizzle postgres-js) · schema/(아래 DB 절)
├── types/                      # 전역 타입·어휘 — survey.ts(질문 구조 SoT, shared/contracts 와 겹침 0) · question-types(배열 ↔ 타입 동치를 tsc 로 강제)
│                               # mobile-table-display · input-type(입력 형식 SSOT) · survey-locale
├── instrumentation*.ts         # Sentry
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
├── localizedMessages (JSONB)     # 언어별 설문 글자 { zh?, en? : { title, description, thankYou, screenedOut } } (0145, NULL=한국어만, 빈 칸은 한국어 폴백). 발행 스냅샷 settings 에 얼린다(라이브 아님). 계약 shared/contracts/survey 의 LocalizedSurveyTexts — 아래 "다국어 설문"
├── piiRetentionUntil (개인정보 보관기한)
├── contactColumns / testContactColumns (JSONB)  # 컨택리스트 표시 컬럼 스킴 (실/테스트 분리)
│                                 #   컬럼별 플래그: hidden(목록 숨김) · piiType · groupLevel(진척보고 분류 축)
│                                 #   · showInMail(단체 메일 위저드·캠페인 상세 수신자 표·수신거부 명단에 열 노출 — attrs.* 는 값, pii.* 는 마스킹 힌트(켠 열만 서버가 읽는다), system.contact_owner 는 컨택원 이름(게스트 화면 제외), system.resid 는 기본 보임이라 끈 경우만 false. 해석 lib/contacts/mail-display-columns)
│                                 #   · mailOrder(메일 발송 주소 순서 1부터, 이메일로 암호화된 열 전용 — 아래 "메일 발송 주소 순서")
├── lookups (JSONB)               # 설문에 복사된 LUT 사본 목록
├── contactResultCodes (JSONB)    # 결과코드 사용자 정의
├── progressColumns (JSONB)       # 진척률 표 컬럼 픽커
├── profileColumns (JSONB)        # 응답 내역 표 컬럼 픽커 — 열 키 sys.·attrs.·pii.·entry.·answer.<문항 id>[.<칸 id>](응답값 열, 2026-10-23: 단답형·장문형·표 입력 칸을 변수명으로 찾아 추가, 저장은 id, 쪽 행만 JSONB 에서 꺼내 암호문은 복호화, 정렬 없음. 검색바·전체 검색·머리 깔때기는 부분일치와 값 없음/있음(profiles-filters 의 answerTextSql), 암호화 저장 칸은 후보에서 빠진다. 후보 read-models/profile-column-scheme 의 getProfileAnswerSources, 값 server/operations/services/profile-answer-values)
├── quotaConfig (JSONB)           # 쿼터 플랜 (NULL = 쿼터 없음) — 라이브 컬럼
├── isPaused, pausedMessage       # 응답 일시중지 — 라이브 컬럼
├── testModeEnabled, testToken    # 테스트 환경 (테스트 링크가 산다). 콘솔이 테스트 파티션을 보는 건 브라우저 쿠키까지 켠 곳만 — 아래 "테스트 모드"
├── priorWaveLabel                # 추적조사 지난 회차 라벨 — 라이브 컬럼
├── priorAnswerImportConfig (JSONB)  # 이월 응답 임포트 확정 매핑 (문항코드 블록 → 문항 id + 값 대응)
├── endRedirects (JSONB)          # 종료 후 이동 주소 {completed, screenedOut, quotaClosed, passParams} — 라이브 컬럼(0138), 판정 lib/survey/end-redirect, CONTEXT.md 「종료 후 이동 주소」
├── changeConfirmEnabled          # 문항별 변동 확인 사용 여부(기본 false) — 라이브 컬럼.
│                                 #   false 면 이월 값을 표시되는 문항에 미리 깔고 응답자가 고치면 덮어쓴다
├── requireInviteToken            # invite token 강제 여부
├── forceWideLayout               # 강제 와이드 레이아웃
├── status                        # 'draft' | 'published' ('closed' 는 미구현 어휘 — 쓰는 경로 없음, 종료는 endDate/isPaused 로)
├── currentVersionId              # 현재 활성 배포 버전
├── testVersionId                 # 지금 테스트 버전 (0141) — 테스트 링크·대상자·관리자 미리보기가 보는 저장본 스냅샷. 아래 "테스트 모드"
├── deletedAt (soft delete)
└── createdAt, updatedAt

question_groups            # 질문 그룹 (계층 구조, self-reference)
├── id, surveyId, parentGroupId, name, description
├── order, color, collapsed, hideName, nameDesign (JSONB)   # nameDesign = 그룹 이름 디자인(배경·글자색·폭). 응답 화면에서 상위 그룹 배지와 하위 그룹 소제목(2026-10-29) 둘 다 적용, 없으면 하위 그룹은 회색 소제목, hideName 이면 안 그린다
├── displayCondition (JSONB)
└── createdAt, updatedAt

questions                  # 개별 질문
├── id, surveyId, groupId
├── type                   # text|textarea|radio|checkbox|select|multiselect|ranking|table|notice
├── title, description, required, requiredMessage, order, hideTitle
├── titleHtml                     # 제목 서식본(굵게·밑줄·글자색·글자 크기, 0125). 정본은 평문 title — 응답 화면 제목 표시만 우선하고, 글자가 평문과 어긋나면 버린다(lib/survey/question-title-html)
├── options, selectLevels, choiceGroups (JSONB)
├── tableTitle, tableColumns, tableRowsData, tableHeaderGrid (JSONB)  # 테이블
├── tableValidationRules, dynamicRowConfigs, sumConstraints (JSONB)   # 검증/합계 제약
├── rowRepeatConfig (JSONB)       # 행 반복 — 응답자가 + 로 늘리는 연속 행 묶음 {enabled, templateRowIds, maxRepeats, addLabel}
├── stagedRowsConfig (JSONB)      # 행 차례로 열기 — 저작된 연속 행 묶음을 처음 몇 행만 보이고 + 로 한 행씩 연다 {enabled, rowIds, initialVisibleCount, addLabel} (0132). 구조는 건드리지 않고 가시성만 정한다 — 행 반복과 다른 개념(ADR 0028)
├── rankingConfig (JSONB)         # 순위형 전용
├── optionsColumns, optionsAlign, mobileOptionsColumns, minSelections, maxSelections, allowOtherOption
├── maxSelectionsSource (JSONB)   # 최대 선택 개수를 다른 문항의 숫자 응답에서 가져온다 {questionId, unlimitedFrom} — NULL=고정값만 (0130)
├── placeholder, defaultValueTemplate  # 단답형(prefill 토큰 지원 — 명단 값이 있으면 그 값으로 잠그고, 치환 결과가 비면 잠그지 않아 응답자가 직접 적는다. 표 input 셀의 defaultValueTemplate 도 같은 규칙이고 셀에는 `prefillEditable`(응답자가 고칠 수 있게 — 잠그지 않고 처음 한 번만 깐다)이 더 있다, CONTEXT.md "이월 값과 본문 프리필 토큰의 우선순위")
├── inputType, emptyDefault, numberFormat (JSONB)  # 단답형 입력 모드 (숫자 | 형식 5종)
├── inputRows, inputAutoGrow      # 단답형·장문형 입력칸 줄 수(1~20, NULL=유형 기본: 단답형 1줄·장문형 4줄)·입력한 만큼 높이 늘리기. 숫자·형식 칸은 한 줄 고정 (0124)
├── textValidation (JSONB)        # 단답형·장문형 응답 품질 검사 {minLength, maxLength, rejectMeaningless} — 평문 모드 전용, 클라이언트 차단 (0109, features/question-renderer/utils/text-quality)
├── piiEncrypted                  # 응답값 암호화 저장 여부 (단답형·장문형). 표 input 셀은 tableRowsData 의 셀 piiEncrypted
├── questionCode, isCustomSpssVarName, exportLabel, spssVarType, spssMeasure, exportCellOrder  # SPSS export
├── answerQuoteEnabled, answerQuoteName, answerQuoteText  # 이전 응답 인용
├── mobileOriginalTable, mobileTableDisplayMode,  # 표시 방식 auto|drilldown-original-row|row-wise-original|row-wise-scale|row-cards|row-group-cards|axis-cards|item-cards|original (0129 CHECK — 어휘를 늘리면 배열·check()·마이그레이션 셋을 함께, 주의사항 1). 방식별 규칙은 CONTEXT.md 「모바일 표시 방식」과 방식별 용어 절
│   mobileDrilldownOmitLeadingColumns,
│   mobileDrilldownRepeatHeaderStartRow/EndRow      # 모바일 표 렌더
├── mobileItemCardBlockColumns (JSONB)  # 「항목 단위 카드」 블록 시작 열 번호 배열(1부터, 작성 열 순서, NULL=블록 없음, 0131). 경계는 저작자가 적는다(자동 추정 없음) — CONTEXT.md 「블록 단위로 세우기」
├── hideColumnLabels, pageBreakBefore
├── stickyColumnCount            # 좌측 고정 열 개수 (NULL=자동 판정, 0~3=명시 지정)
├── fitTableToWidth              # 화면 폭에 맞춰 표 줄이기 (기본 false, 0146) — 아래 "질문 유형"의 좌측 고정 열 다음 항목
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
├── status                        # in_progress|completed|screened_out|quotaful_out|bad|drop (어휘·열림/종결/재응답 술어 SSOT: shared/contracts/survey-response.ts — 전이표도 거기 주석)
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
├── id, surveyId, versionNumber   # 테스트 버전은 음수 번호(배포 번호 max+1 과 겹치지 않게)
├── status                        # 'published' | 'superseded' | 'test'(테스트 버전, 0141 — 버전 목록·배포 번호에서 뺀다) ('closed' 미구현)
├── snapshot (JSONB)              # 배포 시점 전체 설문 구조 (prune 시 NULL 가능 — 직전 테스트 버전은 새 테스트 버전을 만들 때 바로 비운다).
│                                 #   비우지 않는 버전: 지금 배포본·테스트 버전 · 실응답(휴지통 포함)이 가리킴 · 이관 출처 · 이관 이력 from/to (version-retention, 2026-10-23)
├── fingerprints (JSONB)          # 테스트 버전 지문 {revision, questions, groups} (0141) — snapshot 을 비워도 남긴다. 배포 버전은 NULL
├── changeNote, publishedAt, closedAt, prunedAt, deletedAt
└── createdAt

response_edit_logs         # 관리자 응답 편집 이력
├── id, responseId, contactTargetId, surveyId, action
├── editedBy, editorEmail
├── changedQuestions (JSONB), changedCount
└── createdAt

response_migration_history # 이관 이력 — 배포 응답이 버전을 옮길 때마다 한 줄 (0142, 실응답만, CONTEXT.md 「이관 이력」)
├── id, responseId (cascade), surveyId (cascade)
├── fromVersionId, toVersionId    # SET NULL. 여기 걸린 버전은 스냅샷을 비우지 않는다
├── answersBefore, answersAfter (JSONB)  # 옮기기 전·후 답 — 암호문은 「[개인정보 — 이력에 담지 않음]」 표식
├── actor ('respondent' | 'admin' CHECK), editedBy, editorEmail
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
├── assignmentId                  # 지금 맡은 컨택원 (0136, ON DELETE SET NULL — 컨택원을 지우면 배정 없음). 교체 업로드는 대상을 새로 만들어 풀린다
└── createdAt, updatedAt  (UNIQUE surveyId+isTest+resid)

contact_assignments        # 컨택원 — 이름 붙은 배정 묶음 (0136). 계정·로그인과 무관
├── id, surveyId (cascade), isTest           # 실/테스트 파티션마다 따로
├── name, order                              # UNIQUE surveyId+isTest+name · order = 필터 선택지·진척 보고 줄 순서
├── lastClauses (JSONB)                      # 마지막 교체 적용 조건 { source, value, op }[] (contacts 계약 ContactAssignmentClause)
└── lastAppliedAt, createdAt, updatedAt

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
├── kind                   # bulk(단체) | single(단건, 1000001~) | fallback(대체 발송, 2000001~ — 0135 CHECK)
├── parentCampaignId       # 대체 발송의 원래 회차 (부모마다 대체 회차 하나 — 부분 유일 인덱스)
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
├── emailColumnKey, sourceRecipientId  # 주소를 꺼낸 명단 이메일 열 · 대체 발송의 출처 수신자 (0135, 이전 행은 NULL)
├── fallbackPendingAt      # 대체 발송 처리 대기 (0137) — 반송·거부 전이와 같은 트랜잭션이 찍고 대체 발송 처리가 지운다
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
             ├─ (N) survey_responses ─┬─ (N) response_edit_logs
             │                        ├─ (N) response_migration_history
             │                        ├─ (N) test_response_attempts
             │                        └─ (1) contact_targets [optional 매칭]
             ├─ (N) survey_versions ── (N) survey_responses [versionId]
             ├─ (N) contact_uploads ── (N) contact_targets
             ├─ (N) mail_templates ── (N) mail_campaigns
             └─ (N) mail_campaigns ── (N) mail_recipients ── (1) contact_targets

contact_targets ─┬─ (N) contact_pii (암호화 PII)
                 ├─ (N) contact_attempts (결과 회차)
                 ├─ (1) contact_prior_answers (이월 응답)
                 └─ (1) contact_assignments [optional — 지금 맡은 컨택원, 같은 isTest]

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
│   ├── assignments               # 컨택원 관리 (게스트 제외 — 미들웨어도 막는다) → [assignmentId] 컨택원 수정(교체 적용)
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

> 운영 집계는 `server/operations/services` 에서 SQL 집계로 수행 (aggregate + format + wrapper 패턴 — 공유 format 짝은 `lib/operations/*-format.ts`, UI 도 소비하므로 lib 이 정답). 응답값의 정본은 `question_responses` JSONB 하나다 — 문항별 사본 `response_answers` 는 2026-10-23 에 걷어냈다(0143, 읽는 곳이 모두 JSONB 모양으로 되돌려 썼고 SQL 필터에 쓴 곳이 없었다). 문항·변수 단위 통계 표가 필요해지면 이중 쓰기가 아니라 원본에서 다시 만들 수 있는 파생 표로 설계할 것.
> 콘솔 조회·쓰기는 `loadOperationsDataScope`가 결정한 실/테스트 파티션(`is_test`)에 갇힌다. 엑셀·SPSS export 라우트도 같은 스코프를 탄다. 신규 집계 쿼리는 스코프 필터를 빠뜨리지 말 것.
> **메일 발송 주소 · 대체 발송** (0135·0137): 이메일 열이 여럿일 때의 발송 주소 순서(`mailOrder`)와 반송·거부 시 다음 순위 주소로 한 통 더 보내는 대체 회차(`kind='fallback'`, cron `mailFallbackSweeper` — 새 Inngest 함수라 배포 뒤 수동 Resync)는 CONTEXT.md 「발송 주소」가 정본이다. 새로 "이 대상의 이메일"을 읽는 자리를 만들면 `field_type='email'` 을 직접 거르지 말고 `lib/mail/send-address`(규칙)·`server/read-models/send-address`(DB)를 쓸 것.
>
> **컨택원 배정** (0136): 조사 대상을 이름 붙은 배정 묶음(계정 아님)에 나눠 맡긴다. procedure 는 전부 `authed` 이고 게스트 화면은 컨택원 열·값·필터·칩을 전부 받지 않는다. 교체 적용은 들어옴·빠짐을 한 UPDATE 문장으로 하고 충돌이면 `retryAssignmentWrite` 로 다시 돈다. 상세는 CONTEXT.md 「컨택원」.
>
> **조사 대상 필터 해석 · 필터 확장**: 목록 주소·캠페인 스냅샷·조건 줄은 `server/read-models/contact-filter-resolution.ts` 한 곳으로 읽는다(하위 파서 `contacts-filter-parse` 직접 import 는 ESLint 가 막는다). 대상을 고르거나 쓰는 쪽은 `mode: 'write'` 로 해석해 해석 안 되는 조건을 거부한다 — 읽기 해석은 버려서 명단이 넓어진다. 「현재 컨택원」·`짝수`/`홀수`·조건 줄 여러 값 포함 상세는 CONTEXT.md 「조사 대상 필터 해석」. 테스트는 `tests/helpers/resolved-contact-filter.ts` 의 `resolvedFilterForTest`.
>
> **필터 바 구조**: `features/operations/filters/filter-bar-core.tsx` 의 `FilterBarCore` 는 제어형(`rows`/`onRowsChange`, router·searchParams 를 모른다, `as:'div'` 로 다른 폼 안에, `variant:'stack'` 은 조건 줄 전부 펼침)이고, 주소 직렬화·헤더 필터 상호배타·page 초기화는 `url-filter-bar.tsx` 의 `UrlFilterBar` 가 맡는다(조사 대상·응답 내역·단체 메일 위저드). 2,000개 넘는 ID 목록 토큰 변환은 `prepareContactClauseValue`(contacts-filter-bar)로 검색바와 컨택원 수정 화면이 같이 쓴다. 진척 보고 검색바(`progress-filter-bar`)는 별개 단일 검색바다.
>
> **진척 보고 분류 키는 태그 키**다(`lib/operations/report-progress-format` 의 `ProgressGroupKey` — attrs 키는 접두 없이 그대로 직렬화해 옛 `groupBy=` 주소가 열리고, 시스템 기준은 `system:<이름>`, 어휘 `PROGRESS_SYSTEM_GROUP_KEYS`). 집계(`report-progress` 의 `groupKeySql`)는 기준마다 값·표시·정렬 식을 따로 내고, 행의 `groupValues` 는 표시 값이다. 「컨택원」 칩은 컨택원이 있을 때만 맨 끝에 **기본 꺼짐**(`defaultOff`)으로 나오고, 배정 없음은 「(배정 없음)」 한 줄이다.

> 조사 대상·단체 메일 위저드의 시스템ID/attrs 컬럼 검색은 **엑셀 열 붙여넣기 ID 목록**을 받는다 (`lib/operations/range-list.ts` — 공백·개행·탭·콤마 구분, 중복 제거). 단일 컬럼 인라인 상한 2,000개(URL 헤더 한계), 초과분은 `contacts.idLists.create` 로 `contact_id_lists` 에 저장하고 `q=list:<uuid>:<count>` 토큰으로 검색한다. 토큰은 조사 대상 필터 해석이 읽는다(`loadIdListsForValues`, `server/read-models/contact-id-lists.ts`) — 호출자가 따로 읽을 일이 없다. 「전체」 컬럼 검색의 200개 상한은 컬럼 곱연산 SQL 보호용으로 별개다.

---

## 질문 유형

| 타입          | 설명               | 주요 속성                                                                                                                                |
| ------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `text`        | 단답형 텍스트      | placeholder, defaultValueTemplate, inputType(숫자·형식 5종), emptyDefault, numberFormat, textValidation, inputRows, inputAutoGrow        |
| `textarea`    | 장문형 텍스트      | textValidation(최소 글자 수·의미 없는 입력 거부), inputRows(기본 4줄), inputAutoGrow                                                     |
| `radio`       | 단일 선택          | options, choiceGroups, allowOtherOption, optionsAlign                                                                                    |
| `checkbox`    | 복수 선택          | options, choiceGroups, allowOtherOption, minSelections, maxSelections                                                                    |
| `select`      | 드롭다운 단일 선택 | options, allowOtherOption                                                                                                                |
| `multiselect` | 드롭다운 복수 선택 | selectLevels (다단계 — 옵션 리스트는 selectLevels 내부 소유)                                                                             |
| `ranking`     | 순위형             | rankingConfig, optionsSource (manual\|table)                                                                                             |
| `table`       | 매트릭스/그리드    | tableColumns, tableRowsData, tableHeaderGrid, tableValidationRules, dynamicRowConfigs, rowRepeatConfig, stagedRowsConfig, sumConstraints |
| `notice`      | 안내문             | noticeContent, noticeBgColor, requiresAcknowledgment                                                                                     |

공통: `titleHtml`(제목 서식본 — 아래 "셀 본문 부분 강조"와 같은 규칙), `requiredMessage`(필수 미응답 문구), `hideTitle`, `pageBreakBefore`(수동 페이지 나눔), `answerQuote*`(이전 응답 인용), `displayCondition`.

- **언어 문항**: `QuestionOption.locale`(`'ko' | 'zh' | 'en'`, 어휘 `@/types/survey-locale`) — 보기 하나 이상에 언어가 붙은 radio 문항이 그 설문의 언어 문항이다. `options` JSONB 안이라 마이그레이션 없음, 발행 스냅샷에 그대로 실린다. 빌더는 질문 편집 모달의 보기마다 「언어」를 고르고 둘 이상·첫 페이지가 아님을 경고만 한다(`survey-builder/lib/language-question-diagnostics`, 배포는 막지 않음). 동작은 아래 "다국어 설문".
- **그룹별 필수**: `ChoiceGroup.required`/`requiredMessage` (JSONB) — 미설정이면 질문 레벨 `required` 상속. 질문 필수여도 특정 그룹만 해제하거나 그 반대가 가능하며, 문구는 그룹 → 질문 → 기본 순 폴백.
- **최대 선택 개수 연동**: `maxSelectionsSource`(비그룹 checkbox 전용, 0130) — 숫자형 단답 문항의 응답값이 상한이 된다(「담당 팀 수만큼만 선택」). 참조값이 `unlimitedFrom` 이상이면 제한 없음, 못 읽으면(미응답·숨은 문항·1 미만) 고정 `maxSelections` 폴백. 판정은 `features/question-renderer/utils/dynamic-selection-limit.ts` 하나이고, 응답 화면·빌더 미리보기 디스패처가 `withResolvedMaxSelections` 로 상한을 갈아 끼워 렌더러는 고정 숫자만 읽는다. 참조 문항을 나중에 줄여 초과 상태가 되면 선택을 지우지 않고 `NumericIssue.kind: 'selection-max'` 로 「다음」을 막는다(클라이언트 전용). 발행 스냅샷에 실리므로 재발행해야 응답 페이지에 반영된다.
- **단독 선택 보기**: `QuestionOption.exclusiveChoice` · `TableCell.exclusiveChoice`(choice_opt 셀) — 「없음 · 해당 없음 · 모름」류. 체크박스 그룹 안에서 이것을 고르면 나머지가 풀리고 다른 보기를 고르면 이것이 풀린다(대칭, 단독끼리도 배타). 범위는 속한 그룹(일반 체크박스 문항은 문항 전체)이고, `exclusiveScope: 'table'` 이면 그 표의 모든 그룹을 비우고 필수·완료 판정도 표의 그룹 전부를 충족으로 본다(`hasTableExclusiveSelected`). 이 보기 하나로 최소 선택 수를 충족한 것으로 본다. 규칙은 `features/question-renderer/utils/exclusive-choice.ts` 하나이고 세 표면(일반 체크박스 · 레거시 보기 소스 표 · 보기 그룹 표)이 같이 쓴다. 명시 플래그만 동작하며 라벨 추정은 없다. JSONB 라 마이그레이션 없음. 분기 규칙의 `exclusive-check` 와 다른 개념 — CONTEXT.md "단독 선택 보기".
- **필수 마스터 전파**: 질문 편집 모달의 "필수 질문" 토글 조작 시 표의 인터랙티브 셀 필수(게이팅 셀은 `requiredWhenEnabled`)와 그룹 오버라이드를 일괄 재설정한다. 상속이 아닌 조작 시점 복사 — `docs/adr/0021` · CONTEXT.md "필수 마스터 전파".
- **입력 형식**: `inputType`(단답형·표 input 셀)·`textInputType`(보기 상세기재)은 `'text' | 'number'` 에 더해 형식 5종(`mobile` · `phone` · `biz_number` · `corp_number` · `email`)을 받는다. 값 목록은 `@/types/input-type` 이 SSOT 이고 zod 두 곳(`lib/question/schema.ts`, `server/survey-builder/domain/question.ts`)이 그 상수를 쓴다. **형식과 `number` 는 배타** — 형식을 고르면 숫자 서식·초기값·계산 검증이 붙지 않는다. 판정·정규화·실패 사유는 `@/features/question-renderer/utils/input-format` 의 `parseInputFormat` 하나에서 나오고, 차단은 `NumericIssue.kind: 'format'`(클라이언트 전용)이다. 타이핑 단계에서는 번호 형식 4종이 **숫자와 하이픈만** 받는다(`filterFormatTyping`, 훅 `useInputFormatField.handleChange` — 세 표면 공용, 이메일은 제외). 정돈(자동 하이픈)은 여전히 blur 때 한 번이다. 이메일은 타이핑을 막지 않는 대신 한글·전각 글자를 검사 사유 `non_ascii`(「이메일은 영문·숫자로만 입력해 주세요」)로 blur·다음에서 막는다 — 한글 조합 중 글자를 떨어뜨리면 자판이 고장 난 것처럼 보이고 붙여넣기에서 조용히 다른 주소가 되기 때문이다. **DB 마이그레이션 없음** — `input_type` 은 enum·CHECK 없는 text 컬럼이고 셀·보기 쪽은 JSONB 안이다. 자세한 규약은 CONTEXT.md "입력 형식" · `docs/adr/0023`.
- **순위형 입력 방식** `rankingConfig.inputMode` (JSONB, 마이그레이션 없음): 미지정·`'dropdown'` 이면 **기존처럼 순위마다 드롭다운**, `'click'` 이면 보기를 눌러 순위를 매긴다 — 비어 있는 가장 낮은 순위에 들어가고 다시 누르면 해제(뒤 순위 당김), 요약 줄에 `1순위 [보기번호]` 칩 + 순위초기화, 기타·상세기재 입력칸은 그 보기 행 안에 있고 순위가 매겨져야 활성화. 순수 로직은 `features/question-renderer/utils/ranking-click.ts`, UI 조각은 `features/question-renderer/ranking-click-select.tsx`. 표 소스는 내장 표의 `ranking_opt` 셀을 `TablePreview renderCell` 로 같은 얼굴로 그리고, 그룹별 순위는 그룹마다 요약 줄·표는 하나. 응답 모양(`{rank, optionValue}[]`)은 두 방식이 같아 저장·검증·내보내기 무변경. **표 안 ranking 셀은 항상 드롭다운이고, `allowDuplicateRanks` 가 켜지면 클릭을 골라도 드롭다운**이다(클릭으로는 같은 보기를 두 순위에 둘 수 없다).
- **좌측 고정 열**: `stickyColumnCount` — 표를 그리는 문항(table + 내장 테이블을 쓰는 radio/checkbox/ranking) 공용. NULL=자동 판정(왼쪽부터 연속된 정적 셀 열까지), 0=고정 안 함, 1~3=명시 지정. 기본을 0 이 아니라 NULL 로 둔 것은 회귀 방지다 — 0 이 기본이면 지금 고정된 표가 전부 풀린다. 명시 지정도 "스크롤할 열이 남는가"(지정값 ≥ 전체 열 수면 비활성)·"뷰포트 60% 를 넘지 않는가"(최소 1열 유지) 두 가드는 통과해야 한다. 또 고정 경계는 colspan 셀 한가운데를 자르지 않는다 — 본문이 `cellIndex < stickyColCount` 로 sticky 를 걸어, 여러 열을 덮는 셀이 sticky 가 되면 스크롤 시 뒤쪽 열 위를 덮으며 따라오기 때문이다(척도 응답이 colspan 으로 전 열을 덮는 표는 지정해도 라벨 열까지만 고정된다). 판정은 `features/question-renderer/utils/table-grid-utils.ts` 의 `computeStickyLeftColumns`. 가로(헤더) 고정은 옵션이 아니라 표 길이에 따른 자동 그대로다.
- **화면 폭에 맞춰 표 줄이기**: `fitTableToWidth` — 표를 그리는 문항 공용, 기본 꺼짐(문항별 opt-in, 2026-10-29). 표 열 폭은 원래 px 고정이라 카드가 좁아져도(태블릿 세로 등) 표는 그대로 넘쳐 가로 스크롤이 된다. 켜면 모바일 모드(768px 미만)가 아닐 때 열 폭을 비율(`minmax(0, Nfr)`)로 바꿔 화면에 맞춰 줄이고 넓은 화면에서는 지정 총폭을 넘지 않는다. 켜면 좌측 고정 열은 쓰지 않는다(넘치지 않고, px 누적 오프셋이 줄어든 열과 어긋난다). 헤더·본문·가상화 본문이 같은 폭 스타일을 써야 열이 어긋나지 않으므로 grid 폭은 `table-grid-utils` 의 `resolveTableGridSizing` 하나로 낸다. 「화면 너비」(`forceWideLayout`)는 카드의 최대 폭일 뿐 표 폭과 무관하다. 태블릿 기준 폭: md 이상에서 표가 쓸 수 있는 폭 ≈ 화면 폭 − 180px(페이지 48 · 문항 카드 64 · 문항 16 · 표 카드 안쪽 48 · 테두리) — 원본 표 모드가 시작되는 768px 에서 약 588px. 숫자로 맞추기보다 이 옵션을 켜는 편이 확실하다(2026-10-29 만족도 조사에서 130px 로 잘못 잡아 680px 표가 넘쳤다).

### 테이블 질문 셀 타입

- `text`: 텍스트 표시 / `image`: 이미지 / `video`: 비디오 링크
- `checkbox` / `radio` / `select`: 선택 입력
- `input`: 텍스트 입력 (inputType `number` 시 숫자만, 형식 5종 지정 시 형식 검사, 평문 모드면 `textValidation` 응답 품질 검사 — 최소 글자 수·의미 없는 입력 거부). `inputRows`(2 이상)면 여러 줄 입력칸이고, `inputAutoGrow` 를 켜면 입력한 만큼 칸과 행이 자란다(줄 수는 최소 높이, 켠 셀만 — 기존 고정 높이 보존, 숫자·형식 칸은 한 줄 고정, `hooks/use-auto-grow-textarea`). `inputWidth`(px)를 주면 셀 폭을 채우지 않고 그 너비로 고정되며 셀 가로 정렬을 따르고 오른쪽 단위 글자가 바로 뒤에 붙는다(레거시 보기 소스 표의 input 셀도 같음. 계산 칸(calc)도 같은 필드를 빌더 계산 탭의 「값 너비」로 따른다 — 같은 열의 입력칸과 너비를 맞추면 값·단위 자리가 맞는다. 세로 카드 — 모바일 행 카드·드릴다운 카드 목록 — 만 `ignoreInputWidth` 로 무시하고, 드릴다운 안 원본 행 표·행별 원본 같은 px 격자는 적용). 셀 공통 `hideRightBorder` 는 응답 화면·미리보기에서 오른쪽 세로선을 안 그려 다음 셀과 한 칸처럼 이어 보이게 한다(빌더 편집 격자는 그대로) — 년 칸 | 월 칸 같은 "한 셀에 입력 둘" 요구는 이 둘로 푼다. 좌측 고정 열의 마지막 셀에 켜면 고정 영역과 스크롤 영역 사이 선도 사라지니 거기엔 쓰지 말 것. 격자선 클래스는 `features/question-renderer/utils/table-grid-utils.ts` 의 `getCellBorderClasses` 하나다. `piiEncrypted` 셀 플래그로 그 셀 응답값만 암호화 저장 (질문 단위 토글과 같은 규칙, 파기 스윕은 0085 — 이월 응답 파기 0095 와 합본한 본문이 0100, 사본 단계를 뺀 현행 본문은 0143)
- `ranking`: 셀 내부 랭킹 (셀별 옵션 + 순위 드롭다운 N개)
- `ranking_opt`: 이 셀이 질문 레벨 ranking 의 옵션 소스
- `choice_opt`: 이 셀이 질문 레벨 radio/checkbox 의 옵션 소스. 칸에 `optionCode`(변수번호, 예 `opt01`)를 적으면 일반 보기처럼 변수명 숫자 자리에 쓴다(`D2_1_opt01`·`D2_1_opt04_text`, 2026-10-20). 비우면 종전대로 순번 — 빌더 편집 폼에는 칸이 없다(`kept`)
- `calc`: 수식 기반 읽기 전용 계산 셀

> **중복 불가 묶음** (`cell.distinctGroup`, select 셀, 테이블 유형 전용): 같은 묶음 이름의 선택 칸끼리 같은 보기를 두 번 고를 수 없다. 화면 비활성과 검증이 `features/question-renderer/utils/distinct-select-group.ts` 하나를 쓰므로 둘이 넘기는 보이는 칸 범위(`visibleCellIds`)를 같게 유지할 것. 상세 CONTEXT.md 「중복 불가 묶음」.

> **목록에서 찾기** (`cell.lookupSearch`, input 셀, 2026-10-21 — CONTEXT.md 「목록에서 찾기」가 정본): 칸을 누르면 설문 참조표(LUT) 목록이 선택 상자처럼 펼쳐지고 글자를 치면 좁혀지며, 고르면 이 칸과 **같은 표의** 지정 입력 칸(법인·사업자번호 등)을 한 번에 채운다. 목록 밖 값도 직접 적을 수 있고 저장되는 것은 글자뿐이라 저장·검증·내보내기 무변경, 마이그레이션 없음. 판정 `features/question-renderer/utils/lookup-search`(검색 정규화·채울 값 — 대상 칸 형식으로 정돈, 가려진 칸·잠긴 prefill 칸 제외), 여러 칸 쓰기는 `useCellResponse` 의 `patchValues` → `InputCell` 의 `onPatchValues`, 표 셀 정의는 `useGatingTableCells`, 참조표는 `useSurveyLookups`(빌더 편집 목록도 이제 공급한다). 빌더 설정은 `table-editor/cell-editor/lookup-search-fields`(채울 칸 이름은 `utils/lookup-fill-targets` — 같은 행 앞 글자 칸 첫 줄). 셀 필드 정책은 폼 소유·보관함 제외, 복제·행 반복의 칸 id 이동은 `remapCellRefs`. 평문 한 줄 칸·테이블 유형 문항 전용.

> **상세 기재 입력칸을 표 아래에** (`cell.optionTextBelowTable`, 테이블 유형 전용): 격자 표(`OptionTextBelowTableHost` 가 감싼 곳)에서만 옮기고 호스트 없는 모바일 카드는 종전대로 칸 안이다 — 칸 옵션만 보고 접으면 입력칸이 어디에도 없게 된다. 판정 `features/question-renderer/utils/option-text-below-table.ts`, 상세 CONTEXT.md 「표 아래 상세 기재」.

> **이미지 크게 보기**: 설정 없는 기본 기능(표 이미지 · 순위형 보기 이미지 · 안내문·설명 본문 이미지). 표 이미지는 `TableImageEnlargeProvider` 안에서만 켜진다(빌더 편집 표는 밖). 창은 휴대폰 뒤로 가기로 닫히도록 방문 기록 칸을 하나 쌓는다 — 페이지 위에 칸을 쌓는 기능을 새로 만들면 지금 칸(`stepIndex` 포함)을 이어 쌓는 같은 방식을 따를 것. 상세 CONTEXT.md 「이미지 크게 보기」.

> **셀 본문 부분 강조** (`cell.contentHtml`, 2026-09-10): 셀 편집 모달의 "셀 텍스트 내용"은 굵게·글자색·변수 삽입만 있는 축소 편집기(`components/ui/rich-text-editor/inline-rich-text-editor.tsx`, 스키마는 `inline-cell-extensions.ts`)다. **정본은 여전히 평문 `content`** 이고, 글자 일부에 색·굵게가 있을 때만 `contentHtml` 을 곁에 둔다(`serialize-cell.ts` 가 마크 유무로 판정, 마이그레이션 없음). 내보내기·SPSS 라벨·보기 라벨 파생·행 높이 측정·행 라벨 비교는 전부 평문을 보므로 무변경이고, 화면 표시만 `CellText`(`features/question-renderer/cell-text.tsx`) 가 서식본을 우선한다 — 토큰 치환은 `resolveCellTextHtml`, sanitize 는 `sanitizeCellHtml`(문단·줄바꿈·strong·span color 만). 셀 본문을 새로 그리는 자리를 만들면 평문을 직접 흘리지 말고 `CellText` 에 `html` 까지 넘길 것. 문단 = 평문의 한 줄이라 "첫 줄만 굵게"는 첫 문단에 걸린다.

> **응답 칸 없는 표는 모바일에서 원본 표** (2026-10-28): 글자·이미지·영상 셀뿐인 표(전시회 정보 같은 안내 표)는 고른 표시 방식이 아무것도 그리지 못할 때만 원본 표로 그린다(`interactive-table-response` 의 `displayOnlyTableNeedsOriginal`). 축 카드·행별 원본/척도·선택 행 원본 보기는 늘 원본 표로 가고, 「자동」·「행 단위 카드」·「행 단위 그룹 카드」는 「바로 표시」·「접기」를 지정한 글자 셀이 있으면, 「항목 단위 카드」는 표시 전용 카드가 하나라도 서면 저작자가 고른 카드 그대로다. 전에는 제목만 남고 표가 사라졌다. 같은 날 「항목 단위 카드」에 **표시 전용 카드**를 더했다 — 라벨 뒤에 「바로 표시」·「접기」 글자만 오고 입력 칸 없이 다음 라벨·행 끝이 오면 그 라벨을 제목으로 한 카드를 세운다(값 칸을 「바로 표시」로 둔 「라벨 | 값 | 라벨 | 값」 안내 표, 응답자 정보의 업체명). 세로 병합된 구분 라벨 뒤는 하위 항목이라 닫지 않는다. 전에는 그 글자가 다음 카드 설명으로 붙거나 행 끝에서 버려졌다 — 운영의 항목 카드 25개(빌더·배포 스냅샷)는 바뀐 카드가 없음을 대조했다.

> **드릴다운이 읽는 「모바일 카드 표시」**: 입력 드릴다운은 셀의 `mobileDisplay` 로 들여쓰기 표시 셀·묶음 머리·설명 셀·요약 블록을 가른다(`classifyTable` 의 `readMobileDisplay`). 쪼갠 섹션은 목차 열 출처 셀을 공유하므로 `section.identity` 로 찾을 것(`labelSourceCellId` 로 찾으면 충돌). 상세 CONTEXT.md 「들여쓰기 표시 셀」·「묶음 머리」·「설명 셀」.

> 테이블-소스 choice 응답값은 `cell.id` 임. value-match displayCondition에 코드("3" 등)를 넣으면 영구 미스매치. `resolveChoiceOptions` 사용.

### 테이블 검증 규칙

- 분기형(`tableValidationRules`): `exclusive-check` 배타적 선택 / `required-combination` 필수 조합 / `any-of` 최소 하나 / `all-of` 모두 선택 / `none-of` 선택 불가
- 합계형(`sumConstraints`): 좌변(선택 셀 합계 또는 `leftExpr` 수식) `eq|ne|gte|lte|gt|lt` 우변(리터럴 또는 `targetExpr` 수식), `tolerance`는 eq/ne 전용 절대 오차. `aggregate: 'count'` 면 좌변이 **입력된 칸 수**다 — 인터랙티브 셀 전부가 대상이고, 합계와 달리 전부 비었거나 표를 건드리지 않아도 검사한다("10행 중 하나 이상 입력" — CONTEXT.md "입력된 칸 수")
- 검증 문구 자리표시자: 저작자 문구(합계 제약 `errorMessage` · 셀 수식 검증 `formulaErrorMessage` · 계산 칸 `calcValidation.errorMessage`)에 `{현재값}`·`{기준값}` 을 쓰면 검증에 쓴 실제 숫자로 바뀐다(`fillMessageValues`, numeric-validation). 쓰지 않으면 값은 드러나지 않는다 — 기준값 미노출은 기본 문구와 자리표시자 없는 문구에서 그대로다
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
GET    /api/surveys/[surveyId]/export          # SPSS(.sav)/엑셀 export (인증 필요, 파일 스트림). raw/raw-split 은 `includeNonRespondents=1` 로 미응답 조사 대상 행 포함 (sav/sps 는 무시). `includePriorAnswers=1` 은 이번 회차에 키가 없는 문항을 이월 응답으로 채운다 — 숨은 문항 strip 뒤에 병합하고 조건 판정은 하지 않되, 「이월값 불러오기」를 끈 문항(`priorAnswerDisabled`)은 현재 빌더 설정 기준으로 비워 둔다. 조사 대상 명단 열은 파라미터 없이 응답 내역 컬럼 설정(`profileColumns`)의 표시 attrs·pii 열을 항상 붙인다 (pii 열이 있으면 PII 평문 → no-store) — Raw 행 조립은 라우트 폴더 로컬 raw-export-load.ts (contacts·operations 를 함께 읽어 한 도메인에 못 둔다. 순수 조각은 lib/analytics/raw-export-rows.ts — 이름이 같아 헷갈리던 것을 로더 쪽 개명으로 갈랐다)
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

- 차원 × 카테고리 조합 셀에 목표치를 둔다. 셀은 sparse — 목표가 있는 조합만. 차원 유형은 넷(`QUOTA_DIMENSION_KINDS`): 문항 바인딩 `choice`(보기값)·`numeric`(구간)·`text`(키워드 포함), 그리고 명단 attrs 열 바인딩 `attr`(값 완전 일치, `questionId` 는 빈 문자열). JSONB 라 마이그레이션 없음.
- **분류 입력은 응답값이 아니라 판정 대상 `QuotaSubject`(응답값 + 조사 대상 attrs)다.** attrs 는 서버가 응답 행의 `contactTargetId` 로 읽은 값만 싣는다 — 클라이언트 입력 금지. 모수 로더 `loadCompletedQuotaSubjects` 는 `needsContactAttrs(config)` 일 때만 조사 대상을 한 번 더 읽는다. 집행·완료 시점 초과 감지·현황판 셋이 같은 `deriveCategoryIds` 를 쓴다.
- **텍스트형**: 표 문항이면 `cellIds` 의 input 칸들, 단답형이면 응답 문자열 하나를 본다. 칸별로 공백 제거·소문자화 후 키워드 포함(카테고리 안 OR, 칸은 이어 붙이지 않는다). `isElse` 카테고리(「그 외」)는 놓인 자리와 무관하게 키워드가 전부 빗나간 뒤에만 받고, 대상 칸이 전부 비면 미분류다. 오탈자는 「그 외」로 들어가 미분류 수로는 안 보인다.
- **미분류**(차원 하나라도 카테고리 없음)는 쿼터에 걸리지 않고 통과한다. 속성형에서는 익명 응답이 항상 미분류라 `requireInviteToken` 을 켜는 것이 관례다(편집 화면이 경고, 코드 강제 없음). 현황판 요약 `unclassified` 가 그 수를 보인다.
- **쿼터 게이트**(`lib/quota/quota-gate-build.ts` → `Survey.quotaGate`): 속성형은 게이트 문항을 만들지 않는다. 텍스트형 표 문항은 `cellIdsByQuestion` 의 대상 칸에 값이 있어야 "답변됨"이다 — 표 응답은 다른 칸만 채워도 객체가 생겨, 객체 존재로 판정하면 응답당 1회뿐인 확인이 주소를 적기 전에 소진된다. 문항 기반 차원이 없는 플랜은 `checkWithoutQuestions` 로 첫 전환에서 확인한다.
- `enabled=false`면 정의·집계만 하고 응답자를 차단하지 않는다. 마감 차단 시 응답 status는 `quotaful_out`.
- **쿼터마감 다시 열기** (2026-10-22, CONTEXT.md 「쿼터마감 다시 열기」): `quotaful_out` 응답자가 같은 링크로 다시 들어오면 그 응답의 셀에 지금 자리가 있을 때(목표 증가·쿼터 끔·셀 소멸) 마감을 풀고 남긴 답으로 이어 간다 — `quotaful_out → drop → in_progress`, 답 보존, `metadata.quotaReopenedAt` 표식. 판정은 입장 판정과 같은 사슬(`read-models/quota-cell`)이고 `server/survey-response/services/quota-reopen.ts` 의 `reopenQuotaClosedResponse` 하나를 재개(`resumeOrCreateResponse` — 설문이 응답을 받는 중일 때만)와 첫 답 저장(`settleReuseCandidate`)이 부른다. 자리를 예약하지 않으므로 초과는 페이지 재확인·제출 하드 차단이 막는다. 테스트 응답 제외. 마이그레이션 없음. 실DB 테스트 `tests/integration/quota-closed-reopen.realdb.test.ts`.
- **publish 없이 즉시 반영되는 라이브 컬럼** (`isPaused`/`pausedMessage`와 동일 취급).
- 실시간 달성률은 완료 응답 기준 — `docs/adr/0002-quota-realtime-from-completed-answers.md`.
- **「진행 중 마감」** (`midSurveyClose`, 기본 꺼짐 — ADR 0025, CONTEXT.md 「진행 중 마감」): 셀 완료 수가 목표를 넘으면 안 되는 조사(완료자 전원 사례 지급)용. 켜면 두 가지가 바뀐다.
  - **제출 시점 하드 차단(유일한 강제 지점)** — `completeResponse` 가 트랜잭션 첫 문장으로 셀 advisory lock 을 잡고(응답 행 잠금보다 **먼저** — 교착 방지) 잠금 아래에서 셀 완료 수를 다시 센다. 목표 이상이면 답은 저장하되 `quotaful_out`, 결과 `{ kind: 'quota_closed' }`. 빈 complete 도 판정한다. 잠금 사이 셀이 바뀌는 경합·fail-closed 는 CONTEXT.md 「진행 중 마감」, 경합 테스트는 `complete-response-quota-hard-close.realdb.test.ts`.
  - **페이지마다 백그라운드 재확인** — 게이트에 `recheckOnEachStep` 이 실리고(집행 중 + 옵션 켜짐, `buildQuotaGate`), 응답 화면은 첫 판정(기다림) 이후의 모든 「다음」에서 `quota.check` 를 기다리지 않고 발사한다. blocked 면 마감 화면으로 갈아 끼우고, 실패·429 는 통과, 마지막 「제출」에서는 보내지 않는다(제출이 판정을 받는다). 제출 뒤 도착한 늦은 결과는 버린다. `checkQuota` 는 그래서 **재호출 멱등**이다 — `quotaful_out` 이면 모수를 세지 않고 blocked, 그 밖의 종결 상태면 아무것도 안 한다. 알림 속도를 위한 것이라 빠져도 불변식은 깨지지 않는다.
  - **문구 구분**: 입장 판정에서 막힘 = `closedMessage`, 입장 뒤 막힘 = `midSurveyClosedMessage`(비면 `closedMessage`, 둘 다 비면 사과 톤 상수 `QUOTA_MID_SURVEY_CLOSED_FALLBACK`). 폴백 사슬·상수·본문 헬퍼 `midSurveyClosedBody` 는 `lib/quota/closed-message.ts` 한 곳이고 응답 화면·편집 화면 미리보기가 같이 쓴다(기존 `QUOTA_CLOSED_FALLBACK` 의 값 복제 관례와 다르다 — 이번엔 양쪽이 이미 그 lib 을 import 한다). `quota.check` 결과는 둘 다 싣되 어느 단계인지는 클라이언트가 안다.
  - **면제**: 운영자가 만드는 완료 — 관리자 응답 수정의 이탈→완료(`saveAdminEdit`)와 재응답 허용으로 되돌려진 응답(`metadata.reeditPendingSince`)의 재제출 — 는 차단하지 않고(`checkQuota` 의 입장·재확인 판정도 같은 표식으로 면제 — 없으면 되돌린 응답이 첫 「다음」에서 곧장 쿼터마감으로 떨어진다) 기존 초과 표식 `metadata.quotaOverflow` 만 남긴다(재응답 표식은 재제출 뒤에도 남지만 완료 행은 재응답 허용으로만 다시 열린다). 미분류·목표 없는 셀·테스트 응답은 종전대로 통과.
  - **꺼진 설문의 제출 경로는 종전과 같다** — 잠금 없음, 동시 제출 초과는 표식만(2026-08-11 정책). 자리 예약(진행중 응답을 셀 인원으로 세기)·일시 만원 화면은 검토 후 미채택이라 구현에 없다.
  - 부하 메모: 재확인마다 완료 응답 전체를 읽어 센다. 완료 수천 건 설문에서 켜면 부하가 되니 그때 셀 카운트 질의로 바꾼다. 레이트리밋 `quota-check` 는 응답당 30·IP 당 300/분 그대로다 — 호출이 응답당 1회에서 페이지마다로 늘었으니 대형 공용 IP(콜센터급)에서 켜면 429 fail-open 이 늘 수 있다(불변식은 제출 판정이 지킨다).

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

## 다국어 설문

같은 링크 하나로 한국어·中文·English 조사표를 받고, 언어판끼리 같은 변수명으로 한 데이터 파일에 합친다(2026-10-27, ADR 0034 · PRD `.scratch/multilingual-survey/PRD.md` · CONTEXT.md 「다국어 설문」). **다국어 아닌 설문은 화면 글자·변수명·내보내기 열이 한 글자도 바뀌지 않는다** — 그것이 반목표 1번이고, 모든 `locale` 인자의 기본값이 `'ko'` 인 이유다. 관리자 화면(빌더·콘솔·관리자 응답 수정)은 다국어화하지 않는다.

- **언어 문항 · 언어 묶음**: 언어 문항은 보기에 `locale` 이 붙은 radio(위 "질문 유형"), 설문당 하나 — 둘 이상이면 응답 화면 순서(`buildRenderSteps`, 그룹 순서 먼저)로 맨 앞 것만 쓴다. 언어 묶음은 켜진 표시 조건이 「언어 문항 value-match」 하나뿐인 그룹(NOT 으로 뒤집힌 것·두 언어를 함께 받는 것·조건이 섞인 것은 아님)이고 하위 그룹은 가장 가까운 묶음 조상의 언어를 물려받는다. 판정은 전부 `src/utils/survey-language.ts` 한 곳이다.
- **현재 언어**: 언어 문항의 지금 답이 가리키는 보기의 `locale` — 저장하지 않고 답에서 파생한다(`resolveCurrentLocale`). 다국어 아닌 설문은 늘 `'ko'`, 다국어 설문인데 아직 안 골랐으면 **미정**(`null`). 응답 화면이 `SurveyLocaleProvider`(`features/question-renderer/survey-locale-context`)로 내려 주고 감싸는 요소에 `lang` 을 단다. 렌더러는 `useSurveyLocale()`(미정 `null`) 또는 `useInlineSurveyLocale()`(미정이면 한국어)로 읽는다.
- **언어 페이지 자동 넘김**: 보이는 문항이 언어 문항 하나뿐인 페이지(`isLanguageOnlyPage` — 조건으로 숨은 문항은 세지 않는다)는 「다음」·진행 밴드를 그리지 않고 보기를 누르면 넘어간다. 모바일 하단 내비도 없고, 「언어 변경」으로 와서 돌아갈 곳이 있을 때만 「이전」 하나(`MobileBottomNav` 의 `previousOnly`)를 둔다(데스크톱 「이전」과 같은 규칙). 누른 이벤트 안에서 넘기면 답이 아직 없어 필수에 막히므로, 요청만 state 로 남기고 커밋 뒤 effect 가 「다음」과 같은 경로(`runNext`)로 넘긴다(한 렌더 안 연타는 한 번). 쿼터 첫 판정을 기다리는 사이 다른 보기를 누르면 기다리던 넘김은 낡은 답으로 계산된 것이라 버리고 쿼터 판정부터 지금 답으로 다시 한다(`LanguageAdvance.isSuperseded`). 이미 고른 보기를 다시 누를 때 radio 가 보내는 `null` 은 언어 페이지에서만 무시하고 넘긴다. 이 판정·요청·「언어 변경」은 `features/survey-response/hooks/use-language-page.ts` 한 곳이다. **관리자 응답 수정은 끈다** — 언어 페이지도 보통 페이지(한국어 「다음」)이고 「언어 변경」이 없으며 시스템 글자는 한국어다(내용 `lang`·언어별 제목은 응답자가 고른 언어).
- **언어 변경**: 진행률 줄 왼쪽 「언어 변경 · 语言 · Language」 — 지금 페이지를 `stepHistory` 에 쌓고 언어 페이지로 간다(「이전」·뒤로 가기로 돌아온다). 다른 언어를 고르면 이전 언어 묶음이 숨으며 **기존 숨은 문항 규칙대로 답이 지워진다**(주의사항 14 — 별도 장치 없음, 답을 옮기지 않는다). 같은 언어(같은 보기)를 다시 고르면 떠났던 페이지로 돌아간다(그 페이지의 방문 기록 칸을 걷는다). 다른 언어를 고르면 방문 기록을 처음 언어 페이지에 닿기 전까지로 잘라 「이전」이 숨은 이전 언어판 페이지로 가지 않는다.
- **언어별 설문 글자**: 제목·설명·완료 문구·자격미달 문구 넷만 `surveys.localized_messages`(0145)에 언어별로 둔다. 한국어는 기존 칸이고 빈 칸은 한국어로 폴백한다. 일시중지·쿼터 마감 문구는 라이브 설정이라 한국어 한 벌이고 비웠을 때의 기본 문구만 번역된다. 운영 콘솔의 중단 다이얼로그는 한국어 기본 중단 문구를 미리 채워 저장하므로, 응답 화면은 저장된 중단 문구가 그 기본 문구와 같으면 비운 것으로 보고 현재 언어의 기본 문구를 그린다(`already-responded-view`). 빌더 입력칸(`survey-builder/localized-text-fields`)은 **언어 문항이 있을 때만** 나온다(한국어 설명 칸이 원래 없어 언어별 설명 칸도 없다 — 조립 스크립트가 넣는다). 고르기는 `survey-response/lib/localized-survey-texts`(`pickLocalizedText`·`resolveHeaderTitle`·`resolveHeaderDescriptions`) — 미정이면 등록된 언어의 제목·설명을 한 줄(문단)씩 쌓는다(한국어 `title` 칸에 세 언어를 적지 말 것 — 관리자 목록·메일 변수가 그 칸을 쓴다). 읽기 방향은 0110 `screenedOutMessage` 와 같은 경로(스키마 · `SurveySettings` · 설정 저장 · `snapshot-builder` · `read-models/survey-structure` 의 `getSurveyWithDetails` · `use-survey-loader`)이고 tsc 가 못 잡는다.
- **시스템 글자 사전**: 응답 화면 시스템 글자는 `src/utils/system-strings.ts`(`systemText(key, locale = 'ko', values?)`)에서 나오고 저작자 문구는 번역하지 않는다. 한 줄 글자는 미정이면 한국어(`toInlineLocale`)이고, 세 언어 쌓기(`SystemText`)는 언어가 정해지기 전 전체 화면 안내에만 쓴다. 화면 분기에 한국어 글자를 쓰지 않는다. 상세 CONTEXT.md 「시스템 글자」.
- **가드 테스트** `tests/repo/respondent-korean-literals.test.ts`: typescript 문법 트리로 응답 화면 두 묶음(question-renderer·survey-response)의 한글 리터럴(문자열·템플릿·JSX 글자, 주석·`console.*`·`logger.*`·`new Error` 인자 제외)을 모아, 사유 넷(저작 미완성 표시 · 표식/비교 값 · 관리자 전용 · 설문을 읽기 전)의 목록과 **양방향** 대조한다. 템플릿은 조각이 아니라 끼운 자리를 `${}` 로 적은 한 문장(`값 열 ${}개를 행마다 채움`)으로 비교한다 — 한 글자 조각을 목록에 두면 같은 파일의 새 문장이 그 조각을 빌려 빠져나간다. 응답 화면에 한국어를 새로 넣으면 사전으로 옮기거나 사유와 함께 목록에 적어야 통과한다.
- **공유 변수명 열 합치기**: 서로 다른 언어 묶음의 직접 지정(`isCustomSpssVarName`) 같은 변수명을 `generateSPSSColumns` 의 `languageSetLocales` 로 한 열로 접는다 — Raw·분할·.sav·.sps·배포 게이트 모든 소비자가 같은 옵션을 넘겨야 열이 갈리지 않는다. 대표는 한국어 구성원이고 값 라벨·.sav 변수 유형도 대표 것이라 언어판끼리 칸 유형을 맞출 것. 남은 언어판 열의 자리 규칙 포함 상세는 CONTEXT.md 「공유 변수명」.
- **중국어 줄바꿈**: 전역 `body { word-break: keep-all }`(한국어 어절 보존)은 띄어쓰기 없는 중국어 문장 전체를 한 덩어리로 만들어 화면 폭을 넘긴다 — 모바일 「下一步」 버튼이 밀려 사라졌다(2026-10-29). `globals.css` 가 `[lang|="zh"]` 과 그 안의 `.break-keep` 을 `word-break: normal` 로 되돌린다. 언어 문항을 고르기 전(세 언어가 함께 보이는 화면)은 한국어 규칙 그대로다. 새 화면에 `break-keep`·`keep-all` 을 쓸 때 중국어판에서 풀리는지 볼 것.
- **금액 읽기**: 숫자 칸 입력란 아래 읽기(`numberFormat.unit`·`unitSuffix`)는 현재 언어를 따른다 — `utils/number-format` 의 `formatUnitReading(raw, unit, suffix, locale)`(훅 `use-formatted-numeric-input` 이 부른다). 한국어는 기존 `formatKoreanUnitReading` 그대로(「1,500만원」), 中文은 万·亿 로 끊고 묶음 안은 숫자 그대로(「111万1111元」), English 는 백만 이상을 million·billion·trillion 소수 둘째 자리까지(「1.11 million USD」, 어절 앞 띄움). 만(영어는 백만) 미만은 콤마 숫자 + 어절. 중·영판 금액 칸은 `unit: 'one'` + 통화 어절을 준다.
- **Raw 양식 이월 임포트**: 서로 다른 문항이 같은 변수명(대소문자 무시)을 쓰면 되읽지 않고 `unsupportedVarNames`(규칙 종류면 `skippedByRuleVarNames`)로 보고한다(`lib/contacts/raw-format-import`) — 모호한 값은 붙이지 않는다는 기존 원칙.
- **열린 위험(조립 담당)**: 휴대전화·전화 형식 검사는 한국 번호 규칙이라 중·영판 자국 번호를 막는다 · 응답 머리 문구 블록(「통계법 제33조」 제목·상자 본문·한 줄 문구)도 번역되지만 해외 응답자에게 맞는지는 담당자 판단 — 빌더가 기본 문구를 칸에 채워 저장하므로 칸 글자가 한국어 기본 문구와 같으면 현재 언어의 기본 문구로 바꾼다(`lib/survey/response-header-config` 의 `localizeDefaultNoticeTexts`, 고친 문구는 그대로). 로고·문구 블록은 첫 페이지에만 나오는데, 첫 페이지가 언어 페이지면 언어를 고른 다음 페이지에 나온다(2026-10-28). 이 설문 조립은 별도 스펙 `.scratch/akei-expo-2026/PRD.md`.

---

## 테스트 모드

두 겹이다(2026-10-16). **설문의 테스트 환경**(`surveys.testModeEnabled` + `testToken`)은 모두에게 같고 테스트 링크·테스트 대상자 링크가 사는지만 정한다(응답자 쪽 판정은 그대로 이 플래그). **콘솔이 테스트 파티션을 보는지는 브라우저마다** 쿠키 `ops-test-view-<surveyId>`(`lib/operations/test-view-cookie.ts`)로 정한다 — 전에는 한 사람이 켜면 모든 사람의 콘솔이 테스트 데이터로 바뀌었다. 파티션 키는 `is_test` 컬럼(`contact_targets`, `survey_responses`, `mail_campaigns`)이며, `contact_targets`의 resid UNIQUE도 `(surveyId, isTest, resid)`다.

- 읽기/쓰기 파티션은 `server/data-scope.ts`가 단일 결정한다 — `resolveWriteScopeIsTest(전역 플래그, 게스트, 브라우저 쿠키)` 가 **전역 ON ∧ 쿠키 ON ∧ 비게스트**일 때만 test 다. 읽기 `loadOperationsDataScope`·쓰기 `lockWriteScope` 둘 다 쿠키를 `readBrowserTestView` 로 읽는다(요청 밖이면 false). 신규 집계·목록 쿼리는 이 스코프를 반드시 태울 것. **`testModeEnabled` 를 직접 읽어 콘솔 파티션을 정하지 말 것** — 실데이터 업로드 가드(`contact-uploads`)도 그래서 이 함수를 쓴다.
- 토글(`features/operations/test-mode-control.tsx`, 시안 `pencil/테스트모드_드롭다운_시안.pen`): 버튼 자체는 아무 동작이 없고 호버·클릭으로 메뉴 넷을 연다 — 「테스트 모드」 스위치(설문 단위, 끌 때 보관/삭제 확인 창) · 테스트 링크 복사 · 「테스트 데이터 보기」 스위치(브라우저 단위 쿠키) · 테스트 조사 대상자 생성. 테스트 모드가 꺼져 있으면 아래 셋은 막힌다. **테스트 모드를 켜도 보기는 자동으로 켜지지 않는다**(따로 켠다). 대상자 생성은 테스트 파티션에 쓰므로 실데이터를 보는 채로 누르면 보기를 함께 켠다. 버튼 모양: 꺼짐=회색 · 켜짐=주황 테두리+ON · 이 브라우저가 테스트 데이터를 보는 중=꽉 찬 주황 「테스트 데이터 보는 중」. 테스트 모드가 꺼졌는데 쿠키가 남으면 콘솔이 지운다(다시 켜질 때 묻지 않고 테스트 보기로 돌아가지 않게).
- 게스트는 항상 real 파티션(읽기/쓰기 모두) — read/write 비대칭을 막기 위한 의도적 처리.
- 테스트 응답 회차는 `test_response_attempts`가 추적(활성 회차는 responseId당 1개).
- **테스트 버전**(0141): 테스트 링크·테스트 대상자·관리자 미리보기는 배포본이 아니라 저장본 스냅샷을 본다 — `server/workflows/test-version.ts` 의 `ensureTestVersion` 이 테스트 화면 진입과 테스트 응답 저장마다 리비전을 비교해 `status='test'` 버전을 새로 만든다. 테스트 응답이 보는 버전은 `pinnedVersionId`(`testVersionId ?? currentVersionId`)다 — 응답이 볼 버전을 고르는 자리를 새로 만들면 이것을 쓸 것. 배포 번호·버전 목록·보존 정리는 테스트 버전을 뺀다. 상세 CONTEXT.md 「테스트 버전」.

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
pnpm db:size          # 실 DB 테이블·인덱스 크기와 인덱스 사용 횟수 (읽기 전용 — 대량 작업 뒤·배포 전에 보고, 부풀었으면 손으로 REINDEX CONCURRENTLY)
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

> `scripts/` 바로 아래는 공유(추적)하는 스크립트, `scripts/private/` 는 공유하지 않는 일회성 스크립트(gitignore)다 — `package.json` 명령·CI·문서가 부르는 스크립트는 `scripts/` 바로 아래에 둘 것. `survey:backup` 이 부르는 `scripts/private/backup-survey.ts` 는 이미 없는 `src/data` 를 import 해 지금 동작하지 않는다.
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

## 기능 개발 체크리스트

모든 기능 개발·수정은 **스펙(PRD) 단계**와 **적대적 리뷰 단계** 두 번 이 절을 거친다. 축은 셋이다 — 백엔드(2-1) · 프론트엔드(2-2) · 개인정보·컴플라이언스(2-3). 2026-10-19 컨택원 배정에서 테스트·리뷰가 통과한 뒤에야 동시성·일관성 문제가 질문으로 드러났다 — 스펙에 적히지 않은 성질은 TDD 가 테스트를 만들지 않고, 리뷰도 눈에 띄는 버그에서 멈춘다. (2026-10-29 이전 이름은 「쓰기 변경 체크리스트」 — 백엔드 표가 그것이다.)

### 1. 변경 종류를 먼저 정한다

| 변경 종류                     | 예                                | 볼 항목                                                       |
| ----------------------------- | --------------------------------- | ------------------------------------------------------------- |
| 읽기만 하는 화면·문구         | 라벨, 정렬, 표시 방식             | 인가 · 기밀성                                                 |
| 한 행을 쓰는 작업             | 상세에서 한 명 바꾸기             | + 정확성 · 멱등성 · 중복 방지 · 원자성                        |
| 여러 행을 한꺼번에 쓰는 작업  | 교체 적용, 명단 업로드, 일괄 배정 | 아래 항목 전부 — 특히 동시성 · 데드락 · 경쟁 상태 · 격리 수준 |
| 외부 서비스·비동기 작업       | 메일 발송, Inngest, webhook       | + 가용성 · 재시도 · 최종 일관성 · 장애 복구 · 로그            |
| 화면을 바꾸는 작업            | 응답 화면 표시 방식, 빌더 모달    | 2-2 전부 — 응답 화면이면 반응형·다국어·접근성을 특히          |
| 개인정보를 받거나 다루는 작업 | 새 입력 칸, 명단 열, 내보내기 열  | 2-3 전부 + 2-1 기밀성 · 인가                                  |

세 축은 겹친다 — 저장하는 화면이면 2-1·2-2 를 함께, 개인정보 칸을 그리는 화면이면 셋 다 본다.

### 2. 항목마다 답을 적는다

답은 셋 중 하나다 — **지킨다(어떻게)** / **해당 없음(이유)** / **일부러 안 지킨다(이유)**. 이유 없는 "해당 없음"은 답이 아니다. 추상적으로 다시 생각하지 말고 **이 레포에 이미 있는 장치를 썼는가**로 확인한다.

#### 2-1. 백엔드

| 항목                 | 질문                                                                                                                        | 이 레포에서 확인할 것                                                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 정확성               | 경계값·빈 조건·자기가 바꾸는 값을 조건으로 다시 읽는 경우에도 맞는가? 해석 못 한 입력을 조용히 버려 범위가 넓어지지 않는가? | 쓰기 경로는 해석 실패를 거부한다(컨택원 교체 적용·단체 메일 `fetchCandidateIds` 선례). 조건 판정은 `COALESCE(…, FALSE)`                 |
| 멱등성 · 재시도      | 같은 요청이 두 번 오거나 실패 후 재시도해도 결과가 같은가?                                                                  | "결과 상태를 정하는" 쓰기인가. 교착·직렬화 실패는 `retryOnTxConflict`(lib/pg-error)                                                     |
| 중복 방지            | 중복 행이 생길 수 있는가?                                                                                                   | DB 유일 제약 + `isUniqueViolation`(drizzle 이 감싼 `cause` 까지 본다). 앱 쪽 존재 확인만으로 막지 않는다                                |
| 동시성 · 경쟁 상태   | 같은 대상을 두 사람이 동시에? 다른 대상끼리 겹치면? 누가 이기는가?                                                          | 쓰기 파티션은 `lockWriteScope`, 같은 묶음 직렬화는 행 `FOR UPDATE`, 셀·키 단위 직렬화는 `pg_advisory_xact_lock`(쿼터 진행 중 마감 선례) |
| 데드락               | 여러 행을 다른 순서로 잠그는 작업끼리 엇갈리는가?                                                                           | 잠금 순서 통일 또는 한 줄 세우기, 최소한 `retryOnTxConflict`                                                                            |
| 격리 수준 · 트랜잭션 | 읽고 나서 쓰는 사이 데이터가 바뀌면? 두 문장이 서로의 결과를 다시 읽는가?                                                   | 기본은 READ COMMITTED 다. 판정과 쓰기를 한 문장으로 묶거나(교체 적용 단일 UPDATE 선례) 행을 잠근다                                      |
| 원자성 · 복원력      | 중간에 실패하면 반쯤 바뀐 상태가 남는가? 실패 뒤 스스로 원래 상태로 돌아오는가?                                             | 한 `db.transaction` 안인가. 트랜잭션 밖 부수 효과(메일·R2·큐 발행)는 커밋 뒤에, 유실 시 복구 경로(sweeper·유예 큐)가 있는가             |
| 무결성               | 지켜야 할 규칙을 DB 가 막는가, 코드만 막는가?                                                                               | FK · CHECK · UNIQUE 로 막을 수 있으면 마이그레이션에 넣는다. 코드로만 막으면 그 사실과 쓰기 경로 목록을 스펙에 적는다                   |
| 일관성 · 최종 일관성 | 화면 숫자·미리보기·실제 결과가 같은 기준·같은 시점인가? 비동기면 언제 맞춰지는가?                                           | 표시·필터·정렬이 같은 SQL 식을 공유하는가(`matchedResponseSubquery` 등). 비동기는 reconcile·sweeper 가 있는가                           |
| 인증 · 인가          | 권한 없는 사용자·게스트·다른 설문 사용자가 들어오면?                                                                        | `authed`/`scoped` 베이스 + `assertSurveyAccess`, 게스트 경로는 `guestPathRedirect`, RSC 는 `isGuestViewer`                              |
| 기밀성               | 개인정보 평문이 화면·RSC props·로그·내보내기로 나가는가?                                                                    | 목록·패널은 마스킹 힌트만, 로그는 `redact` 경로, 평문을 내보내면 no-store                                                               |
| 가용성               | 외부 API·DB 가 느리거나 죽으면? 실패하면 사용자에게 뭐가 보이는가?                                                          | 레이트리밋 fail 방향(`withRateLimit`), 타임아웃, 재시도·안내 문구                                                                       |
| 확장성               | 트래픽·데이터가 10배면?                                                                                                     | 인덱스, 페이지 상한, 한 요청이 도는 행 수, URL·바인드 파라미터 한계                                                                     |
| 관측성               | 문제가 나면 로그로 원인을 찾을 수 있는가?                                                                                   | RPC 는 `rpcLoggingMiddleware` 가 1줄 남긴다. 재시도·충돌·조용한 폴백은 따로 경고 로그                                                   |

#### 2-2. 프론트엔드

| 항목          | 질문                                                                           | 이 레포에서 확인할 것                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 상태 일관성   | 같은 값을 두 곳이 들고 있는가? 저장 뒤 화면이 서버와 같은가?                   | 서버 상태는 TanStack Query, 클라이언트 상태는 Zustand 하나. 질문 편집 모달의 formData ↔ store 이중 상태가 반복 손실 사고를 냈다. mutation 뒤 `router.refresh()`·무효화 |
| 사용성        | 기존 사용자의 화면이 말없이 바뀌는가?                                          | 응답 화면의 새 동작은 문항 설정 opt-in, 기본값은 기존 동작(9/10 순위형 클릭 UI 되돌림 선례)                                                                            |
| 접근성        | 키보드만으로 쓸 수 있는가? 스크린리더가 라벨을 읽는가?                         | 버튼은 `<button>`, 누르는 요소는 `role`·`tabindex`·Enter/Space(이미지 크게 보기 선례), 입력칸에 라벨, 포커스 이동(`use-field-focus`)                                   |
| 반응형        | 모바일 폭·긴 글자·중국어·영어에서 넘치거나 사라지는가?                         | 모바일 표시 방식(카드·드릴다운)마다 따로 그려진다 — 고른 방식 전부 확인. 전역 `word-break: keep-all` 은 중국어에서 넘친다(2026-10-29 「下一步」 사고)                  |
| 성능          | 칸 하나 입력에 표 전체가 다시 그려지는가?                                      | 칸 단위 구독 `createKeyedValueSelector`, 표 아래 줄은 선택 상태를 글자 하나로 접어 구독(`belowTableSelectionKey`). 응답자 경로만 동적 import                           |
| 시각적 일관성 | 같은 역할의 요소가 같은 모양인가?                                              | 토큰은 `globals.css`, 명세는 DESIGN.md. 도구 UI 는 고밀도. 보기 컨트롤은 여러 줄 라벨의 첫 줄 중앙                                                                     |
| 피드백        | 누른 뒤 진행·성공·실패가 보이는가?                                             | 로딩·비활성 상태, 성공 문구 `use-auto-fade-message`, 실패 문구 `getErrorMessage`. 응답 화면 글자는 `systemText` 사전(가드 `respondent-korean-literals`)                |
| 오류 복구     | 실패·새로고침·탭 두 개에서 입력이 살아남는가?                                  | 응답은 초안·구간 저장, 버전이 바뀌면 「새로고침하면 바뀐 곳부터」. **빌더 동시 저장은 막는 장치가 없다** — 옛 탭 저장이 남의 수정을 덮는다(2026-10-29 실제 발생)       |
| 비동기 제어   | 연타·늦게 온 응답·언마운트 뒤 결과가 상태를 망치는가?                          | 연타는 한 번만(언어 페이지 넘김 선례), 늦은 결과는 버린다(쿼터 재확인 선례). memo·forwardRef 안 `useEffectEvent` 금지(주의사항 17)                                     |
| 보안          | 저작자·응답자 글자가 HTML 로 그려지는가? 클라이언트로 서버 모듈·비밀이 새는가? | 서식본은 `sanitizeCellHtml`·`sanitize-html` 을 거친다. UI 는 `@/server` import 금지(ESLint), 응답자 브라우저로는 발행본이 읽는 명단 열만                               |
| 테스트 가능성 | 판정이 컴포넌트 안에 묻혀 있는가?                                              | 판정은 순수 함수로 `question-renderer/utils` 등에 두고 옆에 `*.test.ts`. 화면 확인은 사용자가 직접 한다 — 무엇을 어느 기기에서 볼지 보고에 적는다                      |

#### 2-3. 개인정보·컴플라이언스

| 항목           | 질문                                                                         | 이 레포에서 확인할 것                                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 수집·이용 공지 | 새로 받는 개인정보가 있는가? 응답자가 받기 전에 목적·항목·보유기간을 보는가? | 응답 머리 문구 블록·동의 문항으로 알린다. 새 개인정보 칸은 스펙에 항목·목적을 적고 담당자에게 공지 문구를 확인받는다                                       |
| 암호화         | 개인정보가 평문으로 DB·로그·이력에 남는가?                                   | 응답은 `piiEncrypted`(문항·표 칸, `lib/crypto/response-pii`), 명단은 `contact_pii` 암호문 + blind index. 이관 이력은 암호문을 표식으로 바꾼다              |
| 접근 통제      | 누가 평문을 볼 수 있는가?                                                    | 2-1 인증·인가와 같다. 게스트·외부 링크에는 기본으로 싣지 않는다. 평문을 내보내면 no-store                                                                  |
| 보유기간       | 언제까지 갖고 있는가? 기한이 데이터에 적혀 있는가?                           | 설문의 `piiRetentionUntil`(`lib/survey/pii-retention`). 새 저장소를 만들면 그 기한을 따르는지 적는다                                                       |
| 파기           | 기한이 지나면 실제로 지워지는가? 사본·백업·파일에도 남지 않는가?             | 파기 스윕(현행 본문 0143)이 새 저장소까지 도는가. R2 파일은 유예 삭제 큐, 버전 스냅샷 보존 규칙. 일회성 백업 JSON(`.scratch`)도 작업 뒤 지울 시점을 적는다 |

### 3. 단계별 쓰는 법

- **스펙(PRD) 단계**: 1의 변경 종류와 2의 답을 PRD 의 「Implementation Decisions」 또는 별도 절에 적는다. 「지킨다」로 적은 항목은 수락 기준이 되고, 티켓·TDD 가 그 테스트를 만든다(동시성·데드락은 실DB 테스트 — `*.realdb.test.ts`).
- **적대적 리뷰 단계**: 초점 문구로 이 절을 넘긴다. 예 —
  `/codex:adversarial-review AGENTS.md 「기능 개발 체크리스트」 항목별로 실패 시나리오를 찾고, 문제없는 항목도 근거를 적어줘. 결과는 한국어로`
- **리뷰를 받은 뒤**: 지적마다 테스트로 먼저 재현하고(RED — 백엔드 동시성은 실DB 테스트) 고친다. 재현이 안 되면 그 근거를 남긴다.
- **검증·완료 보고 단계**: 테스트·lint·tsc 를 돌린 뒤 완료를 보고할 때, 1에서 고른 변경 종류의 항목마다 답을 한 줄씩 붙인다 — 「지킨다」는 그것을 지키는 테스트 이름, 「해당 없음」·「일부러 안 지킨다」는 이유. 테스트로 확인할 수 없는 항목(반응형·접근성·시각적 일관성 등 화면 확인)은 사용자가 어느 화면·기기에서 무엇을 볼지 적는다. 사용자가 따로 요청하지 않아도 한다.

---

## 주의사항

1. **타입 안전성**: Drizzle ORM + TypeScript strict. JSONB 컬럼은 `src/shared/contracts/*`의 타입으로 `.$type<...>()` 지정. 클라이언트 트리(features/components/hooks/stores/utils)는 `@/db` 값 import 금지(ESLint, type 은 허용).

   **함정: Drizzle 의 `text(..., { enum: [...] })` 는 TypeScript 전용이라 SQL CHECK 를 만들지 않는다.** 실제 제약은 마이그레이션이 손으로 쓴 별도 목록이고, 스키마 파일의 `check()` 블록도 또 하나의 사본이다 — 어휘 배열(`@/types/*`)만 고치고 배포하면 tsc 는 통과하는데 새 값을 담은 INSERT 가 CHECK 제약에서 깨진다. 어휘를 늘릴 때는 배열·`check()`·마이그레이션 셋을 함께 볼 것 (`mobile_table_display_mode` 가 그 예).

2. **상태 관리**: 서버 상태는 TanStack Query, 클라이언트 상태는 Zustand(+Immer).

3. **응답 페이지는 snapshot 기반**: 빌더 수정은 publish 전까지 실응답 페이지 미반영. 테스트 링크·테스트 대상자 링크·관리자 미리보기는 **저장본(테스트 버전)** 을 보므로 저장만 하면 반영된다(2026-10-23, 아래 "테스트 모드") — "테스트 링크 OK + 응답 페이지 NG" 패턴이면 publish 누락 먼저 의심. 공개 미리보기 `/preview/<token>` 은 배포본이다. 단, `quotaConfig`·`isPaused`·`pausedMessage`·`endRedirects`는 스냅샷 밖 라이브 컬럼이라 즉시 반영된다.

4. **테이블 질문**: `tableColumns`, `tableRowsData`, `tableHeaderGrid`, `tableValidationRules`, `dynamicRowConfigs`, `rowRepeatConfig`, `sumConstraints` JSONB 사용. choice 응답값은 `cell.id`.

   **행 차례로 열기**(`stagedRowsConfig`, 0132, ADR 0028)는 행 반복과 다른 기능이다 — 구조를 펼치지 않고 가시성만 정하며 내보내기 열은 늘 나간다. 열린 행 수와 필수 범위는 저장하지 않고 값에서 파생한다(`features/question-renderer/utils/staged-rows.ts` 의 `deriveOpenStagedCount`). 응답 화면과 검증은 `resolveStagedRows` 로 구조가 성립할 때만 동작시킨다. 묶음에 넣을 수 없는 행·버튼 줄 배치는 CONTEXT.md 「행 차례로 열기」.

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

    **키 상수는 import 0 인 잎 모듈이 소유하고, 어느 키 모듈도 등록부를 되부르면 안 된다.** 순환이 닫히면 등록부가 남의 상수를 초기화 전에 읽어 계산 키가 `undefined` 로 등록되고, 그 사이드카가 등록 목록에서 **조용히 빠진다** — 저장이 거부가 아니라 누락으로 끝나므로 아무도 모른다. 2026-09-16 에 실제로 닫혀 있었고(`__optTexts__` 를 `lib/option-text-read.ts` 로 내려 끊었다), 순환을 만든 것은 등록부의 직접 import 가 아니라 `prior-answers → response-sidecars` 라는 **전이 closure 안쪽 간선**이었다. 그래서 등록부에 새 import 를 들일 때는 그 모듈의 closure 가 등록부로 돌아오지 않는지 봐야 한다. `lib/survey/response-sidecars-import-order.test.ts` 가 소스를 읽어 이 간선을 막고, 등록 키 집합 전체를 리터럴로 못박는다 — 키 문자열은 `question_responses` JSONB 에 그대로 저장되므로 개명하면 이미 저장된 응답의 사이드카가 고아가 된다.

14. **문항 가시성**: 표시 조건으로 숨겨진 문항의 응답은 **그 순간 지워진다. 되돌려도 살아나지 않는다** (2026-09-07 결정 — 세션 되돌리기 버퍼는 검토 후 미채택). 판정·삭제는 `lib/survey/question-visibility.ts` 의 `resolveVisibleQuestionIds`/`stripHiddenQuestionValues` 한 곳이다. 복제 금지 — 셀 게이팅(`cell-gating.ts`)과 같은 규약. 저장 경계 순서는 **숨은 문항 strip → 경로 밖 strip(둘을 고정점까지) → 게이팅 strip → calc 재계산**이고, 앞의 세 단계(숨은 문항·경로 밖·게이팅)는 **답할 수 있는 범위** `lib/survey/answerable-scope.ts` 의 `pruneToAnswerableScope` 한 곳이 소유하고(2026-10-23 — 응답 확정과 Raw 내보내기 마지막 그물이 순서를 각자 조립하던 사본을 걷어냈다, CONTEXT.md 「답할 수 있는 범위」), 완료 제출(페이로드·빈 complete)과 관리자 수정은 이 순서를 직접 조립하지 않고 **응답 확정** `server/survey-response/services/answer-finalization.ts` 의 `loadFinalizationMaterial`(잠금 밖) + `finalizeAnswers`(동기, 잠금 아래 가능)를 거친다 — 세 단계는 설문 구성·변경 유무와 무관하게 늘 돌고, 등록 사이드카 정제·자격미달 판정·암호화까지 한 번에 낸다(2026-10-19 — 계산 칸·게이팅 칸 유무로 건너뛰던 시절 표시 조건만 있는 설문의 빈 complete 와 안 고친 이탈 응답의 관리자 저장이 strip 을 빠뜨렸다). **초안·구간 저장에는 걸지 않는다.** 그쪽 answers 는 더티 키만 담은 부분 패치이고 저장이 jsonb 합집합 병합이라, strip 을 걸면 조건이 참조하는 상류 문항이 패치에 없어 멀쩡한 답이 지워진다. 새 저장 경로를 만들 때 이 구분을 지킬 것.

    **조건 평가 컨텍스트는 응답 화면과 같다**(2026-10-22): 화면은 조건(문항·그룹·행·열 표시 조건, 동적 행, 분기)을 `{ ...명단 값, ...응답 인용값 }` 으로 푼다 — 조건식의 `attrsKey` 피연산자가 두 채널을 구분하지 못해 인용 우선이다. 응답 확정과 Raw 내보내기 마지막 그물도 같은 컨텍스트를 `lib/survey/answer-eval-ctx.ts` 의 `createAnswerEvalCtx` 로 만든다 — 명단 값만 넘기던 시절, 명단 열과 같은 이름의 인용값을 읽는 조건이 서버에서만 거짓이 되어 화면에서 보이고 입력한 문항·행·열의 답을 지웠다. 인용값은 공용 `utils/answer-quote` 의 `collectAnswerQuotes` 로, 상세 기재 재료는 응답 루트 `__optTexts__`(`readOptTextsSidecar` — 화면의 `resolveEffectiveOptionTextsByQuestion` 도 저장분은 이것으로 읽고 편집 중인 값만 얹는다)로 계산한다. 응답에서 파생되는 값이라 **strip 바퀴마다 지운 결과로 다시 계산한다** — `stripHiddenQuestionValues` 는 뷰마다 컨텍스트를 만드는 함수를 받으면 그 컨텍스트로 지우고 더 지울 것이 없을 때까지 다시 돈다(화면이 지운 뒤 다시 그리며 인용값을 다시 계산하는 것과 같은 수렴). 고정 컨텍스트를 넘기는 응답 화면의 동작은 그대로다. 명단 값도 화면과 같아야 한다 — 내보내기 마지막 그물도 개인정보 열을 합친 명단 값(`server/read-models/respondent-contact-attrs` 의 일괄판 `loadRespondentContactAttrsMany`, 단건과 같은 규칙)으로 판정한다. 없는 명단 열을 읽는 비교는 보이는 쪽으로 풀려, attrs 만 넘기던 시절 화면에서 숨은 문항의 값이 진행 중 응답의 Raw 파일에 실렸다(2026-10-23). 계산 칸 수식(`withCalcValues`)은 화면도 명단 값만 쓰므로 이 컨텍스트를 쓰지 않는다.

    **경로 밖 문항도 지운다**(2026-10-22, CONTEXT.md 「경로 밖 문항」): 분기 이동(goto·end)으로 건너뛴 페이지의 답은 표시 조건이 참이라 숨은 문항 strip 이 못 지우고, 그 값이 자격미달 보기면 응답 확정의 자격미달 판정이 정상 완료를 screened_out 으로 뒤집었다. 판정·삭제는 `lib/survey/answer-path.ts` 의 `stripUnreachedQuestionValues` 한 곳이고(숨은 문항 strip 을 안에서 함께 돌린다) **답할 수 있는 범위(`lib/survey/answerable-scope` 의 `pruneToAnswerableScope`)를 거쳐 응답 확정과 Raw 내보내기 마지막 그물(`stripHiddenFromExportRows`)만** 쓴다 — 응답 화면은 즉시 지우지 않고 초안·구간 저장에도 걸지 않는다(위와 같은 부분 패치 이유). 경로는 응답 화면이 제출 검증에 쓰는 `buildRenderSteps(questions, groups)` + `collectTraversedQuestionIds` 그대로라, **응답 화면이 페이지를 다르게 만들기 시작하면(기기 폭·조사표 분할로 페이지를 쪼개는 등) 서버 경로가 어긋나 멀쩡한 답을 지운다** — `answer-path.test.ts` 의 소스 단언이 먼저 깨지니 그때 같이 고칠 것. 경로를 확정할 수 없으면 건너뛴다(fail-safe — 문항 섞기, 기록된 마지막 페이지 `current_step_id` 가 경로 밖이거나 지금 구조에 없음). calc 는 범위 안 문항(표시 + 경로 위)에만 새로 채우고(`withCalcValues` 의 `inScopeQuestionIds`, 이미 값이 남은 문항은 다시 계산), 응답 화면의 저장 시 주입은 표시 조건상 보이는 문항에만 채운다.

    **표의 숨은 칸도 같다**(2026-09-29 표 행 → 2026-10-22 확장): 보기를 표로 그리는 문항(표 문항 · 보기 소스 radio/checkbox)에서 **행 표시조건 · 열 표시조건 · 고르지 않은 동적 행**으로 숨은 칸을 가리키는 선택은 답이 아니다. `stripHiddenQuestionValues` 가 그 셀 값·`__choiceGroups` 선택·보기 소스 표의 문항 값(셀 id · 셀 id 배열 · 그룹 맵)·`__optTexts__` 항목을 지운다(문항 숨김과 번갈아 고정점 수렴). 판정은 `lib/survey/table-cell-visibility.ts` 의 `resolveTableCellVisibility` 하나이고 투영은 `utils/conditional-table-layout.ts` 의 `projectResponseTableLayout`(행·열 조건 + 동적 행 선택) — 렌더러(`choice-table-response` 의 모든 표시 방식)·차단 검증·strip 이 같은 투영을 쓴다. 동적 행 선택은 표 문항이 표 응답 안 `__selectedRowIds`, 보기 소스 표가 루트 사이드카 `__dynamicRowSelections__` 다. 숨김이 생길 수 없는 표(조건·켜진 동적 그룹 없음)는 판정을 건너뛴다. 필수 판정은 숨은 칸의 그룹을 빼고 숨은 칸의 선택도 세지 않는다 — `resolveChoiceTableVisibleCellIds`(numeric-validation) 로 만든 집합을 `isQuestionAnswered`·`collectUnfilledChoiceGroup*`·`resolveGroupedRequiredMessage`·`collectRequiredOptionTextIssues` 에 **같이** 넘길 것(하나라도 빠지면 「빨갛지 않은데 다음이 막힘」). 보기 소스 표는 데스크톱·모바일 전부 동적 행 고르기 버튼을 표 위에 그린다(전에는 행별 원본 계열 모바일에서만 골랐다). 순위형 내장 표는 렌더러가 조건을 읽지 않아 대상이 아니고, 빌더가 행·열 조건부 표시와 동적 행 그룹 입구를 내지 않는다(`DynamicTableEditor` 의 `allowDisplayConditions`). 저장 경계 calc 재계산은 숨은 칸의 계산 칸에도 값을 넣는다(미해결).

15. **응답 종결 판정은 `status` 로 한다 — `is_completed` 는 종결 게이트가 아니다**: 자격미달(`screened_out`)은 완료 수 분자에서 빠지도록 `is_completed=false` 로 저장된다(`response-completion` 의 `isCompleted: !screenedOut`). 그래서 `is_completed` 를 "끝난 응답인가" 게이트로 쓰면 자격미달만 조용히 빠진다 — 재응답 허용이 `ok:true` 를 돌려주면서 아무것도 안 하던 사고가 이것이다(2026-09-21 수리). 어휘와 술어는 `shared/contracts/survey-response.ts` 가 SSOT 다: 열림 `isOpenResponseStatus` · 종결 `isConcludedResponseStatus` · 재응답 허용 대상 `isReeditableResponseStatus`(completed·screened_out). `is_completed=false` 를 쿼리에 쓰는 것 자체는 무방하나(열린 행 **후보** 조회 범위), 판정은 반드시 status 술어로 한 번 더 한다 — `lifecycle`·`response-row-create` 의 컨택 재사용 조회가 그 패턴이다.

16. **자격미달은 제출 시점에만 정해지지 않는다**: 관리자 응답 수정(`saveAdminEdit`)이 종결 응답(completed·screened_out)에 대해 `detectScreenOut` 을 다시 돌려 `completed ⇄ screened_out` 을 양방향으로 오간다(2026-09-21). 판정 재료는 평문 `finalResponses`(숨은 문항 strip → 게이팅 strip → calc 재계산 **이후**, PII 암호화 **이전**)여야 분기 매칭이 성립한다. `in_progress` 는 응답자 세션 중이라, `quotaful_out`·`bad` 는 자격미달과 다른 축의 종결이라 재판정하지 않는다. 스냅샷을 못 얻으면 재판정을 건너뛰고 기존 상태를 보존한다(calc 재계산과 같은 fail-safe). 바뀐 문항이 없어도 확정·재판정한다 — 판정은 응답 확정의 `screenedOut` 이다.

17. **`useEffectEvent` 를 `React.memo`·`forwardRef` 컴포넌트 안에 쓰지 말 것**: React 19.2.3 은 memo·forwardRef 로 감싼 컴포넌트의 `useEffectEvent` 를 갱신하지 않는다(react-dom 커밋 단계가 일반 함수 컴포넌트만 `ref.impl` 을 갈아끼운다 — dev·prod 둘 다). 이벤트가 첫 렌더 값을 계속 읽어, 표 입력 칸 `InputCell` 의 「응답자가 고칠 수 있게」 칸을 고치면 곧바로 명단 값으로 되돌아갔다(빈값 기본치 숫자 칸도 같은 원리, 2026-10-27 발견 — `InputCell` 의 memo 를 걷어 고쳤다, 부모 `CellRouter` 가 memo 라 손실 없음). 같은 날 코드 리뷰에서 하나가 더 나왔다 — `RichTextEditor`(forwardRef)의 `syncContentFromProp` 이 첫 렌더 값(편집기가 아직 없음)을 계속 읽어, 바깥에서 바꾼 `initialHtml`(보관함 불러오기·템플릿 다시 읽기)이 본문에 반영되지 않았다. 그 안에서 부르는 훅(이미지·첨부 추적기)의 `useEffectEvent` 도 같았다 — 컴포넌트 단위로 걸리므로 훅 안에 숨어 있어도 같다. forwardRef 를 걷고 React 19 의 `ref` prop 으로 받게 고쳤다(`rich-text-editor-prop-sync.test.tsx`). 지금 src 에 그 조합은 없다. ref 가 필요하면 forwardRef 대신 `ref` prop 을, memo 가 필요하면 바깥 컴포넌트를 memo 로 두고 안쪽은 일반 함수 컴포넌트로 둔다. **React 를 올리면 다시 확인할 것.**

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
- 화면 폭에 맞춰 표 줄이기 `questions.fit_table_to_width` 는 0146 이다 (2026-10-29) — **앱 배포 전에** 적용한다(새 앱이 읽고 쓴다, NOT NULL DEFAULT false 라 구버전 앱 INSERT 무관 · 단일 단계)
- 언어별 설문 글자 `surveys.localized_messages` 는 0145 다 (2026-10-27) — **앱 배포 전에** 적용한다(새 앱이 읽는다, nullable 이라 2단계 배포 불필요). 0144 는 staging(클라이언트 링크 탭 백필)이 쓰고 있어 건너뛰었다 — staging 병합 시 배열 끝 append
- 이관 이력 `response_migration_history` 는 0142 다 (2026-10-23) — **앱 배포 전에** 적용한다(새 앱이 쓴다)
- `response_answers` 제거·응답 테이블 중복 인덱스 정리·`adminEditRollback` 이관은 0143 이다 (2026-10-23). **앱 배포 뒤에** 적용한다 — 먼저 적용하면 구버전 앱의 완료 제출이 실패한다. 재생 순서(배열)와 적용 순서가 같다
- 테스트 버전 `surveys.test_version_id`·`survey_versions.fingerprints` 는 0141 이다 (2026-10-23). 0139·0140 은 staging(실사팀 사이드바·설문 카드 제목)이 쓰고 있어 건너뛰었다
- 종료 후 이동 주소 `surveys.end_redirects` 는 0138 이다 (2026-10-20)
- 메일 대체 발송 처리 대기 `mail_recipients.fallback_pending_at` 은 0137 이다 (2026-10-19)
- 컨택원 배정 `contact_assignments`·`contact_targets.assignment_id` 는 0136 이다 (2026-10-19)
- 메일 대체 발송 `mail_campaigns.parent_campaign_id`·kind `fallback`·`mail_recipients.email_column_key`/`source_recipient_id`·`next_fallback_run_number` 는 0135 다 (2026-10-16). 0133·0134 는 staging 브랜치(외주 링크·클라이언트 링크)가 쓰고 있어 건너뛰었다
- 행 차례로 열기 `staged_rows_config` 는 0132 다 (2026-10-06)
- 항목 단위 카드 블록 시작 열 `mobile_item_card_block_columns` 는 0131 이다 (2026-10-02)
- 최대 선택 개수 연동 `max_selections_source` 는 0130 이다 (2026-10-01)
- 「항목 단위 카드」 CHECK 갱신은 0129 다 (2026-10-01). staging 병합 때 CHECK 목록은 0129 본문이 현행이다 — 0128 을 뒤에 재생하면 `item-cards` 가 빠진다
- **0126·0127 은 외주 링크(staging 브랜치, 2026-09-30 기준 미푸시)가 쓰고 있어** main 의 「행별 척도」 CHECK 갱신은 0128 로 두었다
- **0111~0123 은 역할 모델 v2(staging 브랜치)가 쓰고 있어 main 에서 비워 둔다** (2026-09-17). main 이 같은 날 0111·0112 로 만든 입력칸 높이·제목 서식본은 staging 병합 전에 0124·0125 로 옮겼다 — 번호 기록 표가 DB 에 없어 파일 이름만 바뀌고 이미 적용한 DB 는 그대로다

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

`update-docs` 스킬(`.agents/skills/update-docs/`)이 이 레포용 대조표를 갖고 있다. 코드가 문서와 어긋났을 때 이 스킬을 따른다 — 갱신 대상은 `AGENTS.md`·`CONTEXT.md` 이고, `docs/superpowers/plans`·`specs` 와 ADR 본문은 시점 기록물이라 최신화 대상이 아니다.

> `CLAUDE.md` 는 `AGENTS.md` 를 가리키는 심볼릭 링크다. 문서 수정은 항상 `AGENTS.md` 에 한다.
