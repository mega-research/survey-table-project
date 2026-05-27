# 응답 내역 행 액션 구현 계획 — 수정·삭제·초기화

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 운영 콘솔 profiles 페이지에 응답 단건 수정/소프트 삭제/하드 초기화 액션을 추가하고, `surveyResponses.deletedAt`의 통계·리스트·export 사각지대와 dead code 4함수를 함께 정리한다.

**Architecture:**
- soft delete + 옵션 hard reset 모델. 어드민 수정 라우트는 응답 페이지의 본문 컴포넌트를 추출해 재사용.
- 데이터·집계·API 어느 경로에서도 deletedAt 필터를 빠뜨리지 않도록 단일 PR로 일괄 통합.
- 신규 server action은 모두 `(surveyId, responseId)`를 인자로 받아 ownership 가드 헬퍼로 IDOR 차단.

**Tech Stack:** Next.js 15 (App Router), Drizzle ORM, PostgreSQL (Supabase), React 19, TanStack Table, shadcn/ui (DropdownMenu·AlertDialog), Zustand, vitest (integration tests).

**Spec:** `docs/superpowers/specs/2026-05-27-response-row-actions-design.md` (commit 79c79c1).

---

## File Structure

### 신규 파일

| 경로 | 책임 |
|---|---|
| `src/lib/auth/require-survey-ownership.ts` | 현재 user 가 surveyId의 owner인지 검증, 아니면 throw |
| `src/actions/profiles-row-actions.ts` | softDeleteResponse / restoreResponse / hardResetResponse / saveAdminEdit |
| `src/components/operations/profiles/profiles-row-actions.tsx` | kebab 메뉴 + AlertDialog 4종 (삭제·초기화·복원·수정-네비) |
| `src/components/survey-response/survey-response-flow.tsx` | 응답 페이지 본문을 추출한 named export. mode/prefill/onSubmitOverride 받는 client component |
| `src/app/admin/surveys/[id]/operations/profiles/[responseId]/edit/page.tsx` | 어드민 수정 라우트 (server, 가드 + prefill) |
| `src/app/admin/surveys/[id]/operations/profiles/[responseId]/edit/admin-response-editor.tsx` | survey-response-flow를 admin 모드로 wrapping. 헤더 배너, saveAdminEdit 호출 |
| `tests/integration/profiles-row-actions.test.ts` | 6 케이스 통합 검증 |
| `drizzle/00XX_response_last_edited_at.sql` (자동 생성) | lastEditedAt 컬럼 + 인덱스 |

### 수정 파일

| 경로 | 변경 요지 |
|---|---|
| `src/db/schema/surveys.ts` | `lastEditedAt: timestamp` 컬럼 추가 |
| `src/data/responses.ts` | 6 함수에 `isNull(deletedAt)`; `getResponseById`에 `{ includeDeleted? }` 추가 |
| `src/lib/operations/profiles.ts` | `normalizeListArgs`가 `view: 'active' | 'deleted'` 파생 |
| `src/lib/operations/profiles.server.ts` | base subquery에 view 분기 |
| `src/lib/operations/aggregate-daily.server.ts` | 3 쿼리 `isNull(deletedAt)` |
| `src/lib/operations/daily-stats.server.ts` | 1 쿼리 |
| `src/lib/operations/aggregate-status.server.ts` | 1 쿼리 |
| `src/lib/operations/response-time.server.ts` | 1 쿼리 |
| `src/lib/operations/report-progress.server.ts` | 1 쿼리 |
| `src/app/api/surveys/[surveyId]/export/route.ts` | count + data 2 쿼리 |
| `src/app/admin/surveys/[id]/operations/profiles/page.tsx` | view에 따른 헤더 보조 문구 분기 |
| `src/components/operations/profiles/profiles-filter-bar.tsx` | status 드롭다운에 구분선 + '삭제됨' |
| `src/components/operations/profiles/profiles-table.tsx` | actions 컬럼 추가 |
| `src/app/survey/[id]/page.tsx` | 본문을 `<SurveyResponseFlow>`로 위임하는 wrapper로 축소 |
| `src/actions/response-actions.ts` | dead code 4 함수 제거 |
| `src/actions/index.ts` | re-export 정리 |
| `src/hooks/queries/use-responses.ts` | dead hook 3개 제거 |
| `src/hooks/queries/index.ts` | re-export 정리 |

---

## Conventions

- 모든 commit message는 한국어, `feat:|fix:|refactor:|docs:|test:|chore:` prefix, 괄호 없음 (memory `feedback_git_commit_korean`).
- 코드·주석·UI 텍스트에 이모지 금지 (memory `feedback_no_emoji_in_code`).
- 새 sanitize/library 도입 금지 — server side jsdom 의존성 금지 (memory `feedback_no_jsdom_in_server`).
- worktree 사용 금지. feature branch에서 작업 (memory `feedback_no_worktree`).
- vitest test는 반드시 `tests/integration/` 또는 `tests/unit/` 하위. `src/` 옆 *.test.ts 는 silent skip됨 (memory `feedback_vitest_tests_dir_only`).
- drizzle migrate가 `_journal.json`만 따라가므로, 자동 생성이 실패하면 Supabase MCP `apply_migration`으로 대체 (memory `feedback_drizzle_migrate_journal`).
- update 시 spread 금지, 명시적 field set만 (memory `feedback_survey_save_explicit_fields`).
- ESLint 인프라가 깨져 있으므로 `pnpm lint`로 검증 시도하지 말 것. **검증 도구는 `pnpm tsc --noEmit` + `pnpm test` + `pnpm build`** (memory `feedback_lint_infra_broken`).

검증 명령 alias:
- `pnpm tsc --noEmit` (type check)
- `pnpm vitest run tests/integration/profiles-row-actions.test.ts` (해당 test만)
- `pnpm vitest run` (전체 test)
- `pnpm build` (Turbopack production build)

기존 feature branch 확인:
```bash
git status && git branch --show-current
```
main이면 `git checkout -b feat/response-row-actions` 로 분기 후 진행.

---

## Task 1: lastEditedAt 컬럼 + 인덱스 마이그레이션

**Files:**
- Modify: `src/db/schema/surveys.ts:165-214` (surveyResponses 정의)
- Create: `drizzle/XXXX_response_last_edited_at.sql` (자동 생성)

- [ ] **Step 1: 현재 schema에서 surveyResponses 정의 위치 확인**

```bash
grep -n "surveyResponses = pgTable" src/db/schema/surveys.ts
```
Expected: `surveyResponses = pgTable('survey_responses'` 행 라인 번호 출력.

- [ ] **Step 2: schema에 lastEditedAt 컬럼 추가**

`src/db/schema/surveys.ts` 의 surveyResponses 정의에서 `deletedAt: timestamp('deleted_at', { withTimezone: true }),` 줄 바로 뒤에 다음 1줄을 추가한다.

```ts
  // 어드민 수정 시각 (응답자 본인 흐름과 구분). NULL = 미수정.
  lastEditedAt: timestamp('last_edited_at', { withTimezone: true }),
```

- [ ] **Step 3: drizzle 자동 생성 시도**

```bash
pnpm db:generate
```
Expected: `drizzle/XXXX_<auto-name>.sql` 파일이 생성되고 `_journal.json`에 entry 추가됨.

생성된 SQL 파일을 열어 ALTER TABLE 문이 다음과 같은지 확인:
```sql
ALTER TABLE "survey_responses" ADD COLUMN "last_edited_at" timestamp with time zone;
```

- [ ] **Step 4: deletedAt 인덱스 SQL을 같은 마이그레이션 파일에 추가**

자동 생성된 SQL 파일 끝에 다음 한 줄을 수동 추가:
```sql
CREATE INDEX IF NOT EXISTS "idx_survey_responses_deleted_at" ON "survey_responses" ("survey_id","deleted_at");
```

