# WS-2: IDOR 구조 봉인 (scope-WHERE) — 설계 스펙

- 일자: 2026-06-13
- 상태: 승인됨 (구현 대기)
- 브랜치: `feat/ws2-idor-hardening`
- 출처: `claudedocs/owasp-security-audit-2026-06-13.md` (OWASP 전수 감사)
- 선행: WS-1 공개 표면 하드닝(main 머지 완료)

## 배경

OWASP 전수 감사 30 발견을 3 워크스트림으로 분해한 것 중 **WS-2 — IDOR 구조 군**을 다룬다. 이 발견들은 현재 **단일관리자 가정(auth.users=1)으로 악용 경로가 봉인**되어 있으나, 2번째 관리자 추가·계정 탈취·멀티테넌시 전환 시 즉시 cross-tenant 노출로 상승한다. 공통 뿌리는 `authed` 베이스가 세션 존재만 검사하고 per-survey 소유권을 전혀 검증하지 않으며(#6), 다수 service가 `surveyId`/`contactTargetId`를 input으로 받고도 destructive WHERE에 반영하지 않는 일관성 갭이다.

본 스펙은 **ownerUserId 도입 없이** (a) 받은 scope 파라미터를 모든 destructive WHERE에 강제 반영해 cross-survey 오호출/IDOR를 닫고, (b) 2번째 사용자 자체를 런타임 allowlist로 차단해 단일관리자 가정을 코드로 봉인한다.

## 범위 (In Scope) — 6 발견

| # | 심각도 | 항목 | OWASP |
|---|--------|------|-------|
| 6 | MED | authed 베이스가 세션만 검사, 리소스 소유권 미검증 (IDOR 군 뿌리) | A01 |
| 9 | MED | contact_targets update/delete 가 surveyId 받고도 bare id WHERE | A01 |
| 10 | MED | questions/groups update·delete·reorder bare childId WHERE | A01 |
| 15 | LOW | contact_attempts update/delete bare id WHERE | A01 |
| 17 | LOW | read.responseById 가 surveyId 없이 responseId 로만 응답 반환 | A01 |
| 18 | LOW | media.deleteImages 입력에 R2 prefix 게이트 부재 | A01 |

## 목표 / 비목표

**목표**
- 인증된 세션 보유자가 임의 `surveyId`/`contactTargetId`/`responseId`/R2 키로 다른 설문의 컨택·질문·응답·회차·이미지를 읽거나 변조·삭제하는 cross-survey IDOR 경로를 차단한다.
- 2번째 사용자(관리자) 생성·로그인을 코드 레벨에서 차단해 단일관리자 가정을 런타임으로 봉인한다.
- "input 으로 받은 scope 파라미터는 반드시 destructive WHERE 에 반영한다"는 규약을 확립한다.

**비목표 (Out of Scope)**
- `surveys.ownerUserId` 컬럼 도입 + per-user 소유권 모델 + 멀티테넌시. (멀티유저 계획 확정 시 별도 사이클. 현재 YAGNI.)
- contact_pii/contact_targets RLS 정책(#8) 및 Drizzle 신규 테이블 RLS 강제 가드(#19) — WS-3.
- 기타 WS-3 저위험 위생(#13/#16/#21/#22/#24/#25/#26).
- 응답 mutation 세션 소유권 바인딩(#16) — pub 표면, WS-3.

## 확정 설계 결정 (브레인스토밍 결과)

1. **방향**: scope-WHERE 봉인 + 런타임 가드. `ownerUserId` 미도입. (현재 단일관리자, IDOR 는 미래 위협 → YAGNI.)
2. **scope-WHERE 규약**: update/delete service 의 WHERE 에 `and(eq(child.id, id), eq(child.surveyId, surveyId))` 형태로 input scope 를 반영. 영향 0행이면 NOT_FOUND throw(reason 구분). reorder 류는 대상 id 가 전부 동일 `surveyId` 소속인지 검증.
3. **런타임 가드(#6)**: `ADMIN_USER_IDS` env(콤마 분리 user.id 목록)를 `authed` 미들웨어에서 검사 — 목록 외 user 는 `ORPCError('FORBIDDEN')`. **미설정 시 fail-open + 최초 1회 console.warn**(현행 동작 보존, 가용성 우선). Supabase Auth signup 비활성화는 운영 안내(인프라 보강, 이중화).
4. **호출처 파급 최소화**: contacts(#9/#15)는 procedure 가 이미 surveyId/contactTargetId 를 input 으로 받으므로 service WHERE 반영만 — 호출처 무변경. survey-builder(#10)·response-read(#17)는 procedure 입력에 surveyId 추가가 필요해 빌더/훅 호출처를 함께 수정.
5. **error reason**: `SurveyOwnershipError`/service throw 에 `'forbidden'` 과 `'not_found'` 를 구분 가능하게 두되, pub 외 admin 경로라 메시지 노출 민감도는 낮음.

## 상세 설계

### 슬라이스 1 — runtime-guard (#6)

- `src/server/orpc.ts` `authed` 미들웨어: 세션 검사 후 `context.user.id ∈ parseAdminAllowlist(process.env.ADMIN_USER_IDS)` 검사. 목록 외면 `ORPCError('FORBIDDEN')`.
- `parseAdminAllowlist(raw): Set<string>` 헬퍼(콤마 분리, 트림, 빈 항목 제거). 빈/미설정이면 빈 Set → **fail-open**(통과) + 모듈 1회 `console.warn('ADMIN_USER_IDS 미설정 — admin allowlist 가드 비활성')`.
- `.env.example` 에 `ADMIN_USER_IDS=` placeholder 추가(콤마 분리 형식 주석). 기존 미커밋 UPSTASH placeholder 변경은 WS-1 rate limit 의 정당한 example 이라 함께 staging 허용. **`.gitignore`/`CLAUDE.md` 미커밋 변경은 절대 스테이징 금지.**
- `requireSurveyOwnership`(RSC edit page 가드)는 이번 범위에서 그대로 두되, 주석의 "다중 사용자 전환 시" 메모를 allowlist 가드 도입 사실에 맞게 갱신(선택).

### 슬라이스 2 — contacts-scope (#9 #15)

- `src/features/contacts/server/services/contact-targets.service.ts`:
  - `updateContactTarget`(WHERE `eq(contactTargets.id, id)`, ~94행) → `and(eq(id), eq(contactTargets.surveyId, surveyId))`. upsertPiiValue 등 부수효과 이전에 행 소속 확정. 영향 0행이면 NOT_FOUND throw.
  - `deleteContactTarget`(~108행) → 동일하게 `and(id, surveyId)`. 0행이면 throw(CASCADE 전 검증).
- `src/features/contacts/server/services/contact-attempts.service.ts`:
  - `updateAttempt`(~91행)/`deleteAttempt`(~103행): WHERE 에 attempt 가 `input.contactTargetId` 소속인지 + contactTarget 이 `input.surveyId` 소속인지 검증(조인/서브쿼리 또는 최소 `eq(contactTargetId)` + 선행 소속 확인). 0행이면 throw.
- procedure(`targets.ts`/`attempts.ts`)는 이미 surveyId/contactTargetId 를 input 으로 전달 → 호출처 무변경.

### 슬라이스 3 — survey-builder-scope (#10)

- `src/features/survey-builder/server/services/questions.service.ts`: `updateQuestion`/`deleteQuestion`(~107·154행) WHERE 에 `eq(questions.surveyId, surveyId)` 추가. `reorderQuestions`는 `questionIds` 가 전부 동일 surveyId 소속인지 검증 후 진행.
- `src/features/survey-builder/server/services/question-groups.service.ts`: `updateQuestionGroup`/`deleteQuestionGroup`(~51·103행) WHERE 에 surveyId. `deleteQuestionGroup` 의 자손 재귀/하위질문 ungroup 도 surveyId 스코프 내로 한정. `reorderGroups`는 현재 surveyId 를 조회에만 쓰므로 destructive 경로에 반영.
- `src/features/survey-builder/server/procedures/questions.ts`/`question-groups.ts`: update/remove/reorder 입력 스키마에 `surveyId` 추가, service 시그니처에 전달.
- 빌더 호출처(컴포넌트/훅): 위 mutation 호출에 `surveyId` 인자 추가. survey-store 의 현재 surveyId 사용. 호출처는 hook/helper 시그니처 유지 원칙으로 최소 수정.

### 슬라이스 4 — response-read-scope (#17)

- `src/features/survey-builder/server/services/response-read.service.ts` `getResponseById`(~44행): 시그니처에 surveyId 추가, WHERE 에 `eq(surveyResponses.surveyId, surveyId)`. mutate 경로(saveAdminEdit/manage)와 대칭.
- `src/features/survey-builder/server/procedures/read.ts` `responseById`(~88행): 입력 스키마에 `surveyId` 추가, service 에 전달.
- `src/hooks/queries/use-responses.ts`(~55행): `orpc.surveyBuilder.read.responseById.call({ responseId, surveyId })` 로 surveyId 전달. 훅 호출처가 surveyId 를 갖는지 확인해 시그니처 보강.
- 주의: RSC edit page 의 `getResponseById`(src/data/responses.ts)는 별개 함수로 `requireSurveyOwnership` 가드를 거치므로 본 범위 아님(중복 수정 금지).

### 슬라이스 5 — media-scope (#18)

- `src/features/media/domain/media.ts`(deleteImages 입력, ~24행): 첨부 삭제(deleteMailAttachmentTmp/deleteNoticeAttachmentTmp)와 동일하게 입력 URL 배열에 prefix whitelist(`survey/`·`tmp/` 등 의도 namespace) + `'..'`/`'//'` traversal 거부 refine 추가.
- `src/features/media/server/services/media.service.ts`(~28행): `new URL(url).pathname` 추출 후에도 prefix whitelist 재검증(형제 attachment 라우트와 대칭). publicUrl 포함만으로 임의 영구 키 삭제되지 않도록.
- 호출처 무변경(입력 형태 동일, 검증만 강화).

## 테스트 전략

**TDD (red → green), service 모킹은 `tests/integration` 패턴(top-level vi.mock + vi.mocked)**
- runtime-guard: allowlist 미설정 → fail-open 통과; 설정 후 비허용 user.id → FORBIDDEN; 허용 user → 통과. `parseAdminAllowlist` 단위테스트(콤마/공백/빈값).
- contacts-scope: update/delete 를 다른 surveyId 로 호출 → 0행/NOT_FOUND; 정상 surveyId → 성공. attempts 는 contactTargetId 불일치 → 거부.
- survey-builder-scope: 다른 surveyId 의 questionId/groupId update·delete → 거부; reorder 에 타 설문 id 섞임 → 거부; 정상 → 성공.
- response-read-scope: 다른 surveyId 로 responseById → 거부; 정상 → 반환.
- media-scope: tmp/survey prefix 외 키·traversal URL → 거부; 정상 키 → 통과.

**검증 전용**
- 기존 호출처(빌더/훅) 회귀: 정상 흐름 비파괴 — `pnpm test` 전체 + tsc.

## 실행 순서 / 슬라이스 (각 독립 커밋)

1. runtime-guard (#6) — orpc.ts + env. 독립.
2. contacts-scope (#9 #15) — contacts service 2파일. 호출처 무변경. 독립.
3. survey-builder-scope (#10) — questions/groups service + procedure + 빌더 호출처. 파급 중간.
4. response-read-scope (#17) — response-read service + procedure + use-responses 훅. 파급 작음.
5. media-scope (#18) — media domain + service. 호출처 무변경. 독립.

- 5슬라이스 전부 다른 파일 → 논리적 독립. 보안 정확성 위해 **순차 다이나믹 워크플로우 + 슬라이스별 security-engineer 적대적 리뷰 + 통합 게이트**(WS-1 동일 패턴).
- 각 슬라이스 = TDD red→green→리뷰→(결함 medium↑ 시 재수정 1회).

## 롤아웃 / 운영 노트

- `ADMIN_USER_IDS` 를 Vercel 프로젝트 환경변수에 현재 관리자 user.id 로 등재해야 가드가 활성화된다(미설정 시 fail-open). 로컬 `.env.local` 에도 등재.
- Supabase Auth signup 을 대시보드에서 비활성화하면 2번째 사용자 생성 자체가 차단되어 이중 방어가 된다(권장).
- scope-WHERE 는 멀티유저 전환 시에도 그대로 유효하며, 그때 `ownerUserId` 소유권 검증을 추가로 얹으면 된다.

## 미해결 질문

- 없음. (allowlist env 키 이름·error reason 문자열은 구현 시 합리 기본값으로 확정.)
