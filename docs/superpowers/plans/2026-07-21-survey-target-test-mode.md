# 조사대상자 기반 테스트 모드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 익명 테스트 모드를 최대 20명의 가짜 조사대상자, 대상자별 초대 링크, 실제 메일 캠페인, 테스트 전용 운영 현황, 보관·전체 초기화를 지원하는 설문 단위 전역 테스트 작업공간으로 확장한다.

**Architecture:** 실제와 테스트는 같은 `contact_targets`·`survey_responses`·`mail_campaigns` 테이블을 사용하되 `isTest`와 서버가 해석한 `OperationsDataScope`로 모든 읽기·쓰기 경계를 분리한다. 대상자 테스트 응답은 대상자당 행 하나를 재사용하고 `test_response_attempts`가 마지막 실제 입력 세션만 쓰도록 보장하며, 테스트 메일 삭제는 미발송 행을 제거하고 발송·조정 중인 행만 PII를 지운 정산 사실로 남긴다. 전역 `surveys.testModeEnabled`는 운영 화면 범위와 링크 유효성을 함께 제어하고 모든 mutation은 클라이언트 범위를 신뢰하지 않고 DB 상태를 다시 확인한다.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, oRPC, TanStack Query, Drizzle ORM, PostgreSQL/Supabase, Resend, React Email, Inngest, Vitest, Testing Library.

## Global Constraints

- 테스트 모드는 설문 단위 전역 상태이며 실제 공개 응답과 이미 진행 중인 실제 캠페인은 계속 처리한다.
- 테스트 모드 ON의 운영 콘솔은 테스트 데이터만, OFF의 운영 콘솔은 실제 데이터만 표시한다.
- mutation은 클라이언트가 보낸 `isTest` 또는 scope를 신뢰하지 않고 `surveys.testModeEnabled`와 대상 행의 `is_test`를 서버에서 다시 검증한다.
- 익명 테스트는 대상자 0명일 때만 유효하고 같은 브라우저의 반복 응답도 매번 새 행으로 누적한다.
- 테스트 대상자가 한 명이라도 생기는 최초 저장은 기존 익명 테스트 응답을 경고 없이 하드 삭제한다.
- 대상자 테스트는 대상자당 응답 행 하나만 유지하고 마지막으로 실제 입력을 시작한 attempt만 쓸 수 있다.
- 테스트 대상자 총합은 자동 생성과 수동 추가를 합쳐 설문당 20명 이하이다.
- 테스트 모드에서 엑셀 업로드는 UI·직접 라우트·`ingestContactUpload` 서비스에서 모두 막고 안내 문구는 `테스트 모드에서는 실제 조사대상자를 업로드할 수 없습니다.`로 고정한다.
- 테스트 대상자 0명 팝오버는 `테스트 링크 복사`·`테스트 대상자 생성`·구분선·`테스트 모드 끄기`, 1명 이상은 `테스트 링크 복사`·구분선·`테스트 모드 끄기`만 표시한다.
- 테스트 대상자 1명 이상일 때 `테스트 링크 복사`는 `resid ASC` 첫 대상자의 `/i/{inviteCode}` 하나만 복사한다.
- 메일 템플릿은 실제·테스트가 공유하고, 테스트 캠페인은 실제 Resend 발송·`[TEST]` 제목·테스트 푸터·sandbox 수신거부를 사용하며 비용 정산에 포함한다.
- 템플릿 편집 화면의 단독 테스트 발송은 기존 sandbox invite와 sandbox 수신거부를 유지하고, 응답 가능한 `/i/{inviteCode}`는 테스트 캠페인에서만 사용한다.
- `보관하고 끄기`와 `삭제 후 끄기`는 모두 queued·sending 테스트 캠페인을 취소하고 이미 Resend에 전달된 메일은 회수하지 않는다.
- 전체 초기화는 테스트 대상자·응답·컬럼·미발송 메일을 하드 삭제하되 발송·조정 중 메일은 `삭제된 테스트 발송` 비식별 정산 사실만 남긴다.
- SPSS·엑셀 내보내기와 analytics는 UI 문구 변경 없이 항상 테스트 응답을 제외한다.
- 테스트 링크는 closed·일시중지·종료일·최대 응답 수·quota 소진을 우회하고 테스트 운영 현황에서 quota 위젯을 숨긴다.
- 별도 테스트 화면, 테스트 링크 목록, 테스트 대상자 보기·초대, 다시 테스트하기, 자동발송, 테스트 업로드, 응답자용 테스트 표시를 만들지 않는다.
- 테스트 시작 관리자·시작 시각·자동 만료와 공유 설정 편집 경고를 추가하지 않는다. 결과코드·진척률 컬럼·질문·발행본·메일 템플릿은 실제·테스트가 공유한다.
- 주석·문서·커밋 메시지는 한국어, 식별자는 영어로 작성하고 코드·UI·로그·주석에 이모지를 넣지 않는다.
- feature 간 직접 import는 금지한다. 서버 서비스의 타 도메인 schema 쿼리와 `src/lib` 공용 모듈 import만 허용한다.
- 마이그레이션은 수동 SQL만 사용한다. `pnpm db:generate`·`pnpm db:migrate`를 실행하지 않고 `supabase/migrations/0057_survey_target_test_mode.sql`과 `manual-migrations.json`을 함께 갱신한다.
- 운영 DB에는 계획 실행 중 `db:push` 또는 임의 SQL을 적용하지 않는다. 원격 적용은 별도 승인된 Supabase migration 절차로 수행한다.
- 실DB 테스트는 `*.realdb.test.ts`와 `pnpm test:integration`을 사용하고 일반 `pnpm test`에서는 `RUN_REALDB`가 없으면 skip한다.

---

## 작업 전 준비

- 현재 워킹트리의 `src/app/admin/surveys/[id]/edit/page.tsx`, `src/components/survey-response/survey-response-flow.tsx`, `src/components/survey-response/survey-response-screens.tsx`, `prototypes/`, `tmp/`, `completion-message-modal.tsx` 변경은 사용자 작업이다. 삭제·되돌리기·포괄 staging을 하지 않는다.
- 실행 시 `superpowers:using-git-worktrees`로 격리하고 `codex/survey-target-test-mode` 브랜치를 사용한다. 응답 흐름 두 파일을 수정하기 전 사용자 변경 diff를 읽고 그 위에 병합한다.
- `0056_add_mobile_table_display_mode.sql`은 다른 승인 계획이 예약했으므로 이 기능은 현재 파일 기준 다음 충돌 없는 번호 `0057`을 사용한다.
- Task 1 schema를 수정하기 전에 `pnpm db:setup-test`로 로컬 Supabase를 현재 baseline schema에 맞춘다. Task 1의 fail 확인 뒤 `0057`을 이 로컬 DB에만 적용하고, 원격 dev/prod DB에는 적용하지 않는다.

## File Map

### 새 파일

- `src/lib/operations/data-scope.server.ts`: 전역 모드 조회, `OperationsDataScope`, schema별 scope predicate.
- `src/lib/contacts/test-contact-columns.ts`: 실제 컬럼 깊은 복사와 이름·회사·전화·이메일 보충.
- `src/lib/contacts/test-contact-fixtures.ts`: 명백한 합성 대상자 20세트.
- `src/features/contacts/server/services/contact-insert-scope.service.ts`: 설문 잠금, 현재 범위, 20명 제한, 첫 대상자 전환 불변식.
- `src/features/contacts/server/services/test-contacts.service.ts`: 자동 테스트 대상자 생성.
- `src/lib/survey-response/test-target-attempt.server.ts`: 대상자 응답 행 재사용·초기화와 attempt 소유권.
- `src/lib/mail/test-campaign.ts`: `[TEST]` 접두어와 테스트 푸터·sandbox 수신거부 결정.
- `src/lib/mail/test-mail-archive.server.ts`: 테스트 수신자 비식별화, 캠페인 scrub, 활성 카운터 재계산.
- `src/features/operations/server/services/test-workspace.service.ts`: 보관 종료·전체 초기화 트랜잭션.
- `src/components/operations/test-mode-banner.tsx`: 테스트 범위 amber 공통 배너.
- `src/components/operations/contacts/contact-upload-action.tsx`: disabled 상태에서도 hover/focus 안내가 가능한 업로드 액션.
- `src/components/operations/contacts/test-contact-generator-dialog.tsx`: 생성 인원·수신 이메일 모달.
- `supabase/migrations/0057_survey_target_test_mode.sql`: 컬럼·제약·함수·attempt 테이블·RLS.
- `tests/unit/operations/data-scope.test.ts`: 범위 해석 테스트.
- `tests/unit/contacts/test-contact-data.test.ts`: 컬럼 보충과 fixture 테스트.
- `tests/integration/test-mode-operations-scope.test.ts`: 현황·대상자·리포트·캠페인 읽기 격리.
- `tests/integration/test-contact-generation.test.ts`: 생성·수동 CRUD·업로드 서버 가드.
- `tests/integration/test-target-response-lifecycle.test.ts`: 익명/대상자 링크와 응답 행 초기화.
- `tests/integration/test-target-attempt-ownership.realdb.test.ts`: partial unique와 동시 attempt 인수.
- `tests/integration/test-mode-mail.test.ts`: 후보·생성·dispatch 취소·렌더.
- `tests/integration/test-workspace-lifecycle.test.ts`: 보관·전체 초기화·개별 삭제·비식별 정산.
- `tests/unit/operations/test-mode-control.test.tsx`: 팝오버·링크·다이얼로그·폴링.
- `tests/integration/test-mode-boundaries.test.ts`: export·analytics·quota·실데이터 불변 회귀.

### 핵심 수정 파일

- `src/db/schema/surveys.ts`, `contacts.ts`, `mail.ts`: 신규 컬럼·제약·attempt schema. 기존 `index.ts`의 `export * from './surveys'`가 attempt를 자동 노출한다.
- `src/lib/operations/*server.ts`, `src/app/admin/surveys/[id]/operations/**/page.tsx`: 명시적 scope 전달.
- `src/features/contacts/**`, `src/lib/contacts/scheme-helpers.ts`: 테스트 컬럼·생성·현재 범위 CRUD·업로드 차단.
- `src/lib/duplicate-detection/invite-lookup.ts`, `check.ts`, `types.ts`: 실제/테스트 초대 구분과 fail-closed.
- `src/features/survey-builder/domain/survey-read.ts`, `survey-read.service.ts`: 응답 로더의 익명/대상자 테스트 판정.
- `src/features/survey-response/**`, `src/components/survey-response/**`, `src/app/api/response/segment/route.ts`: 단일 응답 재사용과 attempt 전달·검증.
- `src/features/mail/**`, `src/lib/mail/**`, `src/lib/inngest/functions/campaign-dispatcher.ts`: 테스트 캠페인 scope·실제 발송·chunk 취소 안전장치.
- `src/features/operations/server/services/control.service.ts`, `control.ts`, `src/components/operations/test-mode-control.tsx`: target-aware 링크·생성·종료·동기화.
- `src/lib/operations/mail-billing.server.ts`, `src/components/operations/mail-cost/cycle-summary-table.tsx`: 테스트/삭제 발송 정산 표시.

---

### Task 1: DB 스키마와 수동 마이그레이션

**Files:**
- Modify: `src/db/schema/surveys.ts`
- Modify: `src/db/schema/contacts.ts`
- Modify: `src/db/schema/mail.ts`
- Create: `supabase/migrations/0057_survey_target_test_mode.sql`
- Modify: `supabase/migrations/manual-migrations.json`
- Create: `tests/integration/test-target-attempt-ownership.realdb.test.ts`

**Interfaces:**
- Produces: `surveys.testContactColumns`, `contactTargets.isTest`, `mailCampaigns.isTest`, `mailCampaigns.archivedAt`, `mailRecipients.archivedAt`.
- Produces: `testResponseAttempts` Drizzle table with status `'active' | 'superseded'`.
- Produces: `next_contact_resid(uuid, boolean default false)` and `next_campaign_run_number(uuid, boolean default false)`.
- Produces: `(survey_id,is_test,resid)`, `(survey_id,is_test,run_number)`, 대상자 테스트 응답 partial unique, active attempt partial unique.

- [ ] **Step 1: 실DB 제약 실패 테스트 작성**

