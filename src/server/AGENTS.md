# 서버 — src/server

> 루트 `AGENTS.md` 에서 떼어 낸 상세 참조다. 이 디렉터리 아래를 만질 때 읽는다.
> 공통 규칙(주의사항·코드 컨벤션·CI 게이트)은 루트 `AGENTS.md` 에, 마이그레이션 번호는 `supabase/AGENTS.md` 에 있다.
> `CLAUDE.md` 는 이 파일을 가리키는 심볼릭 링크다 — 수정은 이 파일에 한다.

## 인증과 권한

- 세션은 Supabase Auth (`lib/supabase/*`), `proxy.ts` 미들웨어가 `/admin`·`/analytics`에서 세션을 갱신한다.
- procedure 베이스 3종 (`server/orpc.ts`):
  - **`pub`** — 인증 불필요 (응답자 표면: 응답 mutation·공개 설문 조회·컨택 attrs·수신거부 lookup). 남용 방지가 필요한 표면은 `.use(withRateLimit(group))` 부착.
  - **`authed`** — 세션 + `ADMIN_USER_IDS` allowlist. grant-first: 게스트 유저는 allowlist fail-open 여부와 무관하게 FORBIDDEN.
  - **`scoped`** — 세션 + (admin allowlist ∨ 게스트 grant). **이 베이스를 쓰는 procedure는 핸들러 첫 줄에서 `assertSurveyAccess(context.user.id, input.surveyId)` 호출 필수** (유일한 예외: surveyId가 없는 `media.deleteMailAttachmentTmp`). **쓰기 procedure 는 `assertSurveyAccess` 대신 `assertSurveyWriteAccess`** 를 부른다 — 보기만 하는 게스트(`VIEW_ONLY_GUEST_GRANTS`)를 거부한다. 그 게스트의 화면 차단(미들웨어)은 `/api/rpc` 에 걸리지 않아 직접 요청을 막지 못한다(2026-11-03 발견). 새 scoped procedure 는 `orpc-scoped-write-guard.test.ts` 가 소스로 읽어 읽기면 목록 등재를, 쓰기면 이 확인을 요구한다.
