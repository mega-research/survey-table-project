# 조사 대상 목록 "메일" 컬럼 메일 상태 표시 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 조사 대상 목록의 "메일" 컬럼에 각 조사 대상의 최신 발송 메일 상태를 색상 badge로 표시한다.

**Architecture:** `mail_recipients` 의 최신(`created_at DESC`) 1건 상태를 `listContactsForSurvey` 의 correlated subquery 로 가져와(`ContactsRow.latestMailStatus`) 테이블 셀에 badge 렌더. 상태 badge 는 수신자 목록과 공유하는 `RecipientStatusBadge` 컴포넌트로 추출. 최신 1건 조회 가속을 위해 `mail_recipients(contact_target_id, created_at DESC)` 인덱스 추가.

**Tech Stack:** Next.js / React / Drizzle ORM(postgres-js) / PostgreSQL(Supabase) / TailwindCSS / Vitest

**Spec:** [docs/superpowers/specs/2026-06-08-contacts-mail-status-design.md](../specs/2026-06-08-contacts-mail-status-design.md)

---

## File Structure

| 파일 | 책임 | 변경 |
|------|------|------|
| `supabase/migrations/0032_mail_recipients_target_index.sql` | 최신 메일 상태 subquery 가속 인덱스 | Create |
| `src/components/operations/mail-campaign/recipient-status-badge.tsx` | `MailRecipientStatus` → 라벨/톤 badge (수신자 목록 + 조사 대상 목록 공유) | Create |
| `src/components/operations/mail-campaign/campaign-recipients-table.tsx` | 로컬 `STATUS_LABEL` 제거 → 공유 컴포넌트 사용 | Modify |
| `src/lib/operations/contacts.server.ts` | `latestMailStatus` subquery + `ContactsRow` 필드 | Modify |
| `src/components/operations/contacts/contacts-table.tsx` | `system.email_count` 셀을 badge 렌더로 교체 | Modify |
| `tests/operations/recipient-status-badge.test.ts` | `STATUS_LABEL` 9개 status 완전성 검증 | Create |

> 작업 순서는 의존성 기준: 인덱스 → badge 추출 → 데이터 레이어 → 표시 레이어 → 최종 검증.

---

## Task 1: 마이그레이션 0032 — mail_recipients 인덱스

**Files:**
- Create: `supabase/migrations/0032_mail_recipients_target_index.sql`

`mail_recipients` 에는 `contact_target_id` 선두 인덱스가 없다(`UNIQUE(campaign_id, contact_target_id)` 만 존재 — `contact_target_id` 단독 조회에 무용). 조사 대상별 "최신 메일 상태" subquery 가 `contact_target_id` 로 필터 + `created_at DESC` 정렬 후 1건을 뽑으므로 복합 인덱스가 필요하다.

- [ ] **Step 1: 마이그레이션 SQL 파일 작성**

`supabase/migrations/0032_mail_recipients_target_index.sql`:

```sql
-- 조사 대상 목록 "메일" 컬럼 — 조사 대상별 최신 메일 상태 subquery 가속.
-- contact_target_id 로 필터 후 created_at DESC 1건 조회 (latestMailStatusExpr).
-- 기존 UNIQUE(campaign_id, contact_target_id) 는 contact_target_id 선두 조회에 무용.
CREATE INDEX IF NOT EXISTS "idx_mail_recipients_target_created"
  ON "mail_recipients" ("contact_target_id", "created_at" DESC);
```

- [ ] **Step 2: 실제 DB 에 인덱스 적용**

`_journal.json` 이 수동 SQL 파일을 따라가지 않으므로(CLAUDE.md 주의 7) Supabase MCP `apply_migration` 으로 적용한다.
- name: `mail_recipients_target_index`
- query: Step 1 의 `CREATE INDEX ...` 본문

> Supabase MCP 가 불가한 환경이면 `psql $DATABASE_URL -f supabase/migrations/0032_mail_recipients_target_index.sql` 로 직접 실행.

- [ ] **Step 3: 인덱스 생성 확인**

