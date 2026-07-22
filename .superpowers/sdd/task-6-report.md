# Task 6 구현 보고

## Status

실제 대상자, 익명 테스트, 테스트 대상자 초대 링크를 서버에서 구분하고 테스트 링크를 fail-closed로 판정하도록 구현했다. Task 7의 응답 행 재사용·attempt 소유권과 Task 8의 대상자 테스트 클라이언트 lifecycle은 변경하지 않았다.

## 구현

- invite token을 SECURITY DEFINER 함수로 찾은 뒤 `contact_targets.survey_id`를 재검증하고 대상자 `isTest`와 설문 `testModeEnabled/deletedAt`을 함께 조회한다.
- 실제 대상자는 테스트 모드 ON에서도 기존 수신거부·부정 결과·중복 정책을 유지한다. 테스트 대상자는 ON일 때만 유효하며 수신거부·부정 결과·`respondedAt` 차단을 우회하고 `isTestTarget`을 반환한다.
- `/i/{code}`는 실제·테스트 대상자를 구분한다. OFF 테스트 링크와 일반 무효 코드는 각각 전용 화면에서 종료하고 `SurveyResponseFlow`를 마운트하지 않는다.
- attrs lookup은 현재 운영 scope를 따라 실제 대상자를 익명 강등하던 동작을 제거했다. 실제 대상자는 모드와 무관하게 조회하고 OFF 테스트 대상자는 `INVALID_TEST_LINK`로 종료한다.
- public survey control에 `testSessionKind`와 `inviteToken` 입력을 추가했다. 두 토큰 혼합은 거부하고, 테스트 대상자가 한 명이라도 있으면 익명 `testToken`을 즉시 무효화한다.
- loader는 public control 판정에 `inviteToken`을 전달한다.

## TDD

- RED: 지정 집중 명령에서 4파일 17건이 기존 실제/테스트 미구분과 익명 링크 병행 허용 때문에 실패하는 것을 확인했다.
- RED: Track A에서 `invalid_test`가 통과하고 사용된 테스트 대상자가 `token_already_used`로 막히는 2건의 실패를 추가 확인했다.
- RED: attrs lookup의 OFF 테스트 대상자가 `INVALID_TEST_LINK` 대신 attrs를 반환하는 실패를 확인했다.
- GREEN: 최소 서버 판정과 반환 계약을 구현해 지정 집중 테스트 4파일 33건을 통과시켰다.

## 검증

- 지정 집중 테스트: 4파일 33건 통과.
- 기존 Track A·procedure·가용성 관련 추가 테스트: 8파일 71건 통과.
- `pnpm exec tsc --noEmit`: 통과.
- `pnpm lint`: 오류 0, 기존 경고 99건.
- `pnpm test`: 315파일 2,544건 통과. 기존 `tests/unit/use-response-lifecycle.test.tsx` 13건만 `window.localStorage.clear()` 환경 오류로 실패했다.
- `git diff --check`: 통과.

## 우려

- 익명 test token과 테스트 대상자 수의 저장 시점 재검증·잠금은 Task 7 범위다. 이번 Task 6은 신규 진입 control만 차단하며 응답 lifecycle은 선행 구현하지 않았다.
- hard delete된 테스트 대상자의 원래 종류는 token만으로 복원할 수 없지만, 배포된 `/i/{code}` 링크는 코드 미매칭 전용 화면에서 종료하므로 익명 설문으로 폴백하지 않는다.
