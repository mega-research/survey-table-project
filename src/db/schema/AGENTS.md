# 데이터베이스 스키마 — src/db/schema

> 루트 `AGENTS.md` 에서 떼어 낸 상세 참조다. 이 디렉터리 아래를 만질 때 읽는다.
> 공통 규칙(주의사항·코드 컨벤션·마이그레이션 번호·CI 게이트)은 루트 `AGENTS.md` 에 있다.
> `CLAUDE.md` 는 이 파일을 가리키는 심볼릭 링크다 — 수정은 이 파일에 한다.

## 데이터베이스 스키마

스키마 파일은 도메인별로 분리: `auth.ts`, `workspace.ts`, `surveys.ts`, `survey-documents.ts`, `contacts.ts`, `mail.ts`, `mail-billing.ts`, `r2-lifecycle.ts`. JSONB 컬럼의 문서 형태(어휘)는 `src/shared/contracts/<domain>.ts`에 두고 스키마가 `$type<>()`로 참조한다(DB→shared 단방향). 영속 질문 필드 SSOT는 `question-persisted-fields.ts`. `users.status`·`users.user_type` 컬럼 어휘와 **허용 상태 전이표**(`USER_STATUS_TRANSITIONS`) SSOT는 `shared/contracts/auth.ts`, 사용자 관리 RPC 입출력은 `shared/contracts/auth-io.ts`. 팀 어휘(`teams.status`·`team_members.role`·감사 action)와 팀 관리 권한 술어, 그리고 `surveys.visibility` 어휘 + **화면 표기 SSOT**(`SURVEY_VISIBILITY_LABEL` — 「팀 공개」/「초대된 멤버만」, "팀 전체" 금지), `survey_participants.kind` 어휘와 제외 권한 술어(`canRemoveSurveyParticipant`)는 `shared/contracts/workspace.ts`, 팀 RPC 입출력은 `shared/contracts/workspace-io.ts`.

### 인증 도메인 (auth.ts — Better Auth 관할)

```
users                      # 계정 (Better Auth user 모델 + 확장 컬럼)
├── id (uuid PK — 앱이 crypto.randomUUID() 생성, DB default 없음)
├── name, email (UNIQUE), emailVerified, image
├── status                 # pending|active|rejected|suspended|departed — pending/rejected 는
│                          # 도달 불가 어휘(공개 가입 폐기, ADR-0018). DB default 'pending' 은 안전장치
├── isSuperadmin, jobTitle
├── organization           # 게스트 소속 기관 메모 (0113, nullable) — internal 은 팀·fieldwork 는 업체에서 소속을 얻는다
├── userType               # internal|guest|fieldwork (0112, NOT NULL default 'internal' + CHECK)
├── fieldworkOrgId         # 소속 실사 업체 (0120, nullable) — FK 는 마이그레이션 ALTER 가 만든다(순환 회피)
├── fieldworkRole          # leader|worker (0120, nullable) — 팀 역할과 별개 축
│                          # 위 둘과 userType 의 정합은 users_fieldwork_fields_check 가 지킨다:
│                          # fieldwork 면 둘 다 있어야 하고, 아니면 둘 다 NULL 이어야 한다
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

> **선반영 주의**: 프로덕션·스테이징에는 5테이블이 2026-07-14 선반영돼 있다. `0111_better_auth_tables.sql` 은
> **빈 DB 재생 전용 — 프로덕션·스테이징에 적용 금지**, 적용 대상은 `0112_better_auth_v2_reconcile.sql`
> (user_type + issuer 백필 + 어댑터 기대 인덱스)뿐이다. RLS 5테이블 전부 ON(정책 0 = deny-all).

### 워크스페이스 도메인 (workspace.ts — 팀·멤버십)

```
teams                      # 팀 = 설문 소유·접근 경계 (0115)
├── id, name (전체 조직 경로 포함 표시명), order
├── status                 # active | archived — 해산은 삭제가 아니라 archived (ADR-0011, 티켓 13)
├── kind                   # standard | fieldwork (0139, CHECK) — 실사팀 사이드바 표시 전용, 권한 판정은 안 읽는다
├── archivedBy, archivedAt
└── createdAt, updatedAt   (UNIQUE partial(name) WHERE status='active')