- 게스트 계정: `GUEST_SURVEY_GRANTS="<userId>:<surveyId>[,...]"` env로 설문 단위 위임 (한 유저가 복수 설문 grant 가능). 무권한 설문 콘솔 진입 시 강제 로그아웃 → 로그인 후 원래 목적지 복귀 (`lib/auth/guest-grants.ts`).
- 보기 전용 게스트(`VIEW_ONLY_GUEST_GRANTS`)는 설문 보기(preview)도 막힌다 — grant 에 `allowPreview` 를 켠 고객 계정만 연다(dairy@ 유가공업). guest9(인공지능 실태조사)는 협업 업체 사정으로 막아 둔다.
- 보기 전용 게스트의 응답 조회 — grant 에 `allowResponseView` 를 켜면(dairy@, 2026-11-16) 응답 내역 행마다 「조회」가 생기고 `operations/profiles/<응답>/view` 가 열린다. 응답 수정 화면의 본문(`profiles/[responseId]/admin-response-screen.tsx`)을 조회 전용으로 그린 것이다 — 응답 흐름이 값 쓰기를 받지 않고(`adminContext.readOnlyView`) 검증 없이 쪽만 넘기며 마지막 쪽은 닫기다. 답은 원문 그대로 보인다(응답자 정보 문항 포함 — 사용자 결정). 수정 화면(`…/edit`)과 수정 저장은 그대로 막힌다.
- 보기 전용 게스트(고객 계정)에는 응답 내역의 **시작일시·소요시간**을 내지 않는다(2026-11-17 — 소요시간이 짧은 응답을 빼 달라는 고객 요구가 나와서). 종료일시는 남는다. 화면은 열·행 값·그 열의 정렬을 함께 빼고(`profiles/page.tsx`), 그 계정이 받는 응답 내역 목록 엑셀도 같은 열을 뺀다(`response-list-load` 의 `forClient`). 판정은 열 키다 — `lib/operations/profile-columns-format` 의 `withoutClientHiddenProfileColumns`. 응답 현황의 응답시간 통계·쪽별 체류 시간은 그 전부터 보기 전용 게스트에게 그리지 않는다(`overview/page.tsx`). 일반 게스트(실사 외주)는 전부 그대로 본다.
- 게스트의 데이터 내려받기 — 내보내기 주소(`/api/surveys/[id]/export`·`split-preview`)는 `canExportSurveyData(userId, surveyId, 종류)` 로 막는다. 관리자는 전부, 게스트는 grant 의 `allowExport` 가 허용한 종류만 받는다 — 지금은 **응답 내역 목록**(`type=response-list`, guest9)뿐이고 **답이 든 파일(Raw·분할·SPSS)을 받는 게스트는 없다**(2026-11-16: 가린 Raw 를 열었다가 같은 날 목록만으로 바꿨다). 응답 내역 목록은 응답 내역 화면과 같은 로더·같은 컬럼 설정으로 화면의 열 그대로 한 시트를 낸다(`export/response-list-load.ts` · `lib/operations/response-list-sheet` — 「상태」 뒤에 「마지막 응답 문항」만 더 붙는다). 게스트 파일은 개인정보로 표시된 값(암호화 저장 응답값 열·명단 개인정보 열)을 가린다(`lib/crypto/export-pii-mask` — 마스킹 힌트 재사용, 성명은 마지막 글자만). Raw·SPSS 쪽 가리기(`maskAnswers`)도 남아 있어 게스트에게 답이 든 파일을 열게 되면 그때 걸린다. 버튼은 응답 현황의 「엑셀 다운로드」 한 자리다 — 관리자는 내보내기 창, 목록만 허용한 게스트는 바로 받는 버튼(`exportMenuOf`). **미들웨어의 화면 차단은 `/api` 에 걸리지 않는다** — 보기 전용 게스트에게 화면이 막힌 REST 주소(조사 대상 목록 엑셀·수요 집계표)는 각 라우트가 `isViewOnlyGuest` 로 스스로 막는다(`tests/repo/view-only-guest-rest-routes.test.ts`). 게스트에게 여는 REST 주소를 새로 만들면 그 테스트에 넣을 것.
- **게스트 담당 범위**(`GUEST_TARGET_SHARES`, 2026-11-19 — CONTEXT.md 「게스트 담당 범위」): 등재된 (계정, 설문) 쌍은 명단의 한 열이 정해진 값인 조사 대상과 그 대상의 응답·회차만 본다(한 설문을 외주 업체 여럿이 나눠 뛸 때). 해석·술어는 `server/fieldwork-share-scope` 한 곳(`resolveGuestShare` · `shareTargetCondition` · `shareTargetSql`)이고, 서비스 함수는 `share: FieldworkShare` 를 **필수 인자**로 받는다 — 관리자만 지나는 호출은 `FIELDWORK_SHARE_ALL` 을 명시한다(기본값을 두지 말 것, 빠뜨리면 열리는 쪽이다). **기본 거부다**: `assertSurveyAccess`·`assertSurveyWriteAccess` 는 범위 게스트를 FORBIDDEN 으로 막고, 범위를 거르는 procedure 만 `assertSurveyAccessInShare`·`assertSurveyWriteAccessInShare` 로 범위를 받아 서비스에 넘긴다. 페이지는 `requireSurveyConsolePage(surveyId, { share: 'allow' })` 를 준 화면만 열리고 돌려받은 계정으로 `resolveGuestShare` 를 푼다. 미들웨어는 `SHARE_RESTRICTED_BLOCKED_SUBPATHS`, REST 는 라우트가 스스로 막는다. 범위 밖 id 는 NOT_FOUND(조회 조건이지 사후 확인이 아니다 — 사후에 거르면 그 사이 개인정보가 복호화된다). 쓰기는 잠금 아래에서 범위를 본다 — 단건 메일은 사전 확인 뒤 `createCampaign` 이 설문 행 잠금 아래에서 다시 건다(대상 수정이 같은 행을 잠가 줄을 선다). 계정 없이 여는 공개 미리보기(`/preview/<token>`)는 범위를 걸 열람자가 없어, 등재가 있는 설문에는 조사 대상 값을 싣지 않는다(`hasGuestTargetShares`) — 그 링크의 복사 버튼도 범위 게스트에게는 내지 않는다. 새 scoped procedure·게스트용 화면·REST 주소를 만들면 `tests/helpers/guest-share-surfaces.ts` 등재표에 「거름 · 해당 없음(사유) · 닫음」 중 하나를 적어야 `tests/repo/guest-share-surfaces.test.ts` 가 통과한다. 실제로 거르는지는 `tests/integration/guest-target-share.realdb.test.ts`. staging 의 외주 링크 담당 범위(ADR-0035)와 타입·함수 이름을 같게 둔 다리다 — 승격 때 `fieldwork-share-scope.ts` 를 그쪽 것으로 바꾼다.
- 화면(RSC)이 세션을 확인할 때는 `requireAuth` 가 아니라 `lib/auth/require-page-user` 의 `requirePageUser` 를 쓴다 — 미들웨어를 통과한 뒤 렌더 중 세션을 잃으면 오류 화면 대신 원래 경로(미들웨어가 싣는 `x-request-path`)를 실어 로그인으로 보낸다. 게스트 판정(`guest-viewer`)·`requireAdminPage` 가 이것을 거친다. Route Handler·procedure 는 401 이 맞으니 `requireAuth` 그대로.
- 미들웨어는 grant 보유자의 경로만 제한한다 — grant 도 없고 `ADMIN_USER_IDS` 에도 없는 세션은 `/admin`·`/analytics` 화면을 그대로 통과한다. 그래서 서버가 데이터를 렌더하는 RSC 페이지는 `params` 다음 첫 줄에서 스스로 거른다: 관리자 전용은 `requireAdminPage()`(게스트도 거부), 게스트에게도 여는 화면은 `requireSurveyConsolePage(surveyId[, { viewOnly }])`(`canAccessSurvey` + 보기 전용 게스트 정책 `deny`·`allow`·`previewGrant`·`responseViewGrant`). 어느 화면이 어느 가드인지는 `tests/repo/admin-page-guard.test.ts` 의 표가 정본이고 미들웨어 판정(`guestPathRedirect`)과 대조한다 — 새 페이지는 그 표에 등재해야 통과한다.
- allowlist 미설정이면 fail-open(인증된 모든 유저 통과) + 최초 1회 경고. 게스트 콘솔은 전역 테스트 모드와 무관하게 항상 실데이터를 본다.