```ts
// tests/integration/test-target-attempt-ownership.realdb.test.ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '@/db';

const run = process.env['RUN_REALDB'] === '1' ? describe : describe.skip;

run('조사대상자 테스트 모드 DB 제약', () => {
  const surveyId = randomUUID();
  const targetId = randomUUID();
  const responseId = randomUUID();

  beforeAll(async () => {
    await db.execute(sql`INSERT INTO surveys (id,title,test_mode_enabled) VALUES (${surveyId},'test',true)`);
    await db.execute(sql`INSERT INTO contact_targets (id,survey_id,resid,is_test,invite_code) VALUES (${targetId},${surveyId},1,true,'testcode01')`);
    await db.execute(sql`INSERT INTO survey_responses (id,survey_id,question_responses,is_test,contact_target_id,session_id) VALUES (${responseId},${surveyId},'{}',true,${targetId},${randomUUID()})`);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM surveys WHERE id=${surveyId}`);
  });

  it('같은 응답에는 active attempt 하나만 허용한다', async () => {
    await db.execute(sql`INSERT INTO test_response_attempts (id,response_id,session_id,status) VALUES (${randomUUID()},${responseId},'s1','active')`);
    await expect(db.execute(sql`INSERT INTO test_response_attempts (id,response_id,session_id,status) VALUES (${randomUUID()},${responseId},'s2','active')`)).rejects.toThrow();
  });

  it('실제와 테스트 resid는 각각 1부터 발번한다', async () => {
    const real = await db.execute<{ next_id: number }>(sql`SELECT next_contact_resid(${surveyId},false) AS next_id`);
    const test = await db.execute<{ next_id: number }>(sql`SELECT next_contact_resid(${surveyId},true) AS next_id`);
    expect(Number(real[0]?.next_id)).toBe(1);
    expect(Number(test[0]?.next_id)).toBe(2);
  });
});
```

- [ ] **Step 2: 새 schema가 없어 테스트가 실패하는지 확인**

Run: `pnpm test:integration -- tests/integration/test-target-attempt-ownership.realdb.test.ts`

Expected: FAIL — `test_response_attempts` 또는 `contact_targets.is_test`가 존재하지 않는다.

- [ ] **Step 3: Drizzle schema 추가**

`src/db/schema/surveys.ts`의 `surveys`에 다음 컬럼을 추가하고 `surveyResponses` 아래에 attempt table을 선언한다.

```ts
import { relations, sql } from 'drizzle-orm';
import { boolean, doublePrecision, integer, jsonb, pgTable, smallint, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
```

`contacts.ts`와 `mail.ts`의 pg-core import에는 `boolean`을 추가한다.

```ts
testContactColumns: jsonb('test_contact_columns').$type<ContactColumnScheme>(),

export const testResponseAttemptStatusValues = ['active', 'superseded'] as const;
export type TestResponseAttemptStatus = (typeof testResponseAttemptStatusValues)[number];

export const testResponseAttempts = pgTable(
  'test_response_attempts',
  {
    id: uuid('id').primaryKey(),
    responseId: uuid('response_id').notNull().references(() => surveyResponses.id, { onDelete: 'cascade' }),
    sessionId: text('session_id').notNull(),
    status: text('status').$type<TestResponseAttemptStatus>().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
  },
  (table) => ({
    activeResponseUnique: uniqueIndex('test_response_attempts_active_response_unique')
      .on(table.responseId)
      .where(sql`${table.status} = 'active'`),
  }),
);
```

`contacts.ts`와 `mail.ts`는 다음 shape로 변경한다.

```ts
// contactTargets
isTest: boolean('is_test').notNull().default(false),
surveyScopeResidUnique: unique('contact_targets_survey_scope_resid_unique')
  .on(table.surveyId, table.isTest, table.resid),

// mailCampaigns
isTest: boolean('is_test').notNull().default(false),
archivedAt: timestamp('archived_at', { withTimezone: true }),
surveyScopeRunUnique: unique('mail_campaigns_survey_scope_run_unique')
  .on(table.surveyId, table.isTest, table.runNumber),

// mailRecipients
contactTargetId: uuid('contact_target_id').references(() => contactTargets.id, { onDelete: 'set null' }),
emailSnapshot: text('email_snapshot'),
inviteTokenSnapshot: uuid('invite_token_snapshot'),
archivedAt: timestamp('archived_at', { withTimezone: true }),
```

- [ ] **Step 4: 수동 SQL 마이그레이션 작성**

`supabase/migrations/0057_survey_target_test_mode.sql`에 다음 SQL을 작성한다.

```sql
BEGIN;

ALTER TABLE surveys ADD COLUMN test_contact_columns jsonb;
ALTER TABLE contact_targets ADD COLUMN is_test boolean NOT NULL DEFAULT false;
ALTER TABLE mail_campaigns ADD COLUMN is_test boolean NOT NULL DEFAULT false;
ALTER TABLE mail_campaigns ADD COLUMN archived_at timestamptz;
ALTER TABLE mail_recipients ADD COLUMN archived_at timestamptz;

ALTER TABLE contact_targets DROP CONSTRAINT contact_targets_survey_resid_unique;
ALTER TABLE contact_targets ADD CONSTRAINT contact_targets_survey_scope_resid_unique UNIQUE (survey_id,is_test,resid);
ALTER TABLE mail_campaigns DROP CONSTRAINT mail_campaigns_survey_run_unique;
ALTER TABLE mail_campaigns ADD CONSTRAINT mail_campaigns_survey_scope_run_unique UNIQUE (survey_id,is_test,run_number);

ALTER TABLE mail_recipients ALTER COLUMN contact_target_id DROP NOT NULL;
ALTER TABLE mail_recipients ALTER COLUMN email_snapshot DROP NOT NULL;
ALTER TABLE mail_recipients ALTER COLUMN invite_token_snapshot DROP NOT NULL;
ALTER TABLE mail_recipients DROP CONSTRAINT IF EXISTS mail_recipients_contact_target_id_fkey;
ALTER TABLE mail_recipients DROP CONSTRAINT IF EXISTS mail_recipients_contact_target_id_contact_targets_id_fk;
ALTER TABLE mail_recipients ADD CONSTRAINT mail_recipients_contact_target_id_contact_targets_id_fk
  FOREIGN KEY (contact_target_id) REFERENCES contact_targets(id) ON DELETE SET NULL;

DROP FUNCTION IF EXISTS next_contact_resid(uuid);
CREATE FUNCTION next_contact_resid(p_survey_id uuid, p_is_test boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE v_next integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_survey_id::text || ':' || p_is_test::text, 0));
  SELECT COALESCE(MAX(resid),0)+1 INTO v_next FROM contact_targets
   WHERE survey_id=p_survey_id AND is_test=p_is_test;
  RETURN v_next;
END;
$$;

DROP FUNCTION IF EXISTS next_campaign_run_number(uuid);
CREATE FUNCTION next_campaign_run_number(p_survey_id uuid, p_is_test boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE v_next integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_survey_id::text || ':' || p_is_test::text, 0));
  SELECT COALESCE(MAX(run_number),0)+1 INTO v_next FROM mail_campaigns
   WHERE survey_id=p_survey_id AND is_test=p_is_test;
  RETURN v_next;
END;
$$;

CREATE UNIQUE INDEX survey_responses_test_target_active_unique
  ON survey_responses(contact_target_id)
  WHERE is_test=true AND contact_target_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE test_response_attempts (
  id uuid PRIMARY KEY,
  response_id uuid NOT NULL REFERENCES survey_responses(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('active','superseded')),
  started_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz
);
CREATE UNIQUE INDEX test_response_attempts_active_response_unique
  ON test_response_attempts(response_id) WHERE status='active';
CREATE INDEX contact_targets_survey_scope_resid_idx ON contact_targets(survey_id,is_test,resid);
CREATE INDEX mail_campaigns_survey_scope_created_idx ON mail_campaigns(survey_id,is_test,created_at DESC) WHERE archived_at IS NULL;
CREATE INDEX mail_recipients_campaign_active_idx ON mail_recipients(campaign_id,status) WHERE archived_at IS NULL;

ALTER TABLE test_response_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE test_response_attempts FROM anon, authenticated;

COMMIT;
```

- [ ] **Step 5: migration manifest와 schema export 갱신**

`manual-migrations.json` 배열 끝에 `"0057_survey_target_test_mode"`를 추가하고 `src/db/schema/index.ts`가 `surveys.ts`의 attempt export를 계속 노출하는지 확인한다.

- [ ] **Step 6: schema·migration 검증**

Run:

```bash
docker exec -i supabase_db_survey-table-project psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/migrations/0057_survey_target_test_mode.sql
pnpm exec tsc --noEmit
pnpm exec tsx .github/migration-journal-gate.ts
pnpm test:integration -- tests/integration/test-target-attempt-ownership.realdb.test.ts
```

Expected: PASS — 로컬 migration `COMMIT`, 타입 검사 성공, migration gate `OK`, 실DB 테스트 성공.

- [ ] **Step 7: 커밋**

```bash
git add src/db/schema/surveys.ts src/db/schema/contacts.ts src/db/schema/mail.ts supabase/migrations/0057_survey_target_test_mode.sql supabase/migrations/manual-migrations.json tests/integration/test-target-attempt-ownership.realdb.test.ts
git commit -m "feat: 테스트 작업공간 데이터 모델 추가"
```

---

### Task 2: 서버 전용 데이터 범위와 응답 현황 읽기 전환

**Files:**
- Create: `src/lib/operations/data-scope.server.ts`
- Create: `tests/unit/operations/data-scope.test.ts`
- Modify: `src/lib/operations/aggregate-status.server.ts`
- Modify: `src/lib/operations/aggregate-daily.server.ts`
- Modify: `src/lib/operations/daily-stats.server.ts`
- Modify: `src/lib/operations/response-time.server.ts`
- Modify: `src/lib/operations/drop-funnel.server.ts`
- Modify: `src/lib/operations/page-dwell.server.ts`
- Modify: `src/lib/operations/profiles.server.ts`
- Modify: `src/lib/operations/profiles.ts`
- Modify: `src/app/admin/surveys/[id]/operations/overview/page.tsx`
- Modify: `src/app/admin/surveys/[id]/operations/profiles/page.tsx`
- Modify: `src/app/admin/surveys/[id]/operations/profiles/[responseId]/edit/page.tsx`
- Modify: `src/components/operations/profiles/profiles-filter-bar.tsx`
- Create: `tests/integration/test-mode-operations-scope.test.ts`

**Interfaces:**
- Produces: `type OperationsDataScope = 'real' | 'test'`.
- Produces: `testFlagForScope(scope)`, `loadOperationsDataScope(surveyId)`, cached `getOperationsDataScope(surveyId)`.
- Produces: `responseScopeCondition(scope)`, `targetScopeCondition(scope)`, `campaignScopeCondition(scope)`.
- Consumes: 모든 RSC는 scope를 한 번 해석해 집계 함수에 명시적으로 전달한다.

- [ ] **Step 1: scope helper와 집계 격리 실패 테스트 작성**

```ts
// tests/unit/operations/data-scope.test.ts
import { describe, expect, it } from 'vitest';
import { testFlagForScope } from '@/lib/operations/data-scope.server';

describe('testFlagForScope', () => {
  it('real은 false, test는 true로 고정한다', () => {
    expect(testFlagForScope('real')).toBe(false);
    expect(testFlagForScope('test')).toBe(true);
  });
});
```

```ts
// tests/integration/test-mode-operations-scope.test.ts의 첫 describe
it('aggregateStatus는 전달된 scope의 응답만 집계한다', async () => {
  vi.mocked(db.select).mockReturnValueOnce(chain([{ status: 'completed', count: 2 }]) as never);
  await aggregateStatus(SURVEY_ID, 'test');
  expect(whereSql()).toContain('"survey_responses"."is_test" = $');
  expect(whereParams()).toContain(true);
});
```

- [ ] **Step 2: 새 helper 부재와 기존 hard-coded `notTestResponse`로 실패 확인**

Run: `pnpm exec vitest run tests/unit/operations/data-scope.test.ts tests/integration/test-mode-operations-scope.test.ts`

Expected: FAIL — 모듈 부재 또는 test scope에서도 `is_test=false` 조건 사용.

- [ ] **Step 3: scope helper 구현**

```ts
// src/lib/operations/data-scope.server.ts
import 'server-only';
import { cache } from 'react';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { contactTargets, mailCampaigns, surveyResponses, surveys } from '@/db/schema';

export type OperationsDataScope = 'real' | 'test';

export function testFlagForScope(scope: OperationsDataScope): boolean {
  return scope === 'test';
}

export async function loadOperationsDataScope(surveyId: string): Promise<OperationsDataScope> {
  const [row] = await db.select({ enabled: surveys.testModeEnabled }).from(surveys)
    .where(eq(surveys.id, surveyId)).limit(1);
  if (!row) throw new Error('설문을 찾을 수 없습니다.');
  return row.enabled ? 'test' : 'real';
}

export const getOperationsDataScope = cache(loadOperationsDataScope);
export const responseScopeCondition = (scope: OperationsDataScope) =>
  eq(surveyResponses.isTest, testFlagForScope(scope));
export const targetScopeCondition = (scope: OperationsDataScope) =>
  eq(contactTargets.isTest, testFlagForScope(scope));
export const campaignScopeCondition = (scope: OperationsDataScope) =>
  eq(mailCampaigns.isTest, testFlagForScope(scope));
```

- [ ] **Step 4: 응답 집계 함수 시그니처와 SQL을 scope 기반으로 교체**

각 함수는 다음 시그니처를 사용하고 `notTestResponse` 또는 `is_test=false`를 `responseScopeCondition(scope)`/`${testFlagForScope(scope)}`로 바꾼다.

```ts
aggregateStatus(surveyId: string, scope: OperationsDataScope)
aggregateDaily(input: { surveyId: string; scope: OperationsDataScope; mode: 'day' | 'hour'; hourModeDate?: string })
aggregateDailyAvailableDates(surveyId: string, scope: OperationsDataScope)
getDailyStats(surveyId: string, scope: OperationsDataScope)
getResponseTime(surveyId: string, scope: OperationsDataScope)
getDropFunnel(surveyId: string, scope: OperationsDataScope)
getPageDwell(surveyId: string, scope: OperationsDataScope)
```

Raw SQL에는 다음 boolean 파라미터를 넣는다.

```ts
const isTest = testFlagForScope(scope);
const scopedWhere = sql`
  sr.survey_id=${surveyId}::uuid
  AND sr.is_test=${isTest}
  AND sr.deleted_at IS NULL
`;
```

각 raw query의 기존 survey id·`sr.is_test=false`·`deleted_at IS NULL` 조건 세 줄을 `WHERE ${scopedWhere}`로 교체하고 SELECT·GROUP BY·ORDER BY는 변경하지 않는다.

- [ ] **Step 5: profiles의 URL 테스트 필터를 제거하고 scope를 고정**

`listResponsesForProfiles` args의 `test`를 `scope`로 교체하고 상세/삭제 여부 조회에도 같은 predicate를 적용한다.

profiles의 `contact_targets` LEFT JOIN에는 `contactTargets.isTest = surveyResponses.isTest`를 추가해 손상된 교차 범위 FK의 attrs·PII가 노출되지 않게 한다.

```ts
export interface ListProfilesArgs {
  surveyId: string;
  scope: OperationsDataScope;
  page: number;
  pageSize: number;
  status: ProfilesStatus;
  sort: ProfilesSort;
  dir: SortDir;
  view: ProfilesView;
  condition: ProfilesCondition | null;
}
```

`ProfilesFilterBar`에서 `initialTest` prop과 테스트 select를 제거하고 페이지는 `scope`를 전달한다.

- [ ] **Step 6: overview와 profiles RSC에서 scope를 한 번 해석**

```ts
const scope = await getOperationsDataScope(surveyId);
const availableDates = await aggregateDailyAvailableDates(surveyId, scope);
const [statusCounts, dailyBuckets, dailyStats, responseTime, dropFunnel, pageDwell] = await Promise.all([
  aggregateStatus(surveyId, scope),
  aggregateDaily({ surveyId, scope, mode, ...(effectiveDate ? { hourModeDate: effectiveDate } : {}) }),
  getDailyStats(surveyId, scope),
  getResponseTime(surveyId, scope),
  getDropFunnel(surveyId, scope),
  getPageDwell(surveyId, scope),
]);
const quotaStatus = scope === 'test' ? null : await getQuotaStatus(surveyId);
```

응답 상세 RSC는 `response.surveyId===surveyId`뿐 아니라 `response.isTest===testFlagForScope(scope)`를 만족하지 않으면 `notFound()`한다.

- [ ] **Step 7: 테스트 통과 확인**

Run: `pnpm exec vitest run tests/unit/operations/data-scope.test.ts tests/integration/test-mode-operations-scope.test.ts tests/integration/profiles-exclusion.test.ts tests/unit/domains/operations`

Expected: PASS — test/real 양쪽 SQL predicate와 기존 집계 포맷 회귀 통과.

- [ ] **Step 8: 커밋**

```bash
git add src/lib/operations src/app/admin/surveys/[id]/operations/overview/page.tsx src/app/admin/surveys/[id]/operations/profiles src/components/operations/profiles tests/unit/operations/data-scope.test.ts tests/integration/test-mode-operations-scope.test.ts
git commit -m "feat: 운영 응답 현황을 전역 테스트 범위로 전환"
```

---

### Task 3: 조사대상·리포트·메일 읽기 범위와 공통 배너

**Files:**
- Modify: `src/lib/operations/contacts.server.ts`
- Modify: `src/lib/operations/report-progress.server.ts`
- Modify: `src/lib/operations/campaigns.server.ts`
- Modify: `src/lib/operations/contact-sample.server.ts`
- Modify: `src/app/admin/surveys/[id]/operations/contacts/page.tsx`
- Modify: `src/app/admin/surveys/[id]/operations/contacts/[contactId]/page.tsx`
- Modify: `src/app/admin/surveys/[id]/operations/contacts/columns/page.tsx`
- Modify: `src/app/admin/surveys/[id]/operations/contacts/new/page.tsx`
- Modify: `src/app/admin/surveys/[id]/operations/report/page.tsx`
- Modify: `src/app/admin/surveys/[id]/operations/report/columns/page.tsx`
- Modify: `src/app/admin/surveys/[id]/operations/mail/campaigns/page.tsx`
- Modify: `src/app/admin/surveys/[id]/operations/mail/campaigns/new/page.tsx`
- Modify: `src/app/admin/surveys/[id]/operations/mail/campaigns/[cid]/page.tsx`
- Modify: `src/features/mail/server/services/mail-preview.service.ts`
- Create: `src/components/operations/test-mode-banner.tsx`
- Modify: `src/app/admin/surveys/[id]/operations/layout.tsx`
- Modify: `tests/integration/test-mode-operations-scope.test.ts`

**Interfaces:**
- Consumes: `OperationsDataScope`, `targetScopeCondition`, `campaignScopeCondition` from Task 2.
- Produces: `getContactColumnScheme(surveyId, scope)` selecting `contactColumns` or `testContactColumns`.
- Produces: 모든 contact/report/campaign query가 명시적 scope를 요구하고 archived mail을 운영 화면에서 제외한다.

- [ ] **Step 1: 반대 범위 행과 archived 캠페인 제외 테스트 확장**

```ts
it('contacts와 report는 target scope를 사용한다', async () => {
  await listContactsForSurvey({ surveyId: SURVEY_ID, scope: 'test', clauses: [], page: 1, pageSize: 20, sort: 'resid', dir: 'asc' });
  expect(whereParams()).toContain(true);
});

