# Task 9 테스트 메일 캠페인 작업 보고서

## Status

- 캠페인 생성 트랜잭션이 설문 행을 `FOR SHARE`로 잠그고 DB의 현재 `testModeEnabled`로 `isTest`를 결정한다.
- 현재 scope와 선택 대상이 하나라도 다르면 실제/테스트 캠페인으로 강등하지 않고 새로고침 오류로 전체 생성을 거부한다.
- 테스트 캠페인은 scope별 회차 함수를 사용하고 title·subject snapshot에 `[TEST] `를 정확히 한 번 붙인다. 실제 캠페인의 기존 제목·스냅샷 동작은 유지한다.
- 목록은 캠페인 `isTest`에만 테스트 배지를 표시하며 실제/테스트 템플릿은 계속 공유한다.
- Task 3의 후보 전체선택, preflight, preview는 이미 매 mutation에서 현재 scope를 다시 읽어 scoped adapter에 전달하므로 중복 변경하지 않았다.

## TDD 증거

- RED: 설문 잠금 0회, 테스트 ID의 실제 캠페인 강등, mixed ID 허용, scope 없는 회차 함수 호출을 4개 실패로 관찰했다.
- GREEN: 설문 잠금·선택 scope 전수검증·scope별 회차·접두어 저장을 최소 구현해 생성 테스트 5개를 통과시켰다.
- RED→GREEN: 테스트 캠페인 목록에 배지가 없는 실패를 관찰한 뒤 `CampaignRow.isTest` 투영과 캠페인 전용 배지를 추가했다.
- 기존 부정 결과코드·중복 ID 회귀 테스트의 DB fake는 새 잠금·scope 조회 계약만 보완했다.

## 검증

- 지정 집중 테스트: 4파일 16건 통과.
- `pnpm exec tsc --noEmit`: 통과.
- `pnpm lint`: 오류 0건, 기존 경고 99건.
- `pnpm test`: 본 실행 320파일 2,618건, 격리 실행 1파일 14건 모두 통과.
- `git diff --check`: 통과.

## 우려

- Task 10의 footer, unsubscribe, 렌더, dispatch URL 의미론은 변경하지 않았다.
- Task 11의 archive mutation은 구현하지 않았고, 기존 read adapter의 archived 제외 조건만 유지했다.

## 리뷰 수정

- 실제 캠페인은 subject snapshot 원문을 그대로 보존하고 title만 기존처럼 호출부에서 trim하도록 분리했다.
- 테스트 값의 반복된 `[TEST] ` 접두어를 정규화해 최종 접두어가 한 번만 남게 했다.
- in-memory DB fake가 `survey_id`·`is_test`·선택 ID 집합을 실제 SQL parameter로 적용하고, 교차 설문·미선택 동일 scope 대상을 제외하는 회귀를 추가했다.
- RED 2건을 확인한 뒤 집중 4파일 18건, 실DB 12파일 45건, 전체 320파일 2,620건+격리 14건을 통과했다. 실DB에서 scope별 동시 회차 발번과 mode flip의 `FOR SHARE` 직렬화를 검증했고, 신규 경쟁 파일은 단독 연속 3회 통과했다.

## 재검토 후 경쟁 테스트 보강

- 단순 `Promise.all` 동시 호출을 제거하고 첫 생성이 회차 발번과 캠페인 insert를 마친 뒤 result-code gate에서 멈추도록 했다. 두 번째 생성의 transaction backend PID를 별도로 포착하고, 첫 transaction PID가 두 번째 PID의 미승인 `advisory` lock blocker인지 `pg_blocking_pids`로 확인한 뒤 gate를 해제한다.
- mode flip은 `max:1` 전용 postgres 연결의 backend PID를 먼저 얻은 뒤 UPDATE를 실행한다. DB 전체의 쿼리 문자열을 검색하지 않고 정확한 updater PID가 생성 transaction PID에 차단됐는지 확인한다.
- 각 blocker 관찰에는 10초 timeout과 마지막 lock snapshot 오류를 두고, `finally`에서 gate 해제·진행 promise settle·spy 복구·전용 연결 종료를 수행한다. fixture는 UUID survey 단위 FK cascade 삭제로 정리한다.
- RED: blocker 관찰 helper 미구현 오류로 두 경쟁 테스트가 각각 실패하는 것을 확인했다.
- GREEN: 신규 경쟁 파일 단독 3회 연속 2건 통과, 전체 실DB 12파일 45건 통과, Task 9 관련 일반 테스트 4파일 18건 통과를 확인했다. 전체 `pnpm test`도 본 실행 320파일 2,620건과 격리 실행 1파일 14건이 모두 통과했다.

## 최종 test harness timeout 보강

