# Survey Table Project - 에이전트 참조 문서

## 프로젝트 개요

Next.js 16 기반의 고급 설문조사 빌더 + 운영 플랫폼. 복잡한 질문 유형, 조건부 로직, 버전 스냅샷, 컨택 관리, 메일 캠페인, SPSS/엑셀 내보내기, 분석 기능을 갖춘 엔터프라이즈급 애플리케이션.

> 최종 갱신: 2026-09-02 (공지 배경색 notice_bg_color 0099 · 보기 옵션 그룹별 필수(ChoiceGroup.required, 상속) · 필수 마스터 전파 ADR 0021 · 질문 읽기 매퍼 mapQuestionRow + 전수 대조 테스트 · export 테스트 파티션 스코프 · 이전: 문항 수요조사 0097·0098 · piiEncrypted 셀 암호화 0085 · contact_id_lists 0084)

---

## 기술 스택

| 영역           | 기술                                        | 버전            |
| -------------- | ------------------------------------------- | --------------- |
| 프레임워크     | Next.js (App Router, Turbopack)             | 16.2.11         |
| UI 라이브러리  | React (React Compiler)                      | 19.2.3          |
| 스타일링       | TailwindCSS                                 | 4.x             |
| 컴포넌트       | shadcn/ui (Radix UI)                        | -               |
| 상태관리       | Zustand + Immer                             | 5.0.8 / 11.1.3  |
| 데이터 페칭    | TanStack Query                              | 5.90.11         |
| RPC            | oRPC (server/client/tanstack-query/openapi) | 1.14.4          |
| 폼 관리        | React Hook Form                             | 7.63.0          |
| 스키마 검증    | Zod                                         | 4.4.3           |
| 테이블         | TanStack Table                              | 8.21.3          |
| 가상화         | TanStack Virtual                            | 3.13.23         |
| 텍스트 측정    | @chenglou/pretext                           | 0.0.5           |
| 리치 에디터    | TipTap                                      | 3.15.3          |
| 드래그앤드롭   | @dnd-kit                                    | -               |
| ID 생성        | NanoID                                      | 5.1.11          |
| ORM            | Drizzle ORM                                 | 0.45.2          |
| DB 드라이버    | postgres (postgres-js)                      | 3.4.7           |
| 데이터베이스   | PostgreSQL (Supabase)                       | -               |
| 파일 저장소    | Cloudflare R2 (S3 호환)                     | -               |
| 이미지 처리    | sharp                                       | 0.35.3          |
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
│   ├── create/                 # 설문 생성 진입
│   ├── analytics/              # 분석 대시보드
│   └── unsubscribe/            # 메일 수신거부 (+ /restored)
│
├── features/                   # feature 단위 백엔드 (oRPC) — 11개 도메인
│   └── <feature>/              # survey-builder · survey-response · survey-document · operations · contacts
│       │                       # · mail · analytics · library · auth · media · quota
│       ├── domain/             # 타입 re-export + zod 스키마 (런타임 import 0, JSONB는 z.custom)
│       └── server/
│           ├── procedures/     # oRPC procedure (authed/scoped/pub, 얇은 위임) + colocated *.test.ts
│           └── services/       # 비즈 로직 + drizzle (server-only, requireAuth/revalidatePath 없음)
│
├── server/                     # oRPC 코어
│   ├── context.ts              # createContext (supabase session + db + headers — RSC·procedure 공용)
│   ├── orpc.ts                 # base + pub / authed(admin) / scoped(게스트 grant) + withRateLimit
│   ├── router.ts               # 전체 feature router 합성 (AppRouter)
│   ├── handler.ts              # RPCHandler (+ Sentry onError)
│   ├── openapi.ts              # OpenAPI 핸들러 (ENABLE_PUBLIC_API 게이트)
│   ├── rpc-logging.ts          # 전 procedure 구조화 로그 미들웨어
│   ├── rpc-error-policy.ts     # 에러 → RPC 코드 매핑
│   └── rpc-timeout.ts          # 타임아웃 가드
│
├── shared/                     # feature 간 공용 (feature 직접 import 금지의 탈출구)
│   ├── lib/rpc.ts              # 타입드 RPC client: client(plain 호출) + orpc(TanStack utils)
│   ├── lib/survey-control.ts   # 설문 운영 제어 공용 로직
│   └── types/test-attempt.ts
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
├── components/                 # React 컴포넌트 (~250개)
│   ├── survey-builder/         # 설문 생성 컴포넌트 (107개)
│   ├── operations/             # 운영 콘솔 컴포넌트 (71개)
│   ├── survey-response/        # 응답 입력 컴포넌트 (20개)
│   ├── analytics/              # 차트 및 리포팅 (17개)
│   ├── ui/                     # shadcn/ui 기반 컴포넌트 (35개)
│   ├── survey/                 # 공개 설문 공용
│   └── providers/              # Context providers
│
├── stores/                     # Zustand 스토어 (7개 + index)
│   ├── survey-store.ts         # 메인 설문 빌더 상태
│   ├── survey-response-store.ts # 실제 응답 상태
│   ├── test-response-store.ts  # 테스트/미리보기 응답
│   ├── survey-list-store.ts    # 설문 목록 관리
│   ├── question-library-store.ts # 질문 라이브러리
│   ├── ui-store.ts             # 전역 UI 상태
│   ├── error-dialog-store.ts   # 전역 에러 다이얼로그
│   └── index.ts
│
├── hooks/                      # 커스텀 훅
│   ├── queries/                # TanStack Query 훅 (surveys/responses/contacts/campaigns/library/cell-library/file-cleanup)
│   ├── use-survey-sync.ts      # 설문 데이터 동기화
│   ├── use-library-sync.ts     # 라이브러리 동기화
│   ├── use-dynamic-row-* / use-row-* / use-cell-height-cache.ts # 테이블 레이아웃
│   ├── use-question-response-writer.ts # 응답 쓰기 단일 창구
│   ├── use-media-query / use-keyboard-open.ts # 반응형
│   └── ... (테이블 성능/스크롤 동기화/라인카운트/검색파라미터 등)
│
├── lib/                        # 도메인 로직 + 유틸리티
│   ├── supabase/               # Supabase 클라이언트 (client/server/middleware)
│   ├── auth/ + auth.ts         # admin allowlist, 게스트 grant, 설문 소유권 가드
│   ├── rate-limit/             # Upstash 2단 레이트리밋 + 신뢰 IP 추출
│   ├── logger/                 # pino + Axiom transport, redact, route/context 로깅
│   ├── crypto/                 # PII 암호화 (cipher + blind index, 컨택·응답 공용)
│   ├── contacts/               # 엑셀 파서, 컬럼 자동감지, 스킴 헬퍼, 업로드 제한
│   ├── operations/             # 운영 콘솔 집계 로직 (*.server.ts = SQL 집계)
│   ├── mail/                   # 메일 발송/렌더/캠페인 dispatch+reconcile/빌링/첨부
│   ├── quota/                  # 쿼터 게이트 + 응답 매칭
│   ├── r2-lifecycle/           # R2 유예 삭제 큐 + 발송 장부 + 참조 인덱스
│   ├── spss/                   # SPSS .sav 빌더 + 변수 생성/검증 + 데이터 변환
│   ├── inngest/                # Inngest 클라이언트 + functions
│   ├── question/               # 질문 스키마/정규화/가드/변형
│   ├── survey/                 # 토큰 치환, 이미지/첨부 promote, 컨택 attrs context
│   ├── survey-builder/         # changeset, diff payload
│   ├── survey-response/        # 버전 rebase, 구조 생존 판정, 테스트 응답 초기화
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
│   ├── branch-logic / branch-eval.ts # 분기 로직 평가
│   ├── classify-table / renders-as-table.ts # 테이블 분류
│   ├── choice-source / ranking-source / ranking-shared / choice-group-helpers.ts # 옵션 소스 해석
│   ├── option-code-generator / option-value-remap / table-cell-code-generator.ts # 코드 발번
│   ├── spss-var-name.ts        # SPSS 변수명 생성
│   ├── cell-type-detector / cell-label / cell-style / cell-library-helpers / serialize-cell.ts
│   ├── table-grid-utils / table-merge-helpers / table-cell-optimizer / expand-header-grid.ts
│   ├── mobile-* (card-options / display-cells / drilldown-repeat-header / original-row / table-display-mode)
│   ├── number-format / numeric-input / options-layout / expression-migration.ts
│   └── ...
│
├── db/
│   ├── index.ts                # drizzle(postgres-js) 클라이언트
│   └── schema/                 # Drizzle ORM 스키마 (아래 DB 섹션 참조)
│
├── types/survey.ts             # 설문 관련 타입 정의 (도메인 타입 SoT)
├── instrumentation.ts          # Sentry 서버 instrumentation
├── instrumentation-client.ts   # Sentry 클라이언트 instrumentation
└── proxy.ts                    # Next 미들웨어 (/admin, /analytics 세션 갱신)
```

---

## 데이터베이스 스키마

스키마 파일은 도메인별로 분리: `surveys.ts`, `contacts.ts`, `mail.ts`, `mail-billing.ts`, `r2-lifecycle.ts`, JSONB 타입은 `schema-types.ts`. 영속 질문 필드 SSOT는 `question-persisted-fields.ts`.

### 설문 도메인 (surveys.ts)

```
surveys                    # 설문 설정
├── id, title, description, slug, privateToken, previewToken
├── isPublic, allowMultipleResponses, showProgressBar, shuffleQuestions, requireLogin
├── endDate, maxResponses, thankYouMessage, contactEmail, responseHeader (JSONB)
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
├── requireInviteToken            # invite token 강제 여부
├── forceWideLayout               # 강제 와이드 레이아웃
├── status                        # 'draft' | 'published' | 'closed'
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
├── rankingConfig (JSONB)         # 순위형 전용
├── optionsColumns, optionsAlign, mobileOptionsColumns, minSelections, maxSelections, allowOtherOption
├── placeholder, defaultValueTemplate  # 단답형(prefill 토큰 지원)
├── inputType, emptyDefault, numberFormat (JSONB)  # 단답형 숫자 입력 모드
├── piiEncrypted                  # 응답값 암호화 저장 여부 (단답형·장문형). 표 input 셀은 tableRowsData 의 셀 piiEncrypted
├── questionCode, isCustomSpssVarName, exportLabel, spssVarType, spssMeasure, exportCellOrder  # SPSS export
├── answerQuoteEnabled, answerQuoteName, answerQuoteText  # 이전 응답 인용
├── mobileOriginalTable, mobileTableDisplayMode,
│   mobileDrilldownOmitLeadingColumns,
│   mobileDrilldownRepeatHeaderStartRow/EndRow      # 모바일 표 렌더
├── hideColumnLabels, pageBreakBefore
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
├── status                        # in_progress|completed|screened_out|quotaful_out|bad|drop
├── platform, browser, currentStepId, pageVisits (JSONB)  # 운영 현황 추적
├── lastActivityAt, totalSeconds, progressPct, visibleStepIndex, visibleStepTotal
├── contactTargetId               # 컨택 매칭 (FK는 마이그레이션에서 ALTER로 생성)
└── createdAt
└── UNIQUE(surveyId, sessionId)   # 동시 INSERT race 차단

