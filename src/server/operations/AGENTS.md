# 운영 콘솔 집계

> 루트 `AGENTS.md` 에서 떼어 낸 상세 참조다. 이 디렉터리 아래를 만질 때 읽는다.
> 공통 규칙(주의사항·코드 컨벤션·CI 게이트)은 루트 `AGENTS.md` 에, 마이그레이션 번호는 `supabase/AGENTS.md` 에 있다.
> `CLAUDE.md` 는 이 파일을 가리키는 심볼릭 링크다 — 수정은 이 파일에 한다.

## 운영 집계와 파티션

운영 집계는 `server/operations/services` 에서 SQL 집계로 수행 (aggregate + format + wrapper 패턴 — 공유 format 짝은 `lib/operations/*-format.ts`, UI 도 소비하므로 lib 이 정답). 응답값의 정본은 `question_responses` JSONB 하나다 — 문항별 사본 `response_answers` 는 2026-10-23 에 걷어냈다(0143, 읽는 곳이 모두 JSONB 모양으로 되돌려 썼고 SQL 필터에 쓴 곳이 없었다). 문항·변수 단위 통계 표가 필요해지면 이중 쓰기가 아니라 원본에서 다시 만들 수 있는 파생 표로 설계할 것.

콘솔 조회·쓰기는 `loadOperationsDataScope`가 결정한 실/테스트 파티션(`is_test`)에 갇힌다. 엑셀·SPSS export 라우트도 같은 스코프를 탄다. 신규 집계 쿼리는 스코프 필터를 빠뜨리지 말 것.

## 진척 보고 분류 키

**진척 보고 분류 키는 태그 키**다(`lib/operations/report-progress-format` 의 `ProgressGroupKey` — attrs 키는 접두 없이 그대로 직렬화해 옛 `groupBy=` 주소가 열리고, 시스템 기준은 `system:<이름>`, 어휘 `PROGRESS_SYSTEM_GROUP_KEYS`). 집계(`report-progress` 의 `groupKeySql`)는 기준마다 값·표시·정렬 식을 따로 내고, 행의 `groupValues` 는 표시 값이다. 「컨택원」 칩은 컨택원이 있을 때만 맨 끝에 **기본 꺼짐**(`defaultOff`)으로 나오고, 배정 없음은 「(배정 없음)」 한 줄이다. 켜진 분류 기준과 같은 명단 열은 「표시」가 켜져 있어도 표시 열(그룹 안 첫 값을 보이는 대표값 칸)로 다시 그리지 않는다(`metaColumnsOutsideGroupKeys`). 분류 기준의 이름(칩·표 머리·제목)은 진척률 컬럼 설정에서 고친 라벨이 먼저고, 없으면 조사 대상 목록의 라벨이다(`progressCriterionLabel`). 표시 열과 명단 열 분류 기준의 정렬은 조사 대상 목록과 같은 자연 정렬이다 — 글자로 올라온 숫자는 숫자순, 숫자가 아닌 값은 그 뒤에 글자순(`naturalTextSortExprs` — 글자순만 쓰면 전시회ID 가 1, 10, 11, 2 로 선다). 주소에 정렬이 없으면 조사 대상 목록의 기본 정렬 열이 이 표에 나와 있을 때 그 열 오름차순으로 연다(`progressDefaultSort`, CONTEXT.md 「기본 정렬 열」).