team_members               # 소속의 단일 정본 (ADR-0008)
├── id, teamId (FK restrict), userId (FK restrict)
├── role                   # leader | member
└── createdAt              (UNIQUE(teamId, userId) — 서로 다른 팀 겸직은 허용)

team_lifecycle_events      # 팀 감사 (append-only) — 팀 자체 + 멤버 구성
├── id, teamId (FK restrict)
├── action                 # create|rename|dissolve|kind_change | member_add|member_role|member_remove
├── targetUserId           # 멤버 사건의 대상 (팀 자체 사건은 NULL)
├── changedBy (FK restrict), metadata (JSONB — 사건 시점 팀 이름·역할)
└── createdAt

survey_groups              # 팀 공용 설문 그룹 = 정리용 폴더 (0117, 티켓 12)
├── id, teamId (FK restrict), name, order
├── createdBy (FK restrict)
└── createdAt, updatedAt   (UNIQUE(teamId, name) — 팀 안에서만 유일)

fieldwork_orgs             # 실사 업체 = 외주 실사 인력의 소속 경계 (0120, 티켓 24)
├── id, name, status       # active | archived — 종료도 삭제가 아니라 archived (ADR-0019)
├── memo                   # 운영 메모 (판정에 안 쓴다)
├── archivedBy, archivedAt, createdBy (FK restrict)
└── createdAt, updatedAt   (UNIQUE partial(name) WHERE status='active')

survey_participants        # 설문 단위 부여 — 참여자·게스트·실사 통합 (0119, 티켓 18·21)
├── id, surveyId (FK **cascade**), userId (FK restrict)
├── kind                   # member | guest | fieldwork — users.user_type 과의 정합은 서비스가 지킨다
│                          # (두 테이블에 걸친 조건이라 CHECK 불가)
├── guestTabs (JSONB)      # kind=guest 전용 현황 탭 화이트리스트 (티켓 21) — NULL 이면 기본값(응답 현황만)
├── accessLevel            # kind=member 전용 full|limited (0123) — 초대자가 참여자 열 전부를 갖지 않으면 limited.
│                          # limited = 참여자 열 ∩ 팀원 열(열람·편집·초대·현황·분석). 팀원이 자기·동료를 초대해 응답 원문을 얻던 우회 차단
├── addedBy (FK restrict), createdAt
└── UNIQUE(surveyId, userId)  # 한 사람이 한 설문에 두 자격으로 서지 않는다

survey_access_links        # 링크 = 설문 하나를 여는 **접속 수단 하나** (0126 → 0134 개명, ADR-0026·0029). 구 survey_fieldwork_links
├── id, surveyId (FK **cascade**), token (UNIQUE, 16자 이상 URL-safe — 재발급 경로 없음)
├── kind                    # fieldwork(외주 실사 링크) | client(클라이언트 링크) — NOT NULL default 'fieldwork' + CHECK (0134).
│                           # 어휘 SSOT 는 shared/contracts/workspace 의 accessLinkKindValues. **종류가 입구·열·닫히는 조건을 정한다**
├── clientTabs (JSONB)      # kind=client 전용 탭 화이트리스트(SurveyGuestTabs 와 같은 모양) — 외주에서는 NULL 이어야 한다(CHECK).
│                           # NULL 이면 기본값(응답 현황만). **쿠키가 아니라 매 요청 이 컬럼에서 읽는다**
├── passwordCipher          # **가역 암호화**(해시가 아니다) — 공유 출입 암호라 연구원이 다시 읽는다. 키는 컨택 PII 와 같은 것
├── passwordUpdatedAt       # **세션 폐기 표식** — 쿠키가 이 값을 들고 다니고 매 요청 대조한다(시각의 대소가 아니라 값의 일치)
├── passwordUpdatedBy, createdBy (FK restrict)
├── closedAt, closedBy      # 종료는 행 삭제가 아니라 상태 전환 — 귀속 FK 가 restrict 이라 하드 삭제가 막힌다
└── createdAt  (UNIQUE partial(surveyId, kind) WHERE closed_at IS NULL — 활성 링크는 설문당 **종류별** 하나, 종료된 행은 계보)

