# Task 11 구현 보고서

## 구현 범위

- `src/lib/mail/test-mail-archive.server.ts`에 테스트 메일 수명주기 인터페이스를 추가했다.
  - `archiveTestMailForTargets(tx, targetIds)`
  - `archiveTestWorkspaceMail(tx, surveyId)`
  - `recalculateActiveCampaignCounters(tx, campaignIds)`
  - 실제 대상자의 기존 cascade 의미를 명시적으로 유지하는 `hardDeleteMailForTargets(tx, targetIds)`
- 보존 status는 `sending | sent | delivered | opened | bounced | complained`로 고정했다.
  - `queued | failed | skipped_unsubscribed` recipient는 hard delete한다.
  - 보존 recipient는 대상자 FK, email/invite snapshot, error를 제거하고 `archivedAt`을 설정한다.
  - terminal recipient는 attempt/lease/payload도 즉시 제거한다.
  - ambiguous `sending`은 Task 10의 23시간 recovery가 끝날 때까지 durable attempt/lease/payload를 유지한다.
- 잠금 순서를 campaign → contact → recipient로 통일했다. 대상자 삭제 caller가 survey를 먼저 잠그므로 새 test campaign 생성과도 직렬화된다.
- active campaign counter는 archived recipient를 제외해 transaction 안에서 전부 다시 계산하며 `sending`은 `queuedCount`에 포함한다.
  - 마지막 active recipient를 보관해 pending counter가 0이 되면 같은 transaction에서 campaign도 finalize한다.
- workspace archive는 보존 recipient가 없는 test campaign을 hard delete하고, 보존 recipient가 있으면 snapshot·본문·첨부·filter·createdBy를 scrub한 뒤 `삭제된 테스트 발송`으로 보관한다.
- 개별 테스트 대상자 삭제는 메일 archive → test response hard delete → target delete 순서로 처리한다. 실제 대상자는 mail recipient를 먼저 hard delete하고 response FK만 null로 바꿔 기존 동작을 유지한다.
- Task 10의 모든 terminal 전이에서 `sendAttemptedAt`도 lease/payload와 함께 제거하도록 정리했다.
  - archived `sending`을 direct settle/복구 만료/23시간 cleanup으로 종결할 때는 같은 UPDATE의 `archivedAt` 판정으로 `errorReason`을 null로 유지해 provider 오류의 PII 재유입을 막는다.
- 운영 query의 기존 `archivedAt IS NULL` 범위를 유지했다. webhook/reconcile은 archived recipient도 message ID로 계속 전이하며 active counter에는 영향을 주지 않는다.
- 정산은 active/archived recipient를 status 기준 한 번만 세고, test 배지와 archived campaign 상세 링크 제거를 반영했다.

## TDD

- RED: archive module 부재, sending terminal state 미정리, test response 보존, actual recipient의 `SET NULL` 회귀, workspace scrub 부재, billing metadata/UI 부재를 각각 실패로 확인했다.
- GREEN: lifecycle fake-DB 계약, webhook no-op/archived 전이, billing query/UI, Task 10 recovery cleanup을 구현 후 통과시켰다.
- 로컬 PostgreSQL realdb 테스트에서 다음 경계를 확인했다.
  - queued hard delete, sent/sending 비식별 보관, response/attempt cascade, active counter 재계산
  - archived sending webhook fallback 전이 및 terminal payload/lease/attempt 제거
  - retained row가 없는 campaign hard delete와 retained campaign snapshot scrub
  - 마지막 active recipient archive 후 campaign finalize
  - archived sending cleanup의 `errorReason` 비재유입
  - active/archived billable recipient의 정확히 한 번 집계

## 검증

- 집중 회귀: 12개 파일, 110건 통과
- realdb: Task 11 4건 통과; Task 10 경합 회귀와 합쳐 3개 파일, 12건 통과
- `pnpm exec tsc --noEmit`: 통과
- 변경 파일 ESLint: 통과
- `pnpm lint`: 오류 0건, 기존 경고 99건
- 최종 `pnpm test`: 본 스위트 331개 파일, 2695건 통과; 후속 flaky 격리 14건도 통과
- `pnpm build`: production build와 전체 route generation 통과

## 독립 리뷰 보완

- Spec 리뷰 Important 1건과 Standards/correctness 리뷰 Important 2건 중 중복을 합친 2개 결함을 RED로 재현하고 수정했다.
  - active recipient가 모두 archived된 campaign의 finalize 누락
  - archived recipient에 provider/cleanup `errorReason`이 다시 저장되는 비식별 위반
- Standards minor의 archive helper survey-lock precondition을 interface 문서에 명시했다.
- Spec minor의 billing mock 한계를 보완해 local realdb에서 active+archived 혼합 집계를 검증했다.
- 보완 후 Standards/correctness 및 Spec 독립 재리뷰 모두 APPROVE, 남은 Critical/Important finding 0건

## 변경하지 않은 범위

- DB schema와 migration: Task 9의 archive 컬럼과 FK 정책으로 충분해 추가 migration이 필요하지 않았다.
- 원격 Supabase와 원격 DDL
- Task 12의 test mode OFF mutation과 종료 UI
- 마지막 테스트 대상자 삭제 시 `testContactColumns`: 전체 초기화 때만 제거하도록 보존했다.
