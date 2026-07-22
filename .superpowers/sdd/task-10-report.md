# Task 10 구현 보고서

## 구현 범위

- `MailWrapper.testFooterKind`를 `template | campaign | null`로 분리했다.
  - 템플릿 단독 테스트 메일은 비활성 미리보기 안내를 표시한다.
  - 테스트 캠페인은 테스트 응답 기록 안내를 표시한다.
  - 실제 캠페인은 테스트 푸터를 표시하지 않는다.
- 테스트 캠페인은 실제 `inviteCode`를 유지하고 수신거부 URL만 `__test__` sandbox 토큰으로 바꾼다.
- prepare와 각 chunk는 `archivedAt == null`이면서 `queued | sending`인 캠페인만 처리한다.
- dispatcher는 chunk가 `cancelled: true`를 반환하면 남은 chunk 실행을 중단한다.
- 외부 발송 직전에 campaign을 다시 확인하고 recipient를 원자적으로 `queued -> sending`으로 인수한다.
  - non-archived, non-null email snapshot 조건을 만족하며 claim에서 반환된 recipient만 Resend 입력으로 전달한다.
  - 결과 전이는 `sending -> sent | failed` 조건으로 처리한다.
  - terminal update가 실제 적용된 경우에만 campaign counter와 반환 count를 한 번 갱신한다.
- webhook/reconcile 공용 전이는 `sending -> sent | failed`를 허용하고 queued 또는 sending에서 terminal로 갈 때 `queued_count`를 한 번 감소시킨다.
- reconcile의 기존 조회에는 archive 필터를 추가하지 않아, 이미 발송된 archived recipient도 message id 기반 상태 조정을 계속한다.
- 삭제된 캠페인에 대해 이미 예약된 chunk가 실행돼도 throw/retry하지 않고 cancelled no-op으로 종료한다.

## 경합 분석

chunk 시작 시의 campaign 조회만으로는 조회 직후 cancel/archive가 완료되는 경합을 막지 못한다. 따라서 발송 입력 렌더 후, 외부 호출 직전에 별도 transaction에서 다음 순서로 처리했다.

1. campaign 행을 `FOR SHARE`로 잠근다.
2. 같은 transaction 안에서 active 상태를 다시 확인한다.
3. eligible recipient를 조건부 `queued -> sending`으로 갱신하고 반환한다.
4. transaction이 반환한 recipient만 외부 발송한다.

campaign의 cancel/archive update는 campaign 행의 update lock이 필요하므로 이 claim과 직렬화된다. claim을 발송 시작의 선형화 지점으로 정의했다. 외부 네트워크 호출 동안 DB transaction을 유지하지 않으므로 claim 커밋 직후 cancellation이 완료될 수 있는 작은 창은 남지만, 그 recipient는 이미 `sending`으로 인수된 시작 상태다. Task 11/12의 cancel/archive mutation은 이 Task에서 추가하거나 변경하지 않았다.

## 테스트

- RED: 최초 요구사항 관련 21건과 리뷰 보완 1건의 실패 확인
- GREEN: 집중 및 추가 테스트 9개 파일, 61건 통과
- `pnpm exec tsc --noEmit`: 통과
- 변경 파일 ESLint: 통과
- 독립 리뷰: Standards finding 0건, Spec finding 1건 수정 완료
- `pnpm lint`: 통과, 기존 경고 99건과 신규 오류 0건
- `pnpm test`: 322개 파일 중 321개 통과, 2645건 중 2644건 통과
  - Task 10과 무관한 `target-test-session.test.tsx` 1건이 전체 병렬 실행에서 실패했다.
  - 해당 파일 격리 재실행은 22건 모두 통과해 비결정적 suite 간섭으로 판단했다.

## 변경하지 않은 범위

- DB schema와 migration
- Task 11의 메일 비식별 보관 mutation
- Task 12의 캠페인 archive mutation
- 실제 캠페인의 invite 및 unsubscribe URL 정책