- [ ] **Step 5: 마이그레이션 적용**

```bash
pnpm db:migrate
```
Expected: 0 errors, "applied" 메시지. 실패 시 Supabase MCP `apply_migration`으로 동일 SQL 직접 적용.

- [ ] **Step 6: 적용 검증**

Supabase MCP `execute_sql` 또는 `psql`로 다음 두 쿼리 실행:
```sql
SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name='survey_responses' AND column_name IN ('deleted_at','last_edited_at');
SELECT indexname FROM pg_indexes WHERE tablename='survey_responses' AND indexname='idx_survey_responses_deleted_at';
```
Expected: 두 컬럼 모두 `timestamp with time zone`으로 반환. 인덱스 한 행 반환.

- [ ] **Step 7: tsc 통과 확인**

```bash
pnpm tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 8: 커밋**

```bash
git add src/db/schema/surveys.ts drizzle/
git commit -m "feat: survey_responses에 last_edited_at 컬럼 + deleted_at 인덱스 추가"
```

---

## Task 2: Dead code 제거 (4 server actions + 3 hooks)

**Files:**
- Modify: `src/actions/response-actions.ts:650-680`
- Modify: `src/actions/index.ts`
- Modify: `src/hooks/queries/use-responses.ts`
- Modify: `src/hooks/queries/index.ts`

- [ ] **Step 1: dead code 호출자 최종 확인**

```bash
grep -rn "deleteResponse\|clearAllResponses\|clearSurveyResponses\|importResponses\|useDeleteResponse\|useClearSurveyResponses\|useImportResponses" src/ \
  | grep -v "response-actions.ts:65[0-9]\|response-actions.ts:67[0-9]\|use-responses.ts\|hooks/queries/index.ts\|actions/index.ts"
```
Expected: 출력 0건 (호출자 없음을 재확인). 출력이 있으면 그 호출자도 정리 task에 포함 후 사용자 확인.

- [ ] **Step 2: response-actions.ts에서 4 함수 본문과 import 제거**

`src/actions/response-actions.ts`:
- `deleteResponse(responseId: string)` 함수 전체 삭제 (라인 650 부근)
- `importResponses(data: NewSurveyResponse[])` 함수 전체 삭제 (라인 660 부근)
- `clearSurveyResponses(surveyId: string)` 함수 전체 삭제 (라인 670 부근)
- `clearAllResponses()` 함수 전체 삭제 (라인 675 부근)
- 더 이상 참조되지 않는 `NewSurveyResponse` import는 schema에서 import 유지 여부 확인 후 정리

- [ ] **Step 3: src/actions/index.ts re-export 정리**

해당 4 함수의 export 행을 삭제. `grep -n "deleteResponse\|clearAll\|clearSurvey\|importResponses" src/actions/index.ts`로 행 확인 후 제거.

- [ ] **Step 4: src/hooks/queries/use-responses.ts에서 hook 정의 + import 제거**

- `useDeleteResponse`, `useClearSurveyResponses`, `useImportResponses` 함수 정의 삭제 (라인 163, 178 부근)
- 상단의 `deleteResponse as deleteResponseAction`, `clearSurveyResponses as clearSurveyResponsesAction`, `importResponses as importResponsesAction` import 행 삭제

- [ ] **Step 5: src/hooks/queries/index.ts re-export 정리**

`useDeleteResponse`, `useClearSurveyResponses`, `useImportResponses` re-export 행 삭제.

- [ ] **Step 6: tsc 통과 확인**

```bash
pnpm tsc --noEmit
```
Expected: 0 errors. 실패 시 누락된 호출자가 더 있다는 신호 — 에러 출력으로 위치 확인 후 사용자에게 보고.

- [ ] **Step 7: 커밋**

```bash
git add src/actions src/hooks
git commit -m "chore: 호출자 없는 hard-delete server actions와 hooks 제거"
```

---

## Task 3: requireSurveyOwnership 가드 헬퍼 추가

**Files:**
- Create: `src/lib/auth/require-survey-ownership.ts`

- [ ] **Step 1: 기존 auth 헬퍼 확인**

```bash
cat src/lib/auth.ts | head -60
```
Expected: `requireAuth()` 함수와 user object 반환 형태 파악. user.id 또는 session.user.id 인지 확인.

- [ ] **Step 2: surveys 테이블의 owner 컬럼 명 확인**

```bash
grep -n "userId\|user_id\|ownerId" src/db/schema/surveys.ts | head -5
```
Expected: surveys 테이블의 user-FK 컬럼명 (대개 `userId`) 확인.

- [ ] **Step 3: 헬퍼 작성**

`src/lib/auth/require-survey-ownership.ts` 신규:

```ts
import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { surveys } from '@/db/schema';

import { requireAuth } from '@/lib/auth';

export class SurveyOwnershipError extends Error {
  constructor(public readonly reason: 'not_found' | 'forbidden') {
    super(reason);
    this.name = 'SurveyOwnershipError';
  }
}

/**
 * 어드민 server action 진입 가드.
 * - 로그인 안 됨 → requireAuth 가 redirect (기존 동작)
 * - surveyId 없음 → SurveyOwnershipError('not_found')
 * - 다른 user 의 survey → SurveyOwnershipError('forbidden')
 *
 * 호출 후 surveys 행을 그대로 반환해 후속 SELECT 1회를 절약한다.
 */
export async function requireSurveyOwnership(surveyId: string) {
  const user = await requireAuth();
  const row = await db.query.surveys.findFirst({
    where: eq(surveys.id, surveyId),
    columns: { id: true, userId: true },
  });
  if (!row) throw new SurveyOwnershipError('not_found');
  if (row.userId !== user.id) throw new SurveyOwnershipError('forbidden');
  return { user, survey: row };
}
```

만약 step 2에서 컬럼명이 `userId`가 아니면 그 이름으로 치환.

- [ ] **Step 4: tsc 통과 확인**

```bash
pnpm tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/auth
git commit -m "feat: requireSurveyOwnership 가드 헬퍼 추가"
```

---

## Task 4: data layer 필터 통합 (responses.ts 6 함수)

**Files:**
- Modify: `src/data/responses.ts`

- [ ] **Step 1: 파일 전체 읽고 6 함수 정리**

```bash
cat src/data/responses.ts
```
Expected: `getResponsesBySurvey`, `getCompletedResponses`, `getResponseById`, `getResponseCountBySurvey`, `getCompletedResponseCountBySurvey`, `getResponsesWithAnswers` 6 함수 확인.

- [ ] **Step 2: import에 `isNull` 추가**

상단 import에서 `drizzle-orm`로부터 `isNull`을 추가:
```ts
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
```
(기존 import 항목은 유지)

- [ ] **Step 3: 5개 함수의 where에 isNull(deletedAt) 결합**

각 함수의 `.where(eq(surveyResponses.surveyId, surveyId))` 또는 유사 패턴을:
```ts
.where(and(eq(surveyResponses.surveyId, surveyId), isNull(surveyResponses.deletedAt)))
```
로 교체. 대상:
- `getResponsesBySurvey`
- `getCompletedResponses`
- `getResponseCountBySurvey`
- `getCompletedResponseCountBySurvey`
- `getResponsesWithAnswers`

기존에 다른 조건이 결합되어 있으면 `and(...)` 안에 isNull을 추가.

- [ ] **Step 4: getResponseById 시그니처 확장**

```ts
export async function getResponseById(
  responseId: string,
  options: { includeDeleted?: boolean } = {},
) {
  const where = options.includeDeleted
    ? eq(surveyResponses.id, responseId)
    : and(eq(surveyResponses.id, responseId), isNull(surveyResponses.deletedAt));
  return db.query.surveyResponses.findFirst({ where });
}
```
(기존 반환 형태에 맞춰 query.findFirst 또는 .select() 패턴 유지)

- [ ] **Step 5: 호출자가 새 시그니처에 적응되는지 grep**

```bash
grep -rn "getResponseById" src/ | grep -v "responses.ts"
```
Expected: 호출자 목록. 모두 첫 인자만 넘기는 형태면 backward compatible (options default `{}`).

- [ ] **Step 6: tsc 통과 확인**

```bash
pnpm tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 7: 커밋**

