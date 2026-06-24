# Survey Table Project - Claude 참조 문서

## 프로젝트 개요

Next.js 16 기반의 고급 설문조사 빌더 + 운영 플랫폼. 복잡한 질문 유형, 조건부 로직, 버전 스냅샷, 컨택 관리, 메일 캠페인, SPSS/엑셀 내보내기, 분석 기능을 갖춘 엔터프라이즈급 애플리케이션.

> 최종 갱신: 2026-06-06 (oRPC 전면 마이그레이션 완료 반영 — features/ 9개 + server action 3파일 잔존)

---

## 기술 스택

| 영역 | 기술 | 버전 |
|------|------|------|
| 프레임워크 | Next.js (App Router, Turbopack) | 16.2.4 |
| UI 라이브러리 | React (React Compiler) | 19.2.3 |
| 스타일링 | TailwindCSS | 4.x |
| 컴포넌트 | shadcn/ui (Radix UI) | - |
| 상태관리 | Zustand + Immer | 5.0.8 |
| 데이터 페칭 | TanStack Query | 5.90.11 |
| 폼 관리 | React Hook Form | 7.63.0 |
| 스키마 검증 | Zod | 4.4.3 |
| 테이블 | TanStack Table | 8.21.3 |
| 가상화 | TanStack Virtual | 3.13.23 |
| 텍스트 측정 | @chenglou/pretext | 0.0.4 |
| 리치 에디터 | TipTap | 3.15.3 |
| 드래그앤드롭 | @dnd-kit | - |
| ID 생성 | NanoID | 5.1.11 |
| ORM | Drizzle ORM | 0.45.2 |
| DB 드라이버 | postgres (postgres-js) | 3.4.7 |
| 데이터베이스 | PostgreSQL (Supabase) | - |
| 파일 저장소 | Cloudflare R2 (S3 호환) | - |
| 이미지 처리 | sharp | 0.34.5 |
| HTML sanitize | sanitize-html | 2.17.0 |
| 이메일 발송 | Resend + React Email | - |
| 이메일 webhook | svix | 1.93.0 |
| 백그라운드 잡 | Inngest | 4.4.0 |
| 엑셀 생성 | ExcelJS | 4.4.0 |
| SPSS .sav 생성 | sav-writer | 1.0.0 |
| 차트 | Recharts + Tremor | - |
| 에러 모니터링 | Sentry (@sentry/nextjs) | 10.x |
| 테스트 | Vitest + Testing Library + MSW | - |
| 언어 | TypeScript (strict) | 5.9.3 |

