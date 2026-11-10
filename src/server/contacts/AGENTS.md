# 조사 대상

> 루트 `AGENTS.md` 에서 떼어 낸 상세 참조다. 이 디렉터리 아래를 만질 때 읽는다.
> 공통 규칙(주의사항·코드 컨벤션·마이그레이션 번호·CI 게이트)은 루트 `AGENTS.md` 에 있다.
> `CLAUDE.md` 는 이 파일을 가리키는 심볼릭 링크다 — 수정은 이 파일에 한다.

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

## 컨택원 배정

**컨택원 배정** (2026-10-19, 0136 — CONTEXT.md 「컨택원 배정」이 정본): 컨택원은 계정이 아니라 이름 붙은 배정 묶음이고 한 대상은 지금 컨택원 하나에만 속한다(마지막 배정이 이긴다, 응답 상태 무관). **내부 실사 운영 도구라 외부 주체(외부 계정·외주 실사 링크·클라이언트 링크)에게 열지 않는다.** **외주 담당 범위와는 다른 층이다** — 컨택원은 「누가 걸 차례인가」, 담당 범위는 「어느 외주 링크가 볼 수 있나」라서 교체 적용은 `fieldwork_link_shares` 를 건드리지 않고 컨택원을 옮겨도 업체의 시야는 그대로다(ADR-0035, 아래 절). procedure `contacts.assignments.*` 는 베이스가 전부 `authed`(내부 계정 전용)이고 핸들러 첫 줄이 `assertSurveyCapabilityRpc(context.user, surveyId, …)` 다 — `list` 는 `contacts.view`, 나머지는 `contacts.manage`(외부 주체는 이 칸을 갖지 않는다). 전부 IDOR 인벤토리 `tests/integration/cross-team-idor-rpc.test.ts` 에 등재돼 있다. 관리 화면(`(internal)/surveys/[id]/operations/contacts/assignments` + `[assignmentId]`)은 `requireAdminPage()` + `assertSurveyCapabilityPage(viewer, surveyId, 'contacts.manage')` 가 막고, 주소는 `operationsPaths(base).contactsAssignments` / `.contactsAssignment(id)`(`utils/operations-paths.ts`), 탭 「컨택원 관리」는 `contacts.manage` 아래에만 선다. 외부 주체가 보는 화면은 컨택원을 전부 받지 않는다 — 조사 대상 목록의 「컨택원」 열·값·필터 후보·정렬(`loadContactsListPage` 의 `includeContactOwner` — 내부 페이지 `true`, `/fw` 링크 페이지 `false`. 끄면 로더 `includeAssignment:false` + `withoutContactOwnerColumn`), 외부 계정·클라이언트 링크 목록(`read-models/guest-contacts`)과 실사 계정 목록(`read-models/fieldwork-contacts`)의 `includeAssignment:false`, 단건 상세 드롭다운(`app/_operations/contact-detail-screen.tsx` 의 `includeContactOwner` — 내부 페이지만 켜고 `contacts.manage` 도 있어야 그린다), 진척 보고 칩(`app/_operations/report-screen.tsx` 의 `includeContactOwner` — 내부 `true`, `/fw` `false`). 쓰기는 `lockWriteScope` 파티션 아래서 하고 대상과 컨택원의 `is_test` 가 같아야 한다. 서비스는 `server/contacts/services/contact-assignments.ts`(만들기·이름·순서·지우기·한 명 바꾸기·관리 목록 통계 — 응답 상태는 목록 web 열과 같은 `matchedResponseSubquery`) · `contact-assignment-apply.ts`(교체 적용·미리보기·오른쪽 대상 목록) · `contact-assignment-facets.ts`(오른쪽 값 목록). **교체 적용**은 컨택원 행 `FOR UPDATE` 로 같은 컨택원 동시 적용을 직렬화하고 조건을 적용 시점에 다시 평가한다 — 조건 줄 0개 거부, 결과 0명 허용, **해석이 안 되는 절이나 읽지 못한 `list:` 토큰은 거부**(목록 검색처럼 조용히 버리면 조건이 넓어져 남의 배정을 끌어온다). 조건 밖 판정은 `COALESCE(filter, FALSE)` 로 감싼다(3값 논리로 빠지는 행이 없게). **들어옴·빠짐은 한 UPDATE 문장**(`CASE WHEN match THEN 이 컨택원 ELSE NULL`)이다 — 두 문장으로 나누면 조건이 「현재 컨택원」·「배정 없음」일 때 뒤 문장이 앞 문장이 바꾼 값을 다시 읽어 방금 옮긴 대상을 도로 푼다. 교체 적용·지우기는 서로 다른 컨택원끼리 겹치는 대상을 다른 순서로 잠가 교착(40P01)이 날 수 있어, 충돌이면 처음부터 다시 실행한다(`retryAssignmentWrite` → `lib/pg-error` 의 `retryOnTxConflict`, 3번까지 — 다시 돌 때 조건도 새로 계산하므로 나중에 끝난 쪽이 이긴다). 배정은 교체 적용과 상세 한 명 바꾸기로만 한다(조사 대상 목록 위의 「검색 결과 N명을 컨택원에 배정」은 걷어냈다). 목록 주소·스냅샷·조건 줄을 서버에서 읽는 자리는 아래 「조사 대상 필터 해석」을 거친다 — 그 결과로 대상을 고르거나 쓴다면 `mode: 'write'` 로 해석해 해석되지 않는 조건을 거부한다. 스킴에 `system.contact_owner` 열이 없는 옛 설문은 컨택원을 처음 만들 때 그 파티션 스킴 끝에 붙인다(`ensureContactOwnerColumn`). 교체 업로드 경고는 풀릴 배정 수(`countAssignedTargets`)와 링크별 풀릴 담당 범위(아래 「외주 담당 범위」)를 보이고, 테스트 모드를 삭제로 끄면(`disableTestWorkspace`) 테스트 컨택원도 지운다. 컨택원 열은 엑셀 내려받기 제외 목록에 그대로 있다.