- 두 실DB 경쟁 테스트에 90초 timeout을 명시했다. blocker 관찰 10초, 정상 완료 10초, cleanup 20초, backend 종료 후 cleanup 5초, 전용 SQL statement·연결 종료 예산을 모두 합친 최악 경로보다 충분히 길다.
- cleanup의 `Promise.allSettled`는 20초로 제한한다. 시간이 초과되면 fixture에서 포착한 campaign transaction backend PID만 `pg_terminate_backend`로 종료하고 같은 settlement를 5초 동안 다시 기다린다.
- cleanup settlement의 성공·실패와 무관하게 중첩 `finally`가 transaction spy를 복구하고 observer와 mode-flip 전용 postgres 연결을 모두 종료한다. 연결 종료는 각 client의 1초 timeout과 `Promise.allSettled`로 모든 client에 시도한다.
- RED: DB fixture를 만들기 전 해제되지 않는 임시 대기를 두어 기존 테스트가 Vitest 기본 5,000ms timeout으로 실패함을 확인했다.
- GREEN: 임시 대기를 제거한 최종 코드로 신규 경쟁 파일 단독 3회 연속 2건 통과, 전체 실DB 12파일 45건 통과, `pnpm exec tsc --noEmit` 및 해당 파일 ESLint 통과를 확인했다.

## 최종 harness budget 재산정

- 앞선 90초 timeout 설명을 폐기하고 phase 예산을 코드 상수로 직접 합산했다. fixture 20초 + lock coordination 30초 + blocker 관찰 10초 + lock 해제 후 operation 10초 + cleanup settle 20초 + PID 종료 2초 + 강제 cleanup 5초 + SQL close 3초 + 후속 검증 20초 = 120초이며, margin 30초를 더해 각 테스트 timeout을 150초로 정했다.
- observer 연결은 `statement_timeout`을 1초로 낮췄고 각 blocker snapshot 호출에도 2초 JavaScript timeout을 적용했다. 두 제한 모두 전체 polling 예산 10초보다 짧아 단일 관찰 쿼리가 polling deadline을 넘겨 붙잡을 수 없다.
- cleanup timeout 시 포착 PID를 개별 쿼리로 직렬 종료하지 않는다. campaign transaction PID와 mode-flip updater PID를 중복 제거한 JSON 목록으로 전달하고, 살아 있는 transaction backend를 하나의 2초 제한 SQL에서 일괄 종료한다.
- postgres 연결 종료는 드라이버의 `end({ timeout: 1 })` 파괴 semantics와 별도의 3초 JavaScript timeout을 함께 적용해 observer나 mode-flip 전용 연결이 무기한 대기하지 않게 했다.
- 각 테스트 callback과 모든 operation의 settlement를 별도로 추적한다. `afterEach`는 gate를 먼저 해제한 뒤 callback cleanup과 operation 최종 settlement가 끝난 경우에만 UUID fixture를 삭제하며, 이 hook은 120초 + operation 확인 20초 + margin 30초 = 170초 timeout을 갖는다. 따라서 Vitest가 테스트 timeout 후 hook을 시작해도 살아 있는 transaction과 fixture 삭제가 경합하지 않는다.
- 최종 코드로 신규 경쟁 파일 단독 3회 연속 2건 통과, 전체 실DB 12파일 45건 통과, `pnpm exec tsc --noEmit`, 대상 파일 ESLint, `git diff --check` 통과를 확인했다.

## 최종 harness identity 및 phase bound 보정

- 산식에만 있던 fixture와 post-lock assertion 예산을 실제 제한으로 바꿨다. fixture는 전용 연결에서 statement 5초·query 10초를 적용한 4개 query와 transaction 40초·close 3초로 제한한다. post-lock assertion은 전용 query 최대 2회 20초 + campaign operation 20초 + close 3초로 제한하고, campaign transaction에는 `SET LOCAL statement_timeout = '15000ms'`를 적용한다.
- fixture 삭제도 UUID 목록 전체를 하나의 전용 SQL로 처리하며 statement 5초·query 10초·close 3초 제한을 갖는다. 실제 test phase는 fixture 43초 + lock coordination 30초 + 관찰 10초 + lock 해제 후 operation 10초 + cleanup 20초 + identity 종료 2초 + 강제 cleanup 5초 + observer close 3초 + assertion 43초 = 166초이고, margin 30초를 더한 test timeout은 196초다.
- `afterEach`는 gate 해제, callback 대기, operation settlement, mock·상태 복구, bounded fixture 삭제를 각각 독립적으로 시도하고 모든 오류를 마지막 `AggregateError`로 합친다. 앞 단계가 실패해도 뒤 cleanup이 생략되지 않으며 hook timeout은 test phase 166초 + operation 확인 20초 + fixture 삭제 13초 + margin 30초 = 229초다.
- campaign 생성과 mode flip transaction 시작 시 `pid`와 `transaction_timestamp()`를 함께 포착한다. backend 종료 SQL은 JSON recordset의 `(pid, xact_start)`가 현재 `pg_stat_activity`의 active transaction과 모두 일치할 때만 `pg_terminate_backend`를 호출한다.
- 같은 `max:1` 연결의 첫 transaction이 끝난 뒤 동일 PID로 두 번째 transaction을 열어 첫 identity로는 두 번째가 종료되지 않는 realdb 회귀를 추가했다. identity join을 임시 제거한 RED에서는 새 transaction 조회가 빈 배열로 실패했고, join 복원 후 GREEN을 확인했다.
- 최종 집중 realdb 파일은 3회 연속 각 3건 통과했고, 전체 실DB는 12파일 46건 통과했다. `pnpm exec tsc --noEmit`, 대상 파일 ESLint, `git diff --check`도 통과했다.