survey_ownership_events    # 설문 소유 팀·소유자 이동 감사 (0118, 티켓 14 — append-only)
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
> `surveys.team_id` 는 티켓 07 이, `survey_groups` 는 티켓 12 가, `survey_participants` 는 티켓 18 이 붙였다.
> **`survey_participants` 만 팀 축 밖이다** — 초대는 `team_members` 에 아무것도 쓰지 않고 그 설문 하나만 연다.
> **그룹은 접근 권한이 아니라 정리용 묶음이다** — 담겼다는 사실이 판정에 들어가지 않는다.
> `surveys.survey_group_id` 의 FK 는 `ON DELETE SET NULL` 이라 그룹 삭제는 설문을 미분류로
> 되돌릴 뿐이다. 그룹은 팀 소유물이므로 **설문이 팀을 옮기면 `survey_group_id` 도 NULL 로
> 내려야 한다** — 복합 FK 로 강제하지 못한 이유(MATCH SIMPLE 은 team_id NULL 을 건너뛰고
> MATCH FULL 은 그룹 없는 정상 설문을 위반으로 만든다)는 0117 헤더에 있고, 지키는 것은
> 서비스(잠긴 값 재검증)와 조회(team_id 동시 일치 조인)다. 팀 해산·재배치·승계(티켓 13·14·19)의 계약이다.

### 설문 도메인 (surveys.ts)