```bash
git add src/data/responses.ts
git commit -m "fix: data layer 응답 조회에 deletedAt 필터 통합"
```

---

## Task 5: operations 집계 5 파일 필터 통합

**Files:**
- Modify: `src/lib/operations/aggregate-daily.server.ts`
- Modify: `src/lib/operations/daily-stats.server.ts`
- Modify: `src/lib/operations/aggregate-status.server.ts`
- Modify: `src/lib/operations/response-time.server.ts`
- Modify: `src/lib/operations/report-progress.server.ts`

- [ ] **Step 1: 각 파일에서 surveyResponses where 위치 식별**

```bash
grep -n "from(surveyResponses)\|surveyResponses\." src/lib/operations/aggregate-daily.server.ts \
  src/lib/operations/daily-stats.server.ts \
  src/lib/operations/aggregate-status.server.ts \
  src/lib/operations/response-time.server.ts \
  src/lib/operations/report-progress.server.ts
```
Expected: 각 파일별 `.where(eq(surveyResponses.surveyId, surveyId))` 호출 행 번호.

- [ ] **Step 2: 5개 파일 각각에서 isNull 결합**

각 파일에서 다음 패턴을 적용:
1. import에 `isNull, and`이 없으면 추가 (대부분 이미 `and`는 있음)
2. `.where(eq(surveyResponses.surveyId, surveyId))` → `.where(and(eq(surveyResponses.surveyId, surveyId), isNull(surveyResponses.deletedAt)))`
3. 기존에 `and(...)`가 있는 경우 isNull을 추가 인자로 결합

`aggregate-daily.server.ts`는 3 쿼리 (line 38-42, 51-56, 72-75 부근), 나머지는 각 1 쿼리.

- [ ] **Step 3: tsc 통과 확인**

```bash
pnpm tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: 운영 콘솔 overview/report 페이지가 빌드되는지 확인**

```bash
pnpm build 2>&1 | grep -E "error|FAIL" | head -20
```
Expected: error/FAIL 출력 0건. (전체 build 결과는 후속 task에서 확인.)

build가 무겁다면 이 step은 생략하고 Task 16의 최종 검증에 위임. 단 5 파일 모두 isNull 들어간 게 grep으로 재확인:
```bash
grep -c "isNull(surveyResponses.deletedAt)" src/lib/operations/aggregate-daily.server.ts \
  src/lib/operations/daily-stats.server.ts \
  src/lib/operations/aggregate-status.server.ts \
  src/lib/operations/response-time.server.ts \
  src/lib/operations/report-progress.server.ts
```
Expected: aggregate-daily.server.ts:3, 나머지 각 1.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/operations
git commit -m "fix: operations 집계 5 파일에 deletedAt 필터 통합"
```

---

## Task 6: export API 필터 통합

**Files:**
- Modify: `src/app/api/surveys/[surveyId]/export/route.ts:66-81`

- [ ] **Step 1: 해당 라우트의 두 쿼리 위치 확인**

```bash
grep -n "surveyResponses\|from(surveyResponses" src/app/api/surveys/\[surveyId\]/export/route.ts
```
Expected: 두 쿼리 — 사전 count + 본 데이터 fetch.

- [ ] **Step 2: 두 쿼리 모두 isNull 결합**

각 `.where(eq(surveyResponses.surveyId, surveyId))` 를 `.where(and(eq(surveyResponses.surveyId, surveyId), isNull(surveyResponses.deletedAt)))` 로 교체. import에 `and`, `isNull`이 없으면 drizzle-orm에서 추가.

- [ ] **Step 3: tsc 통과 확인**

```bash
pnpm tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/surveys/\[surveyId\]/export/route.ts
git commit -m "fix: export API의 count/data 쿼리에 deletedAt 필터 추가"
```

---

## Task 7: profiles view 분기 (active / deleted)

**Files:**
- Modify: `src/lib/operations/profiles.ts`
- Modify: `src/lib/operations/profiles.server.ts`
- Modify: `src/components/operations/profiles/profiles-filter-bar.tsx`

- [ ] **Step 1: profiles.ts의 status 타입과 normalizeListArgs 확인**

```bash
grep -n "ProfilesStatus\|normalizeListArgs\|view" src/lib/operations/profiles.ts | head -20
```
Expected: 기존 status 유효값과 normalizeListArgs 구현 위치 파악.

- [ ] **Step 2: profiles.ts — status 유효값에 'deleted' 추가 + view 파생**

`STATUSES` 또는 동등 상수 배열에 `'deleted'`를 추가. 그리고 `normalizeListArgs`가 반환하는 객체에 `view: 'active' | 'deleted'` 파생 필드를 추가:

```ts
// 예시 — 실제 타입 정의에 맞춰 적용
const PROFILES_STATUSES = ['all', 'completed', 'in_progress', 'screened_out', 'quotaful_out', 'bad', 'drop', 'deleted'] as const;
export type ProfilesStatus = typeof PROFILES_STATUSES[number];

export function normalizeListArgs(sp: Record<string, string | undefined>): NormalizedListArgs {
  // ... 기존 로직
  const view: 'active' | 'deleted' = status === 'deleted' ? 'deleted' : 'active';
  return { ...existing, view };
}
```

`hasActiveFilters` 같은 헬퍼가 status='deleted'를 어떻게 취급할지도 결정: 기본 페이지가 '활성'이므로 status='deleted'는 활성 필터로 간주.

- [ ] **Step 3: profiles.server.ts — base subquery에 view 분기**

`listResponsesForProfiles` 의 base subquery `.where(eq(surveyResponses.surveyId, surveyId))` 부분을:

```ts
.where(and(
  eq(surveyResponses.surveyId, surveyId),
  args.view === 'deleted'
    ? isNotNull(surveyResponses.deletedAt)
    : isNull(surveyResponses.deletedAt),
))
```

import에 `isNull`, `isNotNull` 추가.

추가로 view='deleted' 일 때는 status 필터를 적용하지 않는다 (deleted view는 deleted 전체 노출):
```ts
if (args.view === 'active' && status !== 'all') {
  whereParts.push(eq(numbered.status, status));
}
```

- [ ] **Step 4: profiles-filter-bar.tsx — status 드롭다운에 '삭제됨' 추가**

기존 SelectItem 마지막 옵션 뒤에 구분선 + '삭제됨' 추가. shadcn `Select`라면:

```tsx
<SelectGroup>
  <SelectItem value="all">전체 상태</SelectItem>
  {/* 기존 status들 */}
</SelectGroup>
<SelectSeparator />
<SelectItem value="deleted">삭제됨</SelectItem>
```

(실제 컴포넌트 구조에 맞춰 적용. shadcn의 RadixUI Select 는 SelectSeparator 지원.)

- [ ] **Step 5: tsc 통과 확인**

