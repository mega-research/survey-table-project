# Task 7 백엔드 작업 보고서

## 결과

- 대상자 테스트 응답은 동일 `survey_responses` 행을 재사용하고, 종결 상태나 이전 버전이면 해당 행과 정규화/편집 파생 데이터를 정확히 초기화한다.
- `test_response_attempts` 활성 attempt를 신규 세션으로 교체하고, 이전 attempt의 답변/스텝/가시성/완료 mutation을 행 잠금 후 차단한다.
- 테스트 모드 OFF 전환은 현재 attempt도 즉시 무효화한다.
- 대상자가 없는 익명 테스트 INSERT와 첫 대상자 생성을 survey 잠금으로 직렬화해 익명 응답 잔류 race를 차단한다.
- 동일 대상자의 동시 acquire는 partial unique 제약과 잠금 순서로 응답 1건·활성 attempt 1건만 남긴다.
- 같은 현재 버전의 대상자 `in_progress` resume은 저장된 `questionResponses`를 반환하며 행을 갱신하지 않는다. 이전 버전은 resume하지 않는다.

## TDD 증거

1. 동일 버전 resume의 답변 누락, 이전 버전 오복구, procedure의 attempt identity strip을 각각 실패 테스트로 재현했다.
2. 종결 응답 재사용, 구 attempt 차단, OFF 차단, 동시 acquire, 익명 INSERT/대상자 생성 race를 실DB 테스트로 작성했다.
3. 처음 동시 acquire에서 deadlock을 재현한 뒤 잠금 순서를 survey SHARE → target UPDATE → response UPDATE로 통일했다.

## 검증

- 집중 테스트: 6개 파일, 63개 통과
- 실DB: `test-target-attempt-ownership.realdb.test.ts` 7개 통과
- TypeScript: `pnpm exec tsc --noEmit` 통과
- 관련 파일 ESLint 통과, `git diff --check` 통과
- 전체 스위트: 317개 파일 중 316개 통과, 2,584개 테스트 중 2,571개 통과

## 잔여 관찰

- 전체 스위트의 유일한 실패는 범위 밖 `tests/unit/use-response-lifecycle.test.tsx` 13개다. Node/jsdom 테스트 환경에서 `window.localStorage`가 `undefined`인 채 `beforeEach` 내 `clear()`를 호출해 본문 실행 전에 모두 실패했다. Task 7 백엔드 범위 밖이므로 수정하지 않았다.

## 리뷰 수정

- 대상자 acquire는 survey `SHARE` 잠금에서 읽은 `currentVersionId`만 응답 버전으로 사용한다. 첫 답변은 같은 트랜잭션에서 reset 후 고정된 응답 버전으로 문항 멤버십과 PII 암호화를 검증·저장해 null/이전 caller 버전과 publish 경쟁을 제거했다.
- 테스트 mutation 잠금 순서를 survey → target → response로 통일하고, 완료 응답과 `contact_targets.responseId/respondedAt` 연결을 한 트랜잭션으로 커밋한다. 새 attempt reset과 stale 완료의 실DB lock 대기열 경쟁에서 stale 완료가 거부되고 `respondedAt`이 null로 유지됨을 검증했다.
- 기존 attempt 재사용은 `status=response active`, `responseId`, `sessionId`를 모두 쓰기 전에 검사하며, 세션 불일치 시 응답과 컨택 상태가 변하지 않는 실DB 회귀 테스트를 추가했다.
- `recordStepVisit`는 트랜잭션 안에서 missing row를 다시 throw하고, 존재하는 동일 step은 기존 no-op 계약을 유지한다.
- 리뷰 수정 검증: 집중 6파일 65개 통과, 실DB 11개 통과, TypeScript·관련 ESLint·`git diff --check` 통과. 일반 전체 스위트는 317파일 중 316파일, 2,586개 중 2,573개 통과했으며 기존 `use-response-lifecycle.test.tsx` localStorage 환경 실패 13개만 동일하게 남았다.

## 리뷰 수정 2

- `completeResponse`의 대상자 연결 원자 트랜잭션은 테스트 응답에만 유지했다. 실제 대상자 응답은 완료 커밋 후 `contact_targets`를 best-effort 갱신하므로 후처리 실패가 완료 응답을 rollback하지 않는다.
- 실제 완료의 response → target 역순 잠금을 제거했다. 컨택 삭제는 target → response 순서로 명시적 unlink 후 삭제해 FK 미적용 환경에서도 dangling 참조를 남기지 않으며, hard reset의 기존 target → response 순서와 정렬된다.
- TDD RED에서 실제 컨택 후처리 실패의 완료 reject와 hard reset 경쟁의 PostgreSQL `40P01`을 재현했다. GREEN에서 실제 delete/hard reset 경쟁이 5초 timeout 안에 모두 fulfilled되고 각 최종 승자의 안전 상태 및 참조 무결성을 검증했다.
- 리뷰 수정 2 검증: 집중 8파일 75개, 실DB 11파일 43개, TypeScript·관련 ESLint 통과. 일반 전체 스위트는 318파일 중 317파일, 2,587개 중 2,574개 통과했으며 기존 `use-response-lifecycle.test.tsx` localStorage 환경 실패 13개만 동일하게 남았다.
