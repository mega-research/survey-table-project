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

## 최종 리뷰 보완 라운드

### durable/idempotent 발송 복구

- campaign batch 발송을 recipient별 단건 발송으로 전환하고
  `campaign/<campaignId>/recipient/<recipientId>` 안정 idempotency key를 사용한다.
- 요청 payload의 `X-Entity-Ref-ID`, campaign/recipient tag도 retry마다 동일하게 유지한다.
- `mail_recipients`에 최초 시도 시각과 30초 lease token/만료 시각을 저장한다.
  - 최초 claim과 같은 원자 update에서 최종 `from/replyTo/to/subject/html` payload도 JSONB snapshot으로 고정한다.
  - 최초 resolve한 첨부의 filename/contentType/SHA-256도 함께 고정하며, retry에서 R2 bytes가 다르면
    Resend 호출 전에 중단한다. 따라서 같은 idempotency key로 다른 payload를 보내지 않는다.
  - retry는 contact attrs/token/email이나 배포 환경값이 바뀌어도 이 snapshot만 사용하며 terminal 전이에서 즉시 지운다.
  - worker crash 또는 Resend 수락 뒤 DB 저장 실패 시 lease 만료 후 같은 key로 reclaim한다.
  - 살아 있는 lease는 50ms 간격으로 최대 30초만 기다려 동시 이중 발송을 막는다.
  - 23시간 경계에서도 active lease를 먼저 기다린 뒤 unresolved send를 재발송 없이 실패 종결한다.
- Resend의 24시간 idempotency 보존 시간을 넘겨 중복 발송하지 않도록 복구 창을 23시간으로 제한했다.
- retryable/unknown 외부 오류는 lease를 해제하고 throw하며, 검증 오류 등 확정 4xx만 failed로 종결한다.
- Inngest의 최종 retry까지 소진되면 durable failure handler가 23시간 동안 webhook 복구를 기다린 뒤
  남은 queued/stale-sending을 failed로 종결한다. 살아 있는 lease가 남아 있으면 1초 clock-skew buffer를 두고
  busy row가 없어질 때까지 durable cleanup을 반복한다.
- Resend tag 기반 webhook fallback으로 외부 수락 뒤 message id DB 저장이 실패한 row의 message id를 복구한다.
  `email.sent` 유실에 대비해 sending에서 delivered/opened/bounced/complained로의 직접 전이도 허용한다.

### archived recipient와 빈 campaign

- 직접 dispatch 결과 update는 같은 statement의 `RETURNING archived_at`으로 보관 상태를 확인한다.
- webhook/reconcile은 recipient를 `FOR UPDATE`로 잠근 조회에서 `archived_at`을 함께 읽는다.
- archived recipient의 상태·message id는 계속 갱신하지만 active campaign counter/finalize는 건드리지 않는다.
- archived in-flight row의 payload가 이미 scrub된 경우 즉시 failed로 바꾸지 않고 sending을 유지해 webhook tag 복구 창을 보장한다.
- 삭제된 contact의 queued recipient도 LEFT JOIN으로 놓치지 않고 외부 호출 없이 failed/counter/finalize 처리한다.
- prepare 결과가 0명이면 즉시 공용 finalize를 실행해 빈 campaign이 sending에 남지 않게 했다.

### schema와 검증

- `0059_add_mail_recipient_dispatch_lease.sql`과 manual migration manifest를 추가했다.
- 원격 DB는 변경하지 않았다. 로컬 Supabase PostgreSQL에만 0059를 적용해 lease 컬럼 왕복 실DB 테스트를 수행했다.
- focused: 10개 파일 69건 통과, realdb 3건 통과
- `pnpm tsc --noEmit`: 통과
- 변경 파일 ESLint: 통과
- migration journal gate: 통과
- `pnpm lint`: 오류 0건, 기존 경고 99건
- 전체 본 스위트: 325개 파일 2670건 통과
- 후속 flaky 단계의 알려진 `profiles-row-actions.test.ts` 12건 실패는 단독 재실행 14건 통과로 확인
- 최종 독립 리뷰: Standards finding 3건, Spec finding 4건 모두 RED 재현 후 수정 완료;
  attachment 보강 후 Standards 재검토 finding 0건

## 최종 리뷰 2차 보완 라운드

### inactive cleanup과 contact 경합

- 취소 또는 보관된 캠페인의 unresolved `sending` recipient도 provider idempotency 창인 23시간을 기다린 뒤 정리한다.
  - message id가 없으면 `failed`, 이미 저장돼 있으면 `sent`로 복구한다.
  - lease와 payload snapshot은 지우되 inactive campaign counter와 finalize는 변경하지 않는다.
- prepare 전체를 campaign `FOR UPDATE` transaction으로 묶어 active 판정 직후 cancel/archive가 끼어드는 경합을 막았다.
  - inactive campaign에 ambiguous `sending` row가 있으면 빈 dispatch 성공으로 끝내지 않고 cleanup을 예약한다.
  - prepare 결과가 0건이면 같은 transaction 안에서 finalize를 수행한다.
- send claim 잠금 순서를 campaign → contact `FOR SHARE` → recipient `FOR UPDATE`로 통일했다.
  - prefetch된 contact 정보는 렌더링 최적화에만 사용한다.
  - 실제 발송 직전 contact 삭제·수신거부 및 recipient의 contact FK 변경을 잠금 아래 재검증한다.
  - queued 대상은 `failed | skipped_unsubscribed`로 원자 종결하고, stale `sending` 대상은 재발송하지 않고 webhook 복구를 기다린다.
- cleanup, 직접 결과 반영, webhook, reconcile도 campaign을 recipient보다 먼저 잠가 교차 경로 deadlock을 제거했다.

### webhook 원자성, 속도 제한, failure 순서

- Resend webhook 비즈니스 로직을 route에서 `lib/mail/resend-webhook.ts`로 이동했다.
  - webhook dedupe insert와 recipient/campaign 전이를 한 DB transaction으로 처리한다.
  - 전이 실패 시 dedupe도 rollback되고 route는 non-2xx를 반환해 provider retry가 가능하다.
  - route module은 Next.js가 허용하는 `POST` export만 유지한다.
- provider 호출 시작 간격을 125ms로 직렬화해 초당 최대 8건으로 제한했다.
  - chunk별 limiter와 dispatcher function-global `concurrency=1`, 순차 chunk 실행을 함께 사용한다.
- Inngest `onFailure`와 취소 후 cleanup은 먼저 `mail/campaign.dispatched`를 emit해 reconcile을 시작하고,
  그 다음 23시간을 기다려 unresolved recipient를 종결한다.
- 0059 migration의 컬럼과 recovery index를 모두 `IF NOT EXISTS`로 만들어 재적용 가능하게 했다.

### 최종 검증

- focused: 10개 파일 76건 통과, finalize 회귀 1건 추가 통과
- realdb: lease/payload, contact 삭제·수신거부, inactive cleanup, webhook/cleanup 교차 경합 6건 통과
- `pnpm tsc --noEmit`: 통과
- 변경 파일 ESLint: 통과
- 로컬 0059 migration 연속 2회 적용: 통과
- `pnpm test`: 일반 328개 파일 2686건, 격리 flaky 단계 1개 파일 14건 모두 통과
- `pnpm build`: production build 및 전체 route generation 통과
- `pnpm lint`: 오류 0건, 기존 경고 99건
- 최종 독립 재검토: Spec finding 0건, Standards/correctness/deep-module finding 0건
- 원격 DB는 변경하지 않았다.