```bash
pnpm tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 6: 운영 콘솔에서 수동 검증**

```bash
pnpm dev
```
브라우저로 `/admin/surveys/<id>/operations/profiles` 진입 → status 드롭다운 '삭제됨' 노출, 선택 시 빈 목록 ("검색 결과가 없습니다" EmptyState) 표시 확인.

dev 서버는 검증 후 Ctrl+C로 종료.

- [ ] **Step 7: 커밋**

```bash
git add src/lib/operations/profiles.ts src/lib/operations/profiles.server.ts src/components/operations/profiles/profiles-filter-bar.tsx
git commit -m "feat: profiles에 view 분기와 삭제됨 status 필터 추가"
```

---

## Task 8: 신규 server actions — softDelete/restore/hardReset + 통합 테스트

**Files:**
- Create: `src/actions/profiles-row-actions.ts`
- Create: `tests/integration/profiles-row-actions.test.ts`

- [ ] **Step 1: tests/integration/ 기존 패턴 확인**

```bash
ls tests/integration/
cat tests/integration/$(ls tests/integration/ | head -1)
```
Expected: 기존 테스트 파일의 setup 패턴 (DB 초기화, fixtures, 인증 mock 등) 파악. survey/user fixture를 만드는 helper 위치 확인.

- [ ] **Step 2: 통합 테스트 골격 작성 (실패하는 테스트)**

`tests/integration/profiles-row-actions.test.ts` 신규. 기존 테스트의 fixture 헬퍼를 import해서 다음 6 케이스 작성:

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets, responseAnswers, surveyResponses } from '@/db/schema';
import {
  softDeleteResponse,
  restoreResponse,
  hardResetResponse,
} from '@/actions/profiles-row-actions';
import {
  createTestSurvey,
  createTestResponse,
  // 기존 fixture 헬퍼들 (실제 이름은 step 1에서 확인)
} from '../helpers/fixtures';

describe('profiles-row-actions', () => {
  describe('softDeleteResponse', () => {
    it('sets deletedAt and excludes from active queries', async () => {
      const { surveyId, userId } = await createTestSurvey();
      const responseId = await createTestResponse(surveyId);

      await softDeleteResponse(surveyId, responseId); // 테스트 환경에서 user 가드 우회 처리

      const row = await db.query.surveyResponses.findFirst({
        where: eq(surveyResponses.id, responseId),
      });
      expect(row?.deletedAt).not.toBeNull();
    });

    it('is idempotent', async () => {
      // ... 두 번 호출해도 에러 없이 같은 상태
    });
  });

  describe('restoreResponse', () => {
    it('clears deletedAt', async () => {
      // softDelete → restore → deletedAt null 확인
    });
  });

  describe('hardResetResponse', () => {
    it('deletes the row and cascades response_answers', async () => {
      const { surveyId } = await createTestSurvey();
      const responseId = await createTestResponse(surveyId, { withAnswers: true });

      await hardResetResponse(surveyId, responseId);

      const row = await db.query.surveyResponses.findFirst({
        where: eq(surveyResponses.id, responseId),
      });
      expect(row).toBeUndefined();
      const answers = await db.query.responseAnswers.findMany({
        where: eq(responseAnswers.responseId, responseId),
      });
      expect(answers).toHaveLength(0);
    });

    it('nulls contact_targets.response_id and responded_at', async () => {
      const { surveyId } = await createTestSurvey();
      const responseId = await createTestResponse(surveyId);
      const contactId = await linkContactToResponse(surveyId, responseId);

      await hardResetResponse(surveyId, responseId);

      const contact = await db.query.contactTargets.findFirst({
        where: eq(contactTargets.id, contactId),
      });
      expect(contact?.responseId).toBeNull();
      expect(contact?.respondedAt).toBeNull();
    });
  });

  describe('IDOR guards', () => {
    it('rejects action on another user surveys', async () => {
      const { surveyId } = await createTestSurvey({ userId: 'attacker' });
      const responseId = await createTestResponse(surveyId);
      // mock current user as different id
      await expect(softDeleteResponse(surveyId, responseId)).rejects.toThrow();
    });
  });
});
```

테스트 헬퍼 이름·시그니처는 step 1의 기존 패턴에 맞춘다. `createTestResponse(surveyId, { withAnswers })` 같은 helper가 없으면 직접 INSERT 코드로 대체.

- [ ] **Step 3: 테스트 실행 — 실패 확인**

```bash
pnpm vitest run tests/integration/profiles-row-actions.test.ts
```
Expected: FAIL — "Cannot find module '@/actions/profiles-row-actions'"

- [ ] **Step 4: profiles-row-actions.ts 작성**

`src/actions/profiles-row-actions.ts` 신규:

```ts
'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets, surveyResponses } from '@/db/schema';
import { requireSurveyOwnership } from '@/lib/auth/require-survey-ownership';

function revalidate(surveyId: string) {
  revalidatePath(`/admin/surveys/${surveyId}/operations/profiles`);
}

export async function softDeleteResponse(surveyId: string, responseId: string) {
  await requireSurveyOwnership(surveyId);
  await db
    .update(surveyResponses)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(surveyResponses.id, responseId),
        eq(surveyResponses.surveyId, surveyId),
      ),
    );
  revalidate(surveyId);
  return { ok: true as const };
}

export async function restoreResponse(surveyId: string, responseId: string) {
  await requireSurveyOwnership(surveyId);
  await db
    .update(surveyResponses)
    .set({ deletedAt: null })
    .where(
      and(
        eq(surveyResponses.id, responseId),
        eq(surveyResponses.surveyId, surveyId),
      ),
    );
  revalidate(surveyId);
  return { ok: true as const };
}

export async function hardResetResponse(surveyId: string, responseId: string) {
  await requireSurveyOwnership(surveyId);
  await db.transaction(async (tx) => {
    await tx
      .update(contactTargets)
      .set({ responseId: null, respondedAt: null })
      .where(eq(contactTargets.responseId, responseId));
    await tx
      .delete(surveyResponses)
      .where(
        and(
          eq(surveyResponses.id, responseId),
          eq(surveyResponses.surveyId, surveyId),
        ),
      );
  });
  revalidate(surveyId);
  return { ok: true as const };
}
```

`response_answers`는 `surveyResponses.id` FK cascade로 자동 삭제됨. 확인:
```bash
grep -A2 "responseId.*notNull" src/db/schema/surveys.ts | head -10
```
Expected: `.references(() => surveyResponses.id, { onDelete: 'cascade' })`. cascade가 아니면 task 안에 명시적 `tx.delete(responseAnswers)` 추가.

- [ ] **Step 5: 테스트 실행 — 통과 확인**

```bash
pnpm vitest run tests/integration/profiles-row-actions.test.ts
```
Expected: 모든 case PASS.

테스트 환경에서 `requireSurveyOwnership` 가드를 어떻게 우회할지는 step 1에서 파악한 기존 패턴 따라가기 (대개 auth mock 또는 test-only override).

- [ ] **Step 6: tsc 통과 확인**

```bash
pnpm tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 7: 커밋**

```bash
git add src/actions/profiles-row-actions.ts tests/integration/profiles-row-actions.test.ts
git commit -m "feat: 응답 행 softDelete/restore/hardReset server actions 추가"
```

---

## Task 9: profiles-row-actions.tsx 컴포넌트 (kebab + AlertDialog)

**Files:**
- Create: `src/components/operations/profiles/profiles-row-actions.tsx`

- [ ] **Step 1: 기존 dropdown / alert dialog 사용 패턴 확인**

```bash
grep -rln "DropdownMenu\|AlertDialog" src/components | head -5
```
Expected: 다른 컴포넌트에서 import 형태 확인 (shadcn `@/components/ui/...`).

- [ ] **Step 2: 컴포넌트 작성**

`src/components/operations/profiles/profiles-row-actions.tsx` 신규:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { MoreHorizontal } from 'lucide-react';

import {
  hardResetResponse,
  restoreResponse,
  softDeleteResponse,
} from '@/actions/profiles-row-actions';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type View = 'active' | 'deleted';

interface Props {
  surveyId: string;
  responseId: string;
  idx: number;
  view: View;
}

type Dialog = null | 'delete' | 'reset';

export function ProfilesRowActions({ surveyId, responseId, idx, view }: Props) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [isPending, startTransition] = useTransition();

  const runConfirmed = (
    fn: (s: string, r: string) => Promise<unknown>,
  ) => {
    startTransition(async () => {
      await fn(surveyId, responseId);
      setDialog(null);
    });
  };

  const editHref = `/admin/surveys/${surveyId}/operations/profiles/${responseId}/edit`;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label={`응답 #${idx} 액션`}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {view === 'active' ? (
            <>
              <DropdownMenuItem
                onSelect={() => window.open(editHref, '_blank')}
              >
                수정
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDialog('reset')}>
                초기화
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setDialog('delete')}
                className="text-red-600 focus:text-red-700"
              >
                삭제
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem
              disabled={isPending}
              onSelect={() => runConfirmed(restoreResponse)}
            >
              복원
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={dialog === 'delete'}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>응답 #{idx}를 삭제합니다</AlertDialogTitle>
            <AlertDialogDescription>
              통계에서 제외되며 휴지통에서 복원 가능합니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={() => runConfirmed(softDeleteResponse)}
              className="bg-red-600 hover:bg-red-700"
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={dialog === 'reset'}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>응답 #{idx}를 완전히 제거합니다</AlertDialogTitle>
            <AlertDialogDescription>
              응답 데이터는 복구할 수 없습니다. 컨택 명단의 진척 상태도 함께 되돌아갑니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={() => runConfirmed(hardResetResponse)}
              className="bg-red-600 hover:bg-red-700"
            >
              초기화
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