survey_documents           # 조사표 — 설문에 붙는 PDF (설문당 여러 행 허용)
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
├── status                        # 'published' | 'superseded' | 'closed'
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

> 운영 집계는 `lib/operations/*.server.ts` 에서 SQL 집계로 수행 (aggregate + format + wrapper 패턴). 정확한 통계는 `question_responses` JSONB 기준 (response_answers는 saveResponse/saveAdminEdit 에서만 채워짐).
> 콘솔 조회·쓰기는 `loadOperationsDataScope`가 결정한 실/테스트 파티션(`is_test`)에 갇힌다. 엑셀·SPSS export 라우트도 같은 스코프를 탄다. 신규 집계 쿼리는 스코프 필터를 빠뜨리지 말 것.
> 조사 대상·단체 메일 위저드의 시스템ID/attrs 컬럼 검색은 **엑셀 열 붙여넣기 ID 목록**을 받는다 (`lib/operations/range-list.ts` — 공백·개행·탭·콤마 구분, 중복 제거). 단일 컬럼 인라인 상한 2,000개(URL 헤더 한계), 초과분은 `contacts.idLists.create` 로 `contact_id_lists` 에 저장하고 `q=list:<uuid>:<count>` 토큰으로 검색한다. 파서는 동기라 페이지/서비스가 `loadIdListsForValues` 로 토큰을 먼저 읽어 `parseClausesFromUrl(…, { idLists })` 에 넘긴다 — 새 파싱 지점을 만들면 이 단계를 빠뜨리지 말 것. 「전체」 컬럼 검색의 200개 상한은 컬럼 곱연산 SQL 보호용으로 별개다.

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
| `notice`      | 안내문             | noticeContent, noticeBgColor, requiresAcknowledgment                                                  |