## 오류 던지기

서버(`src/server`)는 일반 `Error` 를 던지지 않는다 — ESLint(`no-restricted-syntax`)가 막는다. oRPC 는 비-ORPCError 의 문구를 운영에서 'Internal server error' 로 갈아 끼우고 Sentry 는 그것을 장애로 받기 때문이다. 던지는 쪽이 둘 중 하나를 고른다.

- **예상된 거부** — 사용자가 이해하고 고칠 수 있는 것(검증 실패·없음·충돌·상태가 바뀜): `new ORPCError('NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT' …, { message })`. 문구가 화면까지 가고 로그로만 남는다. UPDATE·DELETE 가 0행인 것은 「없음」이라 여기다.
- **내부 실패** — 일어나면 안 되는 것(INSERT 가 행을 안 돌려줌·불변식 위반·환경변수 누락): `new InternalFailure(...)`(`server/internal-failure.ts`). 문구가 가려지고 Sentry 로 간다.

클라이언트가 문구로 분기하는 표식(`TEST_TARGET_GENERATION_STALE` · `TEST_WORKSPACE_DISABLE_STALE` · 「테스트 링크가 더 이상 유효하지 않습니다」 · 「이미 사용 중인 URL」)은 문구에 그대로 둔다 — 지우면 그 화면의 분기가 죽는다.

