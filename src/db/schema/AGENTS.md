# 데이터베이스 스키마 — src/db/schema

> 루트 `AGENTS.md` 에서 떼어 낸 상세 참조다. 이 디렉터리 아래를 만질 때 읽는다.
> 공통 규칙(주의사항·코드 컨벤션·마이그레이션 번호·CI 게이트)은 루트 `AGENTS.md` 에 있다.
> `CLAUDE.md` 는 이 파일을 가리키는 심볼릭 링크다 — 수정은 이 파일에 한다.

## 데이터베이스 스키마

스키마 파일은 도메인별로 분리: `surveys.ts`, `survey-documents.ts`, `contacts.ts`, `mail.ts`, `mail-billing.ts`, `r2-lifecycle.ts`. JSONB 컬럼의 문서 형태(어휘)는 `src/shared/contracts/<domain>.ts`에 두고 스키마가 `$type<>()`로 참조한다(DB→shared 단방향). 영속 질문 필드 SSOT는 `question-persisted-fields.ts`.

### 설문 도메인 (surveys.ts)

```
surveys                    # 설문 설정
├── id, title, description, slug, privateToken, previewToken
├── isPublic, allowMultipleResponses, showProgressBar, shuffleQuestions, requireLogin
│                                 #   allowMultipleResponses = 「중복 응답 허용」(조사원 대리 응답, 2026-10-30) — 라이브 컬럼(control 로 흘린다). 켜면 초대 토큰 없는 응답의 기기 중복 검사(Track B)를 진입·첫 답 저장 둘 다 건너뛰고 완료 화면에 「새 응답 시작」. 초대 링크는 그대로 토큰당 하나
├── endDate, maxResponses, thankYouMessage, screenedOutMessage (자격미달 종료 문구, NULL=완료 문구 폴백, 0110), contactEmail, responseHeader (JSONB)
├── localizedMessages (JSONB)     # 언어별 설문 글자 { zh?, en? : { title, description, thankYou, screenedOut } } (0145, NULL=한국어만, 빈 칸은 한국어 폴백). 발행 스냅샷 settings 에 얼린다(라이브 아님). 계약 shared/contracts/survey 의 LocalizedSurveyTexts — `src/features/AGENTS.md` 「다국어 설문」
├── piiRetentionUntil (개인정보 보관기한)
├── contactColumns / testContactColumns (JSONB)  # 컨택리스트 표시 컬럼 스킴 (실/테스트 분리)
│                                 #   컬럼별 플래그: hidden(목록 숨김) · piiType · groupLevel(진척보고 분류 축)
│                                 #   · showInMail(단체 메일 위저드·캠페인 상세 수신자 표·수신거부 명단에 열 노출 — attrs.* 는 값, pii.* 는 마스킹 힌트(켠 열만 서버가 읽는다), system.contact_owner 는 컨택원 이름(게스트 화면 제외), system.resid 는 기본 보임이라 끈 경우만 false. 해석 lib/contacts/mail-display-columns)
│                                 #   · mailOrder(메일 발송 주소 순서 1부터, 이메일로 암호화된 열 전용 — `src/server/mail/AGENTS.md`)
├── lookups (JSONB)               # 설문에 복사된 LUT 사본 목록
├── contactResultCodes (JSONB)    # 결과코드 사용자 정의
├── progressColumns (JSONB)       # 진척률 표 컬럼 픽커
├── profileColumns (JSONB)        # 응답 내역 표 컬럼 픽커 — 열 키 sys.·attrs.·pii.·entry.·answer.<문항 id>[.<칸 id>](응답값 열, 2026-10-23: 단답형·장문형·표 입력 칸을 변수명으로 찾아 추가, 저장은 id, 쪽 행만 JSONB 에서 꺼내 암호문은 복호화, 정렬 없음. 2026-10-30 부터 선택형(단일·복수·드롭다운, 보기 그룹이 default 하나인 보기 표)과 표 선택 칸(단일·드롭다운·체크박스)도 — 보기 글자로 보이고(복수는 「, 」, 상세 기재는 괄호) 검색·깔때기도 보기 글자로 맞춘다(글자 → 저장값으로 바꿔 jsonb_path 로 비교, 번호로는 안 걸림). 후보·보기 목록 lib/operations/profile-answer-sources, 변환 profile-answer-choices. 검색바·전체 검색·머리 깔때기는 부분일치와 값 없음/있음(profiles-filters 의 answerTextSql), 암호화 저장 칸은 후보에서 빠진다. 후보 read-models/profile-column-scheme 의 getProfileAnswerSources, 값 server/operations/services/profile-answer-values)
├── quotaConfig (JSONB)           # 쿼터 플랜 (NULL = 쿼터 없음) — 라이브 컬럼
├── isPaused, pausedMessage       # 응답 일시중지 — 라이브 컬럼
├── testModeEnabled, testToken    # 테스트 환경 (테스트 링크가 산다). 콘솔이 테스트 파티션을 보는 건 브라우저 쿠키까지 켠 곳만 — `src/server/AGENTS.md` 「테스트 모드」
├── priorWaveLabel                # 추적조사 지난 회차 라벨 — 라이브 컬럼
├── priorAnswerImportConfig (JSONB)  # 이월 응답 임포트 확정 매핑 (문항코드 블록 → 문항 id + 값 대응)
├── endRedirects (JSONB)          # 종료 후 이동 주소 {completed, screenedOut, quotaClosed, passParams} — 라이브 컬럼(0138), 판정 lib/survey/end-redirect, CONTEXT.md 「종료 후 이동 주소」
├── changeConfirmEnabled          # 문항별 변동 확인 사용 여부(기본 false) — 라이브 컬럼.
│                                 #   false 면 이월 값을 표시되는 문항에 미리 깔고 응답자가 고치면 덮어쓴다
├── requireInviteToken            # invite token 강제 여부
├── forceWideLayout               # 강제 와이드 레이아웃
├── status                        # 'draft' | 'published' ('closed' 는 미구현 어휘 — 쓰는 경로 없음, 종료는 endDate/isPaused 로)
├── currentVersionId              # 현재 활성 배포 버전
├── testVersionId                 # 지금 테스트 버전 (0141) — 테스트 링크·대상자·관리자 미리보기가 보는 저장본 스냅샷. `src/server/AGENTS.md` 「테스트 모드」
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
├── collapseButtonLabel           # 문항 접어 두기 버튼 글자(0154, NULL·공백=꺼짐) — 응답 화면에서 그 버튼을 눌러야 문항이 펼쳐진다(CONTEXT.md 「문항 접어 두기」)
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
├── mobileOriginalTable, mobileTableDisplayMode,  # 표시 방식 auto|drilldown-original-row|row-wise-original|row-wise-scale|row-cards|row-group-cards|axis-cards|item-cards|original (0129 CHECK — 어휘를 늘리면 배열·check()·마이그레이션 셋을 함께, 루트 AGENTS.md 주의사항 1). 방식별 규칙은 CONTEXT.md 「모바일 표시 방식」과 방식별 용어 절
│   mobileDrilldownOmitLeadingColumns,
│   mobileDrilldownRepeatHeaderStartRow/EndRow      # 모바일 표 렌더
├── mobileItemCardBlockColumns (JSONB)  # 「항목 단위 카드」 블록 시작 열 번호 배열(1부터, 작성 열 순서, NULL=블록 없음, 0131). 경계는 저작자가 적는다(자동 추정 없음) — CONTEXT.md 「블록 단위로 세우기」
├── hideColumnLabels, pageBreakBefore
├── stickyColumnCount            # 좌측 고정 열 개수 (NULL=자동 판정, 0~3=명시 지정)
├── fitTableToWidth              # 화면 폭에 맞춰 표 줄이기 (기본 false, 0146) — `src/features/AGENTS.md` 「질문 유형」의 좌측 고정 열 다음 항목
├── scaleMeanEnabled             # 평균 산출 = 운영 콘솔 「척도 평균」의 「문항 선택」 (기본 false, 0147) — 그 표의 줄. radio·select·table 전용. 빌더는 쓰지 않는 콘솔 소유 컬럼(CONSOLE_OWNED_QUESTION_FIELDS), `src/features/AGENTS.md` 「질문 유형」
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
├── resultCode, note
├── createdBy                     # 기록자 id — auth.users FK ON DELETE SET NULL(0152). uuid 이고 auth.users 에 있을 때만 채운다
├── createdByEmail                # 기록자 이메일 스냅샷 (0152, 늘 채운다 — 회차 목록 「기록자」 열). 그 전 회차는 둘 다 NULL
└── createdAt  (UNIQUE contactTargetId+attemptNo)

contact_target_edit_logs   # 대상 정보 수정 현황 (0152) — 조사 대상 상세에서 손으로 바꾼 기록, 바꾼 쓰기와 같은 트랜잭션
├── id, surveyId (cascade), contactTargetId (cascade)   # 파티션 열 없음 — 대상이 이미 실/테스트에 속한다
├── action                        # info_edit | attempt_edit | attempt_delete | assignment_change (CHECK)
├── changes (JSONB)               # ContactTargetEditChange[] (shared/contracts/contacts) — 열·컨택원 이름은 그때 스냅샷, pii 는 값 없이 op 만, 값은 1,000자에서 자름
├── editedBy (text), editorEmail  # 편집자 — 응답 편집 이력과 같은 스냅샷 관례
└── createdAt                     # clock_timestamp() — 잠금 뒤 줄 선 저장끼리 최신순이 뒤집히지 않게. INDEX (contactTargetId, createdAt desc)

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
                 ├─ (N) contact_target_edit_logs (대상 정보 수정 현황)
                 ├─ (1) contact_prior_answers (이월 응답)
                 └─ (1) contact_assignments [optional — 지금 맡은 컨택원, 같은 isTest]

saved_questions / saved_lookups / saved_cells / question_categories (standalone)
mail_billing_periods / webhook_events (standalone)
r2_deletion_candidates / r2_sent_keys / r2_key_refs (standalone — 키 문자열로만 연결)
```