공통: `requiredMessage`(필수 미응답 문구), `hideTitle`, `pageBreakBefore`(수동 페이지 나눔), `answerQuote*`(이전 응답 인용), `displayCondition`.

- **그룹별 필수**: `ChoiceGroup.required`/`requiredMessage` (JSONB) — 미설정이면 질문 레벨 `required` 상속. 질문 필수여도 특정 그룹만 해제하거나 그 반대가 가능하며, 문구는 그룹 → 질문 → 기본 순 폴백.
- **필수 마스터 전파**: 질문 편집 모달의 "필수 질문" 토글 조작 시 표의 인터랙티브 셀 필수(게이팅 셀은 `requiredWhenEnabled`)와 그룹 오버라이드를 일괄 재설정한다. 상속이 아닌 조작 시점 복사 — `docs/adr/0021` · CONTEXT.md "필수 마스터 전파".

### 테이블 질문 셀 타입

- `text`: 텍스트 표시 / `image`: 이미지 / `video`: 비디오 링크
- `checkbox` / `radio` / `select`: 선택 입력
- `input`: 텍스트 입력 (inputType `number` 시 숫자만). `piiEncrypted` 셀 플래그로 그 셀 응답값만 암호화 저장 (질문 단위 토글과 같은 규칙, 파기 스윕은 0085 — 이월 응답 파기 0095 와 합본한 현행 본문은 0100)
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
  └─ service 직접 호출 (RPC 자기호출 금지)  # features/*/server/services 또는 data/·lib/operations/*.server.ts
