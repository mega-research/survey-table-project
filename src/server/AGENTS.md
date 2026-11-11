# 서버 — src/server

> 루트 `AGENTS.md` 에서 떼어 낸 상세 참조다. 이 디렉터리 아래를 만질 때 읽는다.
> 공통 규칙(주의사항·코드 컨벤션·마이그레이션 번호·CI 게이트)은 루트 `AGENTS.md` 에 있다.
> `CLAUDE.md` 는 이 파일을 가리키는 심볼릭 링크다 — 수정은 이 파일에 한다.

## 인증과 권한

- 세션은 Supabase Auth (`lib/supabase/*`), `proxy.ts` 미들웨어가 `/admin`·`/analytics`에서 세션을 갱신한다.
- procedure 베이스 3종 (`server/orpc.ts`):
  - **`pub`** — 인증 불필요 (응답자 표면: 응답 mutation·공개 설문 조회·컨택 attrs·수신거부 lookup). 남용 방지가 필요한 표면은 `.use(withRateLimit(group))` 부착.
  - **`authed`** — 세션 + `ADMIN_USER_IDS` allowlist. grant-first: 게스트 유저는 allowlist fail-open 여부와 무관하게 FORBIDDEN.
  - **`scoped`** — 세션 + (admin allowlist ∨ 게스트 grant). **이 베이스를 쓰는 procedure는 핸들러 첫 줄에서 `assertSurveyAccess(context.user.id, input.surveyId)` 호출 필수** (유일한 예외: surveyId가 없는 `media.deleteMailAttachmentTmp`). **쓰기 procedure 는 `assertSurveyAccess` 대신 `assertSurveyWriteAccess`** 를 부른다 — 보기만 하는 게스트(`VIEW_ONLY_GUEST_GRANTS`)를 거부한다. 그 게스트의 화면 차단(미들웨어)은 `/api/rpc` 에 걸리지 않아 직접 요청을 막지 못한다(2026-11-03 발견). 새 scoped procedure 는 `orpc-scoped-write-guard.test.ts` 가 소스로 읽어 읽기면 목록 등재를, 쓰기면 이 확인을 요구한다.
- 게스트 계정: `GUEST_SURVEY_GRANTS="<userId>:<surveyId>[,...]"` env로 설문 단위 위임 (한 유저가 복수 설문 grant 가능). 무권한 설문 콘솔 진입 시 강제 로그아웃 → 로그인 후 원래 목적지 복귀 (`lib/auth/guest-grants.ts`).
- 보기 전용 게스트(`VIEW_ONLY_GUEST_GRANTS`)는 설문 보기(preview)도 막힌다 — grant 에 `allowPreview` 를 켠 고객 계정만 연다(dairy@ 유가공업). guest9(인공지능 실태조사)는 협업 업체 사정으로 막아 둔다.
- 화면(RSC)이 세션을 확인할 때는 `requireAuth` 가 아니라 `lib/auth/require-page-user` 의 `requirePageUser` 를 쓴다 — 미들웨어를 통과한 뒤 렌더 중 세션을 잃으면 오류 화면 대신 원래 경로(미들웨어가 싣는 `x-request-path`)를 실어 로그인으로 보낸다. 게스트 판정(`guest-viewer`)·`requireAdminPage` 가 이것을 거친다. Route Handler·procedure 는 401 이 맞으니 `requireAuth` 그대로.
- 미들웨어는 grant 보유자의 경로만 제한한다 — grant 도 없고 `ADMIN_USER_IDS` 에도 없는 세션은 `/admin` 화면을 그대로 통과한다. 그래서 개인정보 평문을 직접 렌더하는 RSC 페이지는 첫 줄에서 스스로 거른다: 관리자 전용은 `requireAdminPage`(분석), 게스트에게도 여는 운영 콘솔 화면은 `lib/auth/require-survey-console-page` 의 `requireSurveyConsolePage(surveyId)`(조사 대상 목록 — `canAccessSurvey` + 보기 전용 게스트 거부). 조사 대상 상세·응답 내역·응답 수정 화면에는 아직 이 가드가 없다(2026-11-11 리뷰에서 확인한 남은 틈).
- allowlist 미설정이면 fail-open(인증된 모든 유저 통과) + 최초 1회 경고. 게스트 콘솔은 전역 테스트 모드와 무관하게 항상 실데이터를 본다.

