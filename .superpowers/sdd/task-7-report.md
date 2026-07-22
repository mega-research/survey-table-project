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