> 참고: `xlsx`, `jszip` 의존성은 제거됨(2026-06-05). 엑셀 생성은 ExcelJS, SPSS는 sav-writer 사용.

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
│   │   │       ├── analytics/  # 설문별 분석
│   │   │       └── operations/ # 운영 콘솔 (아래 라우트 섹션 참조)
│   │   ├── billing/mail-cost/  # 메일 비용 정산
│   │   ├── login/              # 로그인
│   │   └── profile/            # 프로필
│   ├── api/                    # API 라우트 (아래 API 섹션 참조)
│   ├── survey/[id]/            # 공개 설문 응답 페이지
│   ├── create/                 # 설문 생성 진입
│   ├── analytics/              # 분석 대시보드
│   ├── unsubscribe/            # 메일 수신거부
│   └── sentry-example-page/    # Sentry 점검용
│
├── features/                   # feature 단위 백엔드 (oRPC) — 9개 도메인
│   └── <feature>/              # survey-builder · survey-response · operations · contacts
│       │                       # · mail · analytics · library · auth · media
│       ├── domain/             # 타입 re-export + zod 스키마 (런타임 import 0, JSONB는 z.custom)
│       └── server/
│           ├── procedures/     # oRPC procedure (authed/pub, 얇은 위임) + colocated *.test.ts
│           └── services/       # 비즈 로직 + drizzle (server-only, requireAuth/revalidatePath 없음)
│
├── server/                     # oRPC 코어
│   ├── context.ts              # createContext (supabase session + db — RSC·procedure 공용)
│   ├── orpc.ts                 # base os + authed(admin) + pub(응답자)
│   ├── router.ts               # 전체 feature router 합성 (AppRouter)
│   └── handler.ts              # RPCHandler (+ Sentry onError)
│
├── shared/
│   └── lib/rpc.ts              # 타입드 RPC client: client(plain 호출) + orpc(TanStack utils)
│
├── actions/                    # 잔존 서버 액션 — 3파일 (의도적 유지)
│   ├── auth-actions.ts         # login/logout (redirect+쿠키 의미론이 server action 특화)
│   ├── unsubscribe-actions.ts  # 수신거부 POST form (메일 클라 JS 비활성 환경 + redirect)
│   └── index.ts                # 잔존 사유 주석 포함 배럴
│
├── data/                       # 잔존 데이터 액세스 (RSC·service 내부 직접 호출용)
│   ├── surveys.ts / responses.ts  # analytics RSC 페이지 + 일부 service 가 공유하는 조회
│   ├── response-filters.ts     # notDeletedResponse 등 (operations/duplicate-detection 공용)
│   └── library.ts / regions.ts
│
├── components/                 # React 컴포넌트 (~200개)
│   ├── survey-builder/         # 설문 생성 컴포넌트 (85개)
│   ├── survey-response/        # 응답 입력 컴포넌트 (9개)
│   ├── operations/             # 운영 콘솔 컴포넌트 (52개)
│   ├── analytics/              # 차트 및 리포팅 (17개)
│   ├── survey-analytics/       # 분석 시각화
│   ├── ui/                     # shadcn/ui 기반 컴포넌트 (33개)
│   └── providers/              # Context providers
│
├── stores/                     # Zustand 스토어 (7개)
│   ├── survey-store.ts         # 메인 설문 빌더 상태
│   ├── survey-response-store.ts # 실제 응답 상태
│   ├── test-response-store.ts  # 테스트/미리보기 응답
│   ├── survey-list-store.ts    # 설문 목록 관리
│   ├── question-library-store.ts # 질문 라이브러리
│   ├── ui-store.ts             # 전역 UI 상태
│   └── index.ts
│
├── hooks/                      # 커스텀 훅
│   ├── queries/                # TanStack Query 훅 (surveys/responses/library/cell-library)
│   ├── use-survey-sync.ts      # 설문 데이터 동기화
│   ├── use-library-sync.ts     # 라이브러리 동기화
│   ├── use-dynamic-row-* / use-row-* / use-cell-height-cache.ts # 테이블 레이아웃
│   ├── use-media-query / use-keyboard-open.ts # 반응형
│   └── ... (테이블 성능/스크롤 동기화/라인카운트 등)
│
├── lib/                        # 도메인 로직 + 유틸리티
│   ├── supabase/               # Supabase 클라이언트 (client/server/middleware)
│   ├── auth/ + auth.ts         # 인증
│   ├── crypto/                 # 컨택 PII 암호화 (cipher + blind index)
│   ├── contacts/               # 엑셀 파서, 컬럼 자동감지, 스킴 헬퍼, 업로드 제한
│   ├── operations/             # 운영 콘솔 집계 로직 (*.server.ts = SQL 집계)
│   ├── mail/                   # 메일 발송/렌더/캠페인 dispatch+reconcile/빌링/첨부
│   ├── spss/                   # SPSS .sav 빌더 + 변수 생성/검증 + 데이터 변환
│   ├── inngest/                # Inngest 클라이언트 + functions
│   ├── survey/                 # 토큰 치환, 이미지/첨부 promote, 컨택 attrs context
│   ├── analytics/              # 통계/교차분석/필터 (analyzer/cross-tab/filter)
│   ├── duplicate-detection/    # 중복 응답 감지
│   ├── lookup/                 # LUT 룩업
│   ├── upload/                 # 업로드 헬퍼
│   ├── versioning/             # 설문 버전 스냅샷
│   ├── tiptap/                 # TipTap 확장/설정
│   ├── sanitize.ts             # HTML sanitize (서버: jsdom 금지, sanitize-html 사용)
│   ├── response-normalizer.ts  # 응답 정규화 (response_answers)
│   └── utils.ts                # 공통 유틸리티 (cn())
│
├── utils/                      # 순수 유틸리티 함수
│   ├── branch-logic.ts         # 분기 로직 평가
│   ├── classify-table.ts       # 테이블 분류 (모바일 드릴다운 등)
│   ├── choice-source / ranking-source / ranking-shared.ts # 옵션 소스 해석
│   ├── option-code-generator / table-cell-code-generator.ts # 코드 발번
│   ├── spss-var-name.ts        # SPSS 변수명 생성
│   ├── cell-type-detector / cell-label / cell-library-helpers.ts
│   ├── table-grid / table-merge / table-cell-optimizer.ts # 테이블 그리드
│   ├── mobile-card-options / mobile-display-cells.ts # 모바일 렌더
│   ├── numeric-input / options-layout / expression-migration.ts
│   └── ...
│
├── db/
│   ├── index.ts                # drizzle(postgres-js) 클라이언트
│   └── schema/                 # Drizzle ORM 스키마 (아래 DB 섹션 참조)
│
├── types/survey.ts             # 설문 관련 타입 정의
├── instrumentation.ts          # Sentry 서버 instrumentation
├── instrumentation-client.ts   # Sentry 클라이언트 instrumentation
└── proxy.ts                    # (프록시 설정)
```

---

## 데이터베이스 스키마

스키마 파일은 도메인별로 분리: `surveys.ts`, `contacts.ts`, `mail.ts`, `mail-billing.ts`, JSONB 타입은 `schema-types.ts`.

### 설문 도메인 (surveys.ts)

```
surveys                    # 설문 설정
├── id, title, description, slug, privateToken
├── isPublic, allowMultipleResponses, showProgressBar, shuffleQuestions, requireLogin
├── endDate, maxResponses, thankYouMessage, contactEmail
├── contactColumns (JSONB)        # 컨택리스트 표시 컬럼 스킴
├── lookups (JSONB)               # 설문에 복사된 LUT 사본 목록
├── contactResultCodes (JSONB)    # 결과코드 사용자 정의
├── progressColumns (JSONB)       # 진척률 표 컬럼 픽커
├── requireInviteToken            # invite token 강제 여부
├── status                        # 'draft' | 'published' | 'closed'
├── currentVersionId              # 현재 활성 배포 버전
├── deletedAt (soft delete)
└── createdAt, updatedAt

