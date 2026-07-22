# Task 5 구현 보고

## 구현

- 대상자 수정·삭제와 회차 추가·수정·삭제가 트랜잭션에서 설문 행과 대상 행을 잠그고, 현재 `testModeEnabled`와 같은 `isTest` 범위만 변경하도록 했다. 범위가 다르면 `NOT_FOUND`로 실패한다.
- 공개 attrs 조회도 현재 운영 범위의 대상자만 조회한다.
- 컬럼 스킴 저장은 잠금 뒤 현재 모드에 따라 `contactColumns` 또는 `testContactColumns`만 갱신하며, 업로드 경고용 기존 대상자 수 역시 scope별로 센다.
- `ingestContactUpload`는 파일 검증·파싱 전에 DB 모드를 확인하고, 파싱 뒤 실제 대상자 삭제 직전 설문 행을 다시 잠가 재확인한다. 삭제·삽입은 `isTest=false`로 명시했다.
- 업로드 UI의 네 진입점은 테스트 모드에서 포커스 가능한 `aria-disabled` 버튼과 툴팁을 사용한다. 직접 `upload/new` 라우트와 업로드 이력도 동일 문구로 차단한다.

## TDD

- RED: 테스트 모드에서 실제 대상자 수정이 `NOT_FOUND`가 아니라 성공하는 사례를 추가해 실패를 확인했다.
- RED: 테스트 모드에서 `ingestContactUpload`가 파싱 전에 거부되지 않고 완료되는 사례를 추가해 실패를 확인했다.
- RED: 테스트 모드 컬럼 저장이 `testContactColumns`가 아닌 `contactColumns`를 변경하는 사례를 추가해 실패를 확인했다.
- GREEN: 각 실패를 최소 범위 가드·업로드 가드·모드별 컬럼 저장으로 통과시켰다.

## 검증

- `pnpm exec vitest run tests/integration/test-contact-generation.test.ts tests/integration/contacts-scope-guard.test.ts src/features/contacts/server/services/contact-targets.service.test.ts src/features/contacts/server/services/contact-columns.service.test.ts src/features/contacts/server/procedures/uploads.test.ts` — 28 passed.
- `pnpm exec tsc --noEmit` — passed.
- `pnpm lint` — errors 0, 기존 경고 99건.
- `pnpm test` — 실패. 현재 작업과 무관하게 `tests/unit/use-response-lifecycle.test.tsx` 13건이 `window.localStorage` 미구성으로 실패했다 (`Cannot read properties of undefined (reading 'clear')`). 대상 집중 테스트는 모두 통과했다.

## 파일

- contacts service 5개, uploads procedure, contacts/upload RSC 3개, 공용 헤더, 업로드 액션 컴포넌트와 관련 테스트를 변경·추가했다.

## Self-review / 우려

- 업로드 가드는 초기 조회와 삭제 직전 잠금 재확인을 함께 사용해 UI 우회와 파싱 중 모드 전환을 모두 막는다.
- `NOT_FOUND`는 존재 여부를 노출하지 않는 기존 범위 가드 정책에 맞춘다.
- 전체 테스트 실패의 localStorage 환경 문제는 본 태스크 변경과 독립적이며 수정 범위 밖으로 남겼다.

## 리뷰 수정

- RED: 테스트 모드 대상자 수정 시 `testContactColumns`의 PII 키가 attrs 평문에 남는 회귀 테스트를 추가했고, `테스트담당자` 값이 그대로 저장되어 실패함을 확인했다.
- GREEN: 설문 모드·실제/테스트 컬럼 스킴·대상 행을 같은 트랜잭션 잠금 스냅샷에서 확정하고, 해당 스킴으로 attrs를 sanitize하도록 잠금 helper 반환 계약을 확장했다.
- 업로드 회귀 테스트: 초기 조회는 real이지만 삭제 직전 잠금 결과가 test이면 고정 문구로 거부하고 delete가 호출되지 않는지, real 경로는 delete 조건과 대상자 insert 값에 모두 `isTest=false`가 있는지 고정했다.
- 타입 정리: 업로드 설문 잠금 raw result의 `as unknown as`를 제거하고 `SurveyModeRow extends Record<string, unknown>`와 `tx.execute<SurveyModeRow>`를 사용했다.
- 집중 테스트: 4개 파일 26건 통과. `pnpm exec tsc --noEmit` 통과. `pnpm lint` 오류 0, 기존 경고 99건.
- 전체 테스트: 314개 파일 2,530건 통과, 기존 `use-response-lifecycle.test.tsx` localStorage 환경 문제 13건 실패. 관련 변경의 추가 실패는 없다.