## 테스트 모드

두 겹이다(2026-10-16). **설문의 테스트 환경**(`surveys.testModeEnabled` + `testToken`)은 모두에게 같고 테스트 링크·테스트 대상자 링크가 사는지만 정한다(응답자 쪽 판정은 그대로 이 플래그). **콘솔이 테스트 파티션을 보는지는 브라우저마다** 쿠키 `ops-test-view-<surveyId>`(`lib/operations/test-view-cookie.ts`)로 정한다 — 전에는 한 사람이 켜면 모든 사람의 콘솔이 테스트 데이터로 바뀌었다. 파티션 키는 `is_test` 컬럼(`contact_targets`, `survey_responses`, `mail_campaigns`)이며, `contact_targets`의 resid UNIQUE도 `(surveyId, isTest, resid)`다.

- 읽기/쓰기 파티션은 `server/data-scope.ts`가 단일 결정한다 — `resolveWriteScopeIsTest(전역 플래그, 게스트, 브라우저 쿠키)` 가 **전역 ON ∧ 쿠키 ON ∧ 비게스트**일 때만 test 다. 읽기 `loadOperationsDataScope`·쓰기 `lockWriteScope` 둘 다 쿠키를 `readBrowserTestView` 로 읽는다(요청 밖이면 false). 신규 집계·목록 쿼리는 이 스코프를 반드시 태울 것. **`testModeEnabled` 를 직접 읽어 콘솔 파티션을 정하지 말 것** — 실데이터 업로드 가드(`contact-uploads`)도 그래서 이 함수를 쓴다.
- 토글(`features/operations/test-mode-control.tsx`, 시안 `pencil/테스트모드_드롭다운_시안.pen`): 버튼 자체는 아무 동작이 없고 호버·클릭으로 메뉴 넷을 연다 — 「테스트 모드」 스위치(설문 단위, 끌 때 보관/삭제 확인 창) · 테스트 링크 복사 · 「테스트 데이터 보기」 스위치(브라우저 단위 쿠키) · 테스트 조사 대상자 생성. 테스트 모드가 꺼져 있으면 아래 셋은 막힌다. **테스트 모드를 켜도 보기는 자동으로 켜지지 않는다**(따로 켠다). 대상자 생성은 테스트 파티션에 쓰므로 실데이터를 보는 채로 누르면 보기를 함께 켠다. 버튼 모양: 꺼짐=회색 · 켜짐=주황 테두리+ON · 이 브라우저가 테스트 데이터를 보는 중=꽉 찬 주황 「테스트 데이터 보는 중」. 테스트 모드가 꺼졌는데 쿠키가 남으면 콘솔이 지운다(다시 켜질 때 묻지 않고 테스트 보기로 돌아가지 않게).
- 게스트는 항상 real 파티션(읽기/쓰기 모두) — read/write 비대칭을 막기 위한 의도적 처리.
- 테스트 응답 회차는 `test_response_attempts`가 추적(활성 회차는 responseId당 1개).
- **테스트 버전**(0141): 테스트 링크·테스트 대상자·관리자 미리보기는 배포본이 아니라 저장본 스냅샷을 본다 — `server/workflows/test-version.ts` 의 `ensureTestVersion` 이 테스트 화면 진입과 테스트 응답 저장마다 리비전을 비교해 `status='test'` 버전을 새로 만든다. 테스트 응답이 보는 버전은 `pinnedVersionId`(`testVersionId ?? currentVersionId`)다 — 응답이 볼 버전을 고르는 자리를 새로 만들면 이것을 쓸 것. 배포 번호·버전 목록·보존 정리는 테스트 버전을 뺀다. 상세는 `server/workflows/test-version.ts` 머리 주석(용어는 CONTEXT.md 「테스트 버전」).
