# 결과코드 negative 모집단 제외 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ContactResultCode` 에 3-way `status` enum (positive/neutral/negative) 을 추가하고, negative 코드는 응답률 분자·분모·Profiles 노출·단체메일 발송·응답 페이지 진입 5곳에서 일괄 제외되도록 `unsubscribed_at` OR 결합으로 통합한다.

**Architecture:**
- JSONB 필드 optional 추가 — DDL 변경 0. `getResultCodeStatuses(surveyId)` 헬퍼 한 곳에 fallback (1.조사완료 → positive) 캡슐화.
- positive/negative 코드 추출 헬퍼를 모든 차단·집계 SQL 이 재사용. `unsubscribed_at` 컬럼과 OR 결합으로 두 시스템 자연 통합.
- 응답 페이지 차단은 기존 `AlreadyRespondedView` 컴포넌트 재활용, `BlockReason` 타입에 케이스 1개만 추가.
- contact_attempts 신규 인덱스 1개로 EXISTS subquery 성능 보장.

**Tech Stack:** Next.js 16 (App Router), Drizzle ORM, PostgreSQL (Supabase), React 19, shadcn/ui (Select), vitest (integration tests), Supabase MCP `apply_migration`.

**Spec:** `docs/superpowers/specs/2026-05-28-result-code-negative-exclusion-design.md` (commit 19e9461).

---

## File Structure

### 신규 파일

| 경로 | 책임 |
|---|---|
| `tests/unit/result-code-statuses.test.ts` | `getResultCodeStatuses` fallback 단위 검증 |
| `tests/integration/report-progress-exclusion.test.ts` | report SQL negative 적용 검증 |
| `tests/integration/profiles-exclusion.test.ts` | profiles SQL negative 적용 검증 |
| `tests/integration/preflight-exclusion.test.ts` | preflight 분기·후보 쿼리 검증 |
| `tests/integration/invite-token-excluded.test.ts` | `lookupContactByInviteToken` 의 excluded 분기 검증 |

### 수정 파일

| 경로 | 변경 요지 |
|---|---|
| `src/db/schema/schema-types.ts` | `ResultCodeStatus` 타입, `ContactResultCode.status?`, DEFAULT 13개 매핑 |
| `src/lib/operations/result-code-statuses.ts` (신규) | positive/negative 코드 추출 + fallback 헬퍼 |
| `src/lib/operations/report-progress.ts` | `CLOSING_RESULT_CODES` 삭제, `computeTotals` 에 `excludedTotal` 추가, `ProgressRow/Totals` 확장 |
| `src/lib/operations/report-progress.server.ts` | closingFilter 동적화 + excludeFilter 신규 + 분모/분자 SQL 변경 |
| `src/lib/duplicate-detection/types.ts` | `BlockReason` 에 `excluded_from_population` 추가 |
| `src/components/survey/already-responded-view.tsx` | MESSAGES 에 신규 케이스 1개 |
| `src/actions/response-actions.ts` | `lookupContactByInviteToken` 의 excluded 분기, saveResponse·startResponse race guard |
| `src/components/survey-response/survey-response-flow.tsx` | excluded reason 분기 (이미 AlreadyRespondedView 호출 패턴 존재) |
| `src/lib/operations/campaigns.server.ts` | `buildNotExcludedByNegativeCode` 헬퍼, `buildCandidateWhere` 추가, `preflightRecipients` 분기 |
| `src/components/operations/mail-campaign/campaign-wizard.tsx` | preflight summary "조사 대상 제외: N명" + 후보 도움말 수정 |
| `src/lib/operations/profiles.server.ts` | base subquery WHERE 에 excludeFilter NOT EXISTS |
| `src/app/admin/surveys/[id]/operations/profiles/[responseId]/page.tsx` | 헤더 inline 배지 |
| `src/components/operations/contacts/result-codes-editor.tsx` | '상태' 컬럼, Select 컨트롤, dot, validation, 도움말 |

### DB 마이그레이션 (Supabase MCP)

| 마이그레이션 | 내용 |
|---|---|
| `add_contact_attempts_target_result_idx` | `CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_contact_attempts_target_result ON contact_attempts(contact_target_id, result_code)` |

---

## Task 0: contact_attempts 인덱스 마이그레이션

**Files:** Supabase MCP `apply_migration` (수동 SQL, drizzle 파일 생성 안 함 — memory `feedback_drizzle_migrate_journal.md`)

- [ ] **Step 1: 현재 인덱스 상태 확인**

Supabase MCP 로 실행:
```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'contact_attempts';
```

기대 결과: `contact_attempts_target_no_unique` (target_id, attempt_no) 만 존재. `result_code` 단독 또는 (target_id, result_code) 인덱스 없음.

- [ ] **Step 2: 마이그레이션 적용**

Supabase MCP `apply_migration` 호출:
- name: `add_contact_attempts_target_result_idx`
- query:
```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_contact_attempts_target_result
  ON contact_attempts(contact_target_id, result_code);
```

- [ ] **Step 3: 인덱스 생성 확인**

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'contact_attempts'
  AND indexname = 'ix_contact_attempts_target_result';
```

기대 결과: 1행 반환.

- [ ] **Step 4: Commit (drizzle 마이그레이션 파일 없이 plan 노트만)**

```bash
# 마이그레이션은 Supabase MCP 로 적용 완료. 코드 변경 없음.
# 다음 task 로.
```

---

## Task 1: ContactResultCode 모델 + DEFAULT 매핑

**Files:**
- Modify: `src/db/schema/schema-types.ts:383-414`

- [ ] **Step 1: ResultCodeStatus 타입 + ContactResultCode.status 추가**

[schema-types.ts:382](src/db/schema/schema-types.ts#L382) 위에 타입 추가, ContactResultCode interface 수정:

```ts
/** 결과코드 상태 — 응답률·모집단 처리 분류. */
export type ResultCodeStatus = 'positive' | 'negative' | 'neutral';

/** 결과코드 1개 정의 — surveys.contact_result_codes JSONB 안의 항목 */
export interface ContactResultCode {
  /** UI 표시 코드 (예: '1.조사완료'). 사용자 자유 텍스트. */
  code: string;
  /** UI 라벨 (코드와 동일하게 두는 게 일반적) */
  label: string;
  /** 정렬 순서 */
  order: number;
  /**
   * pill 색상 톤. mockup 의 컨택결과 이력 표 색상 매칭용.
   */
  tone?: 'green' | 'amber' | 'rose' | 'blue' | 'slate';
  /**
   * 응답률·모집단 처리.
   * - 'positive': 응답 완료로 인정 (응답률 분자)
   * - 'neutral': 응답률 분모에만 포함
   * - 'negative': 모집단 완전 제외 — 응답률·단체메일·응답 페이지 모두 제거
   *
   * 누락 (undefined) 시 fallback:
   * - code === '1.조사완료' → 'positive' (backward compat)
   * - 그 외 → 'neutral'
   * 사용자가 빌더에서 한 번 저장하면 명시 status 박힘 → fallback 우회.
   */
  status?: ResultCodeStatus;
}
```

- [ ] **Step 2: DEFAULT_RESULT_CODES 매핑 업데이트**

[schema-types.ts:400-414](src/db/schema/schema-types.ts#L400-L414):

```ts
/**
 * surveys.contact_result_codes 가 NULL 일 때 사용되는 디폴트 13개.
 * mockup §6 의 결과코드 라디오 그대로.
 *
 * status 매핑:
 * - '1.조사완료' → 'positive' (응답 완료 인정)
 * - '수신거부' → 'negative' (모집단 제외)
 * - 나머지 11개 → 필드 생략 (= 'neutral')
 */
export const DEFAULT_RESULT_CODES: ContactResultCode[] = [
  { code: '1.조사완료', label: '1.조사완료', order: 1, tone: 'green', status: 'positive' },
  { code: '2.재통화예약', label: '2.재통화예약', order: 2, tone: 'blue' },
  { code: '3.비수신', label: '3.비수신', order: 3, tone: 'slate' },
  { code: '4.부재', label: '4.부재', order: 4, tone: 'slate' },
  { code: '5.출장', label: '5.출장', order: 5, tone: 'slate' },
  { code: '6.거절', label: '6.거절', order: 6, tone: 'rose' },
  { code: '7.결번·번호오류', label: '7.결번·번호오류', order: 7, tone: 'rose' },
  { code: '8.중복', label: '8.중복', order: 8, tone: 'slate' },
  { code: '9.전시회미참가', label: '9.전시회미참가', order: 9, tone: 'slate' },
  { code: '10.메일발송', label: '10.메일발송', order: 10, tone: 'blue' },
  { code: '11.기타', label: '11.기타', order: 11, tone: 'amber' },
  { code: '12.담당자퇴사', label: '12.담당자퇴사', order: 12, tone: 'rose' },
  { code: '수신거부', label: '수신거부', order: 13, tone: 'rose', status: 'negative' },
];
```

- [ ] **Step 3: tsc 검증**

```bash
pnpm tsc --noEmit
```

기대: 0 에러.

- [ ] **Step 4: Commit**

```bash
git add src/db/schema/schema-types.ts
git commit -m "feat: 결과코드에 status enum 필드 추가

- ResultCodeStatus 타입 (positive/neutral/negative)
- ContactResultCode.status? optional 필드
- DEFAULT 매핑: 1.조사완료=positive, 수신거부=negative

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: getResultCodeStatuses 헬퍼 + unit test

**Files:**
- Create: `src/lib/operations/result-code-statuses.ts`
- Create: `tests/unit/result-code-statuses.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

신규 파일 `tests/unit/result-code-statuses.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { extractResultCodeStatuses } from '@/lib/operations/result-code-statuses';
import { DEFAULT_RESULT_CODES, type ContactResultCode } from '@/db/schema/schema-types';