Supabase MCP `execute_sql` 또는 psql:
```sql
SELECT indexname FROM pg_indexes
WHERE tablename = 'mail_recipients' AND indexname = 'idx_mail_recipients_target_created';
```
Expected: 1 row (`idx_mail_recipients_target_created`)

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/0032_mail_recipients_target_index.sql
git commit -m "feat: 조사 대상별 최신 메일 상태 조회 인덱스 추가"
```

---

## Task 2: RecipientStatusBadge 공유 컴포넌트 추출

**Files:**
- Create: `src/components/operations/mail-campaign/recipient-status-badge.tsx`
- Create: `tests/operations/recipient-status-badge.test.ts`
- Modify: `src/components/operations/mail-campaign/campaign-recipients-table.tsx`

현재 `STATUS_LABEL`(라벨 + tailwind 톤) 맵이 `campaign-recipients-table.tsx:19-29` 안에 로컬로 갇혀 있다. 조사 대상 목록과 공유하기 위해 별도 파일로 추출한다. 동작·외형은 동일(순수 리팩토링).

- [ ] **Step 1: 실패 테스트 작성 — STATUS_LABEL 완전성**

`tests/operations/recipient-status-badge.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { mailRecipientStatusValues } from '@/db/schema/mail';
import { STATUS_LABEL } from '@/components/operations/mail-campaign/recipient-status-badge';