---

## 필터 확장

**필터 확장** (컨택원 배정과 함께): ① 「현재 컨택원」 `FILTER_SOURCE.CONTACT_OWNER`(`system.contact_owner`) — 값은 컨택원 id, 배정 없음은 `FILTER_NONE_VALUE`. 해석 모듈이 이 설문·세션 파티션 컨택원 id 로 검증하고(하위 파서의 `ParseExtraHooks.assignmentIds`, 외부 주체 컨텍스트는 넘기지 않아 절이 만들어지지 않는다) 다른 설문·파티션 id 는 0건이 아니라 조건 미적용. 열 후보는 `buildColumnCandidates(scheme, { includeContactOwner: true })` 로 켠 표면만 받는다 — 조사 대상 목록·컨택원 수정·**단체 메일 위저드**(「이메일 갱신」처럼 컨택원으로 묶은 명단에 보내기) 셋이고 셋 다 외부 주체에게는 끈다(위저드의 「필터 결과 전체 선택」 `fetchCandidateIds` 도 procedure 가 넘긴 `isExternalActor(context.actor)` 로 같다). **주소·스냅샷의 절이 지금 해석되지 않으면**(지워진 컨택원·빠진 열·읽지 못한 `list:` 토큰) 읽기 해석은 버려 명단이 넓어지므로 결과의 `unresolved` 로 알린다 — 위저드는 경고를 띄우고 「미응답자 재발송」 자동 전체 선택을 하지 않으며, `fetchCandidateIds` 는 write 해석이라 `BAD_REQUEST` 로 거부한다. 컨택원 열에도 「메일 표시」 스위치가 있다 — 켜면 위저드 미리보기·캠페인 상세 수신자 표·수신거부 명단에 지금 컨택원 이름이 나오고, 외부 주체 화면은 켜 두어도 싣지 않는다(단체 메일 페이지가 `isExternalViewer()` 로 정해 `resolveMailDisplayColumns(scheme, { includeContactOwner: !isExternal })` → 로더 `includeAssignment`). 열 정렬 키 `owner`(컨택원 순서 → 이름, 배정 없음 끝). ② `짝수`/`홀수` — 시스템ID·attrs ID 목록 입력이 **그 한 단어일 때만** 키워드(`parseParityKeyword`, `FilterCondition.parity`). attrs 는 값 전체가 숫자인 행만(앞자리 0 허용) 나머지 연산, 숫자 아닌 값·빈 값은 어느 쪽에도 안 걸린다 — 상태줄의 「숫자가 아닌 값 N명 제외」는 `contacts.attrValues.nonNumericCount`(`scoped` + `contacts.view`, `attrValues.list` 와 같은 권한이라 외주 실사 링크에도 열린다 — `LINK_OPEN_SCOPED_PATHS`). 진척 보고 필터(`progress-filters` 의 `mode:'parity'`)도 같다. ③ 조건 줄 값 하나에 여러 값 — `encodeMultiClauseValue`(양끝까지 `\u001f` 구분자, trim 이 값 앞뒤 공백을 못 지우게)로 담으면 파서가 헤더 체크박스와 같은 in 절로 읽는다(컨택원 수정 화면 오른쪽 값 목록이 만든다).

