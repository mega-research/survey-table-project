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

**컨택원 배정** (2026-10-19, 0136 — CONTEXT.md 「컨택원 배정」이 정본): 컨택원은 계정이 아니라 이름 붙은 배정 묶음이고 한 대상은 지금 컨택원 하나에만 속한다(마지막 배정이 이긴다, 응답 상태 무관). **내부 실사 운영 도구라 외부 주체(외부 계정·외주 실사 링크·클라이언트 링크)에게 열지 않는다.** procedure `contacts.assignments.*` 는 베이스가 전부 `authed`(내부 계정 전용)이고 핸들러 첫 줄이 `assertSurveyCapabilityRpc(context.user, surveyId, …)` 다 — `list` 는 `contacts.view`, 나머지는 `contacts.manage`(외부 주체는 이 칸을 갖지 않는다). 전부 IDOR 인벤토리 `tests/integration/cross-team-idor-rpc.test.ts` 에 등재돼 있다. 관리 화면(`(internal)/surveys/[id]/operations/contacts/assignments` + `[assignmentId]`)은 `requireAdminPage()` + `assertSurveyCapabilityPage(viewer, surveyId, 'contacts.manage')` 가 막고, 주소는 `operationsPaths(base).contactsAssignments` / `.contactsAssignment(id)`(`features/operations/operations-paths.ts`), 탭 「컨택원 관리」는 `contacts.manage` 아래에만 선다. 외부 주체가 보는 화면은 컨택원을 전부 받지 않는다 — 조사 대상 목록의 「컨택원」 열·값·필터 후보·정렬(`loadContactsListPage` 의 `includeContactOwner` — 내부 페이지 `true`, `/fw` 링크 페이지 `false`. 끄면 로더 `includeAssignment:false` + `withoutContactOwnerColumn`), 외부 계정·클라이언트 링크 목록(`read-models/guest-contacts`)과 실사 계정 목록(`read-models/fieldwork-contacts`)의 `includeAssignment:false`, 단건 상세 드롭다운(`app/_operations/contact-detail-screen.tsx` 의 `includeContactOwner` — 내부 페이지만 켜고 `contacts.manage` 도 있어야 그린다), 진척 보고 칩(`app/_operations/report-screen.tsx` 의 `includeContactOwner` — 내부 `true`, `/fw` `false`). 쓰기는 `lockWriteScope` 파티션 아래서 하고 대상과 컨택원의 `is_test` 가 같아야 한다. 서비스는 `server/contacts/services/contact-assignments.ts`(만들기·이름·순서·지우기·한 명 바꾸기·관리 목록 통계 — 응답 상태는 목록 web 열과 같은 `matchedResponseSubquery`) · `contact-assignment-apply.ts`(교체 적용·미리보기·오른쪽 대상 목록) · `contact-assignment-facets.ts`(오른쪽 값 목록). **교체 적용**은 컨택원 행 `FOR UPDATE` 로 같은 컨택원 동시 적용을 직렬화하고 조건을 적용 시점에 다시 평가한다 — 조건 줄 0개 거부, 결과 0명 허용, **해석이 안 되는 절이나 읽지 못한 `list:` 토큰은 거부**(목록 검색처럼 조용히 버리면 조건이 넓어져 남의 배정을 끌어온다). 조건 밖 판정은 `COALESCE(filter, FALSE)` 로 감싼다(3값 논리로 빠지는 행이 없게). **들어옴·빠짐은 한 UPDATE 문장**(`CASE WHEN match THEN 이 컨택원 ELSE NULL`)이다 — 두 문장으로 나누면 조건이 「현재 컨택원」·「배정 없음」일 때 뒤 문장이 앞 문장이 바꾼 값을 다시 읽어 방금 옮긴 대상을 도로 푼다. 교체 적용·지우기는 서로 다른 컨택원끼리 겹치는 대상을 다른 순서로 잠가 교착(40P01)이 날 수 있어, 충돌이면 처음부터 다시 실행한다(`retryAssignmentWrite` → `lib/pg-error` 의 `retryOnTxConflict`, 3번까지 — 다시 돌 때 조건도 새로 계산하므로 나중에 끝난 쪽이 이긴다). 배정은 교체 적용과 상세 한 명 바꾸기로만 한다(조사 대상 목록 위의 「검색 결과 N명을 컨택원에 배정」은 걷어냈다). 목록 주소·스냅샷·조건 줄을 서버에서 읽는 자리는 아래 「조사 대상 필터 해석」을 거친다 — 그 결과로 대상을 고르거나 쓴다면 `mode: 'write'` 로 해석해 해석되지 않는 조건을 거부한다. 스킴에 `system.contact_owner` 열이 없는 옛 설문은 컨택원을 처음 만들 때 그 파티션 스킴 끝에 붙인다(`ensureContactOwnerColumn`). 교체 업로드 경고는 풀릴 배정 수(`countAssignedTargets`)를 보이고, 테스트 모드를 삭제로 끄면(`disableTestWorkspace`) 테스트 컨택원도 지운다. 컨택원 열은 엑셀 내려받기 제외 목록에 그대로 있다.