question_groups            # 질문 그룹 (계층 구조, self-reference)
├── id, surveyId, parentGroupId, name, description
├── order, color, collapsed
├── displayCondition (JSONB)
└── createdAt, updatedAt

questions                  # 개별 질문
├── id, surveyId, groupId
├── type                   # text|textarea|radio|checkbox|select|multiselect|ranking|table|notice
├── title, description, required, order
├── options, selectLevels (JSONB)
├── tableTitle, tableColumns, tableRowsData, tableHeaderGrid (JSONB)  # 테이블
├── tableValidationRules, dynamicRowConfigs (JSONB)
├── rankingConfig (JSONB)         # 순위형 전용
├── optionsColumns, minSelections, maxSelections, allowOtherOption
├── placeholder, defaultValueTemplate  # 단답형(prefill 토큰 지원)
├── inputType, emptyDefault       # 단답형 숫자 입력 모드
├── questionCode, isCustomSpssVarName, exportLabel, spssVarType, spssMeasure  # SPSS export
├── hideColumnLabels
├── noticeContent, requiresAcknowledgment  # 공지
├── imageUrl, videoUrl
├── displayCondition (JSONB)      # 조건부 표시
└── createdAt, updatedAt

survey_responses           # 수집된 응답
├── id, surveyId, questionResponses (JSONB)
├── isCompleted, startedAt, completedAt
├── userAgent, sessionId, ipHash, fpHash, deviceId  # 중복 감지 신호
├── metadata (JSONB), lastEditedAt, deletedAt
├── versionId                     # 응답 시점 버전
├── status                        # in_progress|completed|screened_out|quotaful_out|bad|drop
├── platform, browser, currentStepId, pageVisits (JSONB)  # 운영 현황 추적
├── lastActivityAt, totalSeconds, progressPct
├── contactTargetId               # 컨택 매칭 (FK는 마이그레이션에서 ALTER로 생성)
└── createdAt
└── UNIQUE(surveyId, sessionId)   # 동시 INSERT race 차단