it('campaign 목록은 scope와 archivedAt null을 모두 요구한다', async () => {
  await listCampaignsForSurvey({ surveyId: SURVEY_ID, scope: 'real', page: 1, pageSize: 20 });
  expect(whereSql()).toContain('archived_at is null');
  expect(whereParams()).toContain(false);
});
```

- [ ] **Step 2: 기존 query가 scope를 받지 않아 실패하는지 확인**

Run: `pnpm exec vitest run tests/integration/test-mode-operations-scope.test.ts`

Expected: FAIL — 새 `scope` 인자가 없거나 반대 범위 행을 제외하지 않는다.

- [ ] **Step 3: contacts adapter를 scope-aware로 변경**

```ts
export interface ListContactsArgs {
  surveyId: string;
  scope: OperationsDataScope;
  clauses: FilterClause[];
  page: number;
  sort: ContactsSortKey;
  dir: ContactsSortDir;
  pageSize: number;
}

export const getContactColumnScheme = cache(async (
  surveyId: string,
  scope: OperationsDataScope,
): Promise<ContactColumnScheme | null> => {
  const [row] = await db.select({
    scheme: scope === 'test' ? surveys.testContactColumns : surveys.contactColumns,
  }).from(surveys).where(eq(surveys.id, surveyId)).limit(1);
  return row?.scheme ?? null;
});
```

`listContactsForSurvey`, `getContactDetailById`, `getMailRecipientsForTarget`는 `targetScopeCondition(scope)`를 적용하고 mail history의 correlated query와 목록에 `mail_recipients.archived_at IS NULL`을 추가한다. contact 목록의 progress subquery는 `survey_responses.is_test = contact_targets.is_test`, latest mail subquery는 campaign `is_test = contact_targets.is_test`를 함께 요구한다. `listContactUploads`는 test scope에서 호출하지 않는다.

- [ ] **Step 4: report와 campaign adapter의 모든 public 함수에 scope 추가**

```ts
getProgressGroupLabel(surveyId: string, scope: OperationsDataScope)
getProgressRows(args: GetProgressRowsArgs & { scope: OperationsDataScope })
getProgressTotals(surveyId: string, scope: OperationsDataScope, condition: FilterCondition | null)
listCampaignsForSurvey(args: { surveyId: string; scope: OperationsDataScope; page: number; pageSize: number })
getCampaignDetail(surveyId: string, cid: string, scope: OperationsDataScope)
listCampaignRecipients(args: { surveyId: string; campaignId: string; scope: OperationsDataScope; page: number; pageSize: number })
previewCampaignCandidates(args: CampaignCandidateArgs & { scope: OperationsDataScope })
countCampaignCandidates(args: CampaignCountArgs & { scope: OperationsDataScope })
listUnsubscribedContacts(args: UnsubscribedArgs & { scope: OperationsDataScope })
preflightRecipients(args: PreflightArgs & { scope: OperationsDataScope })
getFirstContactSample(surveyId: string, scope: OperationsDataScope)
```

campaign query는 항상 `campaignScopeCondition(scope)`와 `isNull(mailCampaigns.archivedAt)`를, recipient query는 `isNull(mailRecipients.archivedAt)`를 적용한다.

`getContactResultCodes`, `getProgressColumnScheme`, 질문·발행본·메일 템플릿 조회에는 scope를 추가하지 않는다. 이 설정들은 공유 자원이고 `testContactColumns`만 mode별로 분리한다.

`report-progress.server.ts`의 raw SQL은 `ct.is_test=${isTest}`와 `sr.is_test=${isTest}`를 둘 다 사용해 반대 범위 응답이 같은 target id에 잘못 집계되지 않게 한다.

- [ ] **Step 5: 모든 RSC가 같은 pass의 scope를 전달**

각 page 상단에서 다음 패턴을 사용한다.

```ts
const scope = await getOperationsDataScope(surveyId);
const [scheme, rows] = await Promise.all([
  getContactColumnScheme(surveyId, scope),
  listContactsForSurvey({
    surveyId,
    scope,
    pageSize: CONTACTS_PAGE_SIZE,
    clauses,
    page: parsedPage,
    sort: safeSort,
    dir,
  }),
]);
```

직접 URL로 반대 범위의 contact/campaign 상세를 열면 adapter가 `null`을 반환하고 page가 `notFound()`하도록 유지한다. 리포트의 빠른 대상자 count에도 `targetScopeCondition(scope)`를 넣는다. 메일 preview service는 mutation 성격의 RPC이므로 `loadOperationsDataScope`로 현재 모드를 매 호출 읽고 `getFirstContactSample(surveyId, scope)`를 호출한다.

- [ ] **Step 6: 운영 공통 amber 배너 추가**

```tsx
// src/components/operations/test-mode-banner.tsx
export function TestModeBanner() {
  return (
    <div role="status" className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-900">
      테스트 데이터를 보고 있습니다. 실제 조사대상자와 응답은 계속 수집되지만 현재 화면에서는 숨겨져 있습니다.
    </div>
  );
}
```

`operations/layout.tsx`는 `scope`를 읽고 탭 아래에 `{scope === 'test' ? <TestModeBanner /> : null}`을 렌더한다.

- [ ] **Step 7: 범위 테스트와 타입 검사**

Run: `pnpm exec vitest run tests/integration/test-mode-operations-scope.test.ts tests/integration/report-progress-exclusion.test.ts tests/integration/campaign-candidate-filter.test.ts && pnpm exec tsc --noEmit`

Expected: PASS — contacts/report/campaign/sample 모두 한 범위만 읽고 반대 ID 상세는 미존재 처리.

- [ ] **Step 8: 커밋**

```bash
git add src/lib/operations src/app/admin/surveys/[id]/operations src/features/mail/server/services/mail-preview.service.ts src/components/operations/test-mode-banner.tsx tests/integration/test-mode-operations-scope.test.ts
git commit -m "feat: 운영 대상자 리포트 메일 읽기 범위 분리"
```

---

### Task 4: 테스트 컬럼·fixture·대상자 자동 생성

**Files:**
- Create: `src/lib/contacts/test-contact-columns.ts`
- Create: `src/lib/contacts/test-contact-fixtures.ts`
- Create: `src/features/contacts/server/services/contact-insert-scope.service.ts`
- Create: `src/features/contacts/server/services/test-contacts.service.ts`
- Modify: `src/features/contacts/domain/contact-target.ts`
- Modify: `src/features/contacts/server/procedures/targets.ts`
- Modify: `src/features/contacts/server/services/contact-targets.service.ts`
- Modify: `src/lib/contacts/scheme-helpers.ts`
- Create: `tests/unit/contacts/test-contact-data.test.ts`
- Create: `tests/integration/test-contact-generation.test.ts`

**Interfaces:**
- Produces: `TEST_CONTACT_FIXTURES` 길이 20.
- Produces: `ensureTestContactColumns(realScheme, savedTestScheme): ContactColumnScheme`.
- Produces: `resolveTestContactFieldBindings(scheme): { name; company; phone; email }` so cloned column keys receive fixture values.
- Produces: `prepareContactInsertScope(tx, { surveyId, requestedCount, requireEmptyTestScope })`.
- Produces: `generateTestContacts({ surveyId, count, recipientEmail }): Promise<{ createdCount:number }>`.
- Produces oRPC: `contacts.targets.generateTest`.

- [ ] **Step 1: 컬럼 보충과 fixture 실패 테스트 작성**

```ts
// tests/unit/contacts/test-contact-data.test.ts
import { describe, expect, it } from 'vitest';
import { ensureTestContactColumns, resolveTestContactFieldBindings } from '@/lib/contacts/test-contact-columns';
import { TEST_CONTACT_FIXTURES } from '@/lib/contacts/test-contact-fixtures';

describe('테스트 대상자 기본 데이터', () => {
  it('20개의 명백한 합성 fixture를 제공한다', () => {
    expect(TEST_CONTACT_FIXTURES).toHaveLength(20);
    expect(new Set(TEST_CONTACT_FIXTURES.map((row) => row.name)).size).toBe(20);
    expect(TEST_CONTACT_FIXTURES.every((row) => row.phone.startsWith('000-'))).toBe(true);
  });

  it('실제 스킴을 변경하지 않고 빠진 네 의미 컬럼만 보충한다', () => {
    const real = { version: 1, headerRow: 1, columns: [{ key: '담당자', label: '담당자', source: 'pii.담당자', piiType: 'name', order: 1 }] } as const;
    const test = ensureTestContactColumns(real, null);
    expect(test).not.toBe(real);
    expect(test.columns.filter((c) => c.piiType === 'name')).toHaveLength(1);
    expect(test.columns.some((c) => c.source === 'attrs.test_company')).toBe(true);
    expect(test.columns.some((c) => c.piiType === 'phone')).toBe(true);
    expect(test.columns.some((c) => c.piiType === 'email')).toBe(true);
  });

  it('보관된 테스트 스킴이 있으면 실제 스킴을 다시 복사하지 않는다', () => {
    const saved = { version: 1, headerRow: 1, columns: [{ key: 'custom', label: '사용자 컬럼', source: 'attrs.custom', order: 1 }] };
    expect(ensureTestContactColumns(null, saved)).toEqual(saved);
  });

  it('복사된 의미 컬럼의 실제 저장 key를 해석한다', () => {
    const scheme = ensureTestContactColumns({ version: 1, headerRow: 1, columns: [
      { key: '담당자', label: '담당자', source: 'pii.담당자', piiType: 'representative', order: 1 },
      { key: '소속', label: '회사명', source: 'attrs.소속', order: 2 },
    ] }, null);
    expect(resolveTestContactFieldBindings(scheme)).toMatchObject({
      name: { columnKey: '담당자', fieldType: 'representative' },
      company: { columnKey: '소속' },
    });
  });
});
```

- [ ] **Step 2: 새 helper 부재로 실패 확인**

Run: `pnpm exec vitest run tests/unit/contacts/test-contact-data.test.ts`

Expected: FAIL — 두 모듈을 찾을 수 없다.

- [ ] **Step 3: fixture와 스킴 helper 구현**

```ts
// src/lib/contacts/test-contact-fixtures.ts
export interface TestContactFixture { name: string; company: string; phone: string }
export const TEST_CONTACT_FIXTURES: readonly TestContactFixture[] = Array.from({ length: 20 }, (_, index) => {
  const no = String(index + 1).padStart(2, '0');
  return { name: `테스트 담당자 ${no}`, company: `테스트기업 ${no}`, phone: `000-0000-${String(index + 1).padStart(4, '0')}` };
});
```

```ts
// src/lib/contacts/test-contact-columns.ts
const DEFAULTS: readonly ContactColumnDef[] = [
  { key: 'test_name', label: '이름', source: 'pii.test_name', piiType: 'name', order: 0 },
  { key: 'test_company', label: '회사', source: 'attrs.test_company', order: 0 },
  { key: 'test_phone', label: '전화번호', source: 'pii.test_phone', piiType: 'phone', order: 0 },
  { key: 'test_email', label: '이메일', source: 'pii.test_email', piiType: 'email', order: 0 },
];

export function ensureTestContactColumns(real: ContactColumnScheme | null, saved: ContactColumnScheme | null): ContactColumnScheme {
  if (saved) return structuredClone(saved);
  const base = structuredClone(real ?? { version: 1, headerRow: 1, columns: [] });
  const hasCompany = base.columns.some((c) => /회사|기업|company/i.test(`${c.key} ${c.label}`));
  const missing = DEFAULTS.filter((column) => {
    if (column.piiType === 'name') return !base.columns.some((c) => c.piiType === 'name' || c.piiType === 'representative');
    if (column.piiType === 'phone') return !base.columns.some((c) => c.piiType === 'phone' || c.piiType === 'mobile');
    if (column.piiType === 'email') return !base.columns.some((c) => c.piiType === 'email');
    return !hasCompany;
  });
  const columns = [...base.columns, ...missing].map((column, index) => ({ ...column, order: index + 1 }));
  return { ...base, columns };
}

export interface TestContactFieldBindings {
  name: { columnKey: string; fieldType: 'name' | 'representative' };
  company: { columnKey: string };
  phone: { columnKey: string; fieldType: 'phone' | 'mobile' };
  email: { columnKey: string; fieldType: 'email' };
}