Router 변동은 server action의 `revalidatePath`가 처리하므로 별도 router.refresh() 불필요. 단 새 탭으로 열린 수정 페이지에서 돌아온 후 갱신을 보장하려면 profiles 페이지의 layout 또는 PageProps의 `dynamic = 'force-dynamic'` 여부를 step 12에서 확인.

- [ ] **Step 3: tsc 통과 확인**

```bash
pnpm tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: 커밋**

```bash
git add src/components/operations/profiles/profiles-row-actions.tsx
git commit -m "feat: 응답 행 액션 dropdown 컴포넌트 추가"
```

---

## Task 10: profiles-table에 actions 컬럼 추가

**Files:**
- Modify: `src/components/operations/profiles/profiles-table.tsx`

- [ ] **Step 1: ProfilesTable에 view prop 추가**

상단의 `interface Props`에 `view: 'active' | 'deleted'`를 추가. 함수 시그니처도 분해 추가:
```ts
export function ProfilesTable({ rows, total, page, pageSize, sort, dir, questions, view }: Props) {
```

- [ ] **Step 2: ProfilesRow 의 id를 display row에도 포함**

`DisplayRow` 인터페이스는 이미 `id: string`을 가지므로 변경 없음.

- [ ] **Step 3: columns 배열 끝에 actions 컬럼 추가**

```tsx
import { ProfilesRowActions } from './profiles-row-actions';

// columns 정의 끝에 추가:
{
  id: 'actions',
  header: '',
  cell: ({ row }) => (
    <ProfilesRowActions
      surveyId={surveyId}
      responseId={row.original.id}
      idx={row.original.idx}
      view={view}
    />
  ),
  meta: meta('center', false),
},
```

`surveyId` 도 props로 받아야 하므로 Props 와 함수 시그니처에 추가. profiles/page.tsx 호출부도 같이 손봐야 함 (Task 12에서).

- [ ] **Step 4: thead 와 tbody 의 정렬 indicator 가 새 컬럼에 비활성으로 적용되는지 확인**

기존 코드의 `sortable: false` 와 `meta: meta('center', false)` 가 새 컬럼에 적용됨. SortIndicator는 sortable===true 일 때만 렌더되므로 자동 보호.

- [ ] **Step 5: tsc 통과 확인**

```bash
pnpm tsc --noEmit
```
Expected: profiles/page.tsx 에서 `surveyId`, `view`를 안 넘긴다는 에러 — Task 12에서 함께 수정 예정. 일단 다음 step으로.

- [ ] **Step 6: 커밋 보류**

본 task의 변경은 Task 12와 함께 한 커밋으로 묶는다. 다음 task 진행.

---

## Task 11: profiles/page.tsx 헤더 + Props 전달

**Files:**
- Modify: `src/app/admin/surveys/[id]/operations/profiles/page.tsx`

- [ ] **Step 1: 페이지에서 args.view 사용**

`normalizeListArgs(sp)` 반환값에서 `view` 추출. ProfilesTable 호출부에 `surveyId={surveyId}`, `view={args.view}` 두 prop 추가.

```tsx
<ProfilesTable
  rows={rows}
  total={total}
  page={clampedPage}
  pageSize={PROFILES_PAGE_SIZE}
  sort={args.sort}
  dir={args.dir}
  questions={qs}
  surveyId={surveyId}
  view={args.view}
/>
```

- [ ] **Step 2: 헤더 보조 문구를 view에 따라 분기**

```tsx
<div className="mb-4">
  <h2 className="text-xl font-bold text-gray-900">
    {args.view === 'deleted' ? '삭제된 응답' : '응답 내역'}
  </h2>
  <p className="text-sm text-slate-500">
    {args.view === 'deleted'
      ? `삭제된 응답 — ${total.toLocaleString('ko-KR')}건. 복원하면 통계에 다시 포함됩니다.`
      : `응답자별 세션 트래킹 — ${total.toLocaleString('ko-KR')}건`}
  </p>
</div>
```

- [ ] **Step 3: EmptyState 분기도 보강**

```tsx
{total === 0 && !hasFilter ? (
  <EmptyState
    message={args.view === 'deleted' ? '삭제된 응답이 없습니다' : '아직 응답이 없습니다'}
    description={args.view === 'deleted' ? '응답을 삭제하면 여기에 모입니다' : '응답이 들어오면 여기에 표시됩니다'}
  />
) : (...)}
```

- [ ] **Step 4: tsc 통과 확인**

```bash
pnpm tsc --noEmit
```
Expected: 0 errors (Task 10의 에러가 해소됨).

- [ ] **Step 5: dev에서 수동 확인**

```bash
pnpm dev
```
- 활성 응답이 있는 설문 진입 → 표 끝에 kebab 메뉴 노출
- kebab → 수정 / 초기화 / 삭제 노출
- '삭제' 클릭 → AlertDialog 노출 → 취소 시 닫힘
- status='deleted' 선택 → "삭제된 응답 0건" 헤더 + EmptyState

dev 서버 종료.

- [ ] **Step 6: Task 10 + Task 11 함께 커밋**

```bash
git add src/components/operations/profiles/profiles-table.tsx \
        src/app/admin/surveys/\[id\]/operations/profiles/page.tsx
git commit -m "feat: profiles 표에 행 액션 컬럼과 view 분기 헤더 추가"
```

---

## Task 12: softDelete 통합 회귀 테스트 — cross-layer 영향 검증

**Files:**
- Modify: `tests/integration/profiles-row-actions.test.ts`

- [ ] **Step 1: 통합 테스트에 cross-layer 케이스 추가**

Task 8의 파일 끝에 새 describe 블록 추가:

```ts
describe('softDelete cross-layer impact', () => {
  it('disappears from listResponsesForProfiles active view, appears in deleted view', async () => {
    const { surveyId } = await createTestSurvey();
    const responseId = await createTestResponse(surveyId, { status: 'completed' });

    const before = await listResponsesForProfiles({
      surveyId,
      view: 'active',
      page: 1,
      pageSize: 10,
      // ... 기존 NormalizedListArgs 기본값
    });
    expect(before.total).toBe(1);

    await softDeleteResponse(surveyId, responseId);

    const afterActive = await listResponsesForProfiles({ surveyId, view: 'active', /* ... */ });
    const afterDeleted = await listResponsesForProfiles({ surveyId, view: 'deleted', /* ... */ });
    expect(afterActive.total).toBe(0);
    expect(afterDeleted.total).toBe(1);
  });

  it('reduces aggregateStatus completed count', async () => {
    const { surveyId } = await createTestSurvey();
    const responseId = await createTestResponse(surveyId, { status: 'completed' });

    const before = await aggregateStatus(surveyId);
    expect(before.completed).toBeGreaterThanOrEqual(1);

    await softDeleteResponse(surveyId, responseId);

    const after = await aggregateStatus(surveyId);
    expect(after.completed).toBe(before.completed - 1);
  });

  it('restore recovers the row in all layers', async () => {
    // softDelete → restore → 모두 원복
  });
});
```

기존 aggregate-status 호출 시그니처는 step 0에서 확인하고 그에 맞춰 작성.

- [ ] **Step 2: 테스트 실행**

```bash
pnpm vitest run tests/integration/profiles-row-actions.test.ts
```
Expected: 모든 case PASS.

만약 listResponsesForProfiles의 view 분기가 Task 7에서 누락된 곳이 있으면 여기서 빨간색으로 잡힘 — 그 경우 Task 7로 돌아가 보완.

- [ ] **Step 3: 커밋**

```bash
git add tests/integration/profiles-row-actions.test.ts
git commit -m "test: softDelete가 profiles list와 aggregateStatus에 미치는 영향 통합 검증"
```

---

## Task 13: 응답 페이지 본문을 SurveyResponseFlow로 추출

**Files:**
- Modify: `src/app/survey/[id]/page.tsx` (1418 라인)
- Create: `src/components/survey-response/survey-response-flow.tsx`

이 task는 가장 위험. 본문을 그대로 옮긴 뒤 page.tsx 가 wrapper 가 되게 한다. 동작 변화 0이 목표.

- [ ] **Step 1: 현재 default export 함수의 시작·끝 라인 파악**

```bash
grep -n "^export default\|^function\s\+\w\+\|^}" "src/app/survey/[id]/page.tsx" | head -30
```
Expected: default export 함수의 시작 라인과 끝(`}`) 라인.

- [ ] **Step 2: 추출 대상 함수의 외부 의존성을 인자로 받을 형태로 식별**

이 컴포넌트가 useParams / useSearchParams / useRouter 를 호출한다. admin edit 라우트에서도 useParams 가 동작하지만 (다른 라우트의 paramName), 충돌 위험. props로 `surveyIdentifier`, `inviteToken` 등을 받는 형태로 바꾸는 것이 안전.

추출 후 시그니처:
```ts
export interface SurveyResponseFlowProps {
  mode?: 'public' | 'admin-edit';
  surveyIdentifier: string;          // slug | uuid | privateToken
  inviteToken?: string | null;
  // admin-edit 모드 전용
  adminContext?: {
    responseId: string;
    surveyId: string;                 // UUID
    initialResponses: ResponsesMap;
    versionId: string | null;
    onSubmit: (payload: SaveAdminEditPayload) => Promise<void>;
  };
}
```

- [ ] **Step 3: 추출 — 본문을 새 파일로 이동**

`src/components/survey-response/survey-response-flow.tsx` 신규. page.tsx의 default export 함수 본문을 그대로 옮기되:
- 첫 줄에 `'use client';` 유지
- `useParams<{ id: string }>()` 호출을 `props.surveyIdentifier` 사용으로 교체
- `useSearchParams()`로부터의 invite 추출 부분을 `props.inviteToken` fallback 으로 교체

`page.tsx`는 다음과 같이 단순화:
```tsx
'use client';