describe('extractResultCodeStatuses', () => {
  it('DEFAULT 13개에서 positive=[1.조사완료], negative=[수신거부]', () => {
    const result = extractResultCodeStatuses(DEFAULT_RESULT_CODES);
    expect(result.positive).toEqual(['1.조사완료']);
    expect(result.negative).toEqual(['수신거부']);
  });

  it('NULL (사용자 정의 안 함) → DEFAULT 적용', () => {
    const result = extractResultCodeStatuses(null);
    expect(result.positive).toEqual(['1.조사완료']);
    expect(result.negative).toEqual(['수신거부']);
  });

  it('명시 status 가 fallback 우선 — 수신거부를 neutral 로 재정의', () => {
    const codes: ContactResultCode[] = [
      { code: '1.조사완료', label: '1.조사완료', order: 1, status: 'positive' },
      { code: '수신거부', label: '수신거부', order: 2, status: 'neutral' },
    ];
    const result = extractResultCodeStatuses(codes);
    expect(result.positive).toEqual(['1.조사완료']);
    expect(result.negative).toEqual([]);
  });

  it('backward compat fallback — status 없고 code=1.조사완료 → positive', () => {
    const codes: ContactResultCode[] = [
      { code: '1.조사완료', label: '1.조사완료', order: 1 },
      { code: '2.재통화예약', label: '2.재통화예약', order: 2 },
    ];
    const result = extractResultCodeStatuses(codes);
    expect(result.positive).toEqual(['1.조사완료']);
    expect(result.negative).toEqual([]);
  });

  it('명시 status 가 fallback 우선 — 1.조사완료를 negative 로 재정의', () => {
    const codes: ContactResultCode[] = [
      { code: '1.조사완료', label: '1.조사완료', order: 1, status: 'negative' },
      { code: '커스텀완료', label: '커스텀완료', order: 2, status: 'positive' },
    ];
    const result = extractResultCodeStatuses(codes);
    expect(result.positive).toEqual(['커스텀완료']);
    expect(result.negative).toEqual(['1.조사완료']);
  });

  it('순서 보존', () => {
    const codes: ContactResultCode[] = [
      { code: 'X', label: 'X', order: 1, status: 'positive' },
      { code: 'A', label: 'A', order: 2, status: 'positive' },
      { code: 'M', label: 'M', order: 3, status: 'negative' },
      { code: 'B', label: 'B', order: 4, status: 'negative' },
    ];
    const result = extractResultCodeStatuses(codes);
    expect(result.positive).toEqual(['X', 'A']);
    expect(result.negative).toEqual(['M', 'B']);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
pnpm vitest run tests/unit/result-code-statuses.test.ts
```

기대: FAIL (모듈 못 찾음).

- [ ] **Step 3: 헬퍼 구현 (pure)**

신규 파일 `src/lib/operations/result-code-statuses.ts`:

```ts
/**
 * 결과코드 status enum 처리 헬퍼.
 *
 * `surveys.contact_result_codes` JSONB 의 status 필드를 응답률·차단 SQL 의
 * positive/negative 코드 배열로 정규화. backward compat fallback 포함:
 * - status 명시 → 그대로 사용
 * - status 누락 + code === '1.조사완료' → positive
 * - 그 외 status 누락 → neutral (배열에 안 들어감)
 *
 * 사용자가 빌더에서 한 번 저장하면 명시 status 박혀 fallback 우회.
 */

import { cache } from 'react';
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { surveys } from '@/db/schema/surveys';
import { DEFAULT_RESULT_CODES, type ContactResultCode } from '@/db/schema/schema-types';

export interface ResultCodeStatuses {
  positive: string[];
  negative: string[];
}

/** pure — 단위 테스트 가능. `getResultCodeStatuses` 가 DB 조회 후 호출. */
export function extractResultCodeStatuses(
  codes: ContactResultCode[] | null,
): ResultCodeStatuses {
  const list = codes ?? DEFAULT_RESULT_CODES;
  const positive: string[] = [];
  const negative: string[] = [];
  for (const c of list) {
    const status = c.status ?? (c.code === '1.조사완료' ? 'positive' : 'neutral');
    if (status === 'positive') positive.push(c.code);
    else if (status === 'negative') negative.push(c.code);
  }
  return { positive, negative };
}

/**
 * `surveys.contact_result_codes` 조회 → extractResultCodeStatuses 적용.
 * `cache()` 로 RSC pass dedupe — 같은 surveyId 다중 호출 1회 query.
 */
export const getResultCodeStatuses = cache(
  async (surveyId: string): Promise<ResultCodeStatuses> => {
    const rows = await db
      .select({ contactResultCodes: surveys.contactResultCodes })
      .from(surveys)
      .where(eq(surveys.id, surveyId))
      .limit(1);
    return extractResultCodeStatuses(rows[0]?.contactResultCodes ?? null);
  },
);
```

- [ ] **Step 4: 테스트 실행 — pass 확인**

```bash
pnpm vitest run tests/unit/result-code-statuses.test.ts
```

기대: PASS 6/6.

- [ ] **Step 5: Commit**

```bash
git add src/lib/operations/result-code-statuses.ts tests/unit/result-code-statuses.test.ts
git commit -m "feat: getResultCodeStatuses 헬퍼 + fallback 단위 테스트

- extractResultCodeStatuses pure 함수: status 명시 우선, 누락 시 1.조사완료→positive fallback
- getResultCodeStatuses: cache() wrapped DB 조회
- 6 단위 케이스 (DEFAULT, NULL, 명시 우선, fallback, 재정의, 순서)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: CLOSING_RESULT_CODES 상수 제거 + closingFilter 동적화

**Files:**
- Modify: `src/lib/operations/report-progress.ts:13-15`
- Modify: `src/lib/operations/report-progress.server.ts:11-34, 185-269`

- [ ] **Step 1: report-progress.ts 의 상수 삭제**

[report-progress.ts:13-15](src/lib/operations/report-progress.ts#L13-L15) 를 삭제:

```ts
// 삭제:
// export const CLOSING_RESULT_CODES = ['1.조사완료'] as const;
```

상수 사용처 검색:
```bash
grep -rn "CLOSING_RESULT_CODES" src/
```

기대: 사용처 없음 (상수가 export 만 되고 호출 안 됨 — Known Limitation 코멘트에서만 언급). 만약 사용처 있으면 별도 step 으로 정리.

- [ ] **Step 2: closingFilter 를 인자 받는 함수로 변경**

[report-progress.server.ts:11-34](src/lib/operations/report-progress.server.ts#L11-L34) 를 교체:

```ts
import 'server-only';

import { cache } from 'react';
import { eq, sql, type SQL } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets } from '@/db/schema/contacts';
import { surveys } from '@/db/schema/surveys';
import type { ContactColumnScheme, ProgressColumnScheme } from '@/db/schema/schema-types';

import type { ProgressRow, ProgressSortKey, SortDir, ProgressTotals } from './report-progress';
import type { FilterCondition } from './progress-filters.server';
import { FILTER_SOURCE, escapeLikePattern } from './filter-shared';
import { getResultCodeStatuses } from './result-code-statuses';

const EMPTY_SCHEME: ProgressColumnScheme = { version: 1, columns: [] };

/**
 * 클로징 정의 W∪A — 두 EXISTS 의 OR.
 *
 * survey_responses.is_completed=true (실제 응답 완료) OR
 * contact_attempts.result_code = ANY(positive codes) (담당자 수동 마감).
 *
 * positive codes 는 `getResultCodeStatuses(surveyId).positive` 동적 추출.
 * DEFAULT 13개에서는 ['1.조사완료'] (기존 하드코딩과 일치).
 *
 * notDeletedResponse 와 동일 의미 (서브쿼리 내부 raw SQL 컨텍스트라 인라인 유지)
 */
function buildClosingFilter(positiveCodes: string[]): SQL {
  const positiveBranch =
    positiveCodes.length === 0
      ? sql`FALSE`
      : sql`EXISTS (SELECT 1 FROM contact_attempts ca
                    WHERE ca.contact_target_id = ct.id AND ca.result_code = ANY(${positiveCodes}))`;
  return sql`
    EXISTS (SELECT 1 FROM survey_responses sr
            WHERE sr.contact_target_id = ct.id AND sr.is_completed = true AND sr.deleted_at IS NULL)
       OR ${positiveBranch}
  `;
}
```

- [ ] **Step 3: getProgressRows / getProgressTotals 에서 closingFilter 사용처 동적화**

[report-progress.server.ts:185](src/lib/operations/report-progress.server.ts#L185) 의 `getProgressRows` 본문 초입에 추가:

```ts
export async function getProgressRows(args: GetProgressRowsArgs): Promise<ProgressRow[]> {
  const { surveyId, condition, page, size, sort, dir, metaKeys } = args;
  const offset = Math.max(0, (page - 1) * size);

  // ↓ 신규: positive codes 추출 + closingFilter 빌드
  const { positive: positiveCodes } = await getResultCodeStatuses(surveyId);
  const closingFilter = buildClosingFilter(positiveCodes);

  // ... 기존 metaSelectSql, sortExpr, filterSql 변수 그대로
```

기존 `closingFilter` (module-scoped) 참조를 함수 내부 local 로 자연 shadow. SQL 본문은 변경 없음 (Task 4 에서 변경).

[report-progress.server.ts:249](src/lib/operations/report-progress.server.ts#L249) 의 `getProgressTotals` 도 동일하게:

```ts
export async function getProgressTotals(
  surveyId: string,
  condition: FilterCondition | null,
): Promise<ProgressTotals> {
  const { positive: positiveCodes } = await getResultCodeStatuses(surveyId);
  const closingFilter = buildClosingFilter(positiveCodes);
  const filterSql = buildFilterSql(condition);
  // ... 기존 SQL 그대로
```

- [ ] **Step 4: tsc + 기존 vitest 회귀 확인**

```bash
pnpm tsc --noEmit
pnpm vitest run
```

기대: 0 에러, 기존 모든 테스트 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/operations/report-progress.ts src/lib/operations/report-progress.server.ts
git commit -m "refactor: closingFilter 동적화 + CLOSING_RESULT_CODES 상수 제거

- buildClosingFilter(positiveCodes) 함수로 변경
- getResultCodeStatuses 호출 후 positive 배열로 SQL 빌드
- DEFAULT 13개 동작 무변경 (1.조사완료 = positive)
- 코드 코멘트의 slice 6/7 동적화 예고 해소

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: excludeFilter SQL 추가 + 분모/분자 변경

**Files:**
- Modify: `src/lib/operations/report-progress.ts:30-41, 95-111`
- Modify: `src/lib/operations/report-progress.server.ts:185-269`
- Create: `tests/integration/report-progress-exclusion.test.ts`

- [ ] **Step 1: ProgressRow / ProgressTotals 에 excludedCount 추가**

[report-progress.ts:30-41](src/lib/operations/report-progress.ts#L30-L41):

```ts
/** 진척률 표 한 행 (그룹 1개) — SQL 결과를 클라이언트 형태로 변환한 것. */
export interface ProgressRow {
  /** 표시 라벨 — group_value=NULL 인 경우 '(미분류)' */
  groupLabel: string;
  /** 원본 group_value (NULL 식별용) */
  groupValueRaw: string | null;
  /** 그룹 내 MIN(resid) — 표 첫 컬럼 '#' 에 표시. */
  firstResid: number | null;
  /** 분모 (excludeFilter 적용 후). 응답률 계산에 사용. */
  listCount: number;
  /** 분자 (closingFilter AND NOT excludeFilter). */
  completedCount: number;
  /** 부정 결과코드 / unsubscribed_at 으로 모집단에서 제외된 ct 수. */
  excludedCount: number;
  /** key=ProgressColumnDef.key, value=MIN(attrs->>key) 또는 null */
  meta: Record<string, string | null>;
}
```

[report-progress.ts:95-111](src/lib/operations/report-progress.ts#L95-L111):

```ts
export interface ProgressTotals {
  groupCount: number;
  listTotal: number;
  completedTotal: number;
  /** 푸터 합계 — 모집단 제외 ct 누적. */
  excludedTotal: number;
}

/** 푸터 합계 — "총 N개 그룹 · 리스트 합계 X / 완료 Y · 제외 Z". */
export function computeTotals(rows: ProgressRow[]): ProgressTotals {
  return rows.reduce<ProgressTotals>(
    (acc, r) => ({
      groupCount: acc.groupCount + 1,
      listTotal: acc.listTotal + r.listCount,
      completedTotal: acc.completedTotal + r.completedCount,
      excludedTotal: acc.excludedTotal + r.excludedCount,
    }),
    { groupCount: 0, listTotal: 0, completedTotal: 0, excludedTotal: 0 },
  );
}
```

- [ ] **Step 2: excludeFilter 빌더 + SQL 변경**

[report-progress.server.ts](src/lib/operations/report-progress.server.ts) 의 `buildClosingFilter` 아래에 신규:

```ts
/**
 * 모집단 제외 정의 — negative codes OR unsubscribed_at.
 *
 * EXISTS 의 any-time 의미 — 한 회차라도 negative 코드 받으면 제외.
 * `unsubscribed_at IS NOT NULL` 도 자동 negative 효과 (메일 푸터 unsubscribe 흐름).
 *
 * negative codes 빈 배열이면 unsubscribed_at 만 평가.
 */
function buildExcludeFilter(negativeCodes: string[]): SQL {
  const codeBranch =
    negativeCodes.length === 0
      ? sql`FALSE`
      : sql`EXISTS (SELECT 1 FROM contact_attempts ca
                    WHERE ca.contact_target_id = ct.id AND ca.result_code = ANY(${negativeCodes}))`;
  return sql`${codeBranch} OR ct.unsubscribed_at IS NOT NULL`;
}
```

`getProgressRows` 본문 변경 — positive 만 가져오던 호출을 negative 도 함께, SQL 의 SELECT 절 변경:

```ts
export async function getProgressRows(args: GetProgressRowsArgs): Promise<ProgressRow[]> {
  const { surveyId, condition, page, size, sort, dir, metaKeys } = args;
  const offset = Math.max(0, (page - 1) * size);

  const { positive: positiveCodes, negative: negativeCodes } =
    await getResultCodeStatuses(surveyId);
  const closingFilter = buildClosingFilter(positiveCodes);
  const excludeFilter = buildExcludeFilter(negativeCodes);

  const metaSelectSql = metaKeys
    .map((k, i) => sql`MIN(ct.attrs->>${k}) AS ${sql.identifier(`meta_${i}`)}`)
    .reduce<ReturnType<typeof sql>>(
      (acc, cur, i) => (i === 0 ? cur : sql`${acc}, ${cur}`),
      sql``,
    );

  let sortExpr;
  if (sort.startsWith('meta:')) {
    const key = sort.slice(5);
    const idx = metaKeys.indexOf(key);
    sortExpr =
      idx >= 0 ? sql.raw(`meta_${idx}`) : sql.raw(SORT_COL_MAP.responseRate);
  } else {
    const mapped = SORT_COL_MAP[sort as Exclude<ProgressSortKey, `meta:${string}`>];
    sortExpr = sql.raw(mapped ?? SORT_COL_MAP.responseRate);
  }
  const dirSql = dir === 'asc' ? sql.raw('ASC') : sql.raw('DESC');

  const filterSql = buildFilterSql(condition);

  const result = await db.execute(sql`
    SELECT * FROM (
      SELECT
        COALESCE(ct.group_value, '(미분류)') AS group_label,
        ct.group_value AS group_value_raw,
        MIN(ct.resid)::int AS first_resid,
        COUNT(*) FILTER (WHERE ${excludeFilter})::int AS excluded_count,
        COUNT(*) FILTER (WHERE NOT (${excludeFilter}))::int AS list_count,
        COUNT(*) FILTER (WHERE (${closingFilter}) AND NOT (${excludeFilter}))::int AS completed_count
        ${metaKeys.length > 0 ? sql`, ${metaSelectSql}` : sql``}
      FROM contact_targets ct
      WHERE ct.survey_id = ${surveyId}
        AND ${filterSql}
      GROUP BY ct.group_value
    ) sub
    ORDER BY ${sortExpr} ${dirSql} NULLS LAST, group_value_raw NULLS LAST
    LIMIT ${size} OFFSET ${offset}
  `);

  return (result as unknown as Array<Record<string, unknown>>).map((r) => {
    const meta: Record<string, string | null> = {};
    metaKeys.forEach((k, i) => {
      const v = r[`meta_${i}`];
      meta[k] = typeof v === 'string' && v.length > 0 ? v : null;
    });
    return {
      groupLabel: String(r.group_label),
      groupValueRaw: r.group_value_raw == null ? null : String(r.group_value_raw),
      firstResid: r.first_resid == null ? null : Number(r.first_resid),
      listCount: Number(r.list_count),
      completedCount: Number(r.completed_count),
      excludedCount: Number(r.excluded_count),
      meta,
    };
  });
}
```

`getProgressTotals` 도 동일 패턴:

```ts
export async function getProgressTotals(
  surveyId: string,
  condition: FilterCondition | null,
): Promise<ProgressTotals> {
  const { positive: positiveCodes, negative: negativeCodes } =
    await getResultCodeStatuses(surveyId);
  const closingFilter = buildClosingFilter(positiveCodes);
  const excludeFilter = buildExcludeFilter(negativeCodes);
  const filterSql = buildFilterSql(condition);
  const result = await db.execute(sql`
    SELECT
      COUNT(DISTINCT COALESCE(ct.group_value, '(미분류)'))::int AS group_count,
      COUNT(*) FILTER (WHERE NOT (${excludeFilter}))::int AS list_total,
      COUNT(*) FILTER (WHERE (${closingFilter}) AND NOT (${excludeFilter}))::int AS completed_total,
      COUNT(*) FILTER (WHERE ${excludeFilter})::int AS excluded_total
    FROM contact_targets ct
    WHERE ct.survey_id = ${surveyId}
      AND ${filterSql}
  `);
  const r = (result as unknown as Array<Record<string, unknown>>)[0] ?? {};
  return {
    groupCount: Number(r.group_count ?? 0),
    listTotal: Number(r.list_total ?? 0),
    completedTotal: Number(r.completed_total ?? 0),
    excludedTotal: Number(r.excluded_total ?? 0),
  };
}
```

- [ ] **Step 3: ProgressTotals/Row 소비자 회귀 점검**

```bash
grep -rn "ProgressTotals\|ProgressRow\|completedTotal\|excludedTotal" src/components src/app | head -30
```

기대: ProgressTotals 사용처가 새 필드를 모르고 깨지는지 점검. excludedTotal 미사용은 OK (추가 노출은 Task 별건으로 가능). 타입 에러 0 이면 다음 step.

- [ ] **Step 4: integration test 작성**

신규 파일 `tests/integration/report-progress-exclusion.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterAll } from 'vitest';

import { db } from '@/db';
import { surveys } from '@/db/schema/surveys';
import { contactTargets, contactAttempts } from '@/db/schema/contacts';
import { surveyResponses } from '@/db/schema/surveys';
import { getProgressRows, getProgressTotals } from '@/lib/operations/report-progress.server';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';

const TEST_SURVEY_TAG = '__test_progress_exclusion__';

async function cleanup() {
  await db.delete(surveys).where(sql`${surveys.title} = ${TEST_SURVEY_TAG}`);
}

interface SeedContact {
  groupValue: string;
  attempts?: string[];
  responded?: boolean;
  unsubscribed?: boolean;
}

async function seed(contactResultCodes: unknown | null, contacts: SeedContact[]) {
  const surveyId = randomUUID();
  await db.insert(surveys).values({
    id: surveyId,
    title: TEST_SURVEY_TAG,
    slug: `test-${surveyId}`,
    privateToken: randomUUID(),
    settings: {
      isPublic: false,
      allowMultipleResponses: false,
      showProgressBar: false,
      shuffleQuestions: false,
      requireLogin: false,
      thankYouMessage: '',
    },
    thankYouMessage: '',
    contactResultCodes: contactResultCodes as never,
  });

  for (const c of contacts) {
    const ctId = randomUUID();
    await db.insert(contactTargets).values({
      id: ctId,
      surveyId,
      resid: 1,
      groupValue: c.groupValue,
      attrs: {},
      inviteToken: randomUUID(),
      unsubscribedAt: c.unsubscribed ? new Date() : null,
    });
    if (c.attempts) {
      for (let i = 0; i < c.attempts.length; i++) {
        await db.insert(contactAttempts).values({
          contactTargetId: ctId,
          attemptNo: i + 1,
          resultCode: c.attempts[i],
        });
      }
    }
    if (c.responded) {
      await db.insert(surveyResponses).values({
        surveyId,
        contactTargetId: ctId,
        isCompleted: true,
        questionResponses: {},
      });
    }
  }
  return surveyId;
}

describe('getProgressTotals — negative exclusion', () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  it('DEFAULT codes — 수신거부 마킹 ct 는 분모/분자에서 제외', async () => {
    const surveyId = await seed(null, [
      { groupValue: 'A', responded: true },                  // 분자+분모
      { groupValue: 'A', attempts: ['1.조사완료'] },          // 분자+분모
      { groupValue: 'A' },                                    // 분모만
      { groupValue: 'A', attempts: ['수신거부'] },            // 제외
    ]);
    const totals = await getProgressTotals(surveyId, null);
    expect(totals.listTotal).toBe(3);
    expect(totals.completedTotal).toBe(2);
    expect(totals.excludedTotal).toBe(1);
  });

  it('unsubscribed_at IS NOT NULL 도 제외', async () => {
    const surveyId = await seed(null, [
      { groupValue: 'A', responded: true },
      { groupValue: 'A', unsubscribed: true },                // 제외
    ]);
    const totals = await getProgressTotals(surveyId, null);
    expect(totals.listTotal).toBe(1);
    expect(totals.completedTotal).toBe(1);
    expect(totals.excludedTotal).toBe(1);
  });

  it('exclude 우선 — 응답 완료해도 negative 면 분자/분모 제외', async () => {
    const surveyId = await seed(null, [
      { groupValue: 'A', responded: true, attempts: ['수신거부'] },  // 제외
      { groupValue: 'A', responded: true },                          // 분자+분모
    ]);
    const totals = await getProgressTotals(surveyId, null);
    expect(totals.listTotal).toBe(1);
    expect(totals.completedTotal).toBe(1);
    expect(totals.excludedTotal).toBe(1);
  });

  it('사용자 정의 — 신규 positive 코드 인정', async () => {
    const surveyId = await seed(
      [
        { code: '1.조사완료', label: '1.조사완료', order: 1, status: 'positive' },
        { code: '추가완료', label: '추가완료', order: 2, status: 'positive' },
        { code: '수신거부', label: '수신거부', order: 3, status: 'negative' },
      ],
      [
        { groupValue: 'A', attempts: ['추가완료'] },           // 분자
        { groupValue: 'A', attempts: ['1.조사완료'] },         // 분자
        { groupValue: 'A' },                                    // 분모만
      ],
    );
    const totals = await getProgressTotals(surveyId, null);
    expect(totals.listTotal).toBe(3);
    expect(totals.completedTotal).toBe(2);
    expect(totals.excludedTotal).toBe(0);
  });

  it('fallback — status 없고 1.조사완료 만 positive 로 자동 인정', async () => {
    const surveyId = await seed(
      [
        { code: '1.조사완료', label: '1.조사완료', order: 1 },
        { code: '2.재통화예약', label: '2.재통화예약', order: 2 },
      ],
      [
        { groupValue: 'A', attempts: ['1.조사완료'] },         // 분자
        { groupValue: 'A', attempts: ['2.재통화예약'] },       // 분모만
      ],
    );
    const totals = await getProgressTotals(surveyId, null);
    expect(totals.listTotal).toBe(2);
    expect(totals.completedTotal).toBe(1);
    expect(totals.excludedTotal).toBe(0);
  });
});

describe('getProgressRows — 그룹별 excludedCount', () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  it('그룹별 분자/분모/제외 카운트', async () => {
    const surveyId = await seed(null, [
      { groupValue: 'A', responded: true },
      { groupValue: 'A' },
      { groupValue: 'A', attempts: ['수신거부'] },
      { groupValue: 'B', responded: true },
      { groupValue: 'B', attempts: ['수신거부'] },
    ]);
    const rows = await getProgressRows({
      surveyId,
      condition: null,
      page: 1,
      size: 100,
      sort: 'groupLabel',
      dir: 'asc',
      metaKeys: [],
    });
    const a = rows.find((r) => r.groupLabel === 'A')!;
    const b = rows.find((r) => r.groupLabel === 'B')!;
    expect(a.listCount).toBe(2);
    expect(a.completedCount).toBe(1);
    expect(a.excludedCount).toBe(1);
    expect(b.listCount).toBe(1);
    expect(b.completedCount).toBe(1);
    expect(b.excludedCount).toBe(1);
  });
});
```

- [ ] **Step 5: integration test 실행**

```bash
pnpm vitest run tests/integration/report-progress-exclusion.test.ts
```

기대: PASS 6/6.

- [ ] **Step 6: 전체 vitest 회귀**

```bash
pnpm vitest run
pnpm tsc --noEmit
```

기대: 모두 PASS, 0 에러.

- [ ] **Step 7: Commit**

```bash
git add src/lib/operations/report-progress.ts src/lib/operations/report-progress.server.ts tests/integration/report-progress-exclusion.test.ts
git commit -m "feat: 응답률 분모 제외 + 분자 동적화 SQL

- buildExcludeFilter: negative codes OR unsubscribed_at OR 결합
- 분모/분자 SQL: NOT excludeFilter 적용 (응답 완료해도 negative 면 제외)
- ProgressRow.excludedCount + ProgressTotals.excludedTotal 노출
- integration: 6 케이스 (DEFAULT, unsubscribed, exclude 우선, 사용자 정의, fallback, 그룹별)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: BlockReason + MESSAGES 확장

**Files:**
- Modify: `src/lib/duplicate-detection/types.ts:27-30`
- Modify: `src/components/survey/already-responded-view.tsx:22-38`

- [ ] **Step 1: BlockReason 케이스 추가**

[duplicate-detection/types.ts:27-30](src/lib/duplicate-detection/types.ts#L27-L30) 수정:

```ts
/**
 * 응답 차단 사유. 응답 페이지·차단 화면·server action 결과 등에서 공통 사용.
 *
 * - invalid_token: 존재하지 않는 invite_token 으로 진입
 * - token_already_used: 동일 invite_token 으로 이미 응답 완료
 * - device_already_responded: 같은 device/fp+IP 로 이미 응답 완료
 * - excluded_from_population: 부정 결과코드 마킹 / unsubscribed_at 으로 모집단 제외됨
 */
export type BlockReason =
  | 'invalid_token'
  | 'token_already_used'
  | 'device_already_responded'
  | 'excluded_from_population';
```

- [ ] **Step 2: MESSAGES 사전에 케이스 추가**

[already-responded-view.tsx:22-38](src/components/survey/already-responded-view.tsx#L22-L38) 의 MESSAGES 끝에:

```ts
const MESSAGES: Record<BlockReason, MessageDef> = {
  invalid_token: {
    title: '잘못된 초대 링크입니다',
    body: '이 링크는 유효하지 않거나 만료되었습니다. 운영자에게 문의해 주세요.',
    tone: 'error',
  },
  token_already_used: {
    title: '이미 응답하신 설문입니다',
    body: '이 초대 링크로는 이미 응답이 제출되었습니다. 중복 응답은 허용되지 않습니다.',
    tone: 'info',
  },
  device_already_responded: {
    title: '이미 응답하신 설문입니다',
    body: '이 기기에서 이 설문에 응답한 기록이 있습니다. 한 분당 한 번만 응답 가능합니다.',
    tone: 'info',
  },
  excluded_from_population: {
    // 카피는 token_already_used 와 의도적으로 유사 — PII 보안 (수신거부/콜센터 노트 추정 차단)
    title: '이미 응답하신 설문입니다',
    body: '이 초대 링크로는 더 이상 응답을 받지 않습니다. 운영자에게 문의해 주세요.',
    tone: 'info',
  },
};
```

- [ ] **Step 3: tsc 검증**

```bash
pnpm tsc --noEmit
```

기대: 0 에러 (Record<BlockReason, …> 가 새 키 강제 — 빠지면 타입 에러로 캐치).

- [ ] **Step 4: Commit**

```bash
git add src/lib/duplicate-detection/types.ts src/components/survey/already-responded-view.tsx
git commit -m "feat: BlockReason.excluded_from_population + 차단 카피 추가

- BlockReason 에 excluded_from_population 케이스
- AlreadyRespondedView MESSAGES 에 카피 1개 (token_already_used 와 유사 — PII 보안)
- Record 타입 강제로 누락 케이스 컴파일 차단

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: lookupContactByInviteToken excluded 분기 + integration test

**Files:**
- Modify: `src/actions/response-actions.ts:29-50`
- Create: `tests/integration/invite-token-excluded.test.ts`

- [ ] **Step 1: 현재 lookupContactByInviteToken 본문 읽기**

[response-actions.ts:29-50](src/actions/response-actions.ts#L29-L50) 읽고 시그니처·호출처 파악:

```bash
grep -rn "lookupContactByInviteToken" src/
```

호출처를 별도 메모 (Step 5 에서 사용).

- [ ] **Step 2: integration test 작성 (실패)**

신규 파일 `tests/integration/invite-token-excluded.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterAll } from 'vitest';

import { db } from '@/db';
import { surveys } from '@/db/schema/surveys';
import { contactTargets, contactAttempts } from '@/db/schema/contacts';
import { lookupContactByInviteToken } from '@/actions/response-actions';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';

const TAG = '__test_invite_excluded__';

async function cleanup() {
  await db.delete(surveys).where(sql`${surveys.title} = ${TAG}`);
}

async function seedSurvey() {
  const surveyId = randomUUID();
  await db.insert(surveys).values({
    id: surveyId,
    title: TAG,
    slug: `test-${surveyId}`,
    privateToken: randomUUID(),
    settings: {
      isPublic: false, allowMultipleResponses: false, showProgressBar: false,
      shuffleQuestions: false, requireLogin: false, thankYouMessage: '',
    },
    thankYouMessage: '',
    contactResultCodes: null,
  });
  return surveyId;
}

async function seedContact(
  surveyId: string,
  opts: { unsubscribed?: boolean; attempts?: string[] } = {},
) {
  const id = randomUUID();
  const inviteToken = randomUUID();
  await db.insert(contactTargets).values({
    id, surveyId, resid: 1, attrs: {}, inviteToken,
    unsubscribedAt: opts.unsubscribed ? new Date() : null,
  });
  if (opts.attempts) {
    for (let i = 0; i < opts.attempts.length; i++) {
      await db.insert(contactAttempts).values({
        contactTargetId: id, attemptNo: i + 1, resultCode: opts.attempts[i],
      });
    }
  }
  return { id, inviteToken };
}

describe('lookupContactByInviteToken — excluded 분기', () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  it('정상 ct → valid', async () => {
    const surveyId = await seedSurvey();
    const { inviteToken } = await seedContact(surveyId);
    const result = await lookupContactByInviteToken(surveyId, inviteToken);
    expect(result.kind).toBe('valid');
  });

  it('수신거부 result_code 마킹 → excluded', async () => {
    const surveyId = await seedSurvey();
    const { inviteToken } = await seedContact(surveyId, { attempts: ['수신거부'] });
    const result = await lookupContactByInviteToken(surveyId, inviteToken);
    expect(result.kind).toBe('excluded');
  });

  it('unsubscribed_at IS NOT NULL → excluded', async () => {
    const surveyId = await seedSurvey();
    const { inviteToken } = await seedContact(surveyId, { unsubscribed: true });
    const result = await lookupContactByInviteToken(surveyId, inviteToken);
    expect(result.kind).toBe('excluded');
  });

  it('무효 토큰 → invalid', async () => {
    const surveyId = await seedSurvey();
    const result = await lookupContactByInviteToken(surveyId, randomUUID());
    expect(result.kind).toBe('invalid');
  });
});
```

- [ ] **Step 3: 테스트 실행 — 실패 확인 (kind 필드 없음)**

```bash
pnpm vitest run tests/integration/invite-token-excluded.test.ts
```

기대: FAIL (현재 시그니처는 contactTargetId 만 반환).

- [ ] **Step 4: lookupContactByInviteToken 시그니처·본문 교체**

[response-actions.ts:29-50](src/actions/response-actions.ts#L29-L50) 의 함수를 다음으로 교체:

```ts
/**
 * inviteToken 으로 컨택 lookup. 반환 케이스 3가지:
 * - valid: 정상 ct, contactTargetId 매칭됨
 * - excluded: 부정 결과코드 OR unsubscribed_at IS NOT NULL (응답 차단)
 * - invalid: 토큰 자체가 무효 (익명 폴백)
 *
 * SECURITY: 차단 사유는 호출자에게 구분 노출하지 않음 (UI 는 동일 카피 — PII).
 */
export type InviteTokenLookupResult =
  | { kind: 'valid'; contactTargetId: string }
  | { kind: 'excluded' }
  | { kind: 'invalid' };

export async function lookupContactByInviteToken(
  surveyId: string,
  inviteToken: string,
): Promise<InviteTokenLookupResult> {
  const lookup = await db.execute(
    sql`SELECT public.lookup_contact_by_invite_token(${surveyId}::uuid, ${inviteToken}::uuid) AS id`,
  );
  const contactTargetId = (lookup as unknown as Array<{ id: string | null }>)[0]?.id ?? null;
  if (!contactTargetId) return { kind: 'invalid' };

  const { negative: negativeCodes } = await getResultCodeStatuses(surveyId);
  const excludedRows = await db.execute(sql`
    SELECT 1
    FROM contact_targets ct
    WHERE ct.id = ${contactTargetId}
      AND (
        ct.unsubscribed_at IS NOT NULL
        ${negativeCodes.length > 0
          ? sql`OR EXISTS (SELECT 1 FROM contact_attempts ca
                           WHERE ca.contact_target_id = ct.id
                             AND ca.result_code = ANY(${negativeCodes}))`
          : sql``}
      )
    LIMIT 1
  `);
  if ((excludedRows as unknown as unknown[]).length > 0) {
    return { kind: 'excluded' };
  }
  return { kind: 'valid', contactTargetId };
}
```

import 추가 (파일 상단):

```ts
import { getResultCodeStatuses } from '@/lib/operations/result-code-statuses';
```

- [ ] **Step 5: 기존 호출처 호환 (이전엔 contactTargetId | null 반환)**

Step 1 에서 메모한 호출처 검색 결과를 따라 각 호출처를 새 시그니처에 맞게 분기 처리:

```bash
grep -rn "lookupContactByInviteToken" src/ | grep -v actions/response-actions.ts
```

각 호출처에 대해:
- 기존: `const cid = await lookupContactByInviteToken(...)` (string | null)
- 변경: `const result = await lookupContactByInviteToken(...); const cid = result.kind === 'valid' ? result.contactTargetId : null;`

호출처가 excluded 를 구분해야 하는 것은 Task 7 에서 처리. 일단 valid/그 외 = null 로 기존 동작 유지.

- [ ] **Step 6: 테스트 실행 — pass 확인**

```bash
pnpm vitest run tests/integration/invite-token-excluded.test.ts
pnpm tsc --noEmit
```

기대: PASS 4/4, 0 타입 에러.

- [ ] **Step 7: Commit**

```bash
git add src/actions/response-actions.ts tests/integration/invite-token-excluded.test.ts
git commit -m "feat: lookupContactByInviteToken 에 excluded 케이스 추가

- InviteTokenLookupResult: valid/excluded/invalid 3-way
- excluded: negative result_code OR unsubscribed_at IS NOT NULL
- 기존 호출처는 valid 외 → null 로 호환 보존 (excluded 분기는 Task 7)
- integration: 4 케이스 (정상/result_code/unsubscribed_at/무효)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: 응답 페이지 차단 렌더 + saveResponse race guard

**Files:**
- Modify: `src/components/survey-response/survey-response-flow.tsx` (excluded 렌더 분기)
- Modify: `src/actions/response-actions.ts` (saveResponse·startResponse race guard)

- [ ] **Step 1: 현재 lookup 호출처 (응답 페이지 본문) 읽기**

[survey-response-flow.tsx:1017](src/components/survey-response/survey-response-flow.tsx#L1017) 근처와 inviteToken lookup 발생 지점 검토:

```bash
grep -n "lookupContactByInviteToken\|inviteToken\|AlreadyRespondedView" src/components/survey-response/survey-response-flow.tsx | head -20
```

호출 흐름이 server component → flow 컴포넌트로 props 전달 형태인지, flow 내부에서 직접 호출인지 확인.

- [ ] **Step 2: excluded 분기 렌더 추가**

lookup 결과를 받는 지점에 `excluded` 일 때 `<AlreadyRespondedView reason="excluded_from_population" ... />` 렌더. props (surveyTitle, contactEmail) 는 기존 `AlreadyRespondedView` 호출과 동일 패턴 — 기존 사용 사이트의 형태를 따라 그대로 복제.

코드 예 (실제 호출 지점이 server component 라면 그곳 / flow 라면 flow 내부):

```tsx
if (lookupResult.kind === 'excluded') {
  return (
    <AlreadyRespondedView
      reason="excluded_from_population"
      surveyTitle={survey.title}
      contactEmail={null}
    />
  );
}
```

호출 지점이 server 라면 `lookupContactByInviteToken` 호출 후 분기, client 라면 server action 호출 후 분기.

- [ ] **Step 3: saveResponse / startResponse 에 race guard 추가**

[response-actions.ts:139-260](src/actions/response-actions.ts#L139-L260) 근처의 `saveResponse` / `startResponse` 본문에서, inviteToken 으로 lookup 한 직후 — 그러나 contact_target_id 매칭 직전 — excluded 케이스를 차단:

```ts
// saveResponse 본문 (개략):
if (inviteToken) {
  const trackA = await checkTrackA(surveyId, inviteToken);
  if (trackA.blocked) {
    return { ok: false, blocked: true, reason: trackA.reason };
  }
  // ↓ 신규: race guard — 응답 시작 후 콜센터가 negative 마킹한 케이스
  const lookup = await lookupContactByInviteToken(surveyId, inviteToken);
  if (lookup.kind === 'excluded') {
    return { ok: false, blocked: true, reason: 'excluded_from_population' };
  }
}
```

`startResponse` 도 동일 패턴.

반환 타입은 기존 `{ ok: false, blocked: true, reason: BlockReason }` 패턴을 따름 (이미 duplicate detection 흐름에서 사용 중).

- [ ] **Step 4: tsc + 기존 vitest 회귀**

```bash
pnpm tsc --noEmit
pnpm vitest run
```

기대: 0 에러, 기존 모든 테스트 PASS.

- [ ] **Step 5: manual smoke — 응답 차단 흐름**

로컬 dev 서버 띄우고:
```bash
pnpm dev
```

수동 시나리오:
1. 임의 survey 의 contact_target 1개 골라 `contact_attempts` 에 result_code='수신거부' INSERT
2. 해당 ct 의 inviteToken 으로 `/survey/<id>?invite=<token>` 진입
3. 기대: `AlreadyRespondedView` 의 "이미 응답하신 설문입니다 / 이 초대 링크로는 더 이상 응답을 받지 않습니다" 카드 렌더

- [ ] **Step 6: Commit**

```bash
git add src/actions/response-actions.ts src/components/survey-response/survey-response-flow.tsx
git commit -m "feat: 응답 페이지 진입 차단 + race guard

- inviteToken lookup 이 excluded 면 AlreadyRespondedView 로 차단 카드
- saveResponse/startResponse 에 동일 체크 1회 더 (응답 중 마킹 race)
- 익명 응답·무효 토큰 폴백은 그대로

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: buildNotExcludedByNegativeCode + buildCandidateWhere

**Files:**
- Modify: `src/lib/operations/campaigns.server.ts:344-410`
- Create: `tests/integration/preflight-exclusion.test.ts` (Task 9 까지 누적)

- [ ] **Step 1: 헬퍼 함수 추가**

[campaigns.server.ts:349](src/lib/operations/campaigns.server.ts#L349) (HAS_EMAIL_PII 아래) 에 신규:

```ts
/**
 * 발송 가능 명단·preflight 양쪽에서 사용하는 negative 결과코드 제외 SQL.
 *
 * EXISTS 의 any-time 의미 — 한 회차라도 negative 코드 받으면 제외.
 * negative codes 빈 배열이면 TRUE (제외 안 함).
 *
 * unsubscribed_at 제외는 별도 isNull 조건으로 결합되므로 여기선 코드만 본다.
 */
function buildNotExcludedByNegativeCode(negativeCodes: string[]): SQL {
  if (negativeCodes.length === 0) return sql`TRUE`;
  return sql`NOT EXISTS (
    SELECT 1 FROM contact_attempts ca
    WHERE ca.contact_target_id = "contact_targets"."id"
      AND ca.result_code = ANY(${negativeCodes})
  )`;
}
```

- [ ] **Step 2: buildCandidateWhere 시그니처 변경 — negativeCodes 인자 받기**

[campaigns.server.ts:351](src/lib/operations/campaigns.server.ts#L351):

```ts
async function buildCandidateWhere(
  surveyId: string,
  filter: CampaignFilterSnapshot,
  negativeCodes: string[],   // 신규
): Promise<SQL> {
  const parts: SQL[] = [
    eq(contactTargets.surveyId, surveyId),
    isNull(contactTargets.unsubscribedAt),
    HAS_EMAIL_PII,
    buildNotExcludedByNegativeCode(negativeCodes),  // 신규
  ];
  // ... 기존 본문 그대로
```

- [ ] **Step 3: buildCandidateWhere 호출처 업데이트**

```bash
grep -n "buildCandidateWhere" src/lib/operations/campaigns.server.ts
```

각 호출 지점 직전에 `const { negative: negativeCodes } = await getResultCodeStatuses(surveyId);` 추가 후 3번째 인자로 전달.

import 추가:
```ts
import { getResultCodeStatuses } from './result-code-statuses';
```

- [ ] **Step 4: tsc 검증**

```bash
pnpm tsc --noEmit
```

기대: 0 에러.

- [ ] **Step 5: 부분 commit — preflight 변경 전 candidate 만**

```bash
git add src/lib/operations/campaigns.server.ts
git commit -m "feat: 단체메일 후보 쿼리에 negative result_code 제외 추가

- buildNotExcludedByNegativeCode 헬퍼 모듈 private
- buildCandidateWhere 시그니처: negativeCodes 인자 추가
- getResultCodeStatuses 호출 후 SQL 결합

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: preflightRecipients 분기 + integration test

**Files:**
- Modify: `src/lib/operations/campaigns.server.ts:589-634`
- Create: `tests/integration/preflight-exclusion.test.ts`

- [ ] **Step 1: integration test 작성 (실패)**

신규 파일 `tests/integration/preflight-exclusion.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterAll } from 'vitest';

import { db } from '@/db';
import { surveys } from '@/db/schema/surveys';
import { contactTargets, contactAttempts, contactPii } from '@/db/schema/contacts';
import { preflightRecipients } from '@/lib/operations/campaigns.server';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';

const TAG = '__test_preflight_exclusion__';

async function cleanup() {
  await db.delete(surveys).where(sql`${surveys.title} = ${TAG}`);
}

async function seedSurvey() {
  const surveyId = randomUUID();
  await db.insert(surveys).values({
    id: surveyId, title: TAG, slug: `test-${surveyId}`,
    privateToken: randomUUID(),
    settings: { isPublic: false, allowMultipleResponses: false, showProgressBar: false, shuffleQuestions: false, requireLogin: false, thankYouMessage: '' },
    thankYouMessage: '',
    contactResultCodes: null,
  });
  return surveyId;
}

async function seedContact(
  surveyId: string,
  opts: { withEmail?: boolean; unsubscribed?: boolean; attempts?: string[] } = {},
) {
  const id = randomUUID();
  await db.insert(contactTargets).values({
    id, surveyId, resid: 1, attrs: {}, inviteToken: randomUUID(),
    unsubscribedAt: opts.unsubscribed ? new Date() : null,
  });
  if (opts.withEmail) {
    await db.insert(contactPii).values({
      contactTargetId: id,
      fieldType: 'email',
      cipherText: 'enc',
      blindIndex: 'bi',
    });
  }
  if (opts.attempts) {
    for (let i = 0; i < opts.attempts.length; i++) {
      await db.insert(contactAttempts).values({
        contactTargetId: id, attemptNo: i + 1, resultCode: opts.attempts[i],
      });
    }
  }
  return id;
}

describe('preflightRecipients — excludedByCode 분기', () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  it('negative 코드 ct → excludedByCodeIds 에 들어감', async () => {
    const surveyId = await seedSurvey();
    const idValid = await seedContact(surveyId, { withEmail: true });
    const idExcluded = await seedContact(surveyId, { withEmail: true, attempts: ['수신거부'] });
    const result = await preflightRecipients({
      surveyId,
      selectedContactIds: [idValid, idExcluded],
    });
    expect(result.validIds).toEqual([idValid]);
    expect(result.excludedByCodeIds).toEqual([idExcluded]);
    expect(result.unsubscribedIds).toEqual([]);
    expect(result.emailMissingIds).toEqual([]);
  });

  it('unsubscribed_at 우선 — 동시 마킹 시 unsubscribed 으로 분류', async () => {
    const surveyId = await seedSurvey();
    const id = await seedContact(surveyId, { withEmail: true, unsubscribed: true, attempts: ['수신거부'] });
    const result = await preflightRecipients({ surveyId, selectedContactIds: [id] });
    expect(result.unsubscribedIds).toEqual([id]);
    expect(result.excludedByCodeIds).toEqual([]);
  });

  it('email 누락 + negative 코드 → excludedByCode 우선', async () => {
    const surveyId = await seedSurvey();
    const id = await seedContact(surveyId, { attempts: ['수신거부'] });
    const result = await preflightRecipients({ surveyId, selectedContactIds: [id] });
    expect(result.excludedByCodeIds).toEqual([id]);
    expect(result.emailMissingIds).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
pnpm vitest run tests/integration/preflight-exclusion.test.ts
```

기대: FAIL (excludedByCodeIds 필드 없음).

- [ ] **Step 3: RecipientPreflightResult 확장 + preflightRecipients 변경**

[campaigns.server.ts:579-634](src/lib/operations/campaigns.server.ts#L579-L634) 의 타입 + 함수를 다음으로 교체:

```ts
export interface RecipientPreflightResult {
  validIds: string[];
  unsubscribedIds: string[];
  excludedByCodeIds: string[];  // 신규
  emailMissingIds: string[];
  notFoundIds: string[];
}

export async function preflightRecipients(args: {
  surveyId: string;
  selectedContactIds: string[];
}): Promise<RecipientPreflightResult> {
  if (args.selectedContactIds.length === 0) {
    return {
      validIds: [], unsubscribedIds: [], excludedByCodeIds: [],
      emailMissingIds: [], notFoundIds: [],
    };
  }

  const { negative: negativeCodes } = await getResultCodeStatuses(args.surveyId);

  const rows = await db
    .select({
      id: contactTargets.id,
      unsubscribedAt: contactTargets.unsubscribedAt,
      hasEmail: sql<boolean>`EXISTS (
        SELECT 1 FROM contact_pii cp
        WHERE cp.contact_target_id = "contact_targets"."id"
          AND cp.field_type = 'email'
      )`.as('has_email'),
      excludedByCode: sql<boolean>`${
        negativeCodes.length === 0
          ? sql`FALSE`
          : sql`EXISTS (
              SELECT 1 FROM contact_attempts ca
              WHERE ca.contact_target_id = "contact_targets"."id"
                AND ca.result_code = ANY(${negativeCodes})
            )`
      }`.as('excluded_by_code'),
    })
    .from(contactTargets)
    .where(
      and(
        eq(contactTargets.surveyId, args.surveyId),
        inArray(contactTargets.id, args.selectedContactIds),
      ),
    );

  const validIds: string[] = [];
  const unsubscribedIds: string[] = [];
  const excludedByCodeIds: string[] = [];
  const emailMissingIds: string[] = [];
  const found = new Set<string>();

  for (const r of rows) {
    found.add(r.id);
    // 우선순위: unsubscribed → excludedByCode → !hasEmail → valid
    if (r.unsubscribedAt !== null) {
      unsubscribedIds.push(r.id);
    } else if (r.excludedByCode) {
      excludedByCodeIds.push(r.id);
    } else if (!r.hasEmail) {
      emailMissingIds.push(r.id);
    } else {
      validIds.push(r.id);
    }
  }
  const notFoundIds = args.selectedContactIds.filter((id) => !found.has(id));

  return { validIds, unsubscribedIds, excludedByCodeIds, emailMissingIds, notFoundIds };
}
```

- [ ] **Step 4: 테스트 실행 — pass 확인**

```bash
pnpm vitest run tests/integration/preflight-exclusion.test.ts
pnpm tsc --noEmit
```

기대: PASS 3/3, 0 타입 에러.

- [ ] **Step 5: preflight 소비자 회귀 점검**

```bash
grep -rn "preflightRecipients\|RecipientPreflightResult\|unsubscribedCount\|preflightSummary" src/ | head -20
```

기존 소비자 (campaign-actions.ts, campaign-wizard.tsx) 가 `excludedByCodeIds` 모르고도 깨지지 않는지 확인. 깨지면 호환 보존 또는 Task 10 에서 사용 추가.

- [ ] **Step 6: Commit**

```bash
git add src/lib/operations/campaigns.server.ts tests/integration/preflight-exclusion.test.ts
git commit -m "feat: preflightRecipients 에 excludedByCodeIds 분기 추가

- RecipientPreflightResult.excludedByCodeIds 신규
- 우선순위: unsubscribed → excludedByCode → !hasEmail → valid
- integration: 3 케이스 (단순/unsubscribed 우선/email 누락+negative)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: campaign-wizard UI — preflight summary + 도움말

**Files:**
- Modify: `src/components/operations/mail-campaign/campaign-wizard.tsx:68-292, 442-444`

- [ ] **Step 1: preflightSummary 타입 + 상태 확장**

[campaign-wizard.tsx:68](src/components/operations/mail-campaign/campaign-wizard.tsx#L68) 근처의 `preflightSummary` 인터페이스 / state 에 `excludedByCode: number` 추가:

```ts
const [preflightSummary, setPreflightSummary] = useState<{
  unsubscribed: number;
  excludedByCode: number;  // 신규
  emailMissing: number;
  notFound: number;
  valid: number;
} | null>(null);
```

- [ ] **Step 2: preflight 결과 매핑 시 새 필드 채움**

[campaign-wizard.tsx:199](src/components/operations/mail-campaign/campaign-wizard.tsx#L199) 근처:

```ts
setPreflightSummary({
  unsubscribed: result.data.unsubscribedCount,
  excludedByCode: result.data.excludedByCodeCount,  // 신규
  emailMissing: result.data.emailMissingCount,
  notFound: result.data.notFoundCount,
  valid: result.data.validCount,
});
```

`result.data` 가 server action campaign-actions.ts 에서 오는 객체이므로 [campaign-actions.ts](src/actions/campaign-actions.ts) 에서 preflight 호출 후 응답 가공하는 지점에 `excludedByCodeCount: preflight.excludedByCodeIds.length` 도 추가:

```bash
grep -n "preflightRecipients\|unsubscribedCount" src/actions/campaign-actions.ts
```

해당 라인 근처에 추가.

- [ ] **Step 3: preflight summary 표시 추가**

[campaign-wizard.tsx:442-444](src/components/operations/mail-campaign/campaign-wizard.tsx#L442-L444) 의 "수신거부로 제외" 줄 아래에:

```tsx
{preflightSummary.unsubscribed > 0 ? (
  <li>
    수신거부로 제외: {preflightSummary.unsubscribed.toLocaleString('ko-KR')}명
  </li>
) : null}
{preflightSummary.excludedByCode > 0 ? (
  <li>
    조사 대상 제외: {preflightSummary.excludedByCode.toLocaleString('ko-KR')}명
  </li>
) : null}
```

- [ ] **Step 4: 후보 도움말 텍스트 수정**

[campaign-wizard.tsx:292](src/components/operations/mail-campaign/campaign-wizard.tsx#L292):

```tsx
<p className="text-xs text-slate-500">
  수신거부자(unsubscribed_at IS NOT NULL), 부정 결과코드(예: 수신거부) 마킹된
  조사 대상, 이메일 누락 조사 대상은 자동으로 제외됩니다.
</p>
```

- [ ] **Step 5: tsc + build 검증**

```bash
pnpm tsc --noEmit
pnpm build
```

기대: 0 에러, build 성공.

- [ ] **Step 6: manual smoke**

```bash
pnpm dev
```

수동 시나리오:
1. `/admin/surveys/<id>/operations/mail/campaigns/new` 진입
2. ④단계 preflight 도달
3. 기대: "조사 대상 제외: N명" 라인이 수신거부 라인 아래에 표시 (해당 ct 가 있을 경우)

- [ ] **Step 7: Commit**

```bash
git add src/components/operations/mail-campaign/campaign-wizard.tsx src/actions/campaign-actions.ts
git commit -m "feat: 단체메일 마법사에 조사 대상 제외 카운트 표시

- preflightSummary 에 excludedByCode 필드 추가
- ④단계 preflight 에 조사 대상 제외 라인 노출
- 후보 도움말에 부정 결과코드 자동 제외 안내 추가

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: listResponsesForProfiles excludeFilter

**Files:**
- Modify: `src/lib/operations/profiles.server.ts:61-87`
- Create: `tests/integration/profiles-exclusion.test.ts`

- [ ] **Step 1: integration test 작성 (실패)**

신규 파일 `tests/integration/profiles-exclusion.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterAll } from 'vitest';

import { db } from '@/db';
import { surveys, surveyResponses } from '@/db/schema/surveys';
import { contactTargets, contactAttempts } from '@/db/schema/contacts';
import { listResponsesForProfiles } from '@/lib/operations/profiles.server';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';

const TAG = '__test_profiles_exclusion__';

async function cleanup() {
  await db.delete(surveys).where(sql`${surveys.title} = ${TAG}`);
}

async function seedSurvey() {
  const surveyId = randomUUID();
  await db.insert(surveys).values({
    id: surveyId, title: TAG, slug: `test-${surveyId}`,
    privateToken: randomUUID(),
    settings: { isPublic: false, allowMultipleResponses: false, showProgressBar: false, shuffleQuestions: false, requireLogin: false, thankYouMessage: '' },
    thankYouMessage: '',
    contactResultCodes: null,
  });
  return surveyId;
}

async function seedResponseWithContact(
  surveyId: string,
  opts: { negative?: boolean; unsubscribed?: boolean; anonymous?: boolean } = {},
) {
  let contactTargetId: string | null = null;
  if (!opts.anonymous) {
    contactTargetId = randomUUID();
    await db.insert(contactTargets).values({
      id: contactTargetId, surveyId, resid: 1, attrs: {}, inviteToken: randomUUID(),
      unsubscribedAt: opts.unsubscribed ? new Date() : null,
    });
    if (opts.negative) {
      await db.insert(contactAttempts).values({
        contactTargetId, attemptNo: 1, resultCode: '수신거부',
      });
    }
  }
  await db.insert(surveyResponses).values({
    surveyId, contactTargetId, isCompleted: true, questionResponses: {},
    startedAt: new Date(),
  });
}

describe('listResponsesForProfiles — negative exclusion', () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  it('negative ct 의 응답 → 목록에서 가림', async () => {
    const surveyId = await seedSurvey();
    await seedResponseWithContact(surveyId);                       // 보임
    await seedResponseWithContact(surveyId, { negative: true });   // 가림
    const result = await listResponsesForProfiles({
      surveyId, page: 1, pageSize: 100, q: '', qfield: 'all',
      status: 'all', sort: 'startedAt', dir: 'desc', view: 'active',
    });
    expect(result.total).toBe(1);
  });

  it('unsubscribed ct 의 응답 → 목록에서 가림', async () => {
    const surveyId = await seedSurvey();
    await seedResponseWithContact(surveyId);
    await seedResponseWithContact(surveyId, { unsubscribed: true });
    const result = await listResponsesForProfiles({
      surveyId, page: 1, pageSize: 100, q: '', qfield: 'all',
      status: 'all', sort: 'startedAt', dir: 'desc', view: 'active',
    });
    expect(result.total).toBe(1);
  });

  it('익명 응답 (contact_target_id IS NULL) → 자동 통과', async () => {
    const surveyId = await seedSurvey();
    await seedResponseWithContact(surveyId, { anonymous: true });
    await seedResponseWithContact(surveyId, { negative: true });
    const result = await listResponsesForProfiles({
      surveyId, page: 1, pageSize: 100, q: '', qfield: 'all',
      status: 'all', sort: 'startedAt', dir: 'desc', view: 'active',
    });
    expect(result.total).toBe(1);
  });

  it('idx 재계산 — negative 빠지면 순번 보정', async () => {
    const surveyId = await seedSurvey();
    await seedResponseWithContact(surveyId);
    await seedResponseWithContact(surveyId);
    await seedResponseWithContact(surveyId, { negative: true });
    const result = await listResponsesForProfiles({
      surveyId, page: 1, pageSize: 100, q: '', qfield: 'all',
      status: 'all', sort: 'startedAt', dir: 'desc', view: 'active',
    });
    expect(result.total).toBe(2);
    // 보임 응답들은 idx 1,2 (절대 순번 보정)
    expect(result.rows.map((r) => r.idx).sort()).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
pnpm vitest run tests/integration/profiles-exclusion.test.ts
```

기대: FAIL (current 동작 = 모두 노출).

- [ ] **Step 3: profiles.server.ts base subquery WHERE 확장**

[profiles.server.ts:80-87](src/lib/operations/profiles.server.ts#L80-L87) 를 다음으로 수정:

```ts
// 신규 import (파일 상단)
import { getResultCodeStatuses } from './result-code-statuses';

// listResponsesForProfiles 본문 초입에서
const { negative: negativeCodes } = await getResultCodeStatuses(surveyId);

const numbered = db
  .select({
    id: surveyResponses.id,
    idx: sql<number>`row_number() over (order by ${surveyResponses.startedAt} desc)`.as('idx'),
    platform: surveyResponses.platform,
    browser: surveyResponses.browser,
    status: surveyResponses.status,
    currentStepId: surveyResponses.currentStepId,
    startedAt: surveyResponses.startedAt,
    completedAt: surveyResponses.completedAt,
    totalSeconds: surveyResponses.totalSeconds,
  })
  .from(surveyResponses)
  .where(
    and(
      eq(surveyResponses.surveyId, surveyId),
      view === 'deleted' ? deletedResponse : notDeletedResponse,
      // ↓ 신규: negative ct 의 응답 가림. 익명 (contact_target_id IS NULL) 은 NOT EXISTS 통과
      sql`NOT EXISTS (
        SELECT 1 FROM contact_targets ct
        WHERE ct.id = ${surveyResponses.contactTargetId}
          AND (
            ct.unsubscribed_at IS NOT NULL
            ${negativeCodes.length > 0
              ? sql`OR EXISTS (SELECT 1 FROM contact_attempts ca
                               WHERE ca.contact_target_id = ct.id
                                 AND ca.result_code = ANY(${negativeCodes}))`
              : sql``}
          )
      )`,
    ),
  )
  .as('numbered');
```

- [ ] **Step 4: 테스트 실행 — pass 확인**

```bash
pnpm vitest run tests/integration/profiles-exclusion.test.ts
pnpm tsc --noEmit
```

기대: PASS 4/4, 0 에러.

- [ ] **Step 5: Commit**

```bash
git add src/lib/operations/profiles.server.ts tests/integration/profiles-exclusion.test.ts
git commit -m "feat: Profiles 탭에서 negative ct 응답 가림

- base subquery WHERE 에 excludeFilter NOT EXISTS 추가
- 익명 응답 자동 통과 (contact_target_id IS NULL)
- idx 재계산 (excluded 빠진 후 순번 보정)
- integration: 4 케이스 (negative/unsubscribed/익명/idx)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Profiles 상세 페이지 — negative 배지

**Files:**
- Modify: `src/app/admin/surveys/[id]/operations/profiles/[responseId]/page.tsx`

- [ ] **Step 1: 현재 page 구조 + contactTarget 조회 위치 파악**

```bash
grep -n "contactTarget\|response\|surveyId" src/app/admin/surveys/\[id\]/operations/profiles/\[responseId\]/page.tsx | head -20
```

이미 contact_target 정보를 가져오는지, 별도 fetch 가 필요한지 결정.

- [ ] **Step 2: 헬퍼 함수 — isResponseExcluded**

[profiles.server.ts](src/lib/operations/profiles.server.ts) 끝에 추가 (또는 result-code-statuses.ts 에):

```ts
/**
 * 응답이 negative 모집단 제외 상태인지 server-side 평가.
 * 상세 페이지 헤더 배지용. 익명 응답은 항상 false.
 */
export async function isResponseExcluded(
  surveyId: string,
  responseId: string,
): Promise<boolean> {
  const { negative: negativeCodes } = await getResultCodeStatuses(surveyId);
  const rows = await db.execute(sql`
    SELECT 1
    FROM survey_responses sr
    JOIN contact_targets ct ON ct.id = sr.contact_target_id
    WHERE sr.id = ${responseId}
      AND sr.survey_id = ${surveyId}
      AND (
        ct.unsubscribed_at IS NOT NULL
        ${negativeCodes.length > 0
          ? sql`OR EXISTS (SELECT 1 FROM contact_attempts ca
                           WHERE ca.contact_target_id = ct.id
                             AND ca.result_code = ANY(${negativeCodes}))`
          : sql``}
      )
    LIMIT 1
  `);
  return (rows as unknown as unknown[]).length > 0;
}
```

- [ ] **Step 3: 상세 page 헤더에 배지 추가**

[profiles/[responseId]/page.tsx](src/app/admin/surveys/[id]/operations/profiles/[responseId]/page.tsx) 의 헤더 렌더 부분에:

```tsx
const excluded = await isResponseExcluded(surveyId, responseId);

// 헤더 영역 JSX 안:
{excluded && (
  <div
    role="status"
    className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
  >
    이 응답자는 부정 결과코드로 모집단에서 제외된 상태입니다. 응답률·메일·응답 페이지에서 가려져 있습니다.
  </div>
)}
```

- [ ] **Step 4: tsc + build 검증**

```bash
pnpm tsc --noEmit
pnpm build
```

기대: 0 에러.

- [ ] **Step 5: manual smoke**

```bash
pnpm dev
```

수동: negative 마킹된 ct 의 응답 상세 URL 직접 진입 → 헤더 배지 노출 확인.

- [ ] **Step 6: Commit**

```bash
git add src/lib/operations/profiles.server.ts src/app/admin/surveys/\[id\]/operations/profiles/\[responseId\]/page.tsx
git commit -m "feat: 응답 상세 페이지에 negative 제외 배지

- isResponseExcluded server helper
- 상세 헤더 amber 배지로 운영자 인지
- 목록에서 가려진 응답도 link 로 접근 시 명확히 표시

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: result-codes-editor.tsx — 상태 컬럼 + Select 컨트롤

**Files:**
- Modify: `src/components/operations/contacts/result-codes-editor.tsx`

- [ ] **Step 1: dot 컴포넌트 + STATUS_OPTIONS 정의 추가**

[result-codes-editor.tsx](src/components/operations/contacts/result-codes-editor.tsx) 의 import 블록 아래, 컴포넌트 위:

```tsx
import { type ResultCodeStatus } from '@/db/schema/schema-types';

const STATUS_DOT_BG: Record<ResultCodeStatus, string> = {
  positive: 'bg-green-500',
  neutral: 'bg-slate-400',
  negative: 'bg-rose-500',
};

const STATUS_LABEL: Record<ResultCodeStatus, string> = {
  positive: '긍정 — 응답 완료로 인정',
  neutral: '중립',
  negative: '부정 — 모집단에서 제외',
};

function StatusDot({ status }: { status: ResultCodeStatus }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT_BG[status]}`}
    />
  );
}

function resolveStatus(c: ContactResultCode): ResultCodeStatus {
  if (c.status) return c.status;
  return c.code === '1.조사완료' ? 'positive' : 'neutral';
}
```

- [ ] **Step 2: 테이블 헤더에 '상태' 컬럼 추가**

[result-codes-editor.tsx:148-154](src/components/operations/contacts/result-codes-editor.tsx#L148-L154):

```tsx
<thead className="bg-slate-50 text-xs uppercase text-slate-600">
  <tr>
    <th className="px-3 py-2 text-left">순서</th>
    <th className="px-3 py-2 text-left">코드</th>
    <th className="px-3 py-2 text-left">라벨</th>
    <th className="px-3 py-2 text-left">색상</th>
    <th className="px-3 py-2 text-left">상태</th>
    <th className="px-3 py-2 text-center">액션</th>
  </tr>
</thead>
```

- [ ] **Step 3: row 안에 상태 Select 추가 (색상 ↔ 액션 사이)**

[result-codes-editor.tsx:193-209](src/components/operations/contacts/result-codes-editor.tsx#L193-L209) 의 색상 td 뒤에 신규 td:

```tsx
<td className="px-3 py-2">
  <Select
    value={resolveStatus(c)}
    onValueChange={(v) => update(i, { status: v as ResultCodeStatus })}
  >
    <SelectTrigger className="h-8 w-56">
      <SelectValue>
        <span className="inline-flex items-center gap-2">
          <StatusDot status={resolveStatus(c)} />
          {STATUS_LABEL[resolveStatus(c)]}
        </span>
      </SelectValue>
    </SelectTrigger>
    <SelectContent>
      {(['positive', 'neutral', 'negative'] as ResultCodeStatus[]).map((s) => (
        <SelectItem key={s} value={s}>
          <span className="inline-flex items-center gap-2">
            <StatusDot status={s} />
            {STATUS_LABEL[s]}
          </span>
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
</td>
```

- [ ] **Step 4: tsc + build 검증**

```bash
pnpm tsc --noEmit
pnpm build
```

기대: 0 에러.

- [ ] **Step 5: manual smoke**

```bash
pnpm dev
```

수동: `/admin/surveys/<id>/operations/contacts/result-codes` 진입 → '상태' 컬럼 노출, 디폴트 13개 중 1.조사완료=긍정/수신거부=부정/나머지=중립 표시 확인. Select 변경 후 저장 → DB 에 status 박힌 후 새로고침 시 유지.

- [ ] **Step 6: Commit**

```bash
git add src/components/operations/contacts/result-codes-editor.tsx
git commit -m "feat: 결과코드 에디터에 상태 컬럼 추가

- Select 컨트롤로 positive/neutral/negative 선택
- StatusDot 컴포넌트 + 색깔 dot + 라벨
- resolveStatus 헬퍼로 fallback (1.조사완료 → positive)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: result-codes-editor — validation + 도움말

**Files:**
- Modify: `src/components/operations/contacts/result-codes-editor.tsx` (validate, 삭제 가드, 도움말)
- Modify: 페이지 상단 도움말이 있는 곳 (`src/app/admin/surveys/[id]/operations/contacts/result-codes/page.tsx`)

- [ ] **Step 1: validate 함수 확장**

[result-codes-editor.tsx:92-103](src/components/operations/contacts/result-codes-editor.tsx#L92-L103):

```ts
function validate(): string | null {
  const trimmed = codes.map((c) => c.code.trim());
  const labelsTrimmed = codes.map((c) => c.label.trim());
  if (trimmed.some((c) => c.length === 0)) return '코드는 빈 값일 수 없습니다.';
  if (labelsTrimmed.some((l) => l.length === 0)) return '라벨은 빈 값일 수 없습니다.';
  const seen = new Set<string>();
  for (const c of trimmed) {
    if (seen.has(c)) return `중복된 코드: ${c}`;
    seen.add(c);
  }
  // 신규: positive 최소 1개
  if (!codes.some((c) => resolveStatus(c) === 'positive')) {
    return '긍정 상태(응답 완료로 인정) 코드가 최소 1개 필요합니다.';
  }
  return null;
}
```

- [ ] **Step 2: 삭제 가드 추가**

[result-codes-editor.tsx:62-71](src/components/operations/contacts/result-codes-editor.tsx#L62-L71) 의 remove 함수:

```ts
function remove(index: number) {
  if (codes.length === 1) {
    setError('최소 1개의 결과코드가 필요합니다.');
    return;
  }
  // 신규: 마지막 positive 삭제 차단
  const target = codes[index];
  if (resolveStatus(target) === 'positive') {
    const otherPositiveExists = codes.some(
      (c, i) => i !== index && resolveStatus(c) === 'positive',
    );
    if (!otherPositiveExists) {
      setError('마지막 긍정 상태 코드는 삭제할 수 없습니다. 다른 코드를 긍정으로 먼저 지정해 주세요.');
      return;
    }
  }
  ensureCustomMode();
  setCodes((prev) =>
    prev.filter((_, i) => i !== index).map((c, i) => ({ ...c, order: i + 1 })),
  );
}
```

- [ ] **Step 3: 페이지 상단 도움말 텍스트 추가**

[result-codes-page](src/app/admin/surveys/[id]/operations/contacts/result-codes/page.tsx) 의 "회차의 결과코드 라디오를 사용자 정의합니다." 줄 아래에:

```tsx
<p className="text-sm text-slate-600">
  회차의 결과코드 라디오를 사용자 정의합니다.
</p>
<ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-500">
  <li>긍정: 응답 완료로 인정 (응답률 분자)</li>
  <li>중립: 응답률 분모에만 포함</li>
  <li>부정: 모집단에서 완전 제외 — 응답률·단체메일·응답 페이지 모두에서 제거</li>
</ul>
```

- [ ] **Step 4: tsc + build**

```bash
pnpm tsc --noEmit
pnpm build
```

기대: 0 에러.

- [ ] **Step 5: manual smoke — validation 동선**

```bash
pnpm dev
```

수동 시나리오:
1. 결과코드 설정 진입 → '1.조사완료' 의 상태를 '중립' 으로 변경 → 저장 클릭
2. 기대: "긍정 상태(응답 완료로 인정) 코드가 최소 1개 필요합니다." 에러
3. 다시 '1.조사완료' 를 '긍정' 으로 복귀 → 저장 → 성공
4. '1.조사완료' 행의 '삭제' 클릭 → "마지막 긍정 상태 코드는 삭제할 수 없습니다." 에러

- [ ] **Step 6: Commit**

```bash
git add src/components/operations/contacts/result-codes-editor.tsx src/app/admin/surveys/\[id\]/operations/contacts/result-codes/page.tsx
git commit -m "feat: 결과코드 에디터 validation + 도움말 추가

- 긍정 코드 최소 1개 강제 (validate + 삭제 가드)
- 페이지 상단 도움말: 긍정/중립/부정 효과 설명
- 마지막 긍정 삭제 시 에러 메시지로 차단

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: 최종 검증 + 회귀 smoke

**Files:** (없음 — 검증만)

- [ ] **Step 1: 전체 vitest 회귀**

```bash
pnpm vitest run
```

기대: 모든 테스트 PASS (신규 5 파일 + 기존 모두).

- [ ] **Step 2: tsc 전체 회귀**

```bash
pnpm tsc --noEmit
```

기대: 0 에러.

- [ ] **Step 3: 프로덕션 빌드 회귀**

```bash
pnpm build
```

기대: 0 에러, 빌드 성공.

- [ ] **Step 4: manual smoke — 회귀 검증 영역**

각 영역 진입해서 기존 동작 무변경 확인:

| 영역 | URL | 확인 |
|---|---|---|
| Analytics 차트 | `/admin/surveys/<id>/analytics` | 데이터 노출 무변경 |
| Export | analytics 페이지 export 버튼 | CSV/SPSS 다운로드 정상 |
| 컨택 리스트 | `/admin/surveys/<id>/operations/contacts` | negative ct 도 그대로 표시 |
| 컨택 상세 | `/admin/surveys/<id>/operations/contacts/<cid>` | 결과코드 이력 정상 |
| 메일 템플릿 | `/admin/surveys/<id>/operations/mail/templates` | 변경 없음 |
| 메일 단체 발송 이력 | `/admin/surveys/<id>/operations/mail/campaigns` | 변경 없음 |
| 수신거부 페이지 | `/unsubscribe/<token>` (테스트 토큰) | 변경 없음 |

- [ ] **Step 5: manual smoke — 신규 기능 end-to-end**

1. 결과코드 설정에서 임의 코드를 negative 로 설정 → 저장
2. 콜센터처럼 임의 ct 의 contact_attempts 에 그 코드 INSERT
3. Report 진척률에서 분모·분자가 줄어듦 확인 (excludedCount 컬럼/툴팁이 노출돼 있으면 함께 확인)
4. Profiles 탭에서 해당 ct 응답이 가려짐 확인
5. 단체메일 마법사 진입 → preflight 에 "조사 대상 제외" 카운트 확인
6. 해당 ct 의 inviteToken 으로 응답 페이지 진입 → 차단 카드 확인

- [ ] **Step 6: 최종 commit (없으면 skip)**

코드 변경 없으면 skip. 작은 doc 갱신이 있다면:

```bash
git add ...
git commit -m "docs: 결과코드 negative 모집단 제외 회귀 검증 완료"
```

- [ ] **Step 7: PR 준비**

```bash
git log main..HEAD --oneline
```

15개 commit 확인 (Task 1~14 + 인덱스 마이그레이션 노트). PR 본문에 spec / plan 링크 포함 후 사용자 승인 받고 push.

---

## Spec Coverage 자기 점검

| Spec 섹션 | 구현 Task |
|---|---|
| §1 데이터 모델 (ResultCodeStatus, ContactResultCode.status, DEFAULT) | Task 1 |
| §2 응답률 계산 (closingFilter 동적화, excludeFilter, SQL, ProgressRow) | Task 3 + Task 4 |
| §2 getResultCodeStatuses 헬퍼 | Task 2 |
| §3 응답 페이지 차단 (BlockReason, MESSAGES) | Task 5 |
| §3 lookupContactByInviteToken excluded | Task 6 |
| §3 응답 페이지 렌더 + race guard | Task 7 |
| §4 buildNotExcludedByNegativeCode + buildCandidateWhere | Task 8 |
| §4 preflightRecipients 분기 | Task 9 |
| §4 campaign-wizard UI | Task 10 |
| §5 listResponsesForProfiles | Task 11 |
| §5 상세 페이지 배지 | Task 12 |
| §6 결과코드 에디터 UI (상태 컬럼) | Task 13 |
| §6 validation + 도움말 | Task 14 |
| §7 인덱스 마이그레이션 | Task 0 |
| §7 fallback (1.조사완료 → positive) | Task 1 (DEFAULT) + Task 2 (extract) |
| §7 회귀 검증 영역 | Task 15 |
| §7 테스팅 (5 integration + 1 unit) | Task 2/4/6/9/11 |