---

## 조사 대상 필터 해석

**조사 대상 필터 해석** (2026-10-19 — CONTEXT.md 「조사 대상 필터 해석」이 정본): 조사 대상 목록 · 단체 메일 위저드 · `fetchCandidateIds` · 교체 적용(미리보기·오른쪽 목록 포함) · 컨택원 수정 화면이 `server/read-models/contact-filter-resolution.ts` 한 곳으로 조건을 읽는다. `loadContactFilterContext(surveyId, scope, { isExternal, surface: 'contacts' | 'mail', canViewMail?, share?, executor? })` 가 스킴(외부 주체면 컨택원 열 제거, `canViewMail:false` 면 메일 열 제거 — 외주 실사 링크 목록)·결과코드·컨택원 선택지(외부 주체면 빈 배열)·검색바 후보·열 머리 후보(`mail` 이면 미리보기 고정 열 `CAMPAIGN_HEADER_FILTER_COLUMNS` 를 덧붙임)를 읽고 — 페이지는 같은 컨텍스트를 UI props 에도 쓴다 — `resolveContactFilter(ctx, input, { mode })` 가 ID 목록을 읽어 해석한다. 입력은 캠페인 스냅샷 모양(`{ clauses: {source,value,op}[]; headerClauses?: {source,mode,hv}[] }`)이고 주소는 `contactFilterInputFromUrl(sp)` 로 바꾼다. 결과 `ResolvedContactFilter<'read'|'write'>` 는 이 모듈만 만드는 브랜드 타입이고 `{ clauses, builderClauses, headerClauses, unresolved, share }` 다 — `share` 는 컨텍스트에 실은 담당 범위(아래 「외주 담당 범위」)이고 해석 결과의 **강제 절**이라, SQL 로 바꿀 때는 `resolvedContactFilterSql(filter)` 를 쓴다(`buildContactsFilterSql(filter.clauses)` 를 직접 부르면 강제 절이 빠진다). 서버 코드가 직접 조립한 절(검색 축이 화면에 고정된 실사 계정·클라이언트 링크 목록 — `read-models/fieldwork-contacts`·`guest-contacts`)은 같은 모듈의 `contactFilterFromServerClauses(clauses)` 로 감싼다 — 사용자가 고른 열 이름을 읽는 주소·스냅샷 입력에는 쓰지 않는다. `listContactsForSurvey`·`previewCampaignCandidates`·`countCampaignCandidates` 는 이 결과(`filter`)만 받고, 교체 적용 같은 **쓰기 서비스는 `ResolvedContactFilter<'write'>` 만 받는다** — write 해석은 해석 안 되는 조건이 하나라도 있으면 `ORPCError BAD_REQUEST`(문구는 모듈 소유: 「조건 N을(를) 지금 적용할 수 없습니다…」 · 「저장된 ID 목록을 찾을 수 없습니다…」). 조사 대상 목록 조립은 `server/read-models/contacts-list-page.ts` 의 `loadContactsListPage({ …, canViewMail, includeContactOwner })` 한 곳이고 화면은 `features/operations/contacts/contacts-list-view.tsx` 다 — 내부 콘솔과 `/fw` 링크 콘솔이 같은 조립을 쓰고 두 칸만 다르다(해석 컨텍스트의 `isExternal` 은 `!includeContactOwner`). 하위 파서는 `read-models/contacts-filter-parse.ts` 이고 ESLint 가 해석 모듈 · 응답 내역(`profiles-filters`, 응답 행 위 다른 열을 보는 표면이라 하위 파서 + 훅을 직접 쓴다) · 서버 트리 테스트 밖의 import 를 막는다(`eslint.config.mjs` 의 `CONTACT_FILTER_PARSE_PATTERN`). `listAssignmentOptions` 는 `read-models/contact-assignment-options.ts` 에 있다. `buildContactsFilterSql` 은 lib 공용이라 `FilterClause[]` 를 그대로 받는다. 테스트에서 해석이 관심사가 아니면 `tests/helpers/resolved-contact-filter.ts` 의 `resolvedFilterForTest` 를 쓴다.