export function resolveTestContactFieldBindings(scheme: ContactColumnScheme): TestContactFieldBindings {
  const name = scheme.columns.find((c) => c.piiType === 'name' || c.piiType === 'representative');
  const company = scheme.columns.find((c) => c.source.startsWith('attrs.') && /회사|기업|company/i.test(`${c.key} ${c.label}`));
  const phone = scheme.columns.find((c) => c.piiType === 'phone' || c.piiType === 'mobile');
  const email = scheme.columns.find((c) => c.piiType === 'email');
  if (!name || (name.piiType !== 'name' && name.piiType !== 'representative')) throw new Error('테스트 이름 컬럼을 찾을 수 없습니다.');
  if (!company) throw new Error('테스트 회사 컬럼을 찾을 수 없습니다.');
  if (!phone || (phone.piiType !== 'phone' && phone.piiType !== 'mobile')) throw new Error('테스트 전화 컬럼을 찾을 수 없습니다.');
  if (!email || email.piiType !== 'email') throw new Error('테스트 이메일 컬럼을 찾을 수 없습니다.');
  return {
    name: { columnKey: name.source.slice(4), fieldType: name.piiType },
    company: { columnKey: company.source.slice(6) },
    phone: { columnKey: phone.source.slice(4), fieldType: phone.piiType },
    email: { columnKey: email.source.slice(4), fieldType: email.piiType },
  };
}
```

- [ ] **Step 4: 설문 잠금과 최초 대상자 불변식 service 구현**

```ts
export async function prepareContactInsertScope(
  tx: DbTransaction,
  input: { surveyId: string; requestedCount: number; requireEmptyTestScope: boolean },
): Promise<{ scope: OperationsDataScope; isTest: boolean; scheme: ContactColumnScheme | null; existingCount: number }> {
  const rows = await tx.execute<SurveyScopeRow>(sql`SELECT id,test_mode_enabled,contact_columns,test_contact_columns FROM surveys WHERE id=${input.surveyId}::uuid FOR UPDATE`);
  const survey = rows[0];
  if (!survey) throw new Error('설문을 찾을 수 없습니다.');
  const isTest = survey.test_mode_enabled;
  const scope = isTest ? 'test' : 'real';
  const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(contactTargets)
    .where(and(eq(contactTargets.surveyId, input.surveyId), eq(contactTargets.isTest, isTest)));
  if (input.requireEmptyTestScope && (!isTest || total !== 0)) throw new Error('TEST_TARGET_GENERATION_STALE');
  if (isTest && total + input.requestedCount > 20) throw new Error('TEST_TARGET_LIMIT');
  let scheme = isTest ? ensureTestContactColumns(survey.contact_columns, survey.test_contact_columns) : survey.contact_columns;
  if (isTest && total === 0) {
    await tx.delete(surveyResponses).where(and(eq(surveyResponses.surveyId, input.surveyId), eq(surveyResponses.isTest, true), isNull(surveyResponses.contactTargetId)));
    await tx.update(surveys).set({ testContactColumns: scheme }).where(eq(surveys.id, input.surveyId));
  }
  return { scope, isTest, scheme, existingCount: total };
}
```

- [ ] **Step 5: 자동 생성 domain·service·procedure 구현**

```ts
export const GenerateTestContactsInput = z.object({
  surveyId: z.string().uuid(),
  count: z.number().int().min(1).max(20),
  recipientEmail: z.string().email(),
});
export const GenerateTestContactsResult = z.object({ createdCount: z.number().int() });
```

`generateTestContacts`는 한 transaction 안에서 `prepareContactInsertScope(...requireEmptyTestScope:true)`를 호출하고 각 fixture를 다음 값으로 저장한다.

```ts
if (!prepared.scheme) throw new Error('테스트 대상자 컬럼을 찾을 수 없습니다.');
const bindings = resolveTestContactFieldBindings(prepared.scheme);
const attrs = { [bindings.company.columnKey]: fixture.company };
const pii = [
  { ...bindings.name, plain: fixture.name },
  { ...bindings.phone, plain: fixture.phone },
  { ...bindings.email, plain: input.recipientEmail },
];
const residRows = await tx.execute<{ resid: number }>(sql`SELECT next_contact_resid(${input.surveyId},true) AS resid`);
const [target] = await tx.insert(contactTargets).values({ surveyId: input.surveyId, resid: Number(residRows[0]?.resid), isTest: true, attrs, inviteCode: generateInviteCode() }).returning({ id: contactTargets.id });
if (!target) throw new Error('테스트 대상자 저장에 실패했습니다.');
for (const value of pii) await upsertPiiValue(tx, target.id, value.columnKey, value.fieldType, value.plain);
```

- [ ] **Step 6: 수동 add도 같은 불변식을 사용**

`addContactTarget`의 attrs sanitize와 insert를 transaction 안으로 옮기고 `prepareContactInsertScope(...requestedCount:1, requireEmptyTestScope:false)`가 반환한 `isTest`·`scheme`을 사용한다.

```ts
const prepared = await prepareContactInsertScope(tx, { surveyId, requestedCount: 1, requireEmptyTestScope: false });
const attrs = sanitizeAttrsAgainstPiiScheme(rawAttrs, prepared.scheme);
const residRows = await tx.execute<{ resid: number }>(sql`SELECT next_contact_resid(${surveyId},${prepared.isTest}) AS resid`);
await tx.insert(contactTargets).values({ surveyId, resid, isTest: prepared.isTest, attrs, groupValue, memo, contactMethod, inviteCode: generateInviteCode() });
```

`scheme-helpers.ts`는 순수 `sanitizeAttrsAgainstPiiScheme(attrs, scheme)`를 export하고 기존 DB 조회 wrapper는 Task 5에서 제거한다.

- [ ] **Step 7: 생성·동시 제한·익명 삭제 테스트 통과 확인**

Run: `pnpm exec vitest run tests/unit/contacts/test-contact-data.test.ts tests/integration/test-contact-generation.test.ts src/features/contacts/server/services/contact-targets.service.test.ts`

Expected: PASS — 0→N 원자 전환, 동일 email 암호화 경로, 최대 20, 자동 생성 재호출 거부, 실제 add의 `isTest=false` 보존.

- [ ] **Step 8: 커밋**

```bash
git add src/lib/contacts src/features/contacts tests/unit/contacts/test-contact-data.test.ts tests/integration/test-contact-generation.test.ts
git commit -m "feat: 테스트 대상자 생성과 전용 컬럼 추가"
```

---

### Task 5: 대상자 CRUD 범위 가드와 업로드 3중 차단

**Files:**
- Modify: `src/features/contacts/server/services/contact-targets.service.ts`
- Modify: `src/features/contacts/server/services/contact-columns.service.ts`
- Modify: `src/features/contacts/server/services/contact-uploads.service.ts`
- Modify: `src/features/contacts/server/services/contact-attempts.service.ts`
- Modify: `src/features/contacts/server/services/contact-attrs.service.ts`
- Create: `src/components/operations/contacts/contact-upload-action.tsx`
- Modify: `src/app/admin/surveys/[id]/operations/contacts/page.tsx`
- Modify: `src/app/admin/surveys/[id]/operations/contacts/upload/page.tsx`
- Modify: `src/app/admin/surveys/[id]/operations/contacts/upload/new/page.tsx`
- Modify: `src/components/operations/operations-page-header.tsx`
- Modify: `src/components/operations/contacts/contact-detail-form.tsx`
- Modify: `tests/integration/test-contact-generation.test.ts`

**Interfaces:**
- Consumes: `loadOperationsDataScope`, `prepareContactInsertScope`, scoped contact scheme.
- Produces: update/remove/attempt/attrs lookup가 현재 전역 범위와 target `isTest` 불일치를 `NOT_FOUND`로 처리.
- Produces: `ContactUploadAction({ href,label,disabled })`.

- [ ] **Step 1: stale mode mutation과 직접 upload RPC 실패 테스트 추가**

```ts
it('테스트 모드에서 ingestContactUpload를 거부한다', async () => {
  mockSurveyMode(true);
  await expect(ingestContactUpload(validUploadInput)).rejects.toThrow('테스트 모드에서는 실제 조사대상자를 업로드할 수 없습니다.');
  expect(mockDeleteTargets).not.toHaveBeenCalled();
});

it('현재 범위와 다른 target update를 NOT_FOUND로 처리한다', async () => {
  mockSurveyMode(true);
  mockTarget({ isTest: false });
  await expect(updateContactTarget(updateInput)).rejects.toThrow('NOT_FOUND');
});
```

- [ ] **Step 2: 현재 서비스가 실제 행을 수정하거나 업로드를 시작해 실패 확인**

Run: `pnpm exec vitest run tests/integration/test-contact-generation.test.ts tests/integration/contacts-scope-guard.test.ts`

Expected: FAIL — `is_test` 조건과 test mode upload guard가 없다.

- [ ] **Step 3: contact mutation에 DB 모드 재검증 추가**

update/remove/attempt는 transaction에서 survey row를 읽고 다음 공통 조건으로 행을 잠근다.

```ts
const scope = await loadOperationsDataScope(input.surveyId);
const expectedIsTest = testFlagForScope(scope);
const [target] = await tx.select({ id: contactTargets.id, isTest: contactTargets.isTest })
  .from(contactTargets)
  .where(and(eq(contactTargets.id, input.id), eq(contactTargets.surveyId, input.surveyId), eq(contactTargets.isTest, expectedIsTest)))
  .for('update');
if (!target) throw new Error('NOT_FOUND');
```

column update는 mode를 다시 읽어 `scope==='test' ? { testContactColumns: scheme } : { contactColumns: scheme }`을 저장한다. `getExistingContactsCount`는 `(surveyId,scope)`를 받아 해당 target만 센다.

- [ ] **Step 4: 업로드 service fail-closed 가드 추가**

`ingestContactUpload`에서 파일 전체 parse보다 먼저 다음 검사를 수행하고 실제 대상자 삭제 SQL에 `isTest=false`를 명시한다.

```ts
const scope = await loadOperationsDataScope(input.surveyId);
if (scope === 'test') {
  throw new Error('테스트 모드에서는 실제 조사대상자를 업로드할 수 없습니다.');
}
// replacement delete도 방어적으로 실제 행만
await tx.delete(contactTargets).where(and(eq(contactTargets.surveyId, surveyId), eq(contactTargets.isTest, false)));
```

- [ ] **Step 5: focus 가능한 disabled 업로드 액션 구현**

```tsx
export function ContactUploadAction({ href, label, disabled }: { href: string; label: string; disabled: boolean }) {
  if (!disabled) return <Button asChild variant="outline" size="sm"><Link href={href}>{label}</Link></Button>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} aria-disabled="true"><Button type="button" variant="outline" size="sm" disabled>{label}</Button></span>
      </TooltipTrigger>
      <TooltipContent>테스트 모드에서는 실제 조사대상자를 업로드할 수 없습니다.</TooltipContent>
    </Tooltip>
  );
}
```

상단 `조사 대상 업로드`, 목록 `엑셀 업로드`·`+ 업로드`, 업로드 이력 `새 업로드`를 이 컴포넌트로 교체하고 `+ 조사 대상 추가`는 그대로 둔다.

- [ ] **Step 6: 직접 upload/new 라우트 차단**

```tsx
const scope = await getOperationsDataScope(surveyId);
if (scope === 'test') {
  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <Card><CardContent className="p-6 text-sm text-slate-700">테스트 모드에서는 실제 조사대상자를 업로드할 수 없습니다.</CardContent></Card>
    </main>
  );
}
```

업로드 이력 page는 test scope에서 실제 이력을 렌더하지 않고 동일 안내와 disabled 액션만 보인다.

- [ ] **Step 7: 테스트·접근성 확인**

Run: `pnpm exec vitest run tests/integration/test-contact-generation.test.ts tests/integration/contacts-scope-guard.test.ts && pnpm exec tsc --noEmit`

Expected: PASS — UI 우회와 직접 RPC가 모두 차단되고 실제 mode 업로드 회귀는 통과.

- [ ] **Step 8: 커밋**

```bash
git add src/features/contacts src/components/operations/contacts src/components/operations/operations-page-header.tsx src/app/admin/surveys/[id]/operations/contacts tests/integration/test-contact-generation.test.ts
git commit -m "feat: 테스트 대상자 CRUD 범위와 업로드 차단 추가"
```

---

### Task 6: 실제·익명 테스트·대상자 테스트 링크 판정

**Files:**
- Modify: `src/lib/duplicate-detection/invite-lookup.ts`
- Modify: `src/lib/duplicate-detection/check.ts`
- Modify: `src/lib/duplicate-detection/types.ts`
- Modify: `src/features/survey-response/domain/duplicate.ts`
- Modify: `src/features/contacts/server/services/contact-invite.service.ts`
- Modify: `src/features/contacts/server/services/contact-attrs.service.ts`
- Modify: `src/features/survey-builder/domain/survey-read.ts`
- Modify: `src/features/survey-builder/server/services/survey-read.service.ts`
- Modify: `src/app/i/[code]/page.tsx`
- Modify: `src/components/survey-response/hooks/use-survey-loader.ts`
- Modify: `src/components/survey-response/survey-response-screens.tsx`
- Modify: `tests/unit/contacts/invite-resolve.test.ts`
- Modify: `tests/unit/duplicate-detection/invite-lookup.test.ts`
- Modify: `src/features/survey-builder/server/services/survey-read.service.test.ts`
- Create: `tests/integration/test-target-response-lifecycle.test.ts`

**Interfaces:**
- Produces: `InviteTokenLookupResult` valid branch의 `isTest: boolean`; 새 branch `{ kind:'invalid_test' }`.
- Produces: `ResolvedInvite = { kind:'valid'; accessIdentifier; inviteToken } | { kind:'invalid_test' }`.
- Produces: `SurveyControl.testSessionKind: 'anonymous' | 'target' | null`.
- `SurveyForResponseInput`은 `inviteToken` optional을 추가한다.

- [ ] **Step 1: OFF·삭제·익명 병행 차단 테스트 작성**

```ts
it('OFF인 테스트 대상자 토큰은 invalid_test이고 익명으로 폴백하지 않는다', async () => {
  mockLookupId(TEST_TARGET_ID);
  mockTarget({ isTest: true, testModeEnabled: false });
  expect(await findContactByInviteToken(SURVEY_ID, TOKEN)).toEqual({ kind: 'invalid_test' });
});

it('테스트 대상자가 있으면 유효한 익명 testToken도 invalid로 판정한다', async () => {
  mockSurvey({ testModeEnabled: true, testToken: 'token' });
  mockTestTargetCount(1);
  const result = await getSurveyForResponse({ surveyId: SURVEY_ID, testToken: 'token' });
  expect(result?.control).toMatchObject({ testSession: 'invalid', testSessionKind: null });
});

it('inviteToken과 testToken을 섞으면 대상 종류와 무관하게 invalid로 판정한다', async () => {
  const result = await getSurveyForResponse({ surveyId: SURVEY_ID, inviteToken: TOKEN, testToken: 'anonymous-test' });
  expect(result?.control).toMatchObject({ testSession: 'invalid', testSessionKind: null });
});
```

- [ ] **Step 2: 기존 fallback 때문에 실패 확인**

Run: `pnpm exec vitest run tests/unit/contacts/invite-resolve.test.ts tests/unit/duplicate-detection/invite-lookup.test.ts src/features/survey-builder/server/services/survey-read.service.test.ts tests/integration/test-target-response-lifecycle.test.ts`

Expected: FAIL — test target/off 상태와 익명 target count를 구분하지 않는다.

- [ ] **Step 3: invite lookup을 fail-closed로 확장**

```ts
export type InviteTokenLookupResult =
  | { kind: 'valid'; contactTargetId: string; respondedAt: Date | null; isTest: boolean }
  | { kind: 'excluded' }
  | { kind: 'invalid_test' }
  | { kind: 'invalid' };
```

security definer 함수로 id를 얻은 뒤 `contactTargets`와 `surveys`를 조회한다. `row.isTest && !row.testModeEnabled`면 `invalid_test`, test target이면 unsubscribe·부정 결과·respondedAt 차단을 우회하고 valid를 반환한다. `checkTrackA`는 `invalid_test_token`으로 매핑하고 valid 결과에 `isTestTarget?: boolean`을 포함한다.

- [ ] **Step 4: `/i/{code}`와 attrs lookup을 구분**

```ts
export type ResolvedInvite =
  | { kind: 'valid'; accessIdentifier: string; inviteToken: string }
  | { kind: 'invalid_test' };
```

`ShortInvitePage`는 `invalid_test`일 때 `InvalidTestLinkScreen`, `null`일 때 `InvalidInviteLinkScreen`을 렌더한다. 둘 다 `SurveyResponseFlow`를 마운트하지 않으므로 삭제된 test code도 익명·실설문으로 폴백하지 않는다. 테스트 대상자 attrs lookup도 `invalid_test`를 null로 익명 강등하지 않고 `INVALID_TEST_LINK` 오류로 종료한다.

```tsx
if (!resolved) return <InvalidInviteLinkScreen />;
if (resolved.kind === 'invalid_test') return <InvalidTestLinkScreen />;
return <SurveyResponseFlow surveyIdentifier={resolved.accessIdentifier} inviteToken={resolved.inviteToken} testToken={null} />;
```

- [ ] **Step 5: public survey control에 세션 종류 추가**

```ts
export type SurveyControl = {
  isPaused: boolean;
  pausedMessage: string | null;
  testSession: 'none' | 'valid' | 'invalid';
  testSessionKind: 'anonymous' | 'target' | null;
};

