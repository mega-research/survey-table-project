# 조사 대상 목록 "메일" 컬럼 — 메일 수신 상태 표시

> 작성일: 2026-06-08
> 브랜치: feat/contacts-mail-status

## 배경

운영 콘솔의 조사 대상 목록(`/admin/surveys/[id]/operations/contacts`)에는 "메일" 컬럼(`system.email_count`)이 이미 존재하지만, 현재 모든 셀이 `—` placeholder로 비어 있다. ([contacts-table.tsx:85-86](../../../src/components/operations/contacts/contacts-table.tsx) — "후속 슬라이스 메일발송" 주석)

메일 수신 상태(전달 완료 / 열람 / 반송 등)는 `mail_recipients` 테이블에 저장되며 `contactTargetId`로 조사 대상과 연결된다. 한 조사 대상이 **여러 캠페인**의 수신자가 될 수 있다(`UNIQUE(campaignId, contactTargetId)`).

## 목표

조사 대상 목록의 "메일" 컬럼에, 각 조사 대상의 **최신 발송 메일 상태**를 수신자 목록과 동일한 색상 badge로 표시한다.

## 결정 사항

| 항목 | 결정 |
|------|------|
| 다중 캠페인 시 표시 상태 | **최신 발송 상태** (`mail_recipients.created_at DESC` 기준 가장 최근 1건) |
| 표시 형태 | 수신자 목록과 동일한 색상 badge (`STATUS_LABEL` 재사용) |
| 셀 클릭 동작 | **정적 표시만** (행 클릭 시 컨택 상세 이동은 기존대로 유지) |
| 미발송 조사 대상 | `—` (다른 빈 셀과 일관) |
| 컬럼 라벨 | "메일" 유지 |

## 데이터 모델

- 소스 테이블: `mail_recipients` (status 9종)
  - `queued | sending | sent | delivered | opened | bounced | complained | failed | skipped_unsubscribed`
- 연결: `mail_recipients.contact_target_id → contact_targets.id`
- "최신 발송" 정의: 해당 조사 대상의 `mail_recipients` 레코드 중 `created_at` 이 가장 늦은 1건의 `status`
  (수신자 레코드 생성 시점 = 캠페인 발송 시점이므로 `created_at` 이 발송 순서를 반영)

## 아키텍처 — 4개 변경

조회는 기존 `latestResultCodeExpr` / `progressPctExpr` / `latestAttemptNoExpr` correlated subquery 패턴을 그대로 따른다(접근 A). 별도 batch 헬퍼(접근 B)는 코드량만 늘어 채택하지 않음.

### 1. DB 인덱스 (마이그레이션 `0032`)

`mail_recipients` 에는 `contact_target_id` 선두 인덱스가 없다(`UNIQUE(campaign_id, contact_target_id)` 만 존재 — `contact_target_id` 단독 조회에는 무용). 최신 1건 subquery 가속을 위해 추가:

```sql
CREATE INDEX IF NOT EXISTS idx_mail_recipients_target_created
  ON mail_recipients (contact_target_id, created_at DESC);
```

`_journal.json` 이 수동 SQL 을 따라가지 않으므로(CLAUDE.md 주의 7) Supabase MCP `apply_migration` 으로 적용하고, 파일은 `supabase/migrations/0032_*.sql` 로 함께 보관.

### 2. 데이터 레이어 — `src/lib/operations/contacts.server.ts`

- correlated subquery 추가:
  ```ts
  const latestMailStatusExpr = sql<MailRecipientStatus | null>`(
    SELECT status FROM mail_recipients
    WHERE contact_target_id = "contact_targets"."id"
    ORDER BY created_at DESC LIMIT 1
  )`;
  ```
- `ContactsRow` 인터페이스에 `latestMailStatus: MailRecipientStatus | null` 필드 추가
- `dataRows` select 에 `latestMailStatus: latestMailStatusExpr.as('latest_mail_status')` 추가
- `rows` 매핑에 `latestMailStatus: r.latestMailStatus` 추가
- `MailRecipientStatus` 타입은 `@/db/schema/mail` 에서 import

### 3. 상태 badge 공유화 — 신규 `RecipientStatusBadge`

현재 `STATUS_LABEL`(라벨 + tailwind 톤) 맵이 [campaign-recipients-table.tsx:19-29](../../../src/components/operations/mail-campaign/campaign-recipients-table.tsx) 안에 로컬로 갇혀 있다. 작은 공유 컴포넌트로 추출:

- 신규 파일: `src/components/operations/mail-campaign/recipient-status-badge.tsx`
  - `STATUS_LABEL: Record<MailRecipientStatus, { label; tone }>` 이동
  - `export function RecipientStatusBadge({ status }: { status: MailRecipientStatus })`
- `campaign-recipients-table.tsx` 는 로컬 `STATUS_LABEL` 삭제하고 신규 컴포넌트/맵 import (동작·외형 동일, 회귀 0)

> 참고: `STATUS_FILTER_CHIPS` 는 campaign-recipients-table 전용이므로 이동하지 않는다.

### 4. 표시 레이어 — `src/components/operations/contacts/contacts-table.tsx`

`computeCell` 의 `case 'system.email_count'` 를 placeholder 에서 교체:

```ts
case 'system.email_count':
  return row.latestMailStatus
    ? {
        display: <RecipientStatusBadge status={row.latestMailStatus} />,
        plain: STATUS_LABEL[row.latestMailStatus].label,
      }
    : { display: '—', plain: undefined };
```

`buildColumnCandidates` 의 `system.email_count` 제외 로직은 그대로 둔다(메일 상태는 필터 후보가 아님 — 이번 범위 밖).

## 영향 범위 / 회귀 점검

- `ContactsRow` 필드 추가 → 이 타입을 소비하는 다른 곳(`contacts-page-client`, 필터 등)은 셀 렌더만 의존하므로 무영향. 추가만 하고 기존 필드 불변.
- `campaign-recipients-table.tsx` 외형/동작 동일 — 추출 리팩토링만.
- 인덱스는 추가 전용(read 성능만 개선, write 미미한 오버헤드).

## 비범위 (YAGNI)

- "메일" 컬럼 정렬/필터 (현재 placeholder 컬럼이라 sort key 없음 — 유지)
- 발송 횟수 표시 (최신 상태만)
- 컨택 상세 페이지의 메일 이력 섹션 (별도 작업)
- 캠페인별 상태 분해 / 호버 상세

## 테스트 전략

- `contacts.server.ts` 의 `latestMailStatus` subquery 는 실DB 왕복이 필요 — 단위 모킹보다 수동 검증 + 기존 `*.realdb.test.ts` 패턴 참고. 최소한 타입/빌드(`tsc`) + lint 통과.
- 수동 검증: 캠페인 발송 이력이 있는 조사 대상이 목록에서 올바른 최신 상태 badge 를 보이는지, 미발송은 `—` 인지, 여러 캠페인 수신자는 최신 1건이 나오는지.