```
surveys                    # 설문 설정
├── id, title, description, slug, privateToken, previewToken
├── cardTitle                     # 카드 제목 (0140, nullable) — 목록 카드·운영 콘솔 머리의 관리용 이름. NULL 이면 title. 응답자는 안 본다
├── isPublic, allowMultipleResponses, showProgressBar, shuffleQuestions, requireLogin
├── endDate, maxResponses, thankYouMessage, screenedOutMessage (자격미달 종료 문구, NULL=완료 문구 폴백, 0110), contactEmail, responseHeader (JSONB)
├── localizedMessages (JSONB)     # 언어별 설문 글자 { zh?, en? : { title, description, thankYou, screenedOut } } (0145, NULL=한국어만, 빈 칸은 한국어 폴백). 발행 스냅샷 settings 에 얼린다(라이브 아님). 계약 shared/contracts/survey 의 LocalizedSurveyTexts — src/features/AGENTS.md "다국어 설문"
├── piiRetentionUntil (개인정보 보관기한)
├── contactColumns / testContactColumns (JSONB)  # 컨택리스트 표시 컬럼 스킴 (실/테스트 분리)
│                                 #   컬럼별 플래그: hidden(목록 숨김) · piiType · groupLevel(진척보고 분류 축)
│                                 #   · showInMail(단체 메일 위저드·캠페인 상세 수신자 표·수신거부 명단에 열 노출 — attrs.* 는 값, pii.* 는 마스킹 힌트(켠 열만 서버가 읽는다), system.contact_owner 는 컨택원 이름(외부 주체 화면 제외), system.resid 는 기본 보임이라 끈 경우만 false. 해석 lib/contacts/mail-display-columns)
│                                 #   · mailOrder(메일 발송 주소 순서 1부터, 이메일로 암호화된 열 전용 — src/app/AGENTS.md 「메일 발송 주소 순서」)
├── lookups (JSONB)               # 설문에 복사된 LUT 사본 목록
├── contactResultCodes (JSONB)    # 결과코드 사용자 정의
├── progressColumns (JSONB)       # 진척률 표 컬럼 픽커
├── profileColumns (JSONB)        # 응답 내역 표 컬럼 픽커 — 열 키 sys.·attrs.·pii.·entry.·answer.<문항 id>[.<칸 id>](응답값 열, 2026-10-23: 단답형·장문형·표 입력 칸을 변수명으로 찾아 추가, 저장은 id, 쪽 행만 JSONB 에서 꺼내 암호문은 복호화, 정렬 없음. 검색바·전체 검색·머리 깔때기는 부분일치와 값 없음/있음(profiles-filters 의 answerTextSql), 암호화 저장 칸은 후보에서 빠진다. 후보 read-models/profile-column-scheme 의 getProfileAnswerSources, 값 server/operations/services/profile-answer-values)
├── quotaConfig (JSONB)           # 쿼터 플랜 (NULL = 쿼터 없음) — 라이브 컬럼
├── isPaused, pausedMessage       # 응답 일시중지 — 라이브 컬럼
├── testModeEnabled, testToken    # 테스트 환경 (테스트 링크가 산다). 콘솔이 테스트 파티션을 보는 건 브라우저 쿠키까지 켠 곳만 — src/server/AGENTS.md 「테스트 모드」
├── priorWaveLabel                # 추적조사 지난 회차 라벨 — 라이브 컬럼
├── priorAnswerImportConfig (JSONB)  # 이월 응답 임포트 확정 매핑 (문항코드 블록 → 문항 id + 값 대응)
├── endRedirects (JSONB)          # 종료 후 이동 주소 {completed, screenedOut, quotaClosed, passParams} — 라이브 컬럼(0138), 판정 lib/survey/end-redirect, CONTEXT.md 「종료 후 이동 주소」
├── changeConfirmEnabled          # 문항별 변동 확인 사용 여부(기본 false) — 라이브 컬럼.
│                                 #   false 면 이월 값을 표시되는 문항에 미리 깔고 응답자가 고치면 덮어쓴다
├── requireInviteToken            # invite token 강제 여부
├── forceWideLayout               # 강제 와이드 레이아웃
├── status                        # 'draft' | 'published' | 'closed' — closed 는 **설문 종료**(ADR-0030, CHECK 없는 text 라 마이그레이션 없음).
│                                 #   전이는 published ⇄ closed 뿐(operations.control.setClosed, survey.edit) + 재발행이 published 로 되돌린다.
│                                 #   isPaused 와 독립이다. 스냅샷 밖 라이브 컬럼처럼 즉시 반영된다
├── currentVersionId              # 현재 활성 배포 버전
├── testVersionId                 # 지금 테스트 버전 (0141) — 테스트 링크·대상자·관리자 미리보기가 보는 저장본 스냅샷. 아래 "테스트 모드"
├── teamId                        # 소유 팀 (0116, nullable — 배치 대기면 NULL)
├── visibility                    # team | invite_only — invite_only 는 **소유 팀 팀원에게만** 숨김
├── ownerUserId, createdBy        # 소유자·작성자 (0116, 2단계 배포 중이라 아직 nullable)
├── surveyGroupId                 # 소속 그룹 (NULL = 미분류, FK ON DELETE SET NULL — 0117)
├── ownershipStatus               # normal | succession_pending (승계 전이는 티켓 19)
├── assignmentStatus              # assigned | assignment_pending — teamId 와 CHECK 로 한 몸
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
├── fieldworkUserId               # 대리 응답을 입력한 실사 계정 (0122) — NULL 이 응답자 직접 응답
├── fieldworkLinkId               # 대리 응답을 입력한 외주 실사 링크 (0127, FK restrict)
│                                 #   **위 계정 칸과 배타** — survey_responses_proxy_exclusive_check
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
├── fieldworkLinkId               # 이 수정을 한 외주 실사 링크 (0133, FK restrict) — editedBy 와 배타 CHECK.
│                                 #   편집 이력 화면은 이 칸이 채워진 행을 「외주」로 읽는다
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
├── resultCode, note, createdBy   # createdBy FK → public.users (0121, 티켓 26 이 채우기 시작)
├── fieldworkLinkId               # 이 회차를 넣은 외주 실사 링크 (0127, FK restrict)
│                                 #   **계정 칸과 배타** — contact_attempts_author_exclusive_check
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
├── fromLocal, fromName
├── replyTo                # nullable — NULL 이면 발송 시점 소유자로 해석 (티켓 20)
├── attachments (JSONB), variablesUsed (JSONB)
├── deletedAt
└── createdAt, updatedAt

mail_campaigns             # 발송 회차
├── id, surveyId, mailTemplateId, runNumber, title
├── kind                   # bulk(단체) | single(단건, 1000001~) | fallback(대체 발송, 2000001~ — 0135 CHECK)
├── parentCampaignId       # 대체 발송의 원래 회차 (부모마다 대체 회차 하나 — 부분 유일 인덱스)
├── isTest                 # 테스트 파티션 여부
├── *Snapshot (subject/bodyHtml/from/replyTo/attachments/filter)  # 캠페인 생성 시점 스냅샷
│                          # replyToSnapshot 만 NULL 을 허용하고, NULL 이면 발송 시점 소유자로 해석
├── status                 # draft|queued|sending|completed|partial|cancelled
├── recipientCount, queuedCount, sentCount, deliveredCount,
│   openedCount, bouncedCount, complainedCount, failedCount,
│   skippedUnsubscribedCount  # webhook이 atomic delta로 갱신
├── createdBy, scheduledAt, startedAt, completedAt, archivedAt
├── fieldworkLinkId        # 단건 메일을 보낸 외주 실사 링크 (0133, FK restrict) — createdBy 와 배타 CHECK
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

> **회신 주소만 스냅샷 밖이다**(티켓 20). 규칙은 `server/mail/services/reply-to.ts` 의
> `resolveSendReplyTo` 하나 — **명시 → 소유자(`read-models/survey-owner-email`) → 발신 주소**.
> 캠페인 발송(`campaign-dispatch`)과 템플릿 테스트 발송(`preview`)이 같은 함수를 쓴다: 나누면
> 「테스트 메일에 답장했더니 아무도 못 받는」 어긋남이 생긴다. **스냅샷에 주소가 박혀 있으면
> 소유자 조회 자체를 하지 않는다** — `??` 의 단락 평가가 계약이라, 고정 회신 캠페인은 소유자
> 조회 왕복이 0 이고 그 조회가 실패해도 영향을 받지 않는다. 이미 claim 된 수신자는
> `send_payload_snapshot` 의 값을 쓰므로 **재시도가 회신 주소를 바꾸지 않는다**(이전 직전에
> claim 된 메일은 이전 소유자에게 답장이 간다 — 의도된 동작). 그래서 **전원이 이미 claim 된
> 재시도 청크는 조회 자체를 건너뛴다** — 쓰지도 않을 값을 읽다 실패하면 값이 이미 정해진
> 재시도가 통째로 막힌다. 해석 단위는 **청크**다: from·제목·본문·첨부와 같은 자리에서 한 번
> 정하므로, 청크 처리 도중의 이전은 그 청크가 끝난 뒤부터 반영된다(계약의 단위가 캠페인
> 발송이지 개별 수신자가 아니다). 소유자 조회는 **계정 상태를 묻지
> 않는다**: 승계 대기 설문의 `owner_user_id` 는 떠난 사람 그대로이고 그 주소가 계약이다. 상태로
> 걸러 null 을 주면 회신이 조용히 발신 주소로 떨어져 답장이 아무도 안 읽는 사서함에 쌓인다 —
> 그 상황을 알리는 것은 재배치 인박스의 승계 대기 경고다. 템플릿의 「답장 받을 메일」이 **선택
> 입력**인 것이 이 연동의 입구이며(`optionalReplyToSchema`), 빈 문자열·공백은 **null 로
> 정규화**한다: 빈 문자열이 컬럼에 들어가면 폴백이 서지 않아 회신 헤더가 빈 채로 나간다.

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