---

## ID 목록 검색

조사 대상·단체 메일 위저드의 시스템ID/attrs 컬럼 검색은 **엑셀 열 붙여넣기 ID 목록**을 받는다 (`lib/operations/range-list.ts` — 공백·개행·탭·콤마 구분, 중복 제거). 단일 컬럼 인라인 상한 2,000개(URL 헤더 한계), 초과분은 `contacts.idLists.create` 로 `contact_id_lists` 에 저장하고 `q=list:<uuid>:<count>` 토큰으로 검색한다. 토큰은 조사 대상 필터 해석이 읽는다(`loadIdListsForValues`, `server/read-models/contact-id-lists.ts`) — 호출자가 따로 읽을 일이 없다. 「전체」 컬럼 검색의 200개 상한은 컬럼 곱연산 SQL 보호용으로 별개다.

**컨택원 수정 화면만 연속 번호를 구간으로 합친다** — 붙여넣기 직후 · 저장된 조건을 열 때 · 미리보기·적용용 값 준비(저장 목록 변환보다 먼저) 세 자리에서 `1 2 … 100` 을 `1-100, 200-300` 으로 접는다(`compactIdListValue` → `range-list` 의 `compactIdList`, 위젯 prop `idListCompact`). 고르는 대상은 같다: 낱개는 IN, 구간은 BETWEEN 이다. **번호 하나로 접히는 입력(`5 5`·`5-5`)은 손대지 않는다** — attrs 단일 숫자는 원문 value 로 텍스트 폴백(ILIKE)을 함께 걸어 `5` 로 바꾸면 `A5` 까지 고른다. 전후 해석 대조는 `read-models/contacts-filter-parse-compact.test.ts`. 숫자 아닌 토큰·앞자리 0·`list:` 토큰·여러 값 구분자 형식도 손대지 않는다. 조사 대상 검색바·단체 메일 위저드는 합치지 않는다. 상태줄 「ID N개 인식」은 토큰 수가 아니라 겹침을 뺀 번호 수(`IdListStatus.list.ids`)다.

---

## 대상 정보 수정 현황