import { useParams, useSearchParams } from 'next/navigation';

import { SurveyResponseFlow } from '@/components/survey-response/survey-response-flow';

export default function SurveyPage() {
  const params = useParams<{ id: string }>();
  const sp = useSearchParams();
  return (
    <SurveyResponseFlow
      surveyIdentifier={params.id}
      inviteToken={sp.get('invite')}
    />
  );
}
```

- [ ] **Step 4: tsc 통과 확인**

```bash
pnpm tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 5: dev로 공개 응답 페이지 회귀 확인**

```bash
pnpm dev
```
- 활성 설문의 공개 URL 진입 → 종전과 동일하게 첫 페이지 노출
- 첫 질문 응답 → 다음 페이지 이동
- inviteToken URL (`?invite=...`) 진입 → 동일 동작
- '?invite=' 토큰 무효 시 amber alert 노출

회귀 발견 시 즉시 commit 없이 step 3으로 복귀해 차이 좁히기. dev 서버 종료.

- [ ] **Step 6: 커밋**

```bash
git add "src/app/survey/[id]/page.tsx" src/components/survey-response/survey-response-flow.tsx
git commit -m "refactor: 응답 페이지 본문을 SurveyResponseFlow로 추출"
```

추출 비용이 step 3에서 예상보다 크다고 판단되면 (예: useParams 호출이 깊은 자식에 있어 props drilling 비용이 큼) **fallback 전략**:
- page.tsx 안에 `mode === 'admin-edit'` 분기를 추가하고, admin edit 라우트는 같은 page.tsx를 새 layout으로 wrapping하는 방식으로 우회.
- 이 경우 본 task의 추출 작업을 되돌리고 (`git restore`), Task 14를 그에 맞게 조정한다.

이 fallback 결정은 사용자에게 보고하고 진행.

---

## Task 14: admin edit route — server page + 가드 + prefill

**Files:**
- Create: `src/app/admin/surveys/[id]/operations/profiles/[responseId]/edit/page.tsx`

- [ ] **Step 1: 어드민 layout 위치와 가드 패턴 확인**

```bash
cat "src/app/admin/surveys/[id]/operations/layout.tsx" 2>/dev/null
cat "src/app/admin/layout.tsx" 2>/dev/null
```
Expected: 어드민 layout이 requireAuth() 또는 동등 가드를 호출하는지 확인.

- [ ] **Step 2: 페이지 작성**

```tsx
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { surveyVersions } from '@/db/schema';
import { requireSurveyOwnership } from '@/lib/auth/require-survey-ownership';
import { getResponseById } from '@/data/responses';
import { AdminResponseEditor } from './admin-response-editor';

interface PageProps {
  params: Promise<{ id: string; responseId: string }>;
}

export const dynamic = 'force-dynamic';

export const metadata = { title: '응답 수정' };

export default async function AdminResponseEditPage({ params }: PageProps) {
  const { id: surveyId, responseId } = await params;
  await requireSurveyOwnership(surveyId);

  const response = await getResponseById(responseId, { includeDeleted: true });
  if (!response || response.surveyId !== surveyId) notFound();

  if (response.deletedAt !== null) {
    return (
      <main className="mx-auto max-w-xl px-6 py-12">
        <h1 className="text-xl font-bold">삭제된 응답입니다</h1>
        <p className="mt-2 text-sm text-slate-500">
          이 응답은 휴지통에 있습니다. 응답 내역에서 복원한 뒤 다시 시도하세요.
        </p>
      </main>
    );
  }

  // 응답 작성 당시의 questions 스냅샷 로드
  const version = response.versionId
    ? await db.query.surveyVersions.findFirst({
        where: eq(surveyVersions.id, response.versionId),
      })
    : null;

  return (
    <AdminResponseEditor
      surveyId={surveyId}
      responseId={responseId}
      initialResponses={response.questionResponses as Record<string, unknown>}
      versionSnapshot={version?.snapshot ?? null}
      idx={null /* 표에서 넘긴 idx 가 없으므로 헤더에서 별도 조회하거나 # 만 노출 */}
    />
  );
}
```

`SaveAdminEditPayload` 등 신규 타입은 Task 15에서 정의되므로 여기서는 직접 참조하지 않는다.

- [ ] **Step 3: tsc 통과 확인**

`AdminResponseEditor`가 아직 없으므로 컴파일 에러. Task 15로 즉시 이어간다.

---

## Task 15: admin-response-editor (client wrapper) + saveAdminEdit action