survey_versions            # 설문 버전 스냅샷 (불변)
├── id, surveyId, versionNumber
├── status                        # 'published' | 'superseded' | 'closed'
├── snapshot (JSONB)              # 배포 시점 전체 설문 구조
├── changeNote, publishedAt, closedAt, deletedAt
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
├── uploadedRows, mergedRows, errorRows
├── mapping (JSONB), uploadedBy
└── createdAt

contact_targets            # 컨택 = 응답 대상
├── id, surveyId
├── resid                  # 설문별 자동 발번 (UNIQUE surveyId+resid)
├── groupValue, attrs (JSONB)     # 엑셀 한 행 통째 Record<string,string>
├── inviteToken (UUID, UNIQUE)    # /survey/[id]?invite=<token>
├── unsubscribeToken (UUID, UNIQUE), unsubscribedAt
├── uploadId, responseId, respondedAt  # 응답 매칭
├── memo, contactMethod
└── createdAt, updatedAt

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

mail_campaigns             # 단체 발송 회차
├── id, surveyId, mailTemplateId, runNumber, title
├── *Snapshot (subject/bodyHtml/from/replyTo/attachments/filter)  # 발송 시점 스냅샷
├── status                 # draft|queued|sending|completed|partial|cancelled
├── recipientCount, queuedCount, sentCount, deliveredCount,
│   openedCount, bouncedCount, complainedCount, failedCount,
│   skippedUnsubscribedCount  # webhook이 atomic delta로 갱신
├── createdBy, scheduledAt, startedAt, completedAt
└── createdAt, updatedAt  (UNIQUE surveyId+runNumber)

mail_recipients            # 수신자별 status + Resend message id
├── id, campaignId, contactTargetId
├── emailSnapshot, inviteTokenSnapshot
├── status                 # queued|sending|sent|delivered|opened|bounced|complained|failed|skipped_unsubscribed
├── resendMessageId, errorReason
├── sentAt, deliveredAt, openedAt, bouncedAt, complainedAt
└── createdAt, updatedAt  (UNIQUE campaignId+contactTargetId)

webhook_events             # Resend webhook idempotency dedupe (id = svix-id)
├── id, source, eventType, receivedAt

mail_billing_periods       # 메일 비용 정산 (요금제+결제일 시계열)
├── id, startDate (UNIQUE), billingDayOfMonth, planLabel
├── monthlyFeeKrw, includedEmails, overagePer1kKrw
├── note, createdBy
└── createdAt, updatedAt
```

### 주요 관계

```
surveys (1) ─┬─ (N) question_groups ── parentGroupId (self-ref)
             ├─ (N) questions
             ├─ (N) survey_responses ─┬─ (N) response_answers
             │                        └─ (1) contact_targets [optional 매칭]
             ├─ (N) survey_versions ── (N) survey_responses [versionId]
             ├─ (N) contact_uploads ── (N) contact_targets
             ├─ (N) mail_templates ── (N) mail_campaigns
             └─ (N) mail_campaigns ── (N) mail_recipients ── (1) contact_targets