## 테스트 모드

두 겹이다(2026-10-16). **설문의 테스트 환경**(`surveys.testModeEnabled` + `testToken`)은 모두에게 같고 테스트 링크·테스트 대상자 링크가 사는지만 정한다(응답자 쪽 판정은 그대로 이 플래그). **콘솔이 테스트 파티션을 보는지는 브라우저마다** 쿠키 `ops-test-view-<surveyId>`(`lib/operations/test-view-cookie.ts`)로 정한다 — 전에는 한 사람이 켜면 모든 사람의 콘솔이 테스트 데이터로 바뀌었다. 파티션 키는 `is_test` 컬럼(`contact_targets`, `survey_responses`, `mail_campaigns`)이며, `contact_targets`의 resid UNIQUE도 `(surveyId, isTest, resid)`다.

- 읽기/쓰기 파티션은 `server/data-scope.ts`가 단일 결정한다 — `resolveWriteScopeIsTest(전역 플래그, 게스트, 브라우저 쿠키)` 가 **전역 ON ∧ 쿠키 ON ∧ 비게스트**일 때만 test 다. 읽기 `loadOperationsDataScope`·쓰기 `lockWriteScope` 둘 다 쿠키를 `readBrowserTestView` 로 읽는다(요청 밖이면 false). 신규 집계·목록 쿼리는 이 스코프를 반드시 태울 것. **`testModeEnabled` 를 직접 읽어 콘솔 파티션을 정하지 말 것** — 실데이터 업로드 가드(`contact-uploads`)도 그래서 이 함수를 쓴다.
- 토글(`features/operations/test-mode-control.tsx`, 시안 `pencil/테스트모드_드롭다운_시안.pen`): 버튼 자체는 아무 동작이 없고 호버·클릭으로 메뉴 넷을 연다 — 「테스트 모드」 스위치(설문 단위, 끌 때 보관/삭제 확인 창) · 테스트 링크 복사 · 「테스트 데이터 보기」 스위치(브라우저 단위 쿠키) · 테스트 조사 대상자 생성. 테스트 모드가 꺼져 있으면 아래 셋은 막힌다. **테스트 모드를 켜도 보기는 자동으로 켜지지 않는다**(따로 켠다). 대상자 생성은 테스트 파티션에 쓰므로 실데이터를 보는 채로 누르면 보기를 함께 켠다. 버튼 모양: 꺼짐=회색 · 켜짐=주황 테두리+ON · 이 브라우저가 테스트 데이터를 보는 중=꽉 찬 주황 「테스트 데이터 보는 중」. 테스트 모드가 꺼졌는데 쿠키가 남으면 콘솔이 지운다(다시 켜질 때 묻지 않고 테스트 보기로 돌아가지 않게).
- 게스트는 항상 real 파티션(읽기/쓰기 모두) — read/write 비대칭을 막기 위한 의도적 처리.
- 테스트 응답 회차는 `test_response_attempts`가 추적(활성 회차는 responseId당 1개).
- **테스트 버전**(0141): 테스트 링크·테스트 대상자·관리자 미리보기는 배포본이 아니라 저장본 스냅샷을 본다 — `server/workflows/test-version.ts` 의 `ensureTestVersion` 이 테스트 화면 진입과 테스트 응답 저장마다 리비전을 비교해 `status='test'` 버전을 새로 만든다. 테스트 응답이 보는 버전은 `pinnedVersionId`(`testVersionId ?? currentVersionId`)다 — 응답이 볼 버전을 고르는 자리를 새로 만들면 이것을 쓸 것. 배포 번호·버전 목록·보존 정리는 테스트 버전을 뺀다. 상세 CONTEXT.md 「테스트 버전」.