**Files:**
- Create: `src/app/admin/surveys/[id]/operations/profiles/[responseId]/edit/admin-response-editor.tsx`
- Modify: `src/actions/profiles-row-actions.ts` (saveAdminEdit 추가)
- Modify: `tests/integration/profiles-row-actions.test.ts`

- [ ] **Step 1: response_answers 재기록 로직 위치 파악**

```bash
grep -n "responseAnswers\|response_answers" src/actions/response-actions.ts | head -10
```
Expected: `completeResponse` 안에서 INSERT 하는 로직 위치 (라인 600 부근).

해당 로직을 `src/actions/profiles-row-actions.ts` 또는 별도 헬퍼 파일로 추출할지, completeResponse 호출로 재사용할지 결정. 추천: 헬퍼 추출.

- [ ] **Step 2: replaceResponseAnswers 헬퍼 추출**

`src/actions/response-answers-replace.ts` 신규 (또는 동일 파일 안에):

```ts
import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { responseAnswers, questions, type Question } from '@/db/schema';

/**
 * questionResponses (JSONB)를 response_answers 정규화 테이블에 재기록한다.
 * 기존 행은 모두 삭제 후 신규 INSERT.
 *
 * tx 인자가 주어지면 그 트랜잭션 안에서 실행.
 */
export async function replaceResponseAnswers(
  tx: typeof db,
  responseId: string,
  surveyId: string,
  questionResponsesMap: Record<string, unknown>,
) {
  await tx.delete(responseAnswers).where(eq(responseAnswers.responseId, responseId));

  const surveyQuestions = await tx.query.questions.findMany({
    where: eq(questions.surveyId, surveyId),
    columns: { id: true, type: true },
  });

  const rows = buildResponseAnswerRows(
    responseId,
    surveyQuestions,
    questionResponsesMap,
  );
  if (rows.length > 0) {
    await tx.insert(responseAnswers).values(rows);
  }
}
```

`buildResponseAnswerRows` 함수는 `completeResponse` 내부의 normalization 로직과 동일해야 한다. Step 1에서 본 원본 코드를 그대로 함수로 분리. 기존 `completeResponse`도 새 헬퍼를 호출하도록 수정해 중복 제거 (DRY).

- [ ] **Step 3: profiles-row-actions.ts에 saveAdminEdit 추가**

```ts
import { replaceResponseAnswers } from './response-answers-replace';

interface SaveAdminEditPayload {
  questionResponses: Record<string, unknown>;
}

export async function saveAdminEdit(
  surveyId: string,
  responseId: string,
  payload: SaveAdminEditPayload,
) {
  await requireSurveyOwnership(surveyId);

  const existing = await db.query.surveyResponses.findFirst({
    where: and(
      eq(surveyResponses.id, responseId),
      eq(surveyResponses.surveyId, surveyId),
    ),
  });
  if (!existing) throw new Error('Response not found');
  if (existing.deletedAt !== null) {
    throw new Error('Cannot edit deleted response');
  }

  const now = new Date();
  const totalSeconds = existing.completedAt
    ? Math.floor((existing.completedAt.getTime() - existing.startedAt.getTime()) / 1000)
    : null;

  await db.transaction(async (tx) => {
    await tx
      .update(surveyResponses)
      .set({
        questionResponses: payload.questionResponses,
        lastEditedAt: now,
        lastActivityAt: now,
        currentStepId: null,
        totalSeconds,
      })
      .where(eq(surveyResponses.id, responseId));

    await replaceResponseAnswers(
      tx as typeof db,
      responseId,
      surveyId,
      payload.questionResponses,
    );
  });

  revalidate(surveyId);
  return { ok: true as const };
}
```

`completedAt`, `status`, `startedAt` 은 set 하지 않음 (명시적 보존). spread 사용 금지 — memory `feedback_survey_save_explicit_fields`.

- [ ] **Step 4: admin-response-editor.tsx 작성**

```tsx
'use client';

import { useRouter } from 'next/navigation';

import { saveAdminEdit } from '@/actions/profiles-row-actions';
import { SurveyResponseFlow } from '@/components/survey-response/survey-response-flow';
import type { SurveyVersionSnapshot } from '@/types/survey';

interface Props {
  surveyId: string;
  responseId: string;
  initialResponses: Record<string, unknown>;
  versionSnapshot: SurveyVersionSnapshot | null;
  idx: number | null;
}

export function AdminResponseEditor({
  surveyId,
  responseId,
  initialResponses,
  versionSnapshot,
  idx,
}: Props) {
  const router = useRouter();

  return (
    <div>
      <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 text-amber-900 text-sm">
        어드민 수정 모드 — 응답 {idx === null ? '' : `#${idx} `}· 응답자 흐름과 동일하게 보입니다.
      </div>
      <SurveyResponseFlow
        mode="admin-edit"
        surveyIdentifier={surveyId}
        adminContext={{
          responseId,
          surveyId,
          initialResponses,
          versionSnapshot,
          onSubmit: async (payload) => {
            await saveAdminEdit(surveyId, responseId, payload);
            router.push(`/admin/surveys/${surveyId}/operations/profiles`);
          },
        }}
      />
    </div>
  );
}
```

`SurveyResponseFlow`의 admin-edit 분기는 step 5에서 구현.

- [ ] **Step 5: SurveyResponseFlow에 admin-edit 분기 추가**

`src/components/survey-response/survey-response-flow.tsx`에서 다음 동작을 분기한다:

| 동작 | public 모드 | admin-edit 모드 |
|---|---|---|
| survey 로드 | `getSurveyForResponse` 호출 | `versionSnapshot`에서 복원 (props로 받음) |
| 초기 응답 상태 | `resumeOrCreateResponse` | `initialResponses` prefill, 신규 행 INSERT 없음 |
| 단계 이동 시 `recordStepVisit` | 호출 | **호출하지 않음** (lastActivityAt이 무의미해짐 — saveAdminEdit이 갱신) |
| 단계 이동 시 `markPageLeaveTime` | 호출 | **호출하지 않음** |
| 자동 저장 `updateQuestionResponse` | 호출 | **호출하지 않음** — 마지막 submit 시점에 saveAdminEdit이 일괄 갱신 |
| 완료 버튼 동작 | `completeResponse` 호출 후 thank-you | `props.adminContext.onSubmit(payload)` 호출 후 router.push |
| 중복 차단 `checkDuplicateOnEntry` | 호출 | **호출하지 않음** |
| inviteToken / contact-attrs lookup | 호출 | **호출하지 않음** (versionSnapshot에 attrs 미포함 시 빈 객체로) |

코드 변경 패턴:
```ts
const isAdminEdit = props.mode === 'admin-edit';

useEffect(() => {
  if (isAdminEdit) {
    // versionSnapshot에서 survey/questions/groups 복원
    setSurvey(props.adminContext!.versionSnapshot!.survey);
    setQuestions(props.adminContext!.versionSnapshot!.questions);
    setGroups(props.adminContext!.versionSnapshot!.groups);
    setResponses(props.adminContext!.initialResponses);
    return;
  }
  // 기존 public 로직
}, [isAdminEdit, /* deps */]);

// updateQuestionResponse 호출 직전:
if (!isAdminEdit) {
  await updateQuestionResponse(/* ... */);
}