export const SurveyForResponseInput = SurveyIdInput.extend({
  testToken: z.string().optional(),
  inviteToken: z.string().optional(),
});
```

`inviteToken`과 `testToken`이 함께 오면 먼저 `{invalid,null}`로 거부한다. 그 외 서버 판정 순서는 `inviteToken`의 test target → 익명 `testToken` → none이다. test target은 ON일 때 `{valid,target}`, OFF면 `{invalid,null}`. 익명 토큰은 ON·토큰 일치·test target count 0을 모두 만족할 때 `{valid,anonymous}`다. loader는 `forResponse`에 inviteToken도 전달하고 create/resume 서비스도 두 토큰 혼합을 `invalid_test_token`으로 거부한다.

- [ ] **Step 6: 테스트 통과 확인**

Run: `pnpm exec vitest run tests/unit/contacts/invite-resolve.test.ts tests/unit/duplicate-detection/invite-lookup.test.ts src/features/survey-builder/server/services/survey-read.service.test.ts tests/integration/test-target-response-lifecycle.test.ts`

Expected: PASS — 실제 invite 기존 정책 유지, 테스트 target OFF/삭제 fail-closed, target 존재 중 익명 차단.

- [ ] **Step 7: 커밋**

```bash
git add src/lib/duplicate-detection src/features/contacts src/features/survey-builder src/app/i/[code]/page.tsx src/components/survey-response/hooks/use-survey-loader.ts src/components/survey-response/survey-response-screens.tsx tests
git commit -m "feat: 대상자 테스트 초대 링크를 서버에서 판정"
```

---

### Task 7: 대상자별 응답 한 행과 attempt 소유권 backend

**Files:**
- Create: `src/lib/survey-response/test-target-attempt.server.ts`
- Modify: `src/features/survey-response/domain/response.ts`
- Modify: `src/features/survey-response/domain/lifecycle.ts`
- Modify: `src/features/survey-response/server/services/response.service.ts`
- Modify: `src/features/survey-response/server/services/lifecycle.service.ts`
- Modify: `src/features/survey-response/server/services/duplicate.service.ts`
- Modify: `src/app/api/response/segment/route.ts`
- Modify: `tests/integration/test-target-response-lifecycle.test.ts`
- Modify: `tests/integration/response-availability-gate.test.ts`
- Modify: `tests/integration/response-segment.test.ts`

**Interfaces:**
- Produces: `TestAttemptIdentity = { attemptId:string; sessionId:string }`.
- Produces: `acquireTestTargetResponse(tx,input): Promise<{ responseId:string; reset:boolean }>`.
- Produces: `assertTestTargetAttemptOwner(tx,{ responseId, attemptId, sessionId }): Promise<void>`.
- Produces: `assertTestResponseWritable(tx,response)`가 OFF와 익명/대상자 혼합 전환 뒤의 stale 저장을 막는다.
- `ResumeOrCreateResponseOutput`의 target-test `in_progress` 결과는 `questionResponses`를 포함해 재진입 화면을 복원한다.
- 모든 answer/lifecycle/complete input은 optional `attemptId`, `sessionId`를 받고 대상자 테스트 행에서만 필수로 검증한다.

- [ ] **Step 1: terminal·이전 버전 초기화와 소유권 실패 테스트 확장**

```ts
it('terminal 테스트 응답은 GET으로 바뀌지 않고 첫 입력에서 같은 id를 초기화한다', async () => {
  mockExistingTargetResponse({ id: RESPONSE_ID, status: 'completed', versionId: OLD_VERSION, questionResponses: { q1: 'old' } });
  expect(await resumeOrCreateResponse(targetResumeInput)).toBeNull();
  expect(mockUpdateResponse).not.toHaveBeenCalled();
  const result = await createResponseWithFirstAnswer({ ...targetCreateInput, attemptId: ATTEMPT_ID });
  expect(result).toMatchObject({ kind: 'created', id: RESPONSE_ID });
  expect(mockReset).toHaveBeenCalledWith(expect.objectContaining({ versionId: CURRENT_VERSION }));
});

it('superseded attempt의 후속 저장을 차단한다', async () => {
  mockAttempt({ status: 'superseded', sessionId: 'old' });
  await expect(updateQuestionResponse({ responseId: RESPONSE_ID, questionId: Q1, value: 'x', attemptId: OLD_ATTEMPT, sessionId: 'old' }))
    .rejects.toThrow('테스트 세션이 다른 화면에서 시작되었습니다');
});

it('OFF 뒤 열린 테스트 응답의 answer와 complete를 모두 차단한다', async () => {
  mockSurveyMode(false);
  await expect(updateQuestionResponse(testUpdateInput)).rejects.toThrow('테스트 링크가 더 이상 유효하지 않습니다');
  await expect(completeResponse(testCompleteInput)).rejects.toThrow('테스트 링크가 더 이상 유효하지 않습니다');
});
```

- [ ] **Step 2: 기존 terminal 새 행·무소유권 동작으로 실패 확인**

Run: `pnpm exec vitest run tests/integration/test-target-response-lifecycle.test.ts tests/integration/response-availability-gate.test.ts tests/integration/response-segment.test.ts`

Expected: FAIL — terminal 응답을 재사용하지 않고 responseId만으로 저장 가능하다.

- [ ] **Step 3: attempt domain 필드 추가**

```ts
export const TestAttemptIdentityFields = {
  attemptId: z.string().uuid().optional(),
  sessionId: z.string().optional(),
} as const;

const CompleteResponseData = z.object({
  questionResponses: QuestionResponsesSchema.optional(),
  exposedQuestionIds: z.array(z.string()).optional(),
  exposedRowIds: z.array(z.string()).optional(),
});
export const UpdateQuestionResponseInput = z.object({ responseId: z.string(), questionId: z.string(), value: z.unknown(), ...TestAttemptIdentityFields });
export const CompleteResponseInput = z.object({ responseId: z.string(), data: CompleteResponseData.optional(), ...TestAttemptIdentityFields });
export const RecordStepVisitInput = z.object({ responseId: z.string(), nextStepId: z.string(), visibleStepIndex: z.number().int().nullish(), visibleStepTotal: z.number().int().nullish(), ...TestAttemptIdentityFields });
export const RecordVisibilitySegmentInput = z.object({ responseId: z.string(), action: z.enum(['hide','show']), ...TestAttemptIdentityFields });
```

createWithFirstAnswer/createBlank에도 `attemptId`를 추가하고 resume output object에는 `questionResponses: QuestionResponsesSchema.optional()`을 추가한다.

- [ ] **Step 4: 응답 행 잠금·초기화·attempt 인수 helper 구현**

```ts
export async function acquireTestTargetResponse(tx: DbTransaction, input: AcquireInput) {
  const [liveTarget] = await tx.select({ id: contactTargets.id }).from(contactTargets)
    .innerJoin(surveys, eq(contactTargets.surveyId, surveys.id))
    .where(and(eq(contactTargets.id, input.contactTargetId), eq(contactTargets.surveyId, input.surveyId), eq(contactTargets.isTest, true), eq(surveys.testModeEnabled, true)))
    .for('share');
  if (!liveTarget) throw new Error('테스트 링크가 더 이상 유효하지 않습니다');
  const existing = await tx.select().from(surveyResponses)
    .where(and(eq(surveyResponses.contactTargetId, input.contactTargetId), eq(surveyResponses.isTest, true), isNull(surveyResponses.deletedAt)))
    .for('update').limit(1).then((rows) => rows[0]);
  const response = existing ?? await insertEmptyTestTargetResponse(tx, input);
  const priorAttempt = await tx.select().from(testResponseAttempts).where(eq(testResponseAttempts.id, input.attemptId)).limit(1).then((rows) => rows[0]);
  if (priorAttempt && (priorAttempt.status === 'superseded' || priorAttempt.responseId !== response.id)) {
    throw new Error('테스트 세션이 다른 화면에서 시작되었습니다');
  }
  const reset = response.status !== 'in_progress' || response.versionId !== input.versionId;
  if (reset) {
    if (priorAttempt) throw new Error('새로 연 테스트 화면에서 다시 입력해주세요');
    await resetTestTargetResponse(tx, response.id, input);
  }
  await tx.update(testResponseAttempts).set({ status: 'superseded', supersededAt: new Date() })
    .where(and(eq(testResponseAttempts.responseId, response.id), eq(testResponseAttempts.status, 'active'), ne(testResponseAttempts.id, input.attemptId)));
  if (!priorAttempt) await tx.insert(testResponseAttempts).values({ id: input.attemptId, responseId: response.id, sessionId: input.sessionId, status: 'active' });
  await tx.update(surveyResponses).set({ sessionId: input.sessionId }).where(eq(surveyResponses.id, response.id));
  await tx.update(contactTargets).set({ responseId: response.id, ...(reset ? { respondedAt: null } : {}) }).where(eq(contactTargets.id, input.contactTargetId));
  return { responseId: response.id, reset };
}
```

`resetTestTargetResponse`는 `questionResponses:{}`, `isCompleted:false`, `status:'in_progress'`, `completedAt:null`, `startedAt/lastActivityAt:new Date()`, `versionId`, `currentStepId`, `pageVisits:[]`, `totalSeconds:null`, `progressPct:null`, `visibleStepIndex/Total:null`, 중복 신호와 metadata를 새 시도 값으로 되돌리고 `response_answers`, `response_edit_logs`를 삭제한다. 기존 attempt 행은 삭제하지 않고 위 인수 단계에서 `superseded`로 남겨 같은 attempt ID의 재인수를 영구 차단한다.

- [ ] **Step 5: 첫 입력과 답 없는 제출을 target 재사용 경로로 연결**

`createResponseWithFirstAnswer`와 `createBlankResponse`는 `checkTrackA`의 `isTestTarget`을 읽는다. target test면 익명 testToken을 요구하지 않고 중복·availability·quota를 우회하며 `acquireTestTargetResponse` 결과 id에 첫 답/complete를 적용한다. 익명 test는 transaction에서 survey row를 `FOR SHARE`로 잠근 뒤 `testModeEnabled=true`, token 일치, test target count 0을 서버에서 다시 확인하고 기존 신규 insert 경로를 유지한다. 이 잠금은 첫 target 생성의 `FOR UPDATE`와 직렬화된다.

```ts
if (trackA && !trackA.blocked && trackA.isTestTarget) {
  if (!input.attemptId || !trackA.contactTargetId) return { kind: 'blocked', reason: 'invalid_test_token' };
  const acquired = await db.transaction((tx) => acquireTestTargetResponse(tx, {
    surveyId, contactTargetId: trackA.contactTargetId, sessionId, attemptId: input.attemptId, versionId, currentStepId,
  }));
  await updateQuestionResponse({ responseId: acquired.responseId, questionId, value: storedValue, attemptId: input.attemptId, sessionId });
  return { kind: 'created', id: acquired.responseId, contactTargetId: trackA.contactTargetId };
}
```

- [ ] **Step 6: 모든 후속 mutation에서 행 잠금 후 owner 검증**

`updateQuestionResponse`, `recordStepVisit`, `recordVisibilitySegment`, `completeResponse`는 transaction 안에서 response row를 `FOR UPDATE`하고 `isTest && contactTargetId!=null`일 때 다음 helper를 호출한다.

```ts
export async function assertTestResponseWritable(tx: DbTransaction, response: { surveyId: string; isTest: boolean; contactTargetId: string | null }) {
  if (!response.isTest) return;
  const [survey] = await tx.select({ enabled: surveys.testModeEnabled }).from(surveys)
    .where(eq(surveys.id, response.surveyId)).for('share');
  if (!survey?.enabled) throw new Error('테스트 링크가 더 이상 유효하지 않습니다');
  if (response.contactTargetId == null) {
    const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(contactTargets)
      .where(and(eq(contactTargets.surveyId, response.surveyId), eq(contactTargets.isTest, true)));
    if (total > 0) throw new Error('테스트 링크가 더 이상 유효하지 않습니다');
  } else {
    const [target] = await tx.select({ id: contactTargets.id }).from(contactTargets)
      .where(and(eq(contactTargets.id, response.contactTargetId), eq(contactTargets.surveyId, response.surveyId), eq(contactTargets.isTest, true)));
    if (!target) throw new Error('테스트 링크가 더 이상 유효하지 않습니다');
  }
}
```

각 mutation은 owner 검증보다 먼저 `assertTestResponseWritable`을 호출한다.

```ts
export async function assertTestTargetAttemptOwner(tx: DbTransaction, input: TestAttemptIdentity & { responseId: string }) {
  if (!input.attemptId || !input.sessionId) throw new Error('테스트 세션이 다른 화면에서 시작되었습니다');
  const [active] = await tx.select({ id: testResponseAttempts.id }).from(testResponseAttempts)
    .where(and(eq(testResponseAttempts.id, input.attemptId), eq(testResponseAttempts.responseId, input.responseId), eq(testResponseAttempts.sessionId, input.sessionId), eq(testResponseAttempts.status, 'active')));
  if (!active) throw new Error('테스트 세션이 다른 화면에서 시작되었습니다');
}
```

segment REST body도 optional attempt/session 형식을 검증해 service에 전달한다.

- [ ] **Step 7: availability와 resume 정책 반영**

`assertSurveyAcceptingResponses`는 `opts.isTest`일 때 status·pause·endDate·maxResponses·invite requirement를 모두 건너뛴다. target resume는 같은 version의 `in_progress`만 반환하고 terminal 또는 이전 version `in_progress`는 DB를 touch하지 않고 `null`을 반환한다. 같은 version 결과에는 읽은 `questionResponses`를 포함한다. 익명 resume 동작은 그대로 둔다.

```ts
return {
  id: existingByContact.id,
  status: 'in_progress',
  resumed: existingByContact.status === 'drop',
  questionResponses: existingByContact.questionResponses,
};
```

- [ ] **Step 8: backend 테스트 통과 확인**

Run: `pnpm exec vitest run tests/integration/test-target-response-lifecycle.test.ts tests/integration/response-availability-gate.test.ts tests/integration/response-segment.test.ts tests/integration/complete-response-membership-guard.test.ts`

Expected: PASS — 한 target 한 row, GET 무변경, 첫 입력 reset, owner 상실 차단, 익명 누적 회귀 통과.

- [ ] **Step 9: 커밋**

```bash
git add src/lib/survey-response src/features/survey-response src/app/api/response/segment/route.ts tests/integration/test-target-response-lifecycle.test.ts tests/integration/response-availability-gate.test.ts tests/integration/response-segment.test.ts
git commit -m "feat: 대상자 테스트 응답 재사용과 세션 소유권 추가"
```

---

### Task 8: 응답 클라이언트 attempt 전달과 빈 화면 정책

**Files:**
- Modify: `src/components/survey-response/survey-response-flow.tsx`
- Modify: `src/components/survey-response/hooks/use-response-lifecycle.ts`
- Modify: `src/components/survey-response/hooks/use-session-recovery.ts`
- Modify: `src/components/survey-response/hooks/use-response-telemetry.ts`
- Modify: `src/components/survey-response/hooks/session-helpers.ts`
- Modify: `src/components/survey-response/hooks/use-duplicate-guard.ts`
- Modify: `src/components/survey-response/survey-response-screens.tsx`
- Modify: `tests/unit/use-response-lifecycle.test.tsx`
- Create: `tests/unit/survey-response/target-test-session.test.tsx`

**Interfaces:**
- Consumes: `control.testSessionKind`, optional attempt identity fields from Task 7.
- Produces: flow mount마다 `attemptId=crypto.randomUUID()` 한 개.
- Produces: `hasTestAttemptOwnership`이 첫 실제 입력 성공 뒤에만 true가 되어 telemetry를 연다.
- Produces: `sessionStorageKey(surveyId, inviteToken?)`로 대상자별 세션 격리.
- Produces: `sendVisibilitySegment(responseId, action, identity?, useBeacon?)`.

- [ ] **Step 1: attempt 전달 실패 테스트 작성**

```tsx
it('target test 첫 답변과 후속 telemetry에 같은 attemptId와 sessionId를 보낸다', async () => {
  mockControl({ testSession: 'valid', testSessionKind: 'target' });
  render(<SurveyResponseFlow surveyIdentifier="survey" inviteToken={INVITE} testToken={null} />);
  await answerFirstQuestion('응답');
  const create = vi.mocked(client.surveyResponse.response.createWithFirstAnswer).mock.calls[0]![0];
  expect(create.attemptId).toMatch(UUID_RE);
  expect(create.sessionId).toBeTruthy();
  expect(vi.mocked(client.surveyResponse.lifecycle.stepVisit).mock.calls.at(-1)?.[0])
    .toMatchObject({ attemptId: create.attemptId, sessionId: create.sessionId });
});