contact_targets ─┬─ (N) contact_pii (암호화 PII)
                 └─ (N) contact_attempts (결과 회차)

saved_questions / saved_lookups / saved_cells / question_categories (standalone)
mail_billing_periods / webhook_events (standalone)
```

---

## 운영 콘솔 라우트

```
/admin/surveys/[id]/operations/
├── overview                      # 응답 현황 (slice 1)
├── profiles                      # 응답자 목록 (slice 2)
│   └── [responseId]/edit         # 응답 상세/수정
├── contacts                      # 컨택리스트 (slice 3)
│   ├── [contactId]               # 컨택 상세
│   ├── columns                   # 컬럼 스킴 편집
│   ├── new                       # 컨택 수동 추가
│   ├── result-codes              # 결과코드 설정
│   ├── upload                    # 업로드 이력
│   └── upload/new                # 엑셀 업로드 마법사
├── report                        # 전시회/그룹별 진척률 리포트 (slice 4)
│   └── columns                   # 리포트 컬럼 픽커
└── mail/                         # 메일 캠페인
    ├── templates                 # 템플릿 목록 → new, [mid], [mid]/edit
    └── campaigns                 # 캠페인 목록 → new, [cid]

/admin/billing/mail-cost          # 메일 비용 정산
```

응답 페이지: `/survey/[id]?invite=<uuid>` 진입 시 inviteToken → contact_targets lookup → survey_responses.contactTargetId 매칭. 토큰 무효 시 amber alert + 익명 응답 폴백. surveyId가 UUID인 경우 private_token fallback 필요.

> 운영 집계는 `lib/operations/*.server.ts` 에서 SQL 집계로 수행 (aggregate + format + wrapper 패턴). 정확한 통계는 `question_responses` JSONB 기준 (response_answers는 saveResponse/saveAdminEdit 에서만 채워짐).

---

## 질문 유형

| 타입 | 설명 | 주요 속성 |
|------|------|----------|
| `text` | 단답형 텍스트 | placeholder, defaultValueTemplate, inputType, emptyDefault |
| `textarea` | 장문형 텍스트 | - |
| `radio` | 단일 선택 | options, allowOtherOption |
| `checkbox` | 복수 선택 | options, allowOtherOption, minSelections, maxSelections |
| `select` | 드롭다운 단일 선택 | options, allowOtherOption |
| `multiselect` | 드롭다운 복수 선택 | selectLevels (다단계 — 옵션 리스트는 selectLevels 내부 소유) |
| `ranking` | 순위형 | rankingConfig, optionsSource (manual\|table) |
| `table` | 매트릭스/그리드 | tableColumns, tableRowsData, tableHeaderGrid, tableValidationRules, dynamicRowConfigs |
| `notice` | 안내문 | noticeContent, requiresAcknowledgment |

### 테이블 질문 셀 타입

- `text`: 텍스트 표시 / `image`: 이미지 / `video`: 비디오 링크
- `checkbox` / `radio` / `select`: 선택 입력
- `input`: 텍스트 입력 (inputType `number` 시 숫자만)
- `ranking`: 셀 내부 랭킹 (셀별 옵션 + 순위 드롭다운 N개)

> 테이블-소스 choice 응답값은 `cell.id` 임. value-match displayCondition에 코드("3" 등)를 넣으면 영구 미스매치. `resolveChoiceOptions` 사용.

### 테이블 검증 규칙

- `exclusive-check`: 배타적 선택 / `required-combination`: 필수 조합
- `any-of`: 최소 하나 / `all-of`: 모두 선택 / `none-of`: 선택 불가

---

## 데이터 흐름 아키텍처 (oRPC — 2026-06-06 전환 완료)

```
클라이언트 컴포넌트/훅
  └─ client.* (plain) 또는 orpc.*.call (TanStack queryFn)   # @/shared/lib/rpc
       └─ POST /api/rpc  →  procedure (.input zod 검증, authed/pub)
            └─ service (비즈 로직 + drizzle)  →  db

RSC (서버 컴포넌트)
  └─ service 직접 호출 (RPC 자기호출 금지)  # features/*/server/services 또는 data/·lib/operations/*.server.ts
```

- 서버 상태는 TanStack Query, 클라이언트 상태는 Zustand로 분리. mutation 후 RSC 데이터 갱신은 `router.refresh()` (revalidatePath는 procedure에서 불가).
- 인증: `authed`(admin, supabase session) / `pub`(응답자 — 응답 mutation·공개 설문 조회·컨택 attrs·수신거부 lookup).
- 잔존 서버 액션은 `actions/` 3파일뿐 (auth login/logout + unsubscribe form — 의도적 유지).
- **feature 마이그레이션 패턴/함정**: domain zod는 `@/types/survey` 방향 통일 + null-coalescing(as unknown as 금지), service input은 zod infer, `.returning()` 후 non-null throw, 컴포넌트는 hook/helper 시그니처 유지로 무수정. 질문 영속 쓰기는 explicit field set(spread 금지) + `PERSISTED_QUESTION_FIELDS` SSOT 로 tsc 관할 — 신규 컬럼은 SSOT 등재만 하면 모든 쓰기 지점(survey-save values/onConflict, create, duplicate, updateQuestion 순회)이 컴파일 에러로 호명된다.
- feature 간 직접 import 금지 (ESLint 강제) — 공용은 `@/shared` 승격 또는 RPC 경유. 서버 내부의 타 도메인 테이블 직접 쿼리는 허용.

---

## API 엔드포인트

```
POST   /api/rpc/[[...rest]]                    # oRPC 핸들러 — 전체 query/mutation (메인 경로)
*      /api/v1/[[...rest]]                     # OpenAPI 핸들러 (ENABLE_PUBLIC_API 게이트, 기본 비활성)
POST   /api/upload/image                       # 이미지 업로드 (multipart, 삭제는 media.deleteImages RPC)
POST   /api/upload/mail-attachment             # 메일 첨부 업로드 (삭제는 media.* RPC)
POST   /api/upload/notice-attachment           # 공지 첨부 업로드 (삭제는 media.* RPC)
GET    /api/surveys/[surveyId]/export          # SPSS(.sav)/엑셀 export (인증 필요, 파일 스트림)
GET    /api/surveys/[surveyId]/export/split-preview  # 분할 export 미리보기
POST   /api/response/segment                   # 구간 응답 저장 (sendBeacon — REST 유지)
*      /api/inngest                            # Inngest 핸들러
POST   /api/webhooks/resend                    # Resend webhook (svix 검증)
```

---

## 백그라운드 잡 (Inngest)

`lib/inngest/functions/` — 캠페인 reconcile 시스템 등. 발송 후 1/5/30분 reconcile로 sent 멈춤(webhook race) 자동 복구. 로컬 dev: `pnpm inngest`.

---

## 개발 스크립트

```bash
pnpm dev              # 개발 서버 (Turbopack)
pnpm build            # 프로덕션 빌드 (Turbopack)
pnpm start            # 프로덕션 서버
pnpm lint             # ESLint 검사 (eslint 9 flat config)
pnpm lint:fix         # ESLint 자동 수정
pnpm test             # Vitest 실행 (tests/ 디렉토리만 include)
pnpm test:watch       # Vitest watch
pnpm test:coverage    # 커버리지
pnpm inngest          # Inngest 로컬 dev 서버
pnpm db:generate      # 마이그레이션 생성
pnpm db:migrate       # 마이그레이션 실행 (_journal.json 기준)
pnpm db:push          # 스키마 푸시
pnpm db:studio        # Drizzle Studio
pnpm survey:backup    # 설문 백업
pnpm survey:restore   # 백업에서 복원
pnpm spss:migrate     # SPSS 필드 마이그레이션 (DRY_RUN 기본)
pnpm spss:rollback    # SPSS 필드 롤백
```

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
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=                  # postgres-js → Supabase Transaction pooler(pgBouncer, 6543). prepare:false 필수

# Cloudflare R2
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_URL=

# 메일 (Resend)
RESEND_API_KEY=
RESEND_WEBHOOK_SECRET=          # svix 서명 검증

# Inngest / Sentry
INNGEST_*=
SENTRY_*=

# 컨택 PII 암호화
CONTACT_PII_KEY=                # cipher + blind index 키
```

> 메일/컨택 메타(발신 표시명, 수행기관 등)는 env default 금지. DB 컬럼 또는 attrs로 관리. env는 비밀+인프라 상수만.

---

## 코드 컨벤션

### 파일 명명

- 컴포넌트: `kebab-case.tsx` (예: `question-edit-modal.tsx`)
- 스토어/유틸/액션/타입: `kebab-case.ts`
- 서버 전용 운영 집계: `*.server.ts`

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

1. **타입 안전성**: Drizzle ORM + TypeScript strict. JSONB 컬럼은 `schema-types.ts`의 타입으로 `.$type<...>()` 지정.

2. **상태 관리**: 서버 상태는 TanStack Query, 클라이언트 상태는 Zustand(+Immer).

3. **응답 페이지는 snapshot 기반**: 빌더 수정은 publish 전까지 응답 페이지 미반영. "테스트 모드 OK + 응답 페이지 NG" 패턴이면 publish 누락 먼저 의심.

4. **테이블 질문**: `tableColumns`, `tableRowsData`, `tableHeaderGrid`, `tableValidationRules`, `dynamicRowConfigs` JSONB 사용. choice 응답값은 `cell.id`.

5. **다단계 선택**: `selectLevels` 배열로 3단계까지. 부모 선택에 따라 동적 로딩.

6. **export 라벨**: `cell.exportLabel || generateExportLabel(questionCode_열_행)` 폴백 필수 (빌더는 placeholder만 표시, DB null 흔함).

7. **마이그레이션**: drizzle migrate는 `_journal.json`만 따라감. 수동 SQL은 silent skip → Supabase MCP `apply_migration` 또는 직접 SQL. `TRUNCATE CASCADE` 금지 (ON DELETE SET NULL 무시).

8. **서버 sanitize**: jsdom 의존 라이브러리 금지 (isomorphic-dompurify 크래시). `sanitize-html` 사용.

9. **테스트**: Vitest include는 `tests/` + `src/features/**/*.test.ts`(colocated procedure 테스트). service 모킹은 `tests/integration` 패턴(top-level `vi.mock` + `vi.mocked`). 실DB 왕복은 `*.realdb.test.ts` — `pnpm test:integration`(로컬 supabase 54322 필요), 일반 `pnpm test`에서는 스킵. `tests/integration/profiles-row-actions.test.ts`는 전체 스위트에서 간헐 12 fail하는 알려진 flaky(격리 실행은 항상 통과) — 회귀로 오해 금지.

10. **drizzle 함정**: timestamptz optimistic lock은 PG μs ↔ JS ms 정밀도 차로 거짓 충돌 (version int 또는 string mode 사용). `ANY(${arr})` 바인딩 금지 (length=1 silent unwrap) → `inArray`/`sql.join`.

---

## Agent skills

### Issue tracker

이슈는 레포 내 `.scratch/<feature-slug>/` 아래 로컬 마크다운 파일로 관리. See `docs/agents/issue-tracker.md`.

### Triage labels

트리아지 라벨은 기본 어휘 그대로 사용 (needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

단일 컨텍스트 — 루트 `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.
