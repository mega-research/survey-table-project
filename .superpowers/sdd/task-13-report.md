# Task 13 구현 보고서

## 최종 경계

- 테스트 모드가 켜진 동안에도 일반 공개 링크의 익명 응답은 `isTest=false`로 생성되는 tracer를 추가했다.
- 테스트 응답은 종료·중단·종료일·최대 응답 수뿐 아니라 조건별 quota도 우회한다.
  - 기존 quota 집계 모수는 이미 `notTestResponse`를 사용했지만, 현재 검사 중인 응답이 테스트인지 확인하지 않아 소진 quota에서 테스트 응답을 `quotaful_out`으로 바꿀 수 있는 회귀를 RED로 재현했다.
  - quota service가 `(responseId, surveyId, deletedAt IS NULL)` 소유권을 확인하고, 테스트 응답이면 집계·상태 변경 전에 `blocked:false`로 종료하도록 최소 수정했다.
  - 섞인 survey/response ID와 stale response는 quota mutation 전에 거부한다.
- SPSS, Raw Excel, split preview 라우트를 실제 호출해 캡처한 모든 응답 SQL에 `is_test=false`가 유지됨을 검증했다.
- analytics와 공용 완료 응답 조회도 같은 real-only predicate를 사용하는지 검증했다.
- 운영 범위 SSOT가 response, target, campaign 모두 `real=false`, `test=true`로 해석되는지 최종 고정했다.
- billing은 active와 archived 테스트 발송을 각각 한 번씩 합산하고, archived 표시 상태를 보존한다.
- 테스트 모드가 ON인 설문에 연결된 기존 `isTest=false` campaign도 발송과 recipient 상태 갱신을 계속하는 tracer를 추가했다.

## 기존 lifecycle과 mutation 회귀

- operations overview, contacts, report, template sample, campaign 목록·상세·recipient가 전달된 범위를 공유한다.
- 테스트 대상 생성·삭제, 실제/테스트 ID 혼합 거부, 대상자 테스트 attempt 소유권, 테스트 메일 campaign 범위, workspace keep/delete를 집중 회귀로 재실행했다.
- 로컬 PostgreSQL에서 workspace 종료, target attempt, campaign 발번·생성 경합을 포함한 realdb 14파일 58건을 통과했다.
- 실제 대상자·응답·campaign은 테스트 workspace 종료에서 보존되고, 정산은 active와 archived billable recipient를 각각 한 번 센다.

## 전역 제어 snapshot 감사

- operations layout은 RSC에서 `getControlState(surveyId)`의 전체 원자 snapshot을 받아 헤더와 banner에 함께 전달한다.
- edit header는 열린 빌더의 미저장 사용자 변경을 보존하기 위해 기존 무-initial 경로를 유지한다. 대신 mount, focus, 10초 polling이 모두 동일한 `operations.control.get` 전체 원자 snapshot을 조회하며, 요청 버전 가드가 역순 응답의 stale overwrite를 막는다. 수동 subset 객체는 만들지 않는다.
- 위 동작은 `test-mode-control`의 initial 동기화, mount fetch, focus/poll, 역순 응답 회귀 테스트로 유지된다.

## 정적·문서 정합

- `testContactColumns`, `OperationsDataScope`, `test_response_attempts`, `disposition`, `archivedAt` 명칭이 spec, schema, service, component에서 일치한다.
- export, split preview, analytics, 공용 response reads의 real-only predicate를 확인했다.
- operations와 mail의 survey ID 및 scope predicate를 확인했다.
  - `contact-uploads`의 `isTest=false`는 테스트 범위에서 업로드 기능 자체를 거부하는 의도된 예외다.
  - quota status의 `notTestResponse`는 테스트 범위에서 quota KPI·패널을 숨기는 정책과 일치한다.
- 사용자 화면에 “테스트 응답은 제외됩니다” 같은 새 안내 문구를 추가하지 않았다.
- migration `0056`~`0059`는 journal/manifest와 일치하며 원격 DDL은 적용하지 않았다.

## TDD

- RED: target 0인 소진 quota에서 테스트 응답이 `blocked:true`가 되고 상태 mutation까지 도달하는 것을 확인했다.
- GREEN: 응답 소유권 확인과 테스트 응답 조기 종료를 quota 소유 service에만 추가했다.
- 회귀: stale/mixed quota ID 거부, 실제 익명 traffic 생존, export/analytics SQL, billing active+archived once를 추가했다.

## 검증

- Task 13 집중 경계: 13파일 179건 통과
- quota/실제 traffic/실제 campaign/export/billing 핵심 묶음: 6파일 85건 통과
- 로컬 PostgreSQL realdb: 14파일 58건 통과
- `pnpm exec tsc --noEmit`: 통과
- `pnpm lint`: 오류 0건, 기존 경고 99건, 변경 파일 신규 경고 0건
- `pnpm exec tsx .github/migration-journal-gate.ts`: 통과
- `pnpm test`: 333파일 2,722건 통과 후 격리 flaky 파일 14건 통과
- `pnpm build`: production compile, TypeScript, 전체 route generation 통과
- `git diff --check`: 통과

## 수동 workflow 대조

- 두 관리자 동기화, 팝오버 분기, 익명/대상자 링크 전환, 늦은 attempt 소유권, terminal 응답 재초기화, keep/delete, 개별 대상자 삭제, 실제 traffic 생존, export/analytics 제외를 component/integration/realdb 경계에 각각 대조했다.
- 실제 받은편지함 수신과 두 브라우저의 사람 주도 클릭 검증은 외부 Resend 발송이나 원격 상태를 만들지 않는 제약 때문에 수행하지 않았다. 테스트 메일 payload·`[TEST]` 제목·sandbox unsubscribe·archive/reconcile 정책은 기존 Task 9~12 자동 회귀로 확인했다.

## 범위 제한

- quota 경계 외 제품 기능, DB schema, migration은 변경하지 않았다.
- 원격 Supabase, 원격 DDL, 원격 migration, 실제 Resend 발송은 수행하지 않았다.

## 독립 리뷰

- Spec 리뷰: APPROVE, 남은 Critical/Important finding 0건
- Standards 리뷰: APPROVE, 남은 Critical/Important finding 0건
- 초기 Important 3건 중 quota SQL assertion과 실제 campaign tracer는 보완했고, edit initial은 부모 설계 결정에 따라 full atomic client fetch와 generation guard의 실질 동등성을 재검토받아 승인됐다.