```

- 서버 상태는 TanStack Query, 클라이언트 상태는 Zustand로 분리. mutation 후 RSC 데이터 갱신은 `router.refresh()` (revalidatePath는 procedure에서 불가).
- procedure 베이스 3종은 아래 "인증과 권한" 참조. 모든 베이스는 `rpcLoggingMiddleware`가 붙은 `base` 파생이라 성공/실패가 구조화 로그 1줄로 남는다.
- 잔존 서버 액션은 `actions/` 3파일뿐 (auth login/logout + unsubscribe form — 의도적 유지).
- **feature 마이그레이션 패턴/함정**: domain zod는 `@/types/survey` 방향 통일 + null-coalescing(as unknown as 금지), service input은 zod infer, `.returning()` 후 non-null throw, 컴포넌트는 hook/helper 시그니처 유지로 무수정. 질문 영속 쓰기는 explicit field set(spread 금지) + `PERSISTED_QUESTION_FIELDS` SSOT 로 tsc 관할 — 신규 컬럼은 SSOT 등재만 하면 모든 쓰기 지점(survey-save values/onConflict, create, duplicate, updateQuestion 순회)이 컴파일 에러로 호명된다. **읽기 방향은 tsc 가 못 잡는다** — 발행 스냅샷·빌더 로드가 공유하는 행→Question 매퍼(`data/surveys.ts` `mapQuestionRow`)도 명시 나열이라, 누락 시 발행 스냅샷에서 값이 조용히 증발한다(noticeBgColor 실사고). 전수 대조는 `tests/unit/data/map-question-row.test.ts` 가 잡는다.
- feature 간 직접 import 금지 (ESLint 강제) — 공용은 `@/shared` 승격 또는 RPC 경유. 서버 내부의 타 도메인 테이블 직접 쿼리는 허용.

---

## API 엔드포인트

```
POST   /api/rpc/[[...rest]]                    # oRPC 핸들러 — 전체 query/mutation (메인 경로)
*      /api/v1/[[...rest]]                     # OpenAPI 핸들러 (ENABLE_PUBLIC_API 게이트, 기본 비활성)
POST   /api/upload/image                       # 이미지 업로드 (multipart, 삭제는 media.deleteImages RPC)
POST   /api/upload/mail-attachment             # 메일 첨부 업로드 (삭제는 media.* RPC)
POST   /api/upload/notice-attachment           # 공지 첨부 업로드 (삭제는 media.* RPC)
POST   /api/upload/survey-document             # 조사표 PDF 업로드 (tmp 로 받고 쪽 수 판독, promote 는 attach RPC)
GET    /api/surveys/[surveyId]/export          # SPSS(.sav)/엑셀 export (인증 필요, 파일 스트림)
GET    /api/surveys/[surveyId]/export/split-preview  # 분할 export 미리보기
GET    /api/surveys/[surveyId]/contacts/export # 조사 대상 목록 엑셀 다운로드
GET    /api/surveys/[surveyId]/demand-summary  # 문항 수요 집계표 엑셀 (화면의 정렬·필터를 쿼리로 받음)
POST   /api/response/segment                   # 구간 응답 저장 (sendBeacon — REST 유지)
POST   /api/response/draft                     # 이탈 시점 임시 저장 (sendBeacon — REST 유지)
*      /api/inngest                            # Inngest 핸들러
POST   /api/webhooks/resend                    # Resend webhook (svix 검증)
```

---

## 백그라운드 잡 (Inngest)

`lib/inngest/functions/` — 4개 함수 (`functions/index.ts` 등록).

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
- **로깅** (`lib/logger/`): pino + Axiom transport. `base`의 `rpcLoggingMiddleware`가 최전방이라 인증·레이트리밋 거부까지 기록된다. PII 마스킹은 `redact.ts` 소관.

---

## R2 파일 수명주기

R2 영구 객체 삭제의 유일한 경로는 유예 삭제 큐다 (`lib/r2-lifecycle/`).

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

`surveys.quota_config` (JSONB, NULL = 쿼터 없음) + `features/quota` + `lib/quota/`.

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
  (`lib/survey-document/pdf-page-count.server.ts`). **R2 참조 표면 SSOT 등재 필수.**
- **영역 앵커** `survey_document_anchors` (0098) — 쪽 번호 + 정규화 0~1. 한 대상에 사각형 여럿.
  대상 참조는 `question_id`/`group_id` nullable FK 둘 + CHECK 정확히 하나 (종류 구분값은 파생).
- **분할 레이아웃** — 설정이 아니라 **파생**이다. 토글 0개. **페이지마다** 판정한다: 앵커 걸린
  항목을 담은 페이지만 좌 조사표 / 우 질문 50:50 이고, 조사표에 등록되지 않은 페이지는 일반
  문항 페이지로 나온다(안내문 → 다음 → 조사표). 판정은 `lib/group-ordering.ts` 의
  `resolveSplitSteps` — **구조 기준**이라 조건부로 숨은 질문의 앵커도 센다.
  좌측에 _그리는_ 것은 표시되는 항목 것만이다. 레이아웃은 구조에서, 표시는 조건에서.
  경계를 넘나들면 뷰어가 언마운트되므로 pdf.js 문서는 주소별로 캐시한다
  (`pdf-page-view.tsx` 의 `openedDocs`). 진행바는 **설문 전체**에서 뺀다 — 페이지마다
  넣었다 뺐다 하면 넘길 때 머리 부분이 들썩인다.
- **수명 분리**: 조사표 파일 참조는 라이브, 앵커는 발행 스냅샷에 freeze, 교체 가드 없음 —
  `docs/adr/0020-survey-document-live-anchors-frozen.md`. 다른 조사표로 바꾸면 **에러 없이
  잘못 그려진다**는 것이 받아들인 위험이다.
- **판단 항목은 평범한 radio** — 필요함 / 필요하지 않음 / 의견(`allowTextInput`). 의견을 골라놓고
  서술이 비면 답으로 치지 않는다(기존 `required-option-text-validation`). 의견 텍스트는
  `__optTexts__` 사이드카에 산다 — 질문 id 로 순회하는 새 경로마다 한 번 분기할 것.
- **운영 관례**: 이 형식은 `requireInviteToken` 을 **켜는 것을 관례로 한다**(신설 없음, 기존 설정).
  익명 응답 한 건이 n=5 짜리 집계를 흔든다. `allowMultipleResponses` 는 켜지 않는다 —
  같은 사람의 응답이 여러 건 쌓여 집계 분모가 이중 계산된다. 제출 후 수정은 관리자 편집 화면으로.
- 조사표는 설문 단위라 테스트 파티션과 무관하다 — 테스트 모드도 같은 파일을 쓰고 별도 업로드가 없다.
- 모바일은 진입 시 뷰포트 폭으로 설문 전체를 안내 화면으로 막는다. **관리자 응답 편집만 면제** —
  이 스펙이 만드는 유일한 조건 분기다.

---

## 테스트 모드

설문 단위 토글(`surveys.testModeEnabled` + `testToken`)로 운영 콘솔 전체가 테스트 파티션으로 전환된다. 파티션 키는 `is_test` 컬럼(`contact_targets`, `survey_responses`, `mail_campaigns`)이며, `contact_targets`의 resid UNIQUE도 `(surveyId, isTest, resid)`다.

- 읽기/쓰기 파티션은 `lib/operations/data-scope.server.ts`의 `loadOperationsDataScope`가 단일 결정한다. 신규 집계·목록 쿼리는 이 스코프를 반드시 태울 것.
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
pnpm test             # Vitest — 본 스위트 + 격리 flaky 2단 실행
pnpm test:watch       # Vitest watch
pnpm test:coverage    # 커버리지 (spss 계열만 집계)
pnpm test:e2e         # Playwright E2E
pnpm test:integration # 실DB 왕복 (*.realdb.test.ts, 로컬 supabase 54322 필요)
pnpm db:setup-test    # 테스트 DB 준비
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
> `.env.example`의 `BETTER_AUTH_*` 항목은 미착수 전환 계획의 잔재로 코드에서 참조되지 않는다.

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

13. **응답 루트 사이드카**: `questionResponses` 최상위의 `__` 접두 키(`__optTexts__` 기타/상세 기재, `__changeConfirm__` 추적조사 변동 확인)는 실존 문항이 아니라 저장 경계마다 분기가 필요하다 — 분리를 빠뜨리면 `saveDraft` 는 소속 검증에서 500 이 되고 `complete` 는 멤버십 필터에서 값을 조용히 버린다(둘 다 실제로 겪은 사고). 키와 정제 함수는 `lib/survey/response-sidecars.ts` 한 곳에 등록하고, 저장 경계는 `splitRootSidecars`/`isPersistedRootSidecarKey`/`sanitizeRootSidecar` 로만 판정한다. 등록되지 않은 `__` 키는 기존대로 거부된다(루트 `__dynamicRowSelections__` 가 미등록 상태 — 별도 판단 필요).

---

## CI 게이트

`.github/workflows/ci.yml` — 변경 범위 판별 후 아래를 순차 실행한다. 로컬에서 미리 돌려야 할 것은 `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm test`.

| 게이트                | 스크립트                            | 역할                                          |
| --------------------- | ----------------------------------- | --------------------------------------------- |
| 공급망 보안 감사      | `.github/audit-gate.ts`             | 감사 리포트 평가 (리포트 누락 시 fail-closed) |
| RLS 하드닝            | `.github/rls-gate.ts`               | 마이그레이션의 RLS 정책 검증                  |
| 마이그레이션 드리프트 | `.github/migration-journal-gate.ts` | 미등재 `.sql` + 접두 번호 중복 차단            |

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
