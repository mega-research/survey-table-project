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