it('같은 버전 in_progress는 답을 읽어오되 첫 새 입력 전에는 telemetry를 쓰지 않는다', async () => {
  mockTargetResume({ id: RESPONSE_ID, status: 'in_progress', resumed: false, questionResponses: { [Q1]: '기존 답' } });
  render(<SurveyResponseFlow surveyIdentifier="survey" inviteToken={INVITE} testToken={null} />);
  expect(await screen.findByDisplayValue('기존 답')).toBeInTheDocument();
  expect(client.surveyResponse.lifecycle.stepVisit).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText('두 번째 질문'), '새 입력');
  expect(client.surveyResponse.response.createWithFirstAnswer).toHaveBeenCalledWith(expect.objectContaining({ attemptId: expect.any(String) }));
});
```

- [ ] **Step 2: 기존 client payload에 attempt가 없어 실패 확인**

Run: `pnpm exec vitest run tests/unit/survey-response/target-test-session.test.tsx tests/unit/use-response-lifecycle.test.tsx`

Expected: FAIL — attemptId가 undefined.

- [ ] **Step 3: flow에서 세션 종류와 attempt를 생성**

```tsx
const isTestSession = control?.testSession === 'valid';
const isTargetTestSession = isTestSession && control?.testSessionKind === 'target';
const [testAttemptId] = useState(() => crypto.randomUUID());
const [hasTestAttemptOwnership, setHasTestAttemptOwnership] = useState(false);
const testIdentity = isTargetTestSession ? { attemptId: testAttemptId, sessionId } : null;
```

이 값을 lifecycle/recovery/telemetry hook에 전달한다. target test telemetry는 `hasTestAttemptOwnership`이 true일 때만 등록한다. 응답자 화면에는 test badge나 별도 문구를 추가하지 않는다.

- [ ] **Step 4: create·complete·telemetry payload 전달**

```ts
const attemptFields = isTargetTestSession ? { attemptId: testAttemptId, sessionId } : {};
const created = await client.surveyResponse.response.createWithFirstAnswer({ ...baseInput, ...attemptFields });
if (isTargetTestSession && created.kind === 'created') setHasTestAttemptOwnership(true);
const blank = await client.surveyResponse.response.createBlank({ ...baseInput, ...attemptFields });
if (isTargetTestSession && blank.kind === 'created') setHasTestAttemptOwnership(true);
await client.surveyResponse.response.complete({ responseId, data, ...attemptFields });
await client.surveyResponse.lifecycle.stepVisit({ responseId, nextStepId, ...progress, ...attemptFields });
```

`useResponseTelemetry`에 `enabled` prop을 추가하고 두 effect의 첫 가드를 다음처럼 둔다.

```ts
const telemetryEnabled = !isTargetTestSession || hasTestAttemptOwnership;
useResponseTelemetry({
  enabled: telemetryEnabled,
  isAdminEdit,
  isPreview,
  currentResponseId,
  currentStep,
  isCompleted,
  visibleProgressRef,
  testIdentity,
});