// completeResponse 호출 직전:
if (isAdminEdit) {
  await props.adminContext!.onSubmit({ questionResponses: responses });
  return;
}
await completeResponse(/* ... */);
```

`versionSnapshot` 의 구조는 schema의 `SurveyVersionSnapshot` 타입을 따른다. snapshot이 expected 구조와 다르면 fallback 으로 surveys.id 직접 SELECT 도 가능 (응답이 오래된 published 이전 응답일 때만 발생) — 본 작업 범위 안에서는 snapshot 우선, null 인 경우는 surveys 직접 조회.

- [ ] **Step 6: saveAdminEdit 통합 테스트 추가**

`tests/integration/profiles-row-actions.test.ts`에 추가:

```ts
describe('saveAdminEdit', () => {
  it('updates questionResponses and preserves completedAt', async () => {
    const { surveyId } = await createTestSurvey();
    const responseId = await createTestResponse(surveyId, {
      status: 'completed',
      questionResponses: { q1: 'old' },
    });
    const before = await db.query.surveyResponses.findFirst({
      where: eq(surveyResponses.id, responseId),
    });

    await saveAdminEdit(surveyId, responseId, {
      questionResponses: { q1: 'new' },
    });

    const after = await db.query.surveyResponses.findFirst({
      where: eq(surveyResponses.id, responseId),
    });
    expect((after?.questionResponses as { q1: string }).q1).toBe('new');
    expect(after?.completedAt?.getTime()).toBe(before?.completedAt?.getTime());
    expect(after?.lastEditedAt).not.toBeNull();
  });

  it('rejects edit on deleted response', async () => {
    const { surveyId } = await createTestSurvey();
    const responseId = await createTestResponse(surveyId);
    await softDeleteResponse(surveyId, responseId);

    await expect(
      saveAdminEdit(surveyId, responseId, { questionResponses: {} }),
    ).rejects.toThrow('Cannot edit deleted response');
  });

  it('rewrites response_answers', async () => {
    // questionResponses 변경 후 responseAnswers에서 신규 답 확인, 옛 답 없음
  });
});
```

- [ ] **Step 7: 테스트 실행**

```bash
pnpm vitest run tests/integration/profiles-row-actions.test.ts
```
Expected: 모든 case PASS.

- [ ] **Step 8: tsc + dev 수동 검증**

```bash
pnpm tsc --noEmit
```
Expected: 0 errors.

```bash
pnpm dev
```
- profiles 표에서 kebab → 수정 → 새 탭으로 어드민 라우트 진입
- amber 배너 노출
- prefill 된 응답 값 확인
- 한 답을 변경 후 완료 버튼
- profiles 로 redirect, 종료일시 변동 없음 확인

dev 서버 종료.

- [ ] **Step 9: 커밋**

```bash
git add src/actions/profiles-row-actions.ts \
        src/actions/response-answers-replace.ts \
        "src/app/admin/surveys/[id]/operations/profiles/[responseId]/edit" \
        src/components/survey-response/survey-response-flow.tsx \
        tests/integration/profiles-row-actions.test.ts
git commit -m "feat: 어드민 응답 수정 라우트와 saveAdminEdit 액션 추가"
```

---

## Task 16: 회귀 방어 grep + 최종 검증

- [ ] **Step 1: deletedAt 누락 grep 가드 실행**

```bash
grep -rn "from(surveyResponses)\|surveyResponses)\.where\|.from(.*surveyResponses" src/ \
  | grep -v "deletedAt\|INSERT\|insert(\|update(" \
  | grep -v "response-actions.ts" \
  | grep -v ".test.ts"
```
Expected 결과 한 줄씩 확인 후 다음 중 하나로 분류:
1. INSERT/UPDATE 본인 행 타게팅 — 무시
2. `isNull(deletedAt)` 이미 적용됨 — 무시
3. 의도된 deleted view 분기 (profiles.server.ts) — 무시
4. 그 외 — 누락. 해당 위치에 isNull 추가 후 추가 커밋.

분류 결과를 PR description의 "Verification" 섹션에 첨부.

- [ ] **Step 2: 전체 vitest 실행**

```bash
pnpm vitest run
```
Expected: 모든 기존 test + 신규 통합 test PASS.

- [ ] **Step 3: tsc 전체 통과**

```bash
pnpm tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: production build**

```bash
pnpm build
```
Expected: 0 errors. Turbopack 빌드 성공 메시지.

- [ ] **Step 5: dev에서 종합 수동 검증**

```bash
pnpm dev
```
체크리스트 (PR description에 그대로 첨부):
- [ ] 활성 응답 1건 soft delete → profiles 활성 뷰에서 사라짐
- [ ] overview 페이지 completed 카운트 1 감소
- [ ] report 진척률 분모/분자 반영 (해당 컨택 그룹)
- [ ] export 엑셀 다운로드 결과에 삭제된 응답 없음
- [ ] 같은 응답을 복원 → 위 모든 변화 원복
- [ ] 다른 응답을 초기화 → 행 자체 사라짐, contact 진척 상태 미응답으로 복원, inviteToken으로 같은 응답자 재진입 시 새 응답 시작
- [ ] 수정 → 새 탭에서 응답 페이지가 prefill 된 상태로 열림
- [ ] 답을 일부 변경 후 완료 → profiles로 redirect, 종료일시 동일, lastEditedAt 컬럼에 시각 기록 (DB 직접 확인)
- [ ] 어드민이 자신이 아닌 다른 user 의 survey 응답 URL을 직접 입력 → 가드 차단

dev 서버 종료.

- [ ] **Step 6: PR 생성**

```bash
git push -u origin feat/response-row-actions
gh pr create --title "feat: 응답 내역 행 액션 — 수정·삭제·초기화" --body "$(cat <<'EOF'
## Summary
- 운영 콘솔 profiles 표 끝에 kebab 액션 메뉴 추가. 수정·삭제(soft)·초기화(hard) 3종.
- `surveyResponses.deletedAt`의 통계·리스트·export 사각지대를 일괄 차단. data layer 6 함수, operations 5 파일, export API 2 쿼리에 `isNull` 추가.
- 어드민 수정 라우트 신규 (응답 페이지 본문을 SurveyResponseFlow로 추출해 admin-edit 모드로 재사용). 종료일시 보존, lastEditedAt 컬럼 신규 기록.
- 호출자 0건이던 hard-delete server actions 4개 + 관련 hooks 3개 제거.

## Spec / Plan
- Design: `docs/superpowers/specs/2026-05-27-response-row-actions-design.md`
- Plan: `docs/superpowers/plans/2026-05-27-response-row-actions.md`

## Verification

### grep 가드 결과
<step 1의 결과 첨부>

### 자동 검증
- pnpm tsc --noEmit: 0 errors
- pnpm vitest run: all PASS
- pnpm build: success

### 수동 검증 체크리스트
<step 5의 체크리스트 그대로 첨부, 모두 ✓ 표시>
EOF
)"
```

PR URL을 사용자에게 보고하고 종료.

---

## Spec 커버리지 (self-check)

| Spec 섹션 | 다루는 Task |
|---|---|
| 2.1 진입점 (kebab) | 9, 10 |
| 2.2 휴지통 status 통합 | 7 |
| 2.3 수정 흐름 | 13, 14, 15 |
| 3.1 lastEditedAt 컬럼 | 1 |
| 3.2 deletedAt 인덱스 | 1 |
| 3.4 contact_targets 연동 | 8 (hardReset 안에) |
| 4.1 actions 컬럼 | 10 |
| 4.2 filter-bar 확장 | 7 |
| 4.3 휴지통 헤더 | 11 |
| 4.4 수정 라우트 | 13, 14, 15 |
| 5.1 신규 server actions | 8 |
| 5.2 saveAdminEdit | 15 |
| 5.3 dead code 제거 | 2 |
| 6.1 data layer | 4 |
| 6.2 operations layer | 5, 7 |
| 6.3 export API | 6 |
| 6.4 자동 보호 영역 | 4 + 5 가 커버 (분석/RSC는 data/operations 호출) |
| 6.5 응답자 동선 | 변경 불필요 (out of scope) |
| 7 테스트 | 8, 12, 15 |
| 8 회귀 방어 grep | 16 |
| 9 비범위 | (구현 안 함) |
| 10 영향 받는 파일 | 1~15 전체 |

모든 spec 요구사항이 task로 매핑됨.
