# Task 8 응답 클라이언트 attempt 작업 보고서

## Status

- 대상자 테스트 flow는 화면 마운트마다 안정적인 `attemptId`와 `sessionId`를 만들고, 첫 실제 입력 또는 답 없는 제출에서만 쓰기 소유권을 획득한다.
- create, blank, complete, step visit, visibility fetch/sendBeacon에 같은 attempt identity를 전달한다. 실제·익명 테스트 payload에는 attempt를 추가하지 않는다.
- 같은 버전 `in_progress` 답은 읽기 전용 resume으로 복원하되 소유권 획득 전 telemetry를 쓰지 않는다. terminal·이전 버전은 저장 key를 지우고 빈 입력 화면을 유지한다.
- invite token별 localStorage key로 대상자 세션을 격리한다. 새 flow 마운트는 새 attempt를 만들어 이전 화면을 supersede할 수 있다.
- stale 테스트 링크는 scoped 저장 상태와 응답 store를 지우고 `InvalidTestLinkScreen`에서 종료한다. `다시 테스트하기` CTA나 테스트 대상자 전용 표시는 추가하지 않았다.
- Task 9 메일 코드는 변경하지 않았다.

## TDD 증거

- RED: 기존 lifecycle 13건이 Node 26의 비활성 experimental localStorage 때문에 테스트 본문 전에 전부 실패하는 것을 확인했다.
- GREEN: 공용 jsdom 메모리 Storage를 설치하고 node test environment는 제외해 lifecycle 16건이 실제 경로를 실행하도록 복구했다.
- RED→GREEN: 회복 응답 첫 입력 attempt 획득, blank 후 complete identity, invite별 key, sendBeacon identity, ownership 전 telemetry 차단, key 없는 target resume, flow 조합 identity, stale 링크 재확인을 각각 실패로 관찰한 뒤 수직 조각으로 구현했다.
- 내부 `session-helpers` 모킹이 invite 인수를 버리는 반패턴을 제거하고 실제 helper interface를 통과해 검증했다.

## 검증

- 집중 테스트: `target-test-session`, `use-response-lifecycle`, `response-segment` 3파일 35건 통과.
- `pnpm exec tsc --noEmit`: 통과.
- `pnpm lint`: 오류 0, 기존 경고 99건.
- `pnpm test`: 본 실행 319파일 2,601건 통과, 격리 실행 1파일 14건 통과.
- `git diff --check`: 통과.

## 사용자 변경 보존

- 원본 checkout의 `SurveyCompletedScreen` 변경을 worktree에 먼저 동일 적용했다.
- `questionCount` prop과 `총 N개 질문` 표시는 제거된 상태를 유지했고, 완료 시간은 `showCompletedTime`일 때만 렌더한다. 해당 표시를 재도입하지 않았다.

## 우려

- lint 경고 99건은 기존 코드베이스 경고이며 이번 변경에서 오류를 추가하지 않았다.
- Node 26 테스트 환경의 localStorage는 jsdom에서만 표준 Storage interface의 메모리 구현으로 대체한다. node 전용 테스트에는 전역을 설치하지 않는다.

## 리뷰 수정

- `SurveyResponseFlow` 앞에 identity boundary와 control shell을 두어 초기 무효 링크에서 recovery·telemetry·lifecycle 훅을 mount하지 않는다. 무효 링크는 survey+invite storage key, Zustand 응답 상태, local answers를 지운 뒤 종료 화면만 렌더한다.
- survey/invite/test identity를 React key로 삼아 같은 컴포넌트에서 token이 바뀌어도 attemptId, sessionId, ownership, currentResponseId, local answers가 함께 새 scope로 교체된다. 이전 invite response를 새 invite로 complete하지 않는 통합 테스트를 추가했다.
- `useSessionRecovery` 요청에 generation/cancel guard를 적용하고 같은 identity의 promise를 재사용했다. deferred promise로 빠른 identity 전환의 stale then/catch/finally, StrictMode 중복 resume, unmount 후 갱신 차단을 검증했다.
- `TestAttemptIdentity`를 `@/shared/types/test-attempt`로 옮겨 client, feature domain, server implementation이 같은 계약을 사용한다. client의 신규 feature-domain 의존은 제거했다.
- RED는 stale `currentResponseId`에서 초기 무효 링크가 telemetry를 실행한 실패와, invite A의 지연 resume가 invite B 상태를 덮는 실패로 확인했다.
- 검증: 집중 3파일 41건 통과, `pnpm exec tsc --noEmit` 통과, `pnpm lint` 오류 0건·기존 경고 99건, `pnpm test` 최종 통과, `git diff --check` 통과.
- `SurveyCompletedScreen`의 `questionCount`와 `총 N개 질문` 제거를 그대로 유지했고 Task 9 메일 코드는 변경하지 않았다.

## 리뷰 수정 2

- `useSessionRecovery` terminal interface에 `enabled`와 `terminalBlocked`를 추가해 완료·무효 링크·기타 blocked 화면에서 recovery를 시작하거나 결과를 재적용하지 않도록 했다.
- pending resume는 identity별 promise map으로만 dedupe하고 settle 즉시 제거한다. 별도 attempted identity 집합이 같은 flow의 recovery를 최초 1회로 제한하며 identity boundary remount는 새 recovery를 허용한다.
- RED는 recovery settle 후 완료 store reset을 모사했을 때 answers가 2회 적용되는 실패로 확인했다. GREEN은 제출 reset 후 `stepVisit` 추가 0회, invalid cleanup 후 telemetry 0회, stale complete cleanup 1회를 검증했다.
- 집중 검증 3파일 46건, `pnpm exec tsc --noEmit`, `pnpm lint` 오류 0건·기존 경고 99건, `git diff --check`는 통과했다.
- `pnpm test` 1회에서 본 실행 319파일 2,612건은 모두 통과했고, 이어진 격리 단계는 알려진 `profiles-row-actions` flaky 12건이 `SurveyOwnershipError: not_found`로 실패했다. 요청대로 전체 suite는 재실행하지 않았다.
- `SurveyCompletedScreen`의 `questionCount`와 `총 N개 질문` 제거를 유지했고 actual·anonymous·target payload 계약과 Task 9 메일 코드는 변경하지 않았다.
