# Task 12 구현 보고서

## 구현 범위

- `disableTestWorkspace({ surveyId, disposition })`를 테스트 모드 OFF의 유일한 mutation으로 추가했다.
  - survey row를 가장 먼저 잠그고 전역 테스트 모드를 끈다.
  - 비보관 테스트 campaign 중 `queued | sending`만 취소한다.
  - `keep`은 테스트 응답·대상자·컬럼을 보존하고 현재 개수를 반환한다.
  - `delete`는 Task 11 workspace mail archive를 먼저 수행한 뒤 테스트 응답과 대상자를 hard delete하고 `testContactColumns`를 초기화한다.
  - 실제 응답·대상자·campaign은 두 disposition 모두 변경하지 않는다.
- `setTestMode`는 ON 전용으로 좁혔다. procedure 입력은 `enabled: true` literal이며 service도 임의의 `false` 호출을 거부한다.
- control state에 테스트 대상자 수와 첫 invite code를 추가했다.
  - 첫 대상자는 `resid ASC, id ASC` 순서로 결정한다.
  - target이 있으면 `/i/{firstTestInviteCode}`, 없으면 기존 anonymous test URL을 복사한다.
- 테스트 대상자 생성 dialog를 추가했다.
  - 필드는 `생성 인원` 1~20과 `메일 받을 테스트 주소`만 제공한다.
  - 기존 `contacts.targets.generateTest`를 호출하며 성공 또는 stale generation 후 control state를 다시 조회한다.
- 테스트 모드 ON popup을 대상자 개수별 exact contract로 제한했다.
  - 0명: 링크 복사, 대상자 생성, separator, 모드 끄기
  - 1명 이상: 링크 복사, separator, 모드 끄기
- 테스트 모드 종료는 응답·대상자 수와 관계없이 항상 동일한 확인 dialog를 사용한다.
  - 제목은 대상자 유무에 따라 정확한 count 문구를 사용한다.
  - 명세의 세 문장을 순서대로 표시한다.
  - 버튼은 `취소`, `보관하고 끄기`, `삭제 후 끄기` 세 개뿐이며 두 action은 각각 `control.disable`을 한 번 호출한다.
- 전역 control state를 focus와 10초 polling으로 동기화하고 snapshot이 바뀔 때만 router를 refresh한다.
  - RSC initial prop 변경도 client local state에 반영한다.
  - 운영 layout의 amber banner는 전역 test mode가 ON일 때만 표시한다.
  - 편집 페이지는 기존 무-initial self-fetch 경로를 유지해 열린 빌더의 사용자 변경을 건드리지 않았다.
  - 응답 완료 흐름은 변경하지 않았다.

## TDD

- RED: keep/delete service 부재와 기존 OFF의 응답 조건 분기, 대상자 없는 anonymous-only popup, arbitrary `false` 허용을 각각 실패로 확인했다.
- GREEN: lifecycle fake DB, control procedure/service, popup/generator/dialog/sync component 테스트를 구현했다.
- 독립 리뷰 RED 보완으로 stale 종료, 역순 polling, 단일 SQL snapshot, 생성 form 오류 접근성을 추가 검증했다.
- 로컬 PostgreSQL에서 다음 경계를 추가 검증했다.
  - keep은 mode와 진행 중 테스트 발송만 끄고 테스트 workspace와 컬럼을 보존한다.
  - delete는 테스트 응답·대상자를 제거하고 완료 발송을 비식별 보관한다.
  - 실제 응답·대상자·campaign은 그대로 보존한다.

## 검증

- Task 12 집중 회귀: 5개 파일, 33건 통과
- 로컬 PostgreSQL realdb: Task 11 회귀 4건 + Task 12 keep/delete 2건, 총 6건 통과
- `pnpm exec tsc --noEmit`: 통과
- 변경 파일 ESLint: 경고·오류 0건
- `pnpm lint`: 오류 0건, 기존 경고 99건; 새 파일의 effect 경고를 제거했다.
- `pnpm test`: 본 스위트 332개 파일, 2,711건 통과
  - 후속 격리 단계에서 AGENTS.md에 명시된 `profiles-row-actions.test.ts` 12건 flaky가 재현됐다.
  - 즉시 파일 단독 재실행해 14건 전부 통과했다.
- `pnpm build`: production build와 전체 route generation 통과

## 독립 리뷰 보완

- Spec Important 1건과 Standards Important 3건을 RED로 재현하고 수정했다.
  - 다른 관리자가 keep으로 종료한 뒤 도착한 stale delete가 보관 workspace를 삭제하던 경합
  - 겹친 focus/poll 요청의 역순 응답이 최신 mode를 덮어쓰던 경합
  - mode, response/target count, first invite가 서로 다른 SQL snapshot에서 혼합되던 경합
  - generator 검증 오류가 invalid field와 접근성 트리에 연결되지 않던 문제
- control state는 correlated subquery를 포함한 단일 SQL statement로 통합했다. 실제 PostgreSQL 검증에서
  최초 outer-column qualification 오류를 RED로 잡고 명시적 alias로 보정했다.
- Spec 및 Standards 독립 재리뷰 모두 APPROVE, 남은 Critical/Important finding 0건

## 변경하지 않은 범위

- DB schema와 migration
- 원격 Supabase, 원격 DDL 및 원격 migration
- 편집 페이지의 기존 사용자 변경
- 응답 완료와 copied response lifecycle
- 별도 테스트 대상자 보기, 다시 테스트하기 또는 추가 popup 항목
