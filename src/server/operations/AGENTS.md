# 운영 콘솔 집계

> 루트 `AGENTS.md` 에서 떼어 낸 상세 참조다. 이 디렉터리 아래를 만질 때 읽는다.
> 공통 규칙(주의사항·코드 컨벤션·마이그레이션 번호·CI 게이트)은 루트 `AGENTS.md` 에 있다.
> `CLAUDE.md` 는 이 파일을 가리키는 심볼릭 링크다 — 수정은 이 파일에 한다.

## 운영 집계와 파티션

운영 집계는 `server/operations/services` 에서 SQL 집계로 수행 (aggregate + format + wrapper 패턴 — 공유 format 짝은 `lib/operations/*-format.ts`, UI 도 소비하므로 lib 이 정답). 정확한 통계는 `question_responses` JSONB 기준 (response_answers는 saveResponse/saveAdminEdit 에서만 채워짐).
콘솔 조회·쓰기는 `loadOperationsDataScope`가 결정한 실/테스트 파티션(`is_test`)에 갇힌다. 엑셀·SPSS export 라우트도 같은 스코프를 탄다. 신규 집계 쿼리는 스코프 필터를 빠뜨리지 말 것.

---

## 진척 보고 분류 키

**진척 보고 분류 키는 태그 키**다(`lib/operations/report-progress-format` 의 `ProgressGroupKey` — attrs 키는 접두 없이 그대로 직렬화해 옛 `groupBy=` 주소가 열리고, 시스템 기준은 `system:<이름>`, 어휘 `PROGRESS_SYSTEM_GROUP_KEYS`, 읽기·쓰기는 `parseProgressGroupKey`/`formatProgressGroupKey`). 집계(`report-progress` 의 `groupKeySql`)는 기준마다 값·표시·정렬 식을 따로 내고, 행의 `groupValues` 는 표시 값이다. 「컨택원」 칩은 `includeContactOwner` 를 켠 화면에서 컨택원이 있을 때만 맨 끝에 **기본 꺼짐**(`defaultOff`)으로 나오고 — `resolveActiveGroupKeys` 가 `groupBy` 미지정이면 `defaultOff` 가 아닌 기준만 켠다 — 배정 없음은 「(배정 없음)」 한 줄이다. 클라이언트 링크 진척 보고(`app/_client-console/report-screen.tsx`)는 attrs 기준만 넘긴다.
