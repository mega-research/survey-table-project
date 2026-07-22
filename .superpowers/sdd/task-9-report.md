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