// 각 telemetry effect
if (!enabled || isAdminEdit || isPreview || currentResponseId === null) return;
```

visibility helper는 다음 payload를 사용한다.

```ts
export function sendVisibilitySegment(responseId: string, action: 'hide'|'show', identity: TestAttemptIdentity | null = null, useBeacon = false) {
  const payload = JSON.stringify({ responseId, action, ...(identity ?? {}) });
  if (useBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
    navigator.sendBeacon('/api/response/segment', new Blob([payload], { type: 'application/json' }));
    return;
  }
  fetch('/api/response/segment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  }).catch(() => {});
}
```

- [ ] **Step 5: 대상자별 localStorage key와 terminal 빈 화면 유지**

```ts
export function sessionStorageKey(surveyId: string, inviteToken?: string | null): string {
  return inviteToken ? `survey-session:${surveyId}:invite:${inviteToken}` : `survey-session:${surveyId}`;
}
```

recovery는 target test면 localStorage key가 없어도 현재 `sessionId`로 resume RPC를 호출한다. 같은 version `in_progress` 결과의 `questionResponses`를 `setResponses`로 복원하고 `currentResponseId`는 설정하되 ownership은 얻지 않는다. `handleResponse`는 target test에서 ownership이 아직 없으면 `currentResponseId` 존재 여부와 무관하게 `createWithFirstAnswer`를 호출해 첫 실제 입력과 attempt 인수를 함께 처리한다. terminal/old-version 결과가 null이면 key만 제거하고 빈 화면을 유지한다. `InvalidTestLinkScreen`을 받은 stale 저장 오류는 local key와 response store를 지우고 종료 화면으로 전환한다. `다시 테스트하기` 버튼을 렌더하지 않는다.

```ts
const recoverySessionId = savedSessionId ?? (isTargetTestSession ? sessionId : null);
if (!recoverySessionId) return;
const result = await client.surveyResponse.lifecycle.resume({ surveyId: loadedSurvey.id, sessionId: recoverySessionId, inviteToken: inviteToken ?? undefined });
if (result?.status === 'in_progress') {
  setCurrentResponseId(result.id);
  setResponses(result.questionResponses ?? {});
}
```

- [ ] **Step 6: client 테스트 통과 확인**

Run: `pnpm exec vitest run tests/unit/survey-response/target-test-session.test.tsx tests/unit/use-response-lifecycle.test.tsx tests/integration/response-segment.test.ts`

Expected: PASS — 같은 attempt identity가 모든 저장 경로에 전달되고 실제/익명 payload는 변경되지 않는다.

- [ ] **Step 7: 커밋**

```bash
git add src/components/survey-response tests/unit/survey-response/target-test-session.test.tsx tests/unit/use-response-lifecycle.test.tsx
git commit -m "feat: 대상자 테스트 응답 attempt를 클라이언트에 연결"
```

---

### Task 9: 테스트 메일 후보·캠페인 생성 범위

**Files:**
- Create: `src/lib/mail/test-campaign.ts`
- Modify: `src/features/mail/server/services/mail-campaigns.service.ts`
- Modify: `src/features/mail/server/services/mail-preview.service.ts`
- Modify: `src/lib/operations/campaigns.server.ts`
- Modify: `src/components/operations/mail-campaign/campaigns-list.tsx`
- Modify: `src/components/operations/mail-campaign/campaign-wizard.tsx`
- Create: `tests/integration/test-mode-mail.test.ts`

**Interfaces:**
- Produces: `withTestPrefix(value, isTest): string`.
- `createCampaign`이 DB 전역 모드를 읽어 `isTest`를 결정하고 모든 selected target scope를 검증한다.
- 테스트 campaign의 title과 subject snapshot은 `[TEST] ` 접두어를 한 번만 가진다.

- [ ] **Step 1: 후보와 stale create 실패 테스트 작성**

```ts
it('테스트 모드 캠페인은 테스트 대상자만 받고 scope별 run number를 쓴다', async () => {
  mockSurveyMode(true);
  mockSelectedTargets([{ id: TEST_ID, isTest: true }]);
  await createCampaign(input, USER_ID);
  expect(mockSql).toHaveBeenCalledWith(expect.stringContaining('next_campaign_run_number'));
  expect(mockCampaignInsert).toHaveBeenCalledWith(expect.objectContaining({ isTest: true, title: '[TEST] 1차 안내', subjectSnapshot: '[TEST] 설문 참여' }));
});

it('작성 중 OFF로 바뀌면 실제 캠페인으로 강등하지 않고 거부한다', async () => {
  mockSurveyMode(false);
  mockSelectedTargets([{ id: TEST_ID, isTest: true }]);
  await expect(createCampaign(input, USER_ID)).rejects.toThrow('화면을 새로고침');
});
```

- [ ] **Step 2: 기존 service가 실제 scope로 생성해 실패 확인**

Run: `pnpm exec vitest run tests/integration/test-mode-mail.test.ts tests/integration/campaign-create-exclusion.test.ts`

Expected: FAIL — `isTest` 저장·scope 일치 검증·접두어가 없다.

- [ ] **Step 3: `[TEST]` helper 구현**

```ts
export function withTestPrefix(value: string, isTest: boolean): string {
  const trimmed = value.trim();
  if (!isTest || trimmed.startsWith('[TEST] ')) return trimmed;
  return `[TEST] ${trimmed}`;
}
```

- [ ] **Step 4: campaign service에서 current scope를 다시 읽고 잠금**

transaction 안에서 survey row를 `FOR SHARE`로 읽고 `isTest=testModeEnabled`를 결정한다. selected target query에 `eq(contactTargets.isTest,isTest)`를 넣고 `uniqueTargetIds.length`와 일치하지 않으면 stale/mixed 오류를 던진다.

```ts
const runRows = await tx.execute<{ next_id: number }>(sql`SELECT next_campaign_run_number(${input.surveyId},${isTest}) AS next_id`);
await tx.insert(mailCampaigns).values({
  surveyId: input.surveyId,
  isTest,
  mailTemplateId: template.id,
  runNumber: Number(runRows[0]?.next_id),
  title: withTestPrefix(input.title, isTest),
  subjectSnapshot: withTestPrefix(template.subject, isTest),
  bodyHtmlSnapshot: template.bodyHtml,
  fromLocalSnapshot: template.fromLocal,
  fromNameSnapshot: template.fromName,
  replyToSnapshot: template.replyTo,
  attachmentsSnapshot: template.attachments,
  filterSnapshot,
  createdBy: userId,
  status: 'queued',
});
```

- [ ] **Step 5: 후보·전체선택·preflight·preview가 mutation 시점 scope를 사용**

`fetchCandidateIds`, `previewPreflight`, `getMailPreviewSample`은 `loadOperationsDataScope(surveyId)`를 매 호출 실행하고 Task 3의 scoped adapter에 전달한다. 클라이언트가 scope를 보내는 필드는 추가하지 않는다. list UI는 `campaign.isTest`에 `테스트` badge를 붙이되 shared template에는 badge를 붙이지 않는다.

- [ ] **Step 6: 테스트 통과 확인**

Run: `pnpm exec vitest run tests/integration/test-mode-mail.test.ts tests/integration/campaign-candidate-filter.test.ts tests/integration/campaign-create-exclusion.test.ts src/features/mail/server/procedures/campaigns.test.ts`

Expected: PASS — 후보·선택·campaign 범위 일치, stale 거부, 실제 campaign 기존 제목과 run number 유지.

- [ ] **Step 7: 커밋**

```bash
git add src/lib/mail/test-campaign.ts src/features/mail src/lib/operations/campaigns.server.ts src/components/operations/mail-campaign tests/integration/test-mode-mail.test.ts
git commit -m "feat: 테스트 범위 메일 캠페인 생성 추가"
```

---

### Task 10: 테스트 메일 렌더와 chunk 취소 안전장치

**Files:**
- Modify: `src/lib/mail/template-wrapper.tsx`
- Modify: `src/lib/mail/campaign-dispatch.ts`
- Modify: `src/lib/mail/recipient-status-transition.ts`
- Modify: `src/lib/mail/campaign-reconcile.ts`
- Modify: `src/lib/inngest/functions/campaign-dispatcher.ts`
- Modify: `tests/integration/test-mode-mail.test.ts`
- Modify: `tests/integration/campaign-dispatch-finalize.test.ts`
- Modify: `tests/unit/mail/mail-wrapper-sanitize.test.ts`
- Modify: `tests/unit/mail/recipient-status-transition.test.ts`

**Interfaces:**
- Produces: `MailWrapper.testFooterKind?: 'template' | 'campaign' | null`.
- `dispatchCampaignChunk` 시작 시 active campaign을 재확인하고 실제 send 직전 queued recipient를 `sending`으로 인수한다.
- `sending -> sent|failed` 전이를 정식 counter 전이로 지원한다.

- [ ] **Step 1: 테스트 푸터·sandbox 수신거부·취소 chunk 실패 테스트 작성**

```ts
it('테스트 캠페인은 기능하는 invite와 sandbox unsubscribe를 렌더한다', async () => {
  mockCampaign({ isTest: true, subjectSnapshot: '[TEST] 설문', status: 'sending', archivedAt: null });
  await dispatchCampaignChunk(CAMPAIGN_ID, [RECIPIENT_ID]);
  expect(mockSend.mock.calls[0]?.[0].html).toContain(`/i/${INVITE_CODE}`);
  expect(mockSend.mock.calls[0]?.[0].html).toContain('/unsubscribe/__test__');
  expect(mockSend.mock.calls[0]?.[0].html).toContain('테스트 캠페인 메일');
});

it.each(['cancelled', 'completed'] as const)('%s 캠페인은 chunk에서 추가 발송하지 않는다', async (status) => {
  mockCampaign({ status, archivedAt: null });
  expect(await dispatchCampaignChunk(CAMPAIGN_ID, [RECIPIENT_ID])).toEqual({ sent: 0, failed: 0 });
  expect(mockSend).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 기존 일반 footer와 queued 직접 전이로 실패 확인**

Run: `pnpm exec vitest run tests/integration/test-mode-mail.test.ts tests/integration/campaign-dispatch-finalize.test.ts tests/unit/mail/mail-wrapper-sanitize.test.ts tests/unit/mail/recipient-status-transition.test.ts`

Expected: FAIL — campaign footer·sandbox 링크·chunk status guard·sending 전이가 없다.

- [ ] **Step 3: footer 종류를 명시적으로 분리**

```tsx
type TestFooterKind = 'template' | 'campaign' | null;

interface Props {
  bodyHtml: string;
  previewText?: string;
  testFooterKind?: TestFooterKind;
  unsubscribeUrl: string | null;
}

const footerCopy: Record<Exclude<TestFooterKind, null>, string> = {
  template: '이 메일은 템플릿 테스트 발송입니다. 본문 내 설문 링크는 미리보기용으로 비활성화되어 있습니다.',
  campaign: '이 메일은 테스트 캠페인 메일입니다. 설문 초대 링크는 테스트 응답으로 기록됩니다.',
};

{testFooterKind ? (
  <Section style={footer}>{footerCopy[testFooterKind]}</Section>
) : null}
```

기존 `showTestFooter` prop을 `testFooterKind`로 교체하고 위 JSX를 현재 unsubscribe footer 다음 위치에 넣는다. template test send는 `'template'`, 실제 campaign은 `null`, test campaign은 `'campaign'`을 전달한다.

- [ ] **Step 4: prepare와 각 chunk가 campaign 취소·archive를 재확인**

```ts
function canDispatch(campaign: MailCampaign): boolean {
  return campaign.archivedAt == null && (campaign.status === 'queued' || campaign.status === 'sending');
}

if (!campaign || !canDispatch(campaign)) return null; // prepare
if (!campaign || !canDispatch(campaign)) return { sent: 0, failed: 0 }; // chunk
```

dispatcher loop도 각 `step.run` 결과가 `{ cancelled:true }`면 break하도록 반환 type을 확장한다.

- [ ] **Step 5: recipient를 external call 직전에 sending으로 인수**

activeRows의 id를 한 transaction에서 `queued -> sending`으로 바꾸고 returning된 행만 Resend에 보낸다. 결과 update 조건은 `status='sending'`이다.

```ts
const reserved = await db.update(mailRecipients).set({ status: 'sending', updatedAt: new Date() })
  .where(and(inArray(mailRecipients.id, activeRows.map((row) => row.recipientId)), eq(mailRecipients.status, 'queued'), isNull(mailRecipients.archivedAt)))
  .returning({ id: mailRecipients.id });
```

schema상 archive 행 때문에 `emailSnapshot`이 nullable이므로 inner join 뒤에도 발송 입력은 다음 type predicate로 좁힌다. null snapshot 행은 절대 Resend에 전달하지 않는다.

```ts
type DispatchRow = (typeof activeRows)[number];
const sendableRows = activeRows.filter(
  (row): row is DispatchRow & { emailSnapshot: string } =>
    row.emailSnapshot != null && reserved.some((reservedRow) => reservedRow.id === row.recipientId),
);
```

`STATUS_ALLOWED_PREV.sent`와 `failed`에 `sending`을 허용하고 counter SQL은 `prevStatus IN ('queued','sending')`이면 `queued_count`를 1 감소시킨다.

- [ ] **Step 6: test campaign URL 정책 적용**

```ts
const unsubscribeToken = campaign.isTest ? UNSUBSCRIBE_SANDBOX_TOKEN : row.unsubscribeToken;
const unsubscribeUrl = `${baseUrl}/unsubscribe/${unsubscribeToken}`;
const testFooterKind = campaign.isTest ? 'campaign' : null;
```

invite URL은 실제 `inviteCode`를 항상 사용한다. reconcile은 archived recipient도 message id로 계속 조정하되 cancelled/archived campaign에서 신규 send를 시작하지 않는다.

- [ ] **Step 7: 테스트 통과 확인**

Run: `pnpm exec vitest run tests/integration/test-mode-mail.test.ts tests/integration/campaign-dispatch-finalize.test.ts tests/integration/campaign-dispatch-unsubscribe.test.ts tests/unit/mail/mail-wrapper-sanitize.test.ts tests/unit/mail/recipient-status-transition.test.ts`

Expected: PASS — 취소 뒤 추가 발송 0, test/real footer와 unsubscribe 분리, sending counter 정합.

- [ ] **Step 8: 커밋**

```bash
git add src/lib/mail src/lib/inngest/functions/campaign-dispatcher.ts tests/integration/test-mode-mail.test.ts tests/integration/campaign-dispatch-finalize.test.ts tests/integration/campaign-dispatch-unsubscribe.test.ts tests/unit/mail
git commit -m "feat: 테스트 메일 발송과 취소 안전장치 추가"
```

---

### Task 11: 비식별 메일 보관과 개별 테스트 대상자 삭제

**Files:**
- Create: `src/lib/mail/test-mail-archive.server.ts`
- Modify: `src/features/contacts/server/services/contact-targets.service.ts`
- Modify: `src/lib/operations/contacts.server.ts`
- Modify: `src/lib/operations/campaigns.server.ts`
- Modify: `src/app/api/webhooks/resend/route.ts`
- Modify: `src/lib/mail/campaign-reconcile.ts`
- Modify: `src/lib/operations/mail-billing.server.ts`
- Modify: `src/components/operations/mail-cost/cycle-summary-table.tsx`
- Create: `tests/integration/test-workspace-lifecycle.test.ts`
- Modify: `tests/integration/recipient-transition-apply.test.ts`

**Interfaces:**
- Produces: `archiveTestMailForTargets(tx,targetIds)`.
- Produces: `archiveTestWorkspaceMail(tx,surveyId)`.
- Produces: `recalculateActiveCampaignCounters(tx,campaignIds)`.
- Billable/inflight statuses: `'sending' | 'sent' | 'delivered' | 'opened' | 'bounced' | 'complained'`.

- [ ] **Step 1: PII scrub·개별 삭제·정산 유지 실패 테스트 작성**

```ts
it('개별 테스트 target 삭제는 queued를 지우고 sent를 비식별 보관한다', async () => {
  seedRecipients([{ status: 'queued' }, { status: 'sent', emailSnapshot: 'qa@example.com', contactTargetId: TARGET_ID }]);
  await deleteContactTarget({ surveyId: SURVEY_ID, id: TARGET_ID });
  expect(rows()).toEqual([
    expect.objectContaining({ status: 'sent', emailSnapshot: null, inviteTokenSnapshot: null, contactTargetId: null, archivedAt: expect.any(Date), errorReason: null }),
  ]);
  expect(testResponseExists()).toBe(false);
});

it('archived recipient webhook은 상태를 계속 전이하고 미존재는 no-op한다', async () => {
  await processResendEvent(MESSAGE_ID, 'email.delivered', NOW);
  expect(recipientStatus()).toBe('delivered');
  await expect(processResendEvent('missing', 'email.delivered', NOW)).resolves.toBeUndefined();
});
```

- [ ] **Step 2: cascade 삭제 또는 PII 보존으로 실패 확인**

Run: `pnpm exec vitest run tests/integration/test-workspace-lifecycle.test.ts tests/integration/recipient-transition-apply.test.ts`

Expected: FAIL — sent recipient가 cascade 삭제되거나 snapshot PII가 남는다.

- [ ] **Step 3: 비식별 archive helper 구현**

```ts
export const RETAINED_TEST_RECIPIENT_STATUSES: readonly MailRecipientStatus[] = [
  'sending', 'sent', 'delivered', 'opened', 'bounced', 'complained',
];

export async function archiveTestMailForTargets(tx: DbTransaction, targetIds: string[]) {
  const affected = await tx.select({ id: mailRecipients.id, campaignId: mailRecipients.campaignId, status: mailRecipients.status })
    .from(mailRecipients).where(and(inArray(mailRecipients.contactTargetId, targetIds), isNull(mailRecipients.archivedAt)));
  const retained = affected.filter((row) => RETAINED_TEST_RECIPIENT_STATUSES.includes(row.status));
  const removed = affected.filter((row) => !RETAINED_TEST_RECIPIENT_STATUSES.includes(row.status));
  if (removed.length) await tx.delete(mailRecipients).where(inArray(mailRecipients.id, removed.map((row) => row.id)));
  if (retained.length) await tx.update(mailRecipients).set({ contactTargetId: null, emailSnapshot: null, inviteTokenSnapshot: null, errorReason: null, archivedAt: new Date() })
    .where(inArray(mailRecipients.id, retained.map((row) => row.id)));
  await recalculateActiveCampaignCounters(tx, [...new Set(affected.map((row) => row.campaignId))]);
}
```

활성 운영 카운터 재계산은 archived recipient를 제외하고 `sending`을 아직 미결인 queued count에 포함한다.

```ts
export async function recalculateActiveCampaignCounters(tx: DbTransaction, campaignIds: string[]) {
  for (const campaignId of campaignIds) {
    await tx.execute(sql`
      UPDATE mail_campaigns mc SET
        recipient_count = x.recipient_count,
        queued_count = x.queued_count,
        sent_count = x.sent_count,
        delivered_count = x.delivered_count,
        opened_count = x.opened_count,
        bounced_count = x.bounced_count,
        complained_count = x.complained_count,
        failed_count = x.failed_count,
        skipped_unsubscribed_count = x.skipped_count,
        updated_at = now()
      FROM (
        SELECT
          count(*)::int AS recipient_count,
          count(*) FILTER (WHERE status IN ('queued','sending'))::int AS queued_count,
          count(*) FILTER (WHERE status='sent')::int AS sent_count,
          count(*) FILTER (WHERE status='delivered')::int AS delivered_count,
          count(*) FILTER (WHERE status='opened')::int AS opened_count,
          count(*) FILTER (WHERE status='bounced')::int AS bounced_count,
          count(*) FILTER (WHERE status='complained')::int AS complained_count,
          count(*) FILTER (WHERE status='failed')::int AS failed_count,
          count(*) FILTER (WHERE status='skipped_unsubscribed')::int AS skipped_count
        FROM mail_recipients WHERE campaign_id=${campaignId}::uuid AND archived_at IS NULL
      ) x
      WHERE mc.id=${campaignId}::uuid
    `);
  }
}
```

workspace helper는 test campaign마다 미보존 recipient를 삭제하고 보존 recipient를 scrub한다. 보존 행이 없으면 campaign hard delete, 있으면 다음 값으로 scrub한다.

```ts
await tx.update(mailCampaigns).set({
  mailTemplateId: null,
  title: '삭제된 테스트 발송',
  subjectSnapshot: '',
  bodyHtmlSnapshot: '',
  fromLocalSnapshot: '',
  fromNameSnapshot: '',
  replyToSnapshot: null,
  attachmentsSnapshot: [],
  filterSnapshot: {},
  createdBy: null,
  status: 'cancelled',
  archivedAt: new Date(),
}).where(eq(mailCampaigns.id, campaignId));
```

- [ ] **Step 4: 개별 test target 삭제 순서 변경**

target row를 scope guard로 잠근 뒤 test target이면 `archiveTestMailForTargets` → 연결된 test response hard delete → target delete 순서로 처리한다. 실제 target은 FK가 `SET NULL`로 바뀐 뒤에도 이전 `CASCADE` 의미를 보존하도록 연결된 `mailRecipients`를 먼저 hard delete한 뒤 target을 삭제한다. 마지막 test target이어도 `surveys.testContactColumns`는 변경하지 않는다.

```ts
if (target.isTest) {
  await archiveTestMailForTargets(tx, [target.id]);
  await tx.delete(surveyResponses).where(and(eq(surveyResponses.contactTargetId, target.id), eq(surveyResponses.isTest, true)));
} else {
  await tx.delete(mailRecipients).where(eq(mailRecipients.contactTargetId, target.id));
}
await tx.delete(contactTargets).where(eq(contactTargets.id, target.id));
```

- [ ] **Step 5: 운영 query와 billing의 archive 정책 반영**

운영 contacts/campaign detail은 `archivedAt IS NULL`을 계속 적용한다. webhook과 reconcile은 `resendMessageId`가 있으면 archived row도 전이한다. billing은 active+archived recipient를 status 기준 한 번만 count하고 `CampaignCycleRow`에 다음 필드를 추가한다.

```ts
export interface CampaignCycleRow {
  campaignId: string;
  surveyId: string;
  surveyTitle: string;
  runNumber: number;
  title: string;
  status: MailCampaignStatus;
  startedAt: Date;
  completedAt: Date | null;
  billableCount: number;
  includedCount: number;
  overageCount: number;
  costKrw: number;
  averageUnitPriceKrw: number;
  isTest: boolean;
  archivedAt: Date | null;
}
```

정산 table은 `isTest`에 `테스트` 배지를 붙이고 archived title은 DB의 `삭제된 테스트 발송`만 표시하며 상세 링크를 만들지 않는다.

- [ ] **Step 6: 테스트 통과 확인**

Run: `pnpm exec vitest run tests/integration/test-workspace-lifecycle.test.ts tests/integration/recipient-transition-apply.test.ts tests/unit/mail/billing-allocator.test.ts`

Expected: PASS — 개별 삭제가 실제 행을 건드리지 않고 PII 없는 정산 사실·webhook 전이를 유지.

- [ ] **Step 7: 커밋**

```bash
git add src/lib/mail/test-mail-archive.server.ts src/features/contacts/server/services/contact-targets.service.ts src/lib/operations src/app/api/webhooks/resend/route.ts src/lib/mail/campaign-reconcile.ts src/components/operations/mail-cost tests/integration/test-workspace-lifecycle.test.ts tests/integration/recipient-transition-apply.test.ts
git commit -m "feat: 테스트 메일 비식별 보관과 대상자 삭제 추가"
```

---

### Task 12: 원자적 종료 서비스와 관리자 제어 UI

**Files:**
- Create: `src/features/operations/server/services/test-workspace.service.ts`
- Modify: `src/features/operations/server/services/control.service.ts`
- Modify: `src/features/operations/server/procedures/control.ts`
- Create: `src/components/operations/contacts/test-contact-generator-dialog.tsx`
- Modify: `src/components/operations/test-mode-control.tsx`
- Modify: `src/components/operations/survey-control-buttons.tsx`
- Modify: `src/app/admin/surveys/[id]/operations/layout.tsx`
- Modify: `src/app/admin/surveys/[id]/edit/page.tsx` (사용자 미커밋 변경을 보존한 채 control initial만 확장)
- Modify: `src/features/operations/server/procedures/control.test.ts`
- Modify: `src/features/operations/server/services/control.service.test.ts`
- Modify: `tests/integration/test-workspace-lifecycle.test.ts`
- Create: `tests/unit/operations/test-mode-control.test.tsx`

**Interfaces:**
- Produces: `disableTestWorkspace({ surveyId, disposition:'keep'|'delete' })`.
- `SurveyControlState`에 `testTargetCount`, `firstTestInviteCode` 추가.
- oRPC `control.disable`이 counts와 최종 상태를 반환하고 기존 `deleteTestResponses`를 제거한다.

- [ ] **Step 1: 보관·삭제·popup 상태 실패 테스트 작성**

```ts
it('보관 종료는 mode와 queued/sending campaign만 끄고 test data를 유지한다', async () => {
  const result = await disableTestWorkspace({ surveyId: SURVEY_ID, disposition: 'keep' });
  expect(result).toMatchObject({ testModeEnabled: false, deletedTargetCount: 0 });
  expect(testTargets()).toHaveLength(2);
  expect(testCampaign().status).toBe('cancelled');
});

it('대상자가 있으면 팝오버에 링크 복사와 끄기만 표시한다', async () => {
  renderControl({ testModeEnabled: true, testTargetCount: 1, firstTestInviteCode: 'abc' });
  await user.hover(screen.getByRole('button', { name: '테스트 모드' }));
  expect(screen.getByText('테스트 링크 복사')).toBeInTheDocument();
  expect(screen.queryByText('테스트 대상자 생성')).not.toBeInTheDocument();
  expect(screen.getByText('테스트 모드 끄기')).toBeInTheDocument();
});
```

- [ ] **Step 2: 기존 응답만 삭제하는 OFF 흐름으로 실패 확인**

Run: `pnpm exec vitest run tests/integration/test-workspace-lifecycle.test.ts tests/unit/operations/test-mode-control.test.tsx src/features/operations/server/procedures/control.test.ts`

Expected: FAIL — target/mail/columns가 남거나 popup state가 없다.

- [ ] **Step 3: atomic 종료 service 구현**

```ts
async function countWorkspace(tx: DbTransaction, surveyId: string) {
  const [responseRow] = await tx.select({ total: sql<number>`count(*)::int` }).from(surveyResponses)
    .where(and(eq(surveyResponses.surveyId, surveyId), eq(surveyResponses.isTest, true)));
  const [targetRow] = await tx.select({ total: sql<number>`count(*)::int` }).from(contactTargets)
    .where(and(eq(contactTargets.surveyId, surveyId), eq(contactTargets.isTest, true)));
  return {
    testModeEnabled: false,
    deletedResponseCount: 0,
    deletedTargetCount: 0,
    remainingResponseCount: responseRow?.total ?? 0,
    remainingTargetCount: targetRow?.total ?? 0,
  };
}

export async function disableTestWorkspace(input: { surveyId: string; disposition: 'keep' | 'delete' }) {
  return db.transaction(async (tx) => {
    const surveyRows = await tx.execute(sql`SELECT id,test_mode_enabled FROM surveys WHERE id=${input.surveyId}::uuid FOR UPDATE`);
    if (!surveyRows[0]) throw new Error('설문을 찾을 수 없습니다.');
    await tx.update(surveys).set({ testModeEnabled: false, updatedAt: new Date() }).where(eq(surveys.id, input.surveyId));
    await tx.update(mailCampaigns).set({ status: 'cancelled', updatedAt: new Date() })
      .where(and(eq(mailCampaigns.surveyId, input.surveyId), eq(mailCampaigns.isTest, true), inArray(mailCampaigns.status, ['queued','sending']), isNull(mailCampaigns.archivedAt)));
    if (input.disposition === 'keep') return countWorkspace(tx, input.surveyId);
    await archiveTestWorkspaceMail(tx, input.surveyId);
    const deletedResponses = await tx.delete(surveyResponses).where(and(eq(surveyResponses.surveyId, input.surveyId), eq(surveyResponses.isTest, true))).returning({ id: surveyResponses.id });
    const deletedTargets = await tx.delete(contactTargets).where(and(eq(contactTargets.surveyId, input.surveyId), eq(contactTargets.isTest, true))).returning({ id: contactTargets.id });
    await tx.update(surveys).set({ testContactColumns: null }).where(eq(surveys.id, input.surveyId));
    return {
      testModeEnabled: false,
      deletedResponseCount: deletedResponses.length,
      deletedTargetCount: deletedTargets.length,
      remainingResponseCount: 0,
      remainingTargetCount: 0,
    };
  });
}
```

모든 test mutation이 survey row를 lock하거나 mode를 재검증하므로 disable commit 뒤 실제 범위로 폴백하지 않고 stale 오류를 낸다.

- [ ] **Step 4: control state와 procedure 확장**

```ts
export interface SurveyControlState {
  isPaused: boolean;
  pausedMessage: string | null;
  testModeEnabled: boolean;
  testToken: string | null;
  accessIdentifier: string;
  testResponseCount: number;
  testTargetCount: number;
  firstTestInviteCode: string | null;
}
```

첫 링크는 `contactTargets.isTest=true ORDER BY resid ASC,id ASC LIMIT 1`. `control.disable` input은 disposition enum, output은 count와 mode를 반환한다. `setTestMode`는 enable만 담당하고 arbitrary false 호출은 막으며 update 뒤 `getControlState(surveyId)` 전체를 반환해 보관된 첫 링크와 count를 즉시 복구한다.

```ts
const enableTestMode = authed
  .input(z.object({ surveyId: z.string().uuid() }))
  .output(ControlStateSchema)
  .handler(async ({ input }) => {
    await svc.setTestMode({ surveyId: input.surveyId, enabled: true });
    return svc.getControlState(input.surveyId);
  });
```

- [ ] **Step 5: 생성 모달 구현**

```tsx
const schema = z.object({ count: z.coerce.number().int().min(1).max(20), recipientEmail: z.string().email() });
const submit = async (values: z.infer<typeof schema>) => {
  await client.contacts.targets.generateTest({ surveyId, count: values.count, recipientEmail: values.recipientEmail });
  toast.success(`테스트 대상자 ${values.count}명을 생성했습니다.`);
  onCreated();
};
```

필드는 `생성 인원`, `메일 받을 테스트 주소` 두 개만 표시한다. server가 `TEST_TARGET_GENERATION_STALE`를 반환하면 닫고 control을 refetch한다.

- [ ] **Step 6: target count별 팝오버와 링크 구현**

```ts
const testLink = state.testTargetCount > 0 && state.firstTestInviteCode
  ? `${window.location.origin}/i/${state.firstTestInviteCode}`
  : state.testToken
    ? `${window.location.origin}/survey/${state.accessIdentifier}?test=${state.testToken}`
    : null;
```

0명일 때만 `테스트 대상자 생성` item을 렌더하고 `DropdownMenuSeparator` 뒤에 끄기를 둔다. ON 직후 기존 익명 링크 자동 복사 동작은 유지한다.

- [ ] **Step 7: 항상 3버튼 종료 다이얼로그 구현**

```tsx
const title = state.testTargetCount > 0
  ? `테스트 대상자 ${state.testTargetCount}명과 응답 ${state.testResponseCount}건을 삭제할까요?`
  : `테스트 응답 ${state.testResponseCount}건을 삭제할까요?`;
```

설명에는 아래 세 문장을 순서대로 표시한다.

```text
테스트 모드에서 수집된 응답은 통계·집계에서 항상 제외됩니다. 삭제하면 복구할 수 없으니, 보관하려면 “보관하고 끄기”를 선택하세요.
다른 관리자가 진행 중인 테스트와 발송된 테스트 링크도 중단됩니다.
테스트 데이터를 모두 삭제하고 진행 중인 발송을 중단합니다. 이미 발송된 메일은 취소할 수 없습니다.
```

버튼은 `취소`, `보관하고 끄기`, `삭제 후 끄기`이며 각각 `control.disable`의 keep/delete를 한 번만 호출한다.

```ts
const keepAndDisable = () => client.operations.control.disable({ surveyId, disposition: 'keep' });
const deleteAndDisable = () => client.operations.control.disable({ surveyId, disposition: 'delete' });
```

- [ ] **Step 8: focus·10초 polling 동기화**

```ts
useEffect(() => {
  let cancelled = false;
  const refreshControl = async () => {
    const next = await client.operations.control.get({ surveyId });
    if (cancelled) return;
    setState((prev) => {
      if (prev && JSON.stringify(prev) !== JSON.stringify(next)) router.refresh();
      return next;
    });
  };
  const interval = window.setInterval(refreshControl, 10_000);
  window.addEventListener('focus', refreshControl);
  return () => { cancelled = true; window.clearInterval(interval); window.removeEventListener('focus', refreshControl); };
}, [router, surveyId]);
```

RSC initial prop 변경도 effect로 state에 반영해 refresh 이후 stale state를 남기지 않는다.

- [ ] **Step 9: 테스트 통과 확인**

Run: `pnpm exec vitest run tests/integration/test-workspace-lifecycle.test.ts tests/unit/operations/test-mode-control.test.tsx src/features/operations/server/procedures/control.test.ts src/features/operations/server/services/control.service.test.ts`

Expected: PASS — 보관/삭제 의미, 정확한 popup item, 첫 링크 전환, 다이얼로그 count, polling 정합.

- [ ] **Step 10: 커밋**

```bash
git add src/features/operations src/components/operations/test-mode-control.tsx src/components/operations/survey-control-buttons.tsx src/components/operations/contacts/test-contact-generator-dialog.tsx src/app/admin/surveys/[id]/operations/layout.tsx src/app/admin/surveys/[id]/edit/page.tsx tests/integration/test-workspace-lifecycle.test.ts tests/unit/operations/test-mode-control.test.tsx
git commit -m "feat: 테스트 작업공간 종료와 전역 제어 UI 추가"
```

---

### Task 13: 경계 회귀·전체 검증·문서 정합

**Files:**
- Create: `tests/integration/test-mode-boundaries.test.ts`
- Modify: `tests/integration/spss/spss-excel-export.test.ts`
- Modify: `tests/unit/data/response-filters.test.ts`
- Modify: `tests/unit/analytics/split-export.test.ts`
- Modify: `tests/integration/test-mode-operations-scope.test.ts`
- Modify: `tests/integration/test-mode-mail.test.ts`
- Modify: `tests/integration/test-workspace-lifecycle.test.ts`

**Interfaces:**
- Verifies: export/analytics는 항상 real only, billing은 test 포함, quota는 test 제외, 실제 traffic은 test mode와 무관하게 계속 저장·발송.
- Verifies: 모든 scoped mutation의 stale/mixed ID 경계와 manual workflow.

- [ ] **Step 1: 최종 경계 테스트 작성**

```ts
describe('테스트 모드 경계', () => {
  it('test mode ON 중 실제 공개 응답은 isTest=false로 계속 저장된다', async () => {
    mockSurvey({ testModeEnabled: true });
    const result = await createResponseWithFirstAnswer(realAnonymousInput);
    expect(result.kind).toBe('created');
    expect(insertedResponse()).toMatchObject({ isTest: false, contactTargetId: null });
  });

  it('테스트 응답은 종료일·최대응답·quota를 우회하지만 실제 카운터를 바꾸지 않는다', async () => {
    mockClosedGates();
    await expect(createResponseWithFirstAnswer(targetTestInput)).resolves.toMatchObject({ kind: 'created' });
    expect(mockQuotaIncrement).not.toHaveBeenCalled();
  });

  it('SPSS·Excel·analytics SQL은 mode와 무관하게 is_test=false를 유지한다', async () => {
    await exportSurvey(SURVEY_ID, 'xlsx');
    await exportSurvey(SURVEY_ID, 'sav');
    await loadAnalytics(SURVEY_ID);
    expect(allCapturedQueries()).toSatisfy((query: string) => query.includes('is_test') && query.includes('false'));
  });

  it('billing은 active와 archived test 발송을 각각 한 번 계산한다', async () => {
    seedActiveAndArchivedTestRecipients();
    const result = await computeCycleBreakdown();
    expect(result.cycles[0]?.totalBillable).toBe(2);
  });
});
```

`operations/layout.tsx`와 edit header는 수동 subset 객체 대신 `getControlState(surveyId)` 결과를 `TestModeControl.initial`에 전달한다.

- [ ] **Step 2: 경계 테스트 실행**

Run:

```bash
pnpm exec vitest run tests/integration/test-mode-boundaries.test.ts tests/integration/spss/spss-excel-export.test.ts tests/unit/data/response-filters.test.ts tests/unit/analytics/split-export.test.ts
```

Expected: PASS. 실패하면 이 태스크에서 임의 조건을 추가하지 말고 실패한 경계의 소유 태스크(Task 2·3·7·9·11)로 돌아가 그 태스크의 명시된 predicate와 테스트를 함께 수정한다.

- [ ] **Step 3: 정적 검증**

Run:

```bash
pnpm exec tsc --noEmit
pnpm lint
pnpm exec tsx .github/migration-journal-gate.ts
rg -n "notTestResponse|is_test\s*=\s*false|contactTargets\.surveyId|mailCampaigns\.surveyId" src/lib/operations src/features/contacts src/features/mail
```

Expected: tsc/lint/migration gate PASS. `rg` 결과의 실제-only 예외는 export/analytics/billing 정책과 일치하고, 운영 console query는 scope predicate 옆에만 나타난다.

- [ ] **Step 4: 전체 자동 테스트**

Run: `pnpm test`

Expected: PASS. 알려진 `tests/integration/profiles-row-actions.test.ts` 격리성 flaky만 실패하면 `RUN_FLAKY_ISOLATED=1 pnpm exec vitest run tests/integration/profiles-row-actions.test.ts`로 격리 PASS를 확인하고 실패 로그를 최종 보고에 명시한다. 새 테스트 실패는 완료로 처리하지 않는다.

- [ ] **Step 5: 수동 검증**

두 관리자 창과 응답자 창에서 다음 순서로 확인한다.

```text
1. 관리자 A가 ON → 관리자 B가 focus 또는 10초 안에 amber 배너와 test scope로 전환
2. 대상자 0명 상태에서 익명 링크로 같은 브라우저 2회 제출 → 테스트 응답 2건
3. 가짜 대상자 3명 생성 → 익명 2건 삭제, 팝오버 생성 항목 제거, 첫 /i/ 링크 복사
4. 각 대상자 링크가 서로 다르고 동일 받은편지함으로 [TEST] 메일 3건 수신
5. 같은 대상자 링크 두 브라우저에서 입력 → 늦게 시작한 화면만 저장, 이전 화면 오류
6. 완료 링크 GET → DB 무변경·빈 화면, 첫 입력 → 같은 response id 초기화
7. 보관하고 끄기 → 링크 차단·data 유지·queued/sending 취소, 재ON → in_progress 재개
8. 개별 대상자 삭제 → 응답 삭제·sent recipient PII 제거·마지막 삭제 후 익명 링크 복귀
9. 삭제 후 끄기 → target/response/test columns 제거, 정산에 삭제된 테스트 발송만 표시
10. 테스트 모드 ON 동안 실제 공개 링크 응답과 기존 실제 캠페인이 계속 진행
11. SPSS·Excel·analytics 결과에 테스트 응답이 없고 별도 안내 문구가 추가되지 않음
```

- [ ] **Step 6: spec과 구현 명칭 최종 대조**

`testContactColumns`, `OperationsDataScope`, `test_response_attempts`, `disposition`, `archivedAt` 이름이 구현과 spec에서 일치하는지 `rg -n "testContactColumns|OperationsDataScope|test_response_attempts|disposition|archivedAt" src docs/superpowers/specs/2026-07-21-survey-target-test-mode-design.md`로 확인한다. 불일치가 있으면 구현을 이 계획의 인터페이스 이름으로 고치고 spec은 수정하지 않는다.

- [ ] **Step 7: 최종 커밋**

```bash
git add tests
git commit -m "test: 조사대상자 테스트 모드 경계 회귀 검증"
```

---

## 완료 기준

- DB 제약과 서버 범위 가드가 실제·테스트 ID 혼합을 막는다.
- 운영 콘솔의 overview·profiles·contacts·report·campaigns·template sample이 전역 모드와 같은 범위를 본다.
- 익명 테스트는 반복 누적되고 대상자 테스트는 대상자당 마지막 한 행만 유지한다.
- terminal/이전 version 응답은 GET에서 바뀌지 않고 첫 실제 입력 또는 답 없는 submit에서 초기화된다.
- 마지막으로 실제 입력을 시작한 target attempt만 후속 answer·step·visibility·complete를 쓸 수 있다.
- 테스트 메일은 기능하는 대상자 링크, sandbox unsubscribe, `[TEST]` 제목, campaign footer를 사용하고 비용에 포함된다.
- 보관 종료와 전체 초기화 모두 추가 발송을 막고, 전체 초기화는 발송 사실 외 PII·본문·필터·첨부를 남기지 않는다.
- 내보내기·analytics는 테스트 응답을 제외하고 실제 수집·실캠페인은 테스트 모드 ON 중에도 계속 동작한다.
- `pnpm exec tsc --noEmit`, `pnpm lint`, migration gate, target tests, `pnpm test`가 통과한다.