---

## 필터 확장

**필터 확장** (컨택원 배정과 함께): ① 「현재 컨택원」 `FILTER_SOURCE.CONTACT_OWNER`(`system.contact_owner`) — 값은 컨택원 id, 배정 없음은 `FILTER_NONE_VALUE`. 해석 모듈이 이 설문·세션 파티션 컨택원 id 로 검증하고(하위 파서의 `ParseExtraHooks.assignmentIds`, 외부 주체 컨텍스트는 넘기지 않아 절이 만들어지지 않는다) 다른 설문·파티션 id 는 0건이 아니라 조건 미적용. 열 후보는 `buildColumnCandidates(scheme, { includeContactOwner: true })` 로 켠 표면만 받는다 — 조사 대상 목록·컨택원 수정·**단체 메일 위저드**(「이메일 갱신」처럼 컨택원으로 묶은 명단에 보내기) 셋이고 셋 다 외부 주체에게는 끈다(위저드의 「필터 결과 전체 선택」 `fetchCandidateIds` 도 procedure 가 넘긴 `isExternalActor(context.actor)` 로 같다). **주소·스냅샷의 절이 지금 해석되지 않으면**(지워진 컨택원·빠진 열·읽지 못한 `list:` 토큰) 읽기 해석은 버려 명단이 넓어지므로 결과의 `unresolved` 로 알린다 — 위저드는 경고를 띄우고 「미응답자 재발송」 자동 전체 선택을 하지 않으며, `fetchCandidateIds` 는 write 해석이라 `BAD_REQUEST` 로 거부한다. 컨택원 열에도 「메일 표시」 스위치가 있다 — 켜면 위저드 미리보기·캠페인 상세 수신자 표·수신거부 명단에 지금 컨택원 이름이 나오고, 외부 주체 화면은 켜 두어도 싣지 않는다(단체 메일 페이지가 `isExternalViewer()` 로 정해 `resolveMailDisplayColumns(scheme, { includeContactOwner: !isExternal })` → 로더 `includeAssignment`). 열 정렬 키 `owner`(컨택원 순서 → 이름, 배정 없음 끝). ② `짝수`/`홀수` — 시스템ID·attrs ID 목록 입력이 **그 한 단어일 때만** 키워드(`parseParityKeyword`, `FilterCondition.parity`). attrs 는 값 전체가 숫자인 행만(앞자리 0 허용) 나머지 연산, 숫자 아닌 값·빈 값은 어느 쪽에도 안 걸린다 — 상태줄의 「숫자가 아닌 값 N명 제외」는 `contacts.attrValues.nonNumericCount`(`scoped` + `contacts.view`, `attrValues.list` 와 같은 권한이라 외주 실사 링크에도 열린다 — `LINK_OPEN_SCOPED_PATHS`). 진척 보고 필터(`progress-filters` 의 `mode:'parity'`)도 같다. ③ 조건 줄 값 하나에 여러 값 — `encodeMultiClauseValue`(양끝까지 `\u001f` 구분자, trim 이 값 앞뒤 공백을 못 지우게)로 담으면 파서가 헤더 체크박스와 같은 in 절로 읽는다(컨택원 수정 화면 오른쪽 값 목록이 만든다).

---

## 조사 대상 필터 해석