**대상 정보 수정 현황** (2026-11-03, 0152 — CONTEXT.md 「조사 대상 수정 기록」이 정본): 표 `contact_target_edit_logs`(`action` = `info_edit | attempt_edit | attempt_delete | assignment_change`, `changes` 어휘는 `shared/contracts/contacts` 의 `ContactTargetEditChange`). 쓰기는 `services/contact-target-edit-log` 의 `recordContactTargetEdit` 하나를 각 쓰기 경로가 **같은 트랜잭션 · 대상 행 `FOR UPDATE` 아래**에서 부른다 — 상세 저장 `updateContactTarget` · 메모·연락 방법만 쓰는 `setContactTargetMemo`(외주 링크도 지나는 좁은 표면) · 컨택원 한 명 바꾸기 `setTargetAssignment`(잠금 순서는 설문 스코프 → 컨택원 → 대상) · 회차 `updateAttempt`·`deleteAttempt`. 판정은 `domain/contact-target-edit` 의 순수 함수(`diffContactTargetInfo` · `diffContactTargetPii` · `attemptEditChange`)이고, 개인정보 열의 지금 값은 잠금 아래에서 복호화해 메모리에서만 비교한다(`lib/crypto/contact-pii-repo` 의 `readStoredPiiPlain` · `piiPlainToStore`). `created_at` 은 `clock_timestamp()` 다 — 잠금 뒤 줄을 선 저장은 늦게 쓴 쪽이 먼저 시작했을 수 있어 `now()` 로는 최신순이 뒤집힌다. **편집자는 주체에서 파생한다** — procedure 가 `procedures/contact-editor` 의 `contactEditorOfContext` 로 만든다: 계정이면 세션의 id·이메일, 외주 실사 링크면 `link:<링크 id>` · 「외주」(`LINK_CONTACT_EDITOR_LABEL`). 회차는 귀속(`created_by` 계정 칸 · `fieldwork_link_id` 링크 칸, 0127 배타)과 별개로 기록자 글자 `created_by_email` 을 채운다. 외주 링크 화면(`hideStaffEmails`)은 기록과 회차의 내부 담당자 이메일을 걷고 「외주」 글자만 남긴다(ADR-0027 과 같은 규칙). 읽기는 `read-models/contact-target-edit-logs` 의 `getContactTargetEditLogs`(운영 데이터 스코프, 최신순 최대 200줄, 컨택원을 내리지 않는 화면이면 `visibleContactTargetEditChanges` 로 컨택원 변경을 뺀다), 화면 문구는 `features/operations/contacts/contact-target-edit-format`, 카드는 `contact-target-edit-history-card`. **조사 대상을 한 명씩 바꾸는 쓰기 경로를 새로 만들면** 대상 행 잠금 아래에서 지금 값을 읽고 같은 트랜잭션에서 `recordContactTargetEdit` 를 부를 것 — 일괄 쓰기(업로드·교체 적용·이월 임포트)는 남기지 않는 것이 정해진 범위다. Raw 내보내기의 노란 칸(CONTEXT.md 「조사 대상 명단 열」)이 이 기록을 읽는다(`read-models/contact-export-marks`). 기존 「수정 / 편집 현황」 칸은 「응답 수정 / 편집 현황」으로 이름만 바뀌었다.

---

## 외주 담당 범위

**외주 담당 범위** (0160 — CONTEXT.md 「담당 범위」·ADR-0035 가 정본): 외주 실사 링크마다 **볼 수 있는** 조사 대상의 경계다. 저장은 `fieldwork_link_shares`(link_id, contact_target_id — 같이 맡기기가 있어 다대다)와 링크 행의 `share_applied_at`(나눈 적 있음)·`share_clauses`(마지막 조건, 수정 화면이 다시 채운다). 링크 발급·이름표·종료는 `src/server/workspace/AGENTS.md` 「외주 실사 링크」.

