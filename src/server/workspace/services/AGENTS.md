# 워크스페이스 서비스 — 설문 그룹

> `src/server/workspace/AGENTS.md` 「설문 그룹」에서 떼어 낸 상세 참조다. `services/survey-groups.ts` 를 만질 때 읽는다.
> 관문(그룹 구조는 팀 공용 · 설문을 넣고 빼는 것은 설문 권한)과 화면 주소는 그 문서에, 용어와 보이는 규칙은
> CONTEXT.md 「설문 그룹」·「미분류」에, 결정 배경은 ADR-0038 에 있다.
> `CLAUDE.md` 는 이 파일을 가리키는 심볼릭 링크다 — 수정은 이 파일에 한다.

## 설문 그룹 — 구조 쓰기와 목록

그룹은 3단계까지 겹친다(`SURVEY_GROUP_MAX_DEPTH`, `shared/contracts/workspace-io`). 표의 제약은
`src/db/schema/AGENTS.md` 의 `survey_groups`, 표면은 `workspace.surveyGroups.*` 다.

### 구조 쓰기 다섯은 한 줄로 선다

만들기(`createSurveyGroup`) · 이름 바꾸기(`renameSurveyGroup`) · 순서 바꾸기(`reorderSurveyGroups`) ·
옮기기(`relocateSurveyGroup`) · 지우기(`removeSurveyGroup`)는 전부 `inGroupStructureTx` 안에서 돈다.

- **첫 줄에서 팀 키 advisory lock 을 잡는다**(`lockTeamGroupStructure` — 키는 `survey-groups-<teamId>`,
  `groupId` 만 받는 쓰기는 `lockGroupStructureByGroup`). 깊이·이름 겹침·옮길 자리·올라갈 자리의 판정이 전부
  「읽고 나서 쓰기」라, 같은 팀의 구조 쓰기가 겹치면 서로가 읽은 것이 낡는다. 한 줄로 세우면 두 사람이
  서로의 하위로 동시에 옮기거나 동시에 한 단계씩 늘려도 나중 요청이 먼저 끝난 결과를 보고 거부된다.
- **같은 자리에서 `teams` 행을 `FOR SHARE` 로 잡고 active 를 다시 본다.** 관문의 확인은 별도 왕복이라 그
  사이 해산이 커밋되면 감사 계보로 남겨야 할 archived 팀의 그룹 행이 수정·삭제된다.
- **잠금 순서는 하나다 — 팀 키 → 팀 행 → 그룹 행 → 설문 행.** 설문 행을 잠그는 담기·이동
  (`collectSurveysIntoGroup`·`moveSurveyToGroup`)은 팀 키를 잡지 않고 그룹 행 → 설문 행(`FOR UPDATE`,
  설문끼리는 id 오름차순)으로 가므로 방향이 같다. **팀 키를 그룹 행이나 설문 행 뒤에 잡는 경로를 만들지 말 것.**
- 교착(40P01)·직렬화 실패(40001)는 `retryOnTxConflict` 가 처음부터 다시 돌린다. 담기·이동은 재시도하지
  않으므로 그쪽과 잠금 순서가 엇갈리면 오류 화면으로 끝난다.

### 깊이·같은 팀 부모·순환은 DB 도 막는다

0166 의 복합 FK 와 CHECK 가 4단계·다른 팀의 부모·순환(자기 하위 밑으로 옮기기)을 전부 거부한다. 그래도
**서비스가 먼저 판정한다** — DB 의 거부는 CHECK·FK 위반이라 그대로 두면 500 이다. 서비스가 알맞은 도메인
에러(전부 CONFLICT)로 답하고 DB 는 그 판정이 틀렸을 때의 마지막 방어선이다.

쓰는 값은 언제나 **그 그룹 한 행의 `parentGroupId`·`parentDepth` 짝**이다(최상위면 둘 다 null). `depth` 는
계산 칸이라 쓸 수 없고, 하위 그룹의 깊이는 FK 의 `ON UPDATE CASCADE` 가 따라 고친다 — 하위 그룹 행을 직접
고치지 않는다. 이름 겹침은 유일 인덱스(23505)를 `isUniqueViolation` 으로 받아 「이미 있는 이름」으로 답한다.

### 옮기기 — `relocate`

표면 이름은 `workspace.surveyGroups.relocate` 다. **`move` 는 설문 한 건의 그룹 이동**이라 다른 표면이다.
입력의 `parentGroupId` 는 기본값 없는 필수이고 null 이 최상위다.

- 팀 키 아래서 **그 팀의 구조 전부**를 읽어 `utils/survey-group-tree` 의 `judgeSurveyGroupRelocation` 으로
  판정한다. 화면의 옮기기 창이 쓰는 것과 같은 함수다 — 화면은 요청자에게 보이는 그룹만 알고 서버는 전부를 안다.
- 거부: 없는 그룹·다른 팀의 그룹(같은 NOT_FOUND) · 자기 자신·자기 하위 밑 · 「새 부모의 깊이 + 옮기는 가지의
  높이」가 3을 넘는 자리 · 그 자리에 같은 이름.
- **지금 있는 자리로 옮기는 요청은 아무것도 쓰지 않고 성공한다**(맨 뒤로 다시 붙이지도 않는다). 그 밖에는
  새 부모의 맨 뒤에 붙는다.
- 담긴 설문의 소속 그룹은 바뀌지 않는다. 설문 관문도 묻지 않는다 — 구조는 팀 공용이다.

