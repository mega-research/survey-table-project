# Task 4 구현 보고서

## Status

테스트 대상자 전용 컬럼·합성 fixture·자동 생성 RPC와 공통 INSERT 스코프 불변식을 구현했다. 자동 생성과 수동 추가는 모두 설문 행 잠금 아래 현재 DB 모드를 재확인하고, 테스트 대상자 자동+수동 합계 20명 제한을 공유한다.

## 구현

- 실제 `contactColumns`를 깊은 복사한 뒤 이름·회사·전화·이메일 의미 컬럼만 보충하고, 저장된 `testContactColumns`가 있으면 그대로 복사해 재사용한다.
- 이름·회사·전화가 명백히 합성인 fixture 20세트를 추가했다.
- `prepareContactInsertScope`가 `surveys ... FOR UPDATE`, 현재 `test_mode_enabled`, scope별 대상자 수를 한 트랜잭션에서 확정한다.
- 최초 test target 저장 시 익명 test response만 hard delete하고 전용 컬럼을 저장한다. 실제 응답과 대상자 연결 test response는 보존한다.
- 자동 생성은 fixture별 회사 attrs와 이름·전화·사용자 입력 수신 이메일 PII를 저장한다.
- 수동 add도 같은 helper, 현재 scope의 스킴, scope별 `next_contact_resid`, 서버 결정 `isTest`를 사용한다.
- `contacts.targets.generateTest` 입력/출력 스키마와 authed procedure를 추가했다.

## TDD 증거

- RED: `pnpm exec vitest run tests/unit/contacts/test-contact-data.test.ts` → `test-contact-columns` 모듈을 찾을 수 없어 실패.
- GREEN: 같은 명령 → 1파일, 4테스트 통과.
- RED: `pnpm exec vitest run tests/integration/test-contact-generation.test.ts` → `test-contacts.service` 모듈을 찾을 수 없어 실패.
- RED: `pnpm exec vitest run src/features/contacts/server/procedures/targets.test.ts` → `client.targets.generateTest is not a function` 1건 실패.
- GREEN: 집중 명령 → 4파일, 19테스트 통과.

## 검증

- 집중 테스트: fixture/컬럼, 최초 전환, 동일 이메일, 재호출 거부, 실제 모드 add, 자동+수동 20 제한, 동시 자동/수동 요청, procedure 위임 — 19개 통과.
- `pnpm exec tsc --noEmit` — exit 0.
- 관련 파일 ESLint — exit 0.
- 관련 파일 Prettier check 및 `git diff --check` — exit 0.
- 전체 `pnpm test` 1회 — 312파일/2522테스트 통과, 기존 `tests/unit/use-response-lifecycle.test.tsx` 13건만 `window.localStorage.clear()` 환경 오류로 실패.

## 변경 파일

- `src/lib/contacts/test-contact-columns.ts`
- `src/lib/contacts/test-contact-fixtures.ts`
- `src/lib/contacts/scheme-helpers.ts`
- `src/features/contacts/domain/contact-target.ts`
- `src/features/contacts/server/procedures/targets.ts` 및 테스트
- `src/features/contacts/server/services/contact-insert-scope.service.ts`
- `src/features/contacts/server/services/test-contacts.service.ts`
- `src/features/contacts/server/services/contact-targets.service.ts`
- `tests/unit/contacts/test-contact-data.test.ts`
- `tests/integration/test-contact-generation.test.ts`

## Self-review

- 동시성 테스트는 `FOR UPDATE` SQL이 실제로 있어야 획득되는 직렬화 fake를 사용하며, 삭제 predicate도 Drizzle SQL로 `surveyId + isTest=true + contactTargetId IS NULL`을 별도 검증한다.
- `isTest`와 scope는 요청값을 받지 않고 잠근 survey row에서만 결정한다.
- feature 간 직접 import를 추가하지 않았다.
- Task 5 범위인 일반 CRUD stale-mode guard와 upload 차단은 구현하지 않았다.

## 우려

- 전체 suite의 13건 실패는 실행 시 `localStorage is not available because --localstorage-file was not provided` 경고와 함께 재현된 기존 환경 문제다. 이번 변경 파일과 직접 관련은 없다.

## 리뷰 수정

- RED: `pnpm exec vitest run tests/unit/contacts/test-contact-data.test.ts`에서 PII·시스템 회사 라벨만 있는 스킴이 `attrs.test_company`를 보충하지 않아 1건 실패했다.
- GREEN: 회사 의미 판별을 `attrs.` source 조건을 포함한 단일 helper로 통합한 뒤 같은 테스트 5건이 통과했다. resolver도 같은 helper를 사용해 보충한 `test_company` 바인딩을 해석한다.
- raw SQL 결과의 `as unknown as` 캐스팅을 `tx.execute<SurveyScopeRow>` 및 `tx.execute<{ resid: number }>` generic으로 대체했다.
- 검증: 집중 테스트 3파일 15건, `pnpm exec tsc --noEmit`, 변경 관련 ESLint, `git diff --check` 통과.
- 전체 `pnpm test` 1회는 기존 `tests/unit/use-response-lifecycle.test.tsx` 13건의 `localStorage is not available because --localstorage-file was not provided` 환경 오류로 exit 1이었다.