**조사 대상 필터 해석** (2026-10-19 — CONTEXT.md 「조사 대상 필터 해석」이 정본): 조사 대상 목록 · 단체 메일 위저드 · `fetchCandidateIds` · 교체 적용(미리보기·오른쪽 목록 포함) · 컨택원 수정 화면이 `server/read-models/contact-filter-resolution.ts` 한 곳으로 조건을 읽는다. `loadContactFilterContext(surveyId, scope, { isExternal, surface: 'contacts' | 'mail', canViewMail?, executor? })` 가 스킴(외부 주체면 컨택원 열 제거, `canViewMail:false` 면 메일 열 제거 — 외주 실사 링크 목록)·결과코드·컨택원 선택지(외부 주체면 빈 배열)·검색바 후보·열 머리 후보(`mail` 이면 미리보기 고정 열 `CAMPAIGN_HEADER_FILTER_COLUMNS` 를 덧붙임)를 읽고 — 페이지는 같은 컨텍스트를 UI props 에도 쓴다 — `resolveContactFilter(ctx, input, { mode })` 가 ID 목록을 읽어 해석한다. 입력은 캠페인 스냅샷 모양(`{ clauses: {source,value,op}[]; headerClauses?: {source,mode,hv}[] }`)이고 주소는 `contactFilterInputFromUrl(sp)` 로 바꾼다. 결과 `ResolvedContactFilter<'read'|'write'>` 는 이 모듈만 만드는 브랜드 타입이고 `{ clauses, builderClauses, headerClauses, unresolved }` 다. 서버 코드가 직접 조립한 절(검색 축이 화면에 고정된 실사 계정·클라이언트 링크 목록 — `read-models/fieldwork-contacts`·`guest-contacts`)은 같은 모듈의 `contactFilterFromServerClauses(clauses)` 로 감싼다 — 사용자가 고른 열 이름을 읽는 주소·스냅샷 입력에는 쓰지 않는다. `listContactsForSurvey`·`previewCampaignCandidates`·`countCampaignCandidates` 는 이 결과(`filter`)만 받고, 교체 적용 같은 **쓰기 서비스는 `ResolvedContactFilter<'write'>` 만 받는다** — write 해석은 해석 안 되는 조건이 하나라도 있으면 `ORPCError BAD_REQUEST`(문구는 모듈 소유: 「조건 N을(를) 지금 적용할 수 없습니다…」 · 「저장된 ID 목록을 찾을 수 없습니다…」). 조사 대상 목록 조립은 `server/read-models/contacts-list-page.ts` 의 `loadContactsListPage({ …, canViewMail, includeContactOwner })` 한 곳이고 화면은 `features/operations/contacts/contacts-list-view.tsx` 다 — 내부 콘솔과 `/fw` 링크 콘솔이 같은 조립을 쓰고 두 칸만 다르다(해석 컨텍스트의 `isExternal` 은 `!includeContactOwner`). 하위 파서는 `read-models/contacts-filter-parse.ts` 이고 ESLint 가 해석 모듈 · 응답 내역(`profiles-filters`, 응답 행 위 다른 열을 보는 표면이라 하위 파서 + 훅을 직접 쓴다) · 서버 트리 테스트 밖의 import 를 막는다(`eslint.config.mjs` 의 `CONTACT_FILTER_PARSE_PATTERN`). `listAssignmentOptions` 는 `read-models/contact-assignment-options.ts` 에 있다. `buildContactsFilterSql` 은 lib 공용이라 `FilterClause[]` 를 그대로 받는다. 테스트에서 해석이 관심사가 아니면 `tests/helpers/resolved-contact-filter.ts` 의 `resolvedFilterForTest` 를 쓴다.

---

## ID 목록 검색

조사 대상·단체 메일 위저드의 시스템ID/attrs 컬럼 검색은 **엑셀 열 붙여넣기 ID 목록**을 받는다 (`lib/operations/range-list.ts` — 공백·개행·탭·콤마 구분, 중복 제거). 단일 컬럼 인라인 상한 2,000개(URL 헤더 한계), 초과분은 `contacts.idLists.create` 로 `contact_id_lists` 에 저장하고 `q=list:<uuid>:<count>` 토큰으로 검색한다. 토큰은 조사 대상 필터 해석이 읽는다(`loadIdListsForValues`, `server/read-models/contact-id-lists.ts`) — 호출자가 따로 읽을 일이 없다. 「전체」 컬럼 검색의 200개 상한은 컬럼 곱연산 SQL 보호용으로 별개다.