- **해석은 `server/fieldwork-share-scope` 하나다.** `resolveFieldworkShare(actor, surveyId)` → `all | targets | none`. 계정 주체·클라이언트 링크·**한 번도 나누지 않은** 외주 링크는 `all`(업체 하나인 설문은 아무것도 하지 않아도 지금과 같다), 나눈 링크는 표가 비어도 0명(빼앗긴 쪽이 전체로 넓어지지 않는다), 링크가 남의 설문을 물으면 `none`. 「나눈 적 있음」은 세션 판정이 매 요청 링크 행에서 읽어 주체의 `shareDivided` 에 싣는다 — 쿠키에 없어서 범위를 바꾸면 다음 요청에 반영된다. 파티션(실/테스트)을 대체하지 않는 **옆 축**이고, capability 관문을 지난 뒤 **추가로** 건다.
- **술어는 `shareTargetCondition(share, column)` 하나다**(날 SQL 안은 늘 SQL 을 돌려주는 `shareTargetSql`) — 표면마다 새로 쓰지 말 것. 링크 하나의 범위 조각(`targetInLinkShare`·`targetInOtherOpenLinkShare`·`otherOpenLinkIds`·`linkShareCount`)도 같은 파일이다. 대상 칸 기본은 `contact_targets.id`, 응답 표면은 `survey_responses.contact_target_id` 다(대상 없는 응답은 나눈 링크에서 빠진다). `all` 이면 `undefined` 라 `and()` 가 건너뛴다. 서브쿼리 표를 별칭으로 박아 drizzle 관계 쿼리(`db.query.*.findFirst`) 안에서도 쓸 수 있다. 조사 대상 필터 해석을 거치는 표면은 위 「조사 대상 필터 해석」의 강제 절이 같은 술어를 건다.
- **표면 등재 — 미처리는 없다.** 외주 링크가 지나는 scoped procedure 와 `/fw` 화면은 전부 `tests/helpers/fieldwork-share-surfaces.ts` 에 「거름(`FILTERED`)」 또는 사유 있는 「해당 없음(`exempt`)」으로 올라 있고, `tests/integration/fieldwork-link-denial.test.ts` 가 라우터 열거(`LINK_OPEN_SCOPED_PATHS`)·`src/app/fw` 트리와 맞춘다. 새 표면을 링크에 열면 거르거나 사유를 대기 전까지 빨갛다. 「거름」인 `/fw` 화면은 page 파일 안에서 `resolveFieldworkShare(` 를 불러야 한다(스크린이 해석하면 page 가 넘기는 모양으로). 대리 응답 진입(`server/fieldwork-proxy`)은 열거 밖이라 판정 코어가 직접 건다(범위 밖 초대 토큰 = `blocked: out_of_share` → NOT_FOUND). 실제로 거르는지는 실DB 스위트 `fieldwork-share*.realdb` 가 링크 A·B 세션으로 본다.
- **빠뜨리면 tsc 가 잡게 필수 인자로 둔다** — `loadContactsListPage`·단건(회차·메모·단건 메일·상세)·응답(목록·단건·수정 저장)·현황 서비스의 `share`, 스크린의 `share` prop. 주체가 없거나 계정만 지나는 자리는 `FIELDWORK_SHARE_ALL` 을 명시한다. 단건 표면은 범위 밖 id 를 없는 대상과 같은 답으로 접는다(NOT_FOUND — 메일 미리보기 표본만 종전 계약대로 null).
- **외주가 보는 숫자는 자기 몫이다** — 응답 현황·진척 보고는 범위 대상 기준, 응답 내역 순번은 범위 안 순번(연구원 화면의 「응답 N번」과 다를 수 있다 — 소통은 시스템ID), 쿼터 현황은 셀마다 내 달성 수 + 설문 전체 기준 마감 여부뿐이다(`src/server/quota/AGENTS.md`). 진척 보고 제목의 그룹 라벨은 값이 실리지 않아 거르지 않는다.
- **나누기는 연구원 표면이다** — `contacts.fieldworkShares.*`(list·preview·apply·clear·matches·facets, 전부 `authed` + `survey.manageAccess`), 서비스 `services/fieldwork-shares.ts` 가 범위 표에 행을 넣는 유일한 자리다(외주 링크만·같은 설문·실데이터 대상만 같은 교차 테이블 조건을 잠근 행에서 다시 본다). 링크 하나를 통째로 푸는 것은 코어 `server/fieldwork-share-write` 의 `releaseLinkShares` 하나이고 「담당 범위 없애기」와 링크 종료가 함께 부른다. 적용은 결과 상태 지정(조건 결과 = 그 링크의 범위)이고 **쓰기 해석**이라 해석 안 되는 절을 거부한다. **실데이터 고정**(`EXTERNAL_VIEWER_DATA_SCOPE` — 연구원 브라우저가 테스트 데이터를 보고 있어도). 조건 편집기의 열 후보에 「현재 컨택원」이 없다(`loadFieldworkShareFilterContext` 가 외부 주체 컨텍스트로 읽는다 — 일 나누기가 업체 접근을 정하는 입구가 되지 않게). 「담당 범위 없애기」(`clear`)는 범위 행 삭제 + 나눈 적 있음 NULL 이다. 화면은 `(internal)/surveys/[id]/operations/contacts/shares` + `[linkId]`(조사 대상 메뉴 「외주 담당 범위」, `survey.manageAccess` 아래에만 선다)와 공유 설정 외주 링크 카드의 범위 요약·바로가기다.
- **겹침** = 조건 결과 ∧ 이 링크에 없음 ∧ 다른 **열린** 외주 링크에 있음(종료된 링크는 몫이 없고, 이미 같이 맡은 대상은 겹침이 아니다). 적용 입력의 필수 값 `overlap: 'take' | 'keep' | 'joint'`(가져오기·남겨 두기·같이 맡기기)가 처리를 정하고, 의미론의 정본은 수정 화면 쪽 `features/operations/contacts/shares/share-overlap` 의 `shareTargetOutcome`(소비자가 그 화면뿐이라 lib 에 두지 않는다)이고 적용 SQL 은 그 표를 손으로 옮긴 사본이다 — 둘은 `fieldwork-share-overlap.realdb` 「적용 SQL 은 화면의 의미론 표와 같다」가 사실 여덟 조합 × 처리 셋으로 맞춘다. 같이 맡은 대상에 외주 쪽 표식은 없다(외주 표면은 「이 링크에 있는가」만 본다).
- **잠금 순서는 설문 행 FOR SHARE → 링크 FOR UPDATE → 대상 id 오름차순 FOR NO KEY UPDATE** 다. 대상 잠금이 `FOR UPDATE` 면 FK 검사의 키 공유 잠금과 부딪혀 적용 중에 그 대상의 응답 행이 만들어지지 못하고, `FOR SHARE` 면 두 링크의 동시 가져오기가 줄을 서지 않아 양쪽에 남는다(`fieldwork-share-overlap.realdb` 가 둘 다 실측). 충돌·교착은 처음부터 다시 돈다(조건도 새로). 잠금 순서·세기·해제·재시도는 코어 `server/fieldwork-share-write`(`lockShareWriteScope`·`lockShareTargets`·`releaseLinkShares`·`retryShareWrite`) 한 벌이라 링크 종료도 같다.
- **풀리는 경우는 둘이다.** 링크 종료는 같은 트랜잭션에서 그 링크의 범위 행을 지우고 「나눈 적 있음」은 남긴다. 명단 교체 업로드는 대상 삭제의 CASCADE 로 푼다 — 나눈 링크는 다시 나눌 때까지 0명이고, 추가 업로드로 들어온 대상은 나눈 링크에 저절로 들어가지 않는다. 교체 업로드 경고 재료는 `countFieldworkSharesToRelease`(`services/fieldwork-share-release`, 나눈 **열린** 링크마다 이름·인원) → `features/operations/contacts/share-release-warning`.