describe('recipient-status-badge STATUS_LABEL', () => {
  it('모든 MailRecipientStatus 값에 라벨/톤이 매핑되어 있다', () => {
    for (const status of mailRecipientStatusValues) {
      expect(STATUS_LABEL[status], `누락된 status: ${status}`).toBeDefined();
      expect(STATUS_LABEL[status].label.length).toBeGreaterThan(0);
      expect(STATUS_LABEL[status].tone.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test recipient-status-badge`
Expected: FAIL — `Cannot find module '.../recipient-status-badge'` (파일 미존재)

- [ ] **Step 3: 공유 컴포넌트 작성**

`src/components/operations/mail-campaign/recipient-status-badge.tsx`:

```tsx
import type { MailRecipientStatus } from '@/db/schema/mail';

/** 수신자 status → 표시 라벨 + tailwind 톤. 수신자 목록·조사 대상 목록 공유. */
export const STATUS_LABEL: Record<MailRecipientStatus, { label: string; tone: string }> = {
  queued: { label: '대기', tone: 'bg-amber-100 text-amber-700' },
  sending: { label: '전송중', tone: 'bg-blue-100 text-blue-700' },
  sent: { label: '발송됨', tone: 'bg-blue-100 text-blue-700' },
  delivered: { label: '전달 완료', tone: 'bg-emerald-100 text-emerald-700' },
  opened: { label: '열람', tone: 'bg-emerald-200 text-emerald-800' },
  bounced: { label: '반송', tone: 'bg-rose-100 text-rose-700' },
  complained: { label: '신고', tone: 'bg-rose-200 text-rose-800' },
  failed: { label: '실패', tone: 'bg-rose-100 text-rose-700' },
  skipped_unsubscribed: { label: '수신거부', tone: 'bg-slate-100 text-slate-600' },
};

/** 수신자 status badge. STATUS_LABEL 매핑 기반 단일 pill. */
export function RecipientStatusBadge({ status }: { status: MailRecipientStatus }) {
  const tone = STATUS_LABEL[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone.tone}`}
    >
      {tone.label}
    </span>
  );
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test recipient-status-badge`
Expected: PASS (1 test)

- [ ] **Step 5: campaign-recipients-table 리팩토링**

`campaign-recipients-table.tsx` 상단 import 에 추가(기존 `import type { MailRecipientStatus }` 줄 아래):

```tsx
import { RecipientStatusBadge, STATUS_LABEL } from './recipient-status-badge';
```

로컬 `STATUS_LABEL` 정의(19-29줄) 전체를 **삭제**한다. `STATUS_FILTER_CHIPS`(31줄~)는 그대로 둔다.

셀 렌더의 status badge 부분(현재 148-154줄 부근)을 공유 컴포넌트로 교체. 변경 전:
```tsx
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone.tone}`}
                        >
                          {tone.label}
                        </span>
```
변경 후:
```tsx
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1">
                        <RecipientStatusBadge status={r.status} />
```

그리고 그 위의 `const tone = STATUS_LABEL[r.status];` 줄(138줄 부근, `rows.map((r) => {` 직후)을 **삭제**한다 — 더 이상 `tone` 지역변수를 직접 쓰지 않는다.

> `STATUS_LABEL` import 는 남겨둔다: 향후 필요 시 대비가 아니라, 이 파일에서 다른 용도가 없으면 import 도 제거. 확인 결과 `tone` 외 사용처가 없으므로 **`STATUS_LABEL` import 는 넣지 말고 `RecipientStatusBadge` 만 import** 한다. 위 import 줄을 `import { RecipientStatusBadge } from './recipient-status-badge';` 로 작성.

- [ ] **Step 6: 타입 + lint 확인**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 에러 0 (`tone` 미사용 변수 경고 없음 = 삭제 정상)

- [ ] **Step 7: 커밋**

```bash
git add src/components/operations/mail-campaign/recipient-status-badge.tsx tests/operations/recipient-status-badge.test.ts src/components/operations/mail-campaign/campaign-recipients-table.tsx
git commit -m "refactor: 수신자 상태 badge를 공유 컴포넌트로 추출"
```

---

## Task 3: contacts.server.ts — 최신 메일 상태 데이터 레이어

**Files:**
- Modify: `src/lib/operations/contacts.server.ts`

`listContactsForSurvey` 가 반환하는 `ContactsRow` 에 `latestMailStatus` 를 추가한다. 기존 `latestResultCodeExpr` / `progressPctExpr` correlated subquery 패턴을 그대로 따른다.

- [ ] **Step 1: MailRecipientStatus 타입 import 추가**

`contacts.server.ts` 상단, `import type { ContactColumnScheme } from '@/db/schema/schema-types';` 줄 아래에 추가:

```ts
import type { MailRecipientStatus } from '@/db/schema/mail';
```

- [ ] **Step 2: latestMailStatusExpr subquery 추가**

`progressPctExpr` 정의(70-74줄) 바로 아래에 추가:

```ts
// 조사 대상별 최신(created_at DESC) 메일 수신 상태 1건.
// outer correlation 은 명시적 qualifier 필수 (latestAttemptNoExpr 주석 참고).
// 인덱스: idx_mail_recipients_target_created (contact_target_id, created_at DESC).
const latestMailStatusExpr = sql<MailRecipientStatus | null>`(
  SELECT status FROM mail_recipients
  WHERE contact_target_id = "contact_targets"."id"
  ORDER BY created_at DESC LIMIT 1
)`;
```

- [ ] **Step 3: ContactsRow 인터페이스에 필드 추가**

`ContactsRow` 인터페이스(36-52줄)의 `progressPct` 필드 아래에 추가:

```ts
  /** 최신(created_at DESC) 메일 수신 상태. 발송 이력 없으면 null */
  latestMailStatus: MailRecipientStatus | null;
```

- [ ] **Step 4: select 절에 추가**

`dataRows` select(130-141줄)의 `progressPct: progressPctExpr.as('progress_pct'),` 줄 아래에 추가:

```ts
      latestMailStatus: latestMailStatusExpr.as('latest_mail_status'),
```

- [ ] **Step 5: row 매핑에 추가**

`rows` 매핑(151-163줄)의 `progressPct: r.progressPct,` 줄 아래에 추가:

```ts
    latestMailStatus: r.latestMailStatus,
```

- [ ] **Step 6: 타입 확인**

Run: `pnpm exec tsc --noEmit`
Expected: 에러 0 (`ContactsRow` 소비처는 필드 추가만 받으므로 무영향)

- [ ] **Step 7: 커밋**

```bash
git add src/lib/operations/contacts.server.ts
git commit -m "feat: 조사 대상 목록에 최신 메일 상태 조회 추가"
```

---

## Task 4: contacts-table.tsx — 메일 상태 badge 셀 렌더

**Files:**
- Modify: `src/components/operations/contacts/contacts-table.tsx`

`computeCell` 의 `system.email_count` case 를 placeholder("—") 에서 badge 렌더로 교체한다.

- [ ] **Step 1: import 추가**

`contacts-table.tsx` 상단, `import type { ContactsRow } from '@/lib/operations/contacts.server';` 줄 아래에 추가:

```tsx
import {
  RecipientStatusBadge,
  STATUS_LABEL,
} from '@/components/operations/mail-campaign/recipient-status-badge';
```

- [ ] **Step 2: email_count case 교체**

`computeCell` 의 다음 부분(85-86줄):
```tsx
    case 'system.email_count':
      return { display: '—', plain: undefined }; // 후속 슬라이스 메일발송
```
을 아래로 교체:
```tsx
    case 'system.email_count':
      return row.latestMailStatus
        ? {
            display: <RecipientStatusBadge status={row.latestMailStatus} />,
            plain: STATUS_LABEL[row.latestMailStatus].label,
          }
        : { display: '—', plain: undefined };
```

- [ ] **Step 3: 헤더 doc 주석 갱신**

파일 상단 컴포넌트 doc 주석(120-122줄 부근)의:
```tsx
 * - system.email_count/contact_owner: 다음 슬라이스 (메일발송/면접원) 까지 placeholder
```
를:
```tsx
 * - system.email_count: 최신 메일 수신 상태 badge (mail_recipients, 발송 이력 없으면 —)
 * - system.contact_owner: 다음 슬라이스 (면접원) 까지 placeholder
```
로 교체.

- [ ] **Step 4: 타입 + lint 확인**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 에러 0

- [ ] **Step 5: 커밋**

```bash
git add src/components/operations/contacts/contacts-table.tsx
git commit -m "feat: 조사 대상 목록 메일 컬럼에 수신 상태 badge 표시"
```

---

## Task 5: 최종 검증

**Files:** 없음 (검증 전용)

- [ ] **Step 1: 전체 타입 + lint + 관련 테스트**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm test recipient-status-badge`
Expected: tsc 0 에러, lint 0 에러, 테스트 1 pass

- [ ] **Step 2: 수동 검증 (개발 서버)**

`pnpm dev` 후 `/admin/surveys/<id>/operations/contacts` 진입. 캠페인 발송 이력이 있는 설문을 사용해 확인:
- [ ] 메일 발송 이력이 있는 조사 대상 → "메일" 컬럼에 올바른 상태 badge(전달 완료/열람/반송 등)
- [ ] 발송 이력 없는 조사 대상 → `—`
- [ ] 여러 캠페인 수신자 → 가장 최근(created_at) 캠페인 상태가 표시
- [ ] 수신자 목록(`mail/campaigns/<cid>`)의 badge 외형이 기존과 동일(리팩토링 회귀 없음)
- [ ] 행 클릭 → 컨택 상세 이동 동작 유지 (badge 셀은 정적)

- [ ] **Step 3: 최종 상태 확인**

Run: `git log --oneline feat/contacts-mail-status ^main`
Expected: design doc + Task 1~4 커밋 5개

---

## Self-Review 결과

- **Spec 커버리지:** 4개 변경(인덱스/데이터/badge공유/표시) 모두 Task 1~4 에 매핑. 동작 명세(최신 발송/미발송 `—`/정적/라벨 "메일") 모두 반영. ✓
- **Placeholder:** TBD/TODO 없음. 모든 코드 step 에 실제 코드 포함. ✓
- **타입 일관성:** `MailRecipientStatus`(schema/mail), `STATUS_LABEL`/`RecipientStatusBadge`(신규 컴포넌트), `latestMailStatus`(ContactsRow) — Task 간 명칭 일치. ✓
- **비범위 준수:** 정렬/필터/발송횟수/상세 메일 이력 미포함(spec 일치). ✓