### 지우기 — 내용물을 한 단계 위로

하위 그룹은 지운 그룹의 부모 밑으로(최상위였으면 최상위로, 그 자리의 맨 뒤), 직접 담긴 설문은 그 부모
그룹으로(최상위였으면 미분류) 간다. **순서가 계약이다.**

1. 지우는 그룹 행 `FOR UPDATE`, 이어서 **올라갈 자리(부모) 행 `FOR KEY SHARE`**(`lockLiftDestination`).
   설문을 부모 그룹에 다시 매달면 FK 가 그 부모 행을 잠그는데, 설문 행을 쥔 뒤에 그 잠금을 기다리면
   순서가 「설문 행 → 그룹 행」으로 뒤집혀 담기·이동과 교착한다. 그래서 설문 행보다 먼저 잡는다.
2. 하위 그룹 올리기(`liftSubgroups`). 올라갈 자리에 같은 이름의 그룹이 있으면 **아무것도 쓰기 전에**
   `SurveyGroupLiftNameConflictError` → CONFLICT + `data.conflictingNames`(모양은 `SurveyGroupRemoveConflict`).
   지우는 그룹과 이름이 같은 하위 그룹(「2026 › 2026」)은 겹침이 아니라 그 자리를 물려받는다.
3. 설문 올리기(`liftDirectSurveys` — id 오름차순 `FOR NO KEY UPDATE`). 휴지통의 설문도 함께 올린다.
4. 그룹 삭제.

2 를 건너뛰고 지우면 FK(`ON DELETE NO ACTION`)가 막고, 3 을 건너뛰면 `surveys.survey_group_id` 의
`ON DELETE SET NULL` 이 설문을 부모가 아니라 미분류로 떨어뜨린다. 요청자가 편집할 수 없는 설문이 담겨
있어도 지운다. 같은 삭제를 두 번 보내면 두 번째는 「없는 그룹」이다.

### 순서 바꾸기 — 한 부모의 형제만

입력의 `parentGroupId`(없거나 null 이면 최상위끼리)가 가리키는 부모의 하위 그룹만 다시 매긴다. UPDATE 를
팀과 부모로 함께 좁히므로 타 팀·다른 부모의 id 가 섞여 와도 그 행에는 닿지 않는다.

### 목록 — 관문 대신 조회 조건이 좁힌다

`listSurveyGroups` 는 내 팀 줄(`listOwnTeamGroups`)과 협업 그룹 줄(`listCollaboratingGroups`)을 이어 붙인
평평한 목록이고 트리는 화면이 묶는다(`buildSurveyGroupTree`).

- **내 팀 줄**: 건수는 하위 그룹까지 합친, 요청자가 볼 수 있는 설문 수다. 아래에 설문이 있는데 볼 수 있는
  것이 없으면 행이 나오지 않고, 아래 전체가 비면 나오며, **위쪽 그룹 중 하나라도 숨으면 함께 숨는다.**
  그래서 내 팀 줄의 `parentGroupId` 는 언제나 목록 안의 줄을 가리킨다 — 목록에 깊이 칸을 따로 두지 않는다.
- **협업 그룹 줄**: 요청자가 볼 수 있는 설문이 **직접** 담긴 타 팀 그룹만, `parentGroupId` 는 언제나 null,
  건수도 직접 담긴 것만. 타 팀 사람에게 위쪽·아래쪽 그룹 이름을 내지 않는다(ADR-0038).
- **보이는 술어는 설문 목록(`buildSurveyScopeFilter`)과 같은 조각이다**(`participatesInSurvey`·
  `leadsParticipantTeam`). 사본을 두면 「그룹은 보이는데 안이 비었거나, 설문은 보이는데 폴더가 없는」
  상태가 된다.
- 「아래 전체」는 재귀 없이 자기 조인으로 편다(`isWithinGroupSubtree` — 자기 · 바로 밑 · 그 밑). **깊이
  상한을 늘리면 이 술어와 설문 목록의 `inGroupSubtreeSql` 이 한 단계를 놓친다.**
- 그룹 화면의 검색 범위(검색어가 있으면 아래 전체, 협업 그룹은 직접 담긴 설문만)는 설문 목록 read-model 이
  정한다 — `src/server/AGENTS.md` 「설문 목록 조회」.

### 그 밖의 계약

- 담기·이동·옮기기·지우기 어느 것도 `surveys.updatedAt` 을 건드리지 않는다. 폴더 정리는 내용 수정이 아니고,
  건드리면 「최신 수정순」 기본 정렬이 담기 한 번에 뒤집힌다.
- 담기 후보(`listUngroupedSurveys`)의 `canMove` 는 근사가 아니라 서버 판정 그대로다(주체 한 번 +
  `resolveSurveyCapabilities` 를 행마다). 볼 수 없는 설문은 후보에 나오지 않는다.
- 옮기기와 지우기는 커밋 뒤에 로그 한 줄을 남긴다(그룹 id · 함께 움직인 하위 그룹 수 · 올린 설문 수).
  그룹 이름은 싣지 않는다.
- 음성 검증은 실DB 다 — `tests/integration/survey-groups.realdb.test.ts`(중첩·가시성·지우기·동시성)와
  `survey-groups-relocate.realdb.test.ts`(옮기기). 조인·잠금·제약은 목으로는 무엇이든 통과한다.
