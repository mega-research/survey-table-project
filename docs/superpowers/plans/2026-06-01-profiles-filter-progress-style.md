# 응답 내역 필터 진척률 스타일 통일 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 운영 콘솔 응답 내역 페이지의 필터를 진척률 스타일(`[컬럼 선택][검색어][전체 상태][적용]`)로 통일하고, "조사 대상 그룹" 컬럼을 하드코딩 "공개링크" 대신 매칭된 응답의 실제 그룹 값(전시회명 국문)으로 표시한다.

**Architecture:** 응답 내역 데이터 어댑터가 `survey_responses`에 `contact_targets`를 LEFT JOIN해 명단 정보(그룹 값·resid·attrs)를 끌어온다. 순번(idx) 독립성을 위해 필터는 row_number를 매기는 base subquery가 아니라 그 위(outer) WHERE에서 적용한다. 진척률의 필터 조건 SQL 빌더(`buildFilterSql`)를 컬럼 alias 주입 가능하게 일반화해 응답 내역에서 재사용하고, 응답 전용 `idx`/`browser` 분기를 추가한다.

**Tech Stack:** Next.js 16 (App Router, RSC), Drizzle ORM, PostgreSQL, TanStack Table, shadcn/ui, Zod, Vitest.

---

## File Structure

| 파일 | 역할 | 변경 |
|------|------|------|
| `src/lib/operations/progress-filters.server.ts` | 필터 조건 파싱 + SQL 빌더 | `buildFilterSql`를 이곳으로 이동·alias 일반화·export |
| `src/lib/operations/report-progress.server.ts` | 진척률 집계 SQL | 로컬 `buildFilterSql` 제거 → import |
| `src/lib/operations/profiles-filters.server.ts` | **신규** 응답 전용 condition 타입·파서·후보 상수 | 생성 |
| `src/lib/operations/profiles.ts` | 응답 내역 pure helper·공용 타입 | `qfield`→`col` 전환 |
| `src/lib/operations/profiles.server.ts` | 응답 내역 데이터 어댑터 | ct LEFT JOIN + condition 필터 + groupValue |
| `src/components/operations/profiles/profiles-filter-bar.tsx` | 필터바 UI | 진척률 스타일 재작성 |
| `src/components/operations/profiles/profiles-table.tsx` | 응답 테이블 | group 컬럼 실제 값 |
| `src/app/admin/surveys/[id]/operations/profiles/page.tsx` | RSC 페이지 | 후보 로드 + condition 파싱 |
| `tests/unit/progress-filters.test.ts` | 진척률 파서 단위 | 무회귀 (변경 없음) |
| `tests/unit/domains/operations/profiles-filters.test.ts` | **신규** 응답 파서 단위 | 생성 |
| `tests/unit/domains/operations/profiles.test.ts` | 응답 pure helper 단위 | normalize/hasActiveFilters 케이스 추가 |
| `tests/integration/profiles-exclusion.test.ts` | 어댑터 통합 | leftJoin mock 지원 추가 |

---

## Task 1: `buildFilterSql` 이동 + alias 일반화 + export

진척률 전용으로 `report-progress.server.ts`에 묻혀 있는 `buildFilterSql`을 `progress-filters.server.ts`로 옮기고, 컬럼 참조를 주입받게 하여 응답 내역에서도 쓸 수 있게 한다. 진척률 호출부는 기본값(`ct` alias)으로 무회귀.

**Files:**
- Modify: `src/lib/operations/progress-filters.server.ts`
- Modify: `src/lib/operations/report-progress.server.ts:77-116` (제거), `:243`, `:294` (import 사용)

- [ ] **Step 1: `progress-filters.server.ts`에 `buildFilterSql` + alias 타입 추가**

`src/lib/operations/progress-filters.server.ts` 상단 import에 `sql`, `type SQL`를 추가하고(현재 없음), 파일 끝에 아래를 추가한다.

```typescript
import { sql, type SQL } from 'drizzle-orm';
import { escapeLikePattern } from './filter-shared';
```

(기존 import 라인과 병합 — `FILTER_SOURCE`는 이미 import됨. `escapeLikePattern`만 추가.)

```typescript
/** buildFilterSql 의 컬럼 참조 — 진척률은 `ct` alias, 응답 내역은 numbered subquery alias. */
export interface FilterColumnRefs {
  resid: SQL;
  attrs: SQL;
  contactId: SQL;
}

const DEFAULT_FILTER_COLS: FilterColumnRefs = {
  resid: sql`ct.resid`,
  attrs: sql`ct.attrs`,
  contactId: sql`ct.id`,
};

/**
 * 조건 → WHERE 절 SQL. null 이면 TRUE (전체 조회).
 *
 * SECURITY: condition.source 는 호출자에서 화이트리스트 검증 끝난 값만 전달된다고 가정.
 * value/from/to/blindIndex/key 모두 parameter binding. pii.* 평문은 SQL 에 들어가지 않고
 * 사전 계산된 blindIndex 만 사용.
 *
 * cols 를 주입받아 진척률(`ct`)·응답 내역(`numbered`) 양쪽에서 재사용.
 */
export function buildFilterSql(
  condition: FilterCondition | null,
  cols: FilterColumnRefs = DEFAULT_FILTER_COLS,
): SQL {
  if (!condition) return sql`TRUE`;

  if (condition.source === FILTER_SOURCE.RESID) {
    if (condition.mode === 'idlist') {
      if (condition.ranges.length === 0) return sql`FALSE`;
      const conds = condition.ranges.map((r) =>
        r.from === r.to
          ? sql`${cols.resid} = ${r.from}`
          : sql`${cols.resid} BETWEEN ${r.from} AND ${r.to}`,
      );
      // 자체 괄호 — 외부 AND 결합 시 PG AND>OR 우선순위로 인한 cross-survey 누락 차단.
      return sql`(${sql.join(conds, sql` OR `)})`;
    }
    return sql`FALSE`; // text 폴백 — resid 정수 컬럼이라 비숫자 매칭 0건
  }

  if (condition.source.startsWith(FILTER_SOURCE.ATTRS_PREFIX)) {
    const key = condition.source.slice(FILTER_SOURCE.ATTRS_PREFIX.length);
    const escaped = escapeLikePattern(condition.value);
    return sql`${cols.attrs}->>${key} ILIKE '%' || ${escaped} || '%'`;
  }

  if (condition.source.startsWith(FILTER_SOURCE.PII_PREFIX) && condition.mode === 'exact') {
    const columnKey = condition.source.slice(FILTER_SOURCE.PII_PREFIX.length);
    return sql`EXISTS (
      SELECT 1 FROM contact_pii pp
      WHERE pp.contact_target_id = ${cols.contactId}
        AND pp.column_key = ${columnKey}
        AND pp.blind_index = ${condition.blindIndex}
    )`;
  }

  // 알 수 없는 source — safety net. FALSE 로 두면 결과가 비어 즉시 인지된다.
  return sql`FALSE`;
}
```

- [ ] **Step 2: `report-progress.server.ts`에서 로컬 `buildFilterSql` 제거 후 import**

`report-progress.server.ts:77-116`의 `function buildFilterSql(...) { ... }` 전체(주석 포함 `66-116`의 함수 정의)를 삭제한다. import 라인을 수정한다.

`FILTER_SOURCE`·`escapeLikePattern`은 이 파일에서 `buildFilterSql` 내부에서만 쓰이므로(확인 완료), 함수를 옮기면 둘 다 불필요해진다. 따라서 `filter-shared` import 라인을 통째로 제거하고 `buildFilterSql` import를 추가한다.

기존:
```typescript
import { FILTER_SOURCE, escapeLikePattern } from './filter-shared';
```
변경(이 라인을 삭제하고 대신):
```typescript
import { buildFilterSql } from './progress-filters.server';
```

`:243`·`:294`의 `buildFilterSql(condition)` 호출은 그대로 둔다(cols 기본값 `ct`).

- [ ] **Step 3: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 4: 진척률 무회귀 테스트**

Run: `npx vitest run tests/unit/progress-filters.test.ts tests/integration/report-progress-exclusion.test.ts tests/integration/response-progress.test.ts`
Expected: 전부 PASS (buildFilterSql 동작 불변).

- [ ] **Step 5: Commit**

```bash
git add src/lib/operations/progress-filters.server.ts src/lib/operations/report-progress.server.ts
git commit -m "refactor: buildFilterSql를 progress-filters로 이동하고 컬럼 alias 주입 가능하게 일반화"
```

---

## Task 2: 응답 전용 condition 타입·파서 (`profiles-filters.server.ts`)

응답 내역은 진척률 후보(resid/attrs/pii)에 더해 응답 자체 컬럼 `idx`(순번)·`browser`를 검색한다. 진척률 `parseConditionFromUrl`을 재사용하되 idx/browser 분기를 앞에 둔다.

**Files:**
- Create: `src/lib/operations/profiles-filters.server.ts`
- Test: `tests/unit/domains/operations/profiles-filters.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/unit/domains/operations/profiles-filters.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

import {
  parseProfilesCondition,
  PROFILES_EXTRA_CANDIDATES,
} from '@/lib/operations/profiles-filters.server';
import type { ColumnCandidate } from '@/lib/operations/progress-filters.server';

const candidates: ColumnCandidate[] = [
  ...PROFILES_EXTRA_CANDIDATES,
  { source: 'system.resid', label: '컨택번호' },
  { source: 'attrs.전시회명', label: '전시회명' },
  { source: 'pii.email', label: '이메일', piiType: 'email' },
];

describe('parseProfilesCondition', () => {
  it('col 없으면 null', () => {
    expect(parseProfilesCondition(null, '5', candidates)).toBeNull();
  });

  it('빈 q 면 null', () => {
    expect(parseProfilesCondition('idx', '', candidates)).toBeNull();
    expect(parseProfilesCondition('idx', '   ', candidates)).toBeNull();
  });

  it('idx 숫자 → idx condition', () => {
    expect(parseProfilesCondition('idx', '5', candidates)).toEqual({
      source: 'idx',
      mode: 'idx',
      value: 5,
    });
  });

  it('idx 비숫자 → value 0 (매칭 0건 보장)', () => {
    expect(parseProfilesCondition('idx', 'abc', candidates)).toEqual({
      source: 'idx',
      mode: 'idx',
      value: 0,
    });
  });

  it('browser → text condition (trim)', () => {
    expect(parseProfilesCondition('browser', '  Chrome ', candidates)).toEqual({
      source: 'browser',
      mode: 'text',
      value: 'Chrome',
    });
  });

  it('attrs.* 는 진척률 파서로 위임', () => {
    expect(parseProfilesCondition('attrs.전시회명', '핵심', candidates)).toEqual({
      source: 'attrs.전시회명',
      mode: 'text',
      value: '핵심',
    });
  });

  it('system.resid idlist 위임', () => {
    expect(parseProfilesCondition('system.resid', '1-3, 9', candidates)).toEqual({
      source: 'system.resid',
      mode: 'idlist',
      ranges: [
        { from: 1, to: 3 },
        { from: 9, to: 9 },
      ],
    });
  });

  it('화이트리스트에 없는 col 은 null', () => {
    expect(parseProfilesCondition('attrs.unknown', 'x', candidates)).toBeNull();
  });

  it('PROFILES_EXTRA_CANDIDATES 는 idx·browser 2개', () => {
    expect(PROFILES_EXTRA_CANDIDATES.map((c) => c.source)).toEqual(['idx', 'browser']);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/unit/domains/operations/profiles-filters.test.ts`
Expected: FAIL — "Cannot find module '@/lib/operations/profiles-filters.server'".

- [ ] **Step 3: 구현**

`src/lib/operations/profiles-filters.server.ts`:

```typescript
import 'server-only';

import {
  parseConditionFromUrl,
  type ColumnCandidate,
  type FilterCondition,
} from './progress-filters.server';

/**
 * 응답 내역 필터 조건. 진척률 FilterCondition(resid/attrs/pii) + 응답 자체 컬럼 2종.
 *  - idx: survey_responses row_number (응답 순번). 정확 매치.
 *  - browser: survey_responses.browser. ilike 부분일치.
 */
export type ProfilesCondition =
  | { source: 'idx'; mode: 'idx'; value: number }
  | { source: 'browser'; mode: 'text'; value: string }
  | FilterCondition;

/** 응답 전용 추가 컬럼 후보 — 명단 후보 앞에 노출. */
export const PROFILES_EXTRA_CANDIDATES: ColumnCandidate[] = [
  { source: 'idx', label: '순번' },
  { source: 'browser', label: '브라우저' },
];

/**
 * col/q → ProfilesCondition. idx/browser 는 응답 전용 분기, 그 외는 진척률 파서 위임.
 *
 * idx 비숫자 입력은 value=0 으로 반환한다. row_number 는 항상 1 이상이라 `idx = 0` 은
 * 0건 — "순번으로 검색했으나 숫자가 아님 → 결과 없음" 의미를 명시적으로 표현(전체 노출 방지).
 */
export function parseProfilesCondition(
  col: string | null,
  q: string | null,
  candidates: ColumnCandidate[],
): ProfilesCondition | null {
  if (!col) return null;
  const trimmed = (q ?? '').trim();
  if (trimmed.length === 0) return null;

  if (col === 'idx') {
    const n = parseInt(trimmed, 10);
    return { source: 'idx', mode: 'idx', value: Number.isFinite(n) && n > 0 ? n : 0 };
  }

  if (col === 'browser') {
    return { source: 'browser', mode: 'text', value: trimmed };
  }

  return parseConditionFromUrl(col, q, candidates);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/unit/domains/operations/profiles-filters.test.ts`
Expected: PASS (10 케이스).

- [ ] **Step 5: Commit**

```bash
git add src/lib/operations/profiles-filters.server.ts tests/unit/domains/operations/profiles-filters.test.ts
git commit -m "feat: 응답 내역 필터 조건 파서 추가 (idx·browser + 명단 컬럼)"
```

---

## Task 3: `profiles.ts` — `qfield` → `col` 전환

URL 파라미터 체계를 진척률과 맞춘다(`qfield` 제거, `col` 도입). 후보 화이트리스트 검증은 server의 `parseProfilesCondition`이 담당하므로 여기선 원시 문자열만 보존한다.

**Files:**
- Modify: `src/lib/operations/profiles.ts:27-28` (QFIELDS 제거), `:55-101` (타입·함수)
- Test: `tests/unit/domains/operations/profiles.test.ts`

- [ ] **Step 1: 실패하는 테스트 추가**

`tests/unit/domains/operations/profiles.test.ts` 끝에 추가(상단 import에 `normalizeListArgs, hasActiveFilters` 추가):

```typescript
import { normalizeListArgs, hasActiveFilters } from '@/lib/operations/profiles'

describe('normalizeListArgs', () => {
  it('기본값 — col 빈 문자열, status all, sort idx, dir desc', () => {
    const r = normalizeListArgs({})
    expect(r.col).toBe('')
    expect(r.q).toBe('')
    expect(r.status).toBe('all')
    expect(r.sort).toBe('idx')
    expect(r.dir).toBe('desc')
    expect(r.view).toBe('active')
  })

  it('col 원시 문자열 보존 (화이트리스트 검증 안 함)', () => {
    expect(normalizeListArgs({ col: 'attrs.전시회명' }).col).toBe('attrs.전시회명')
    expect(normalizeListArgs({ col: 'idx' }).col).toBe('idx')
  })

  it('status=deleted → view deleted', () => {
    expect(normalizeListArgs({ status: 'deleted' }).view).toBe('deleted')
  })
})

describe('hasActiveFilters', () => {
  it('전부 기본값 → false', () => {
    expect(hasActiveFilters({})).toBe(false)
  })

  it('col+q 둘 다 있으면 → true', () => {
    expect(hasActiveFilters({ col: 'browser', q: 'Chrome' })).toBe(true)
  })

  it('col 만 있고 q 없으면 → false (검색 미발생)', () => {
    expect(hasActiveFilters({ col: 'browser', q: '' })).toBe(false)
  })

  it('status != all → true', () => {
    expect(hasActiveFilters({ status: 'completed' })).toBe(true)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/unit/domains/operations/profiles.test.ts`
Expected: FAIL — `col` 프로퍼티 없음 / `qfield` 타입 불일치.

- [ ] **Step 3: 구현 — `profiles.ts` 수정**

`profiles.ts:27-28` 삭제:
```typescript
export const QFIELDS = ['all', 'idx', 'browser'] as const;
export type QField = (typeof QFIELDS)[number];
```

`NormalizedListArgs` (`:55-64`) 수정 — `qfield: QField` → `col: string`:
```typescript
export interface NormalizedListArgs {
  page: number;
  q: string;
  /** 선택된 검색 컬럼 source (원시). 빈 문자열이면 미선택. 화이트리스트 검증은 server. */
  col: string;
  status: StatusFilter;
  sort: SortKey;
  dir: SortDir;
  /** status='deleted' 이면 'deleted', 그 외 전부 'active'. */
  view: ProfilesView;
}
```

`normalizeListArgs` (`:67-86`) 수정 — input 타입과 본문:
```typescript
export function normalizeListArgs(input: {
  page?: string;
  q?: string;
  col?: string;
  status?: string;
  sort?: string;
  dir?: string;
}): NormalizedListArgs {
  const status = pickFromWhitelist(input.status, STATUS_FILTERS, 'all');
  const view: ProfilesView = status === 'deleted' ? 'deleted' : 'active';
  return {
    page: Math.max(1, parseInt(input.page ?? '1', 10) || 1),
    q: (input.q ?? '').slice(0, 200),
    col: (input.col ?? '').slice(0, 100),
    status,
    sort: pickFromWhitelist(input.sort, SORT_KEYS, 'idx'),
    dir: input.dir === 'asc' ? 'asc' : 'desc',
    view,
  };
}
```

`hasActiveFilters` (`:91-101`) 수정:
```typescript
export function hasActiveFilters(input: {
  q?: string;
  col?: string;
  status?: string;
}): boolean {
  const hasSearch = (input.col ?? '') !== '' && (input.q ?? '') !== '';
  return hasSearch || (input.status ?? 'all') !== 'all';
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/unit/domains/operations/profiles.test.ts`
Expected: PASS (기존 + 신규 케이스).

- [ ] **Step 5: Commit**

```bash
git add src/lib/operations/profiles.ts tests/unit/domains/operations/profiles.test.ts
git commit -m "feat: 응답 내역 필터 파라미터를 qfield에서 col로 전환"
```

---

## Task 4: `profiles.server.ts` — ct LEFT JOIN + condition 필터 + groupValue

데이터 어댑터가 명단 정보를 끌어오고 condition 기반 필터를 outer에서 적용한다. row_number(idx) 독립성을 유지한다.

**Files:**
- Modify: `src/lib/operations/profiles.server.ts`

- [ ] **Step 1: import + `ProfilesRow` 수정**

상단 import 블록 수정:
```typescript
import { and, asc, eq, ilike, sql, type AnyColumn, type SQL } from 'drizzle-orm';

import { db } from '@/db';
import { surveyResponses, contactTargets } from '@/db/schema';
import { deletedResponse, notDeletedResponse } from '@/data/response-filters';
import { escapeLikePattern } from './filter-shared';

import type { Platform } from './parse-ua';
import { type NormalizedListArgs, type SortDir, type SortKey } from './profiles';
import { buildFilterSql } from './progress-filters.server';
import type { ProfilesCondition } from './profiles-filters.server';
import { buildNegativeCodeExists, getResultCodeStatuses } from './result-code-statuses.server';
```

(`or`는 더 이상 안 쓰므로 제거. `ilike`는 browser 매칭에 사용.)

`ProfilesRow`에 `groupValue` 추가:
```typescript
export interface ProfilesRow {
  id: string;
  idx: number;
  platform: Platform | null;
  browser: string | null;
  status: string;
  currentStepId: string | null;
  startedAt: Date;
  completedAt: Date | null;
  totalSeconds: number | null;
  /** 매칭된 contact_targets.group_value (전시회명 국문 등). 익명/미매칭이면 null. */
  groupValue: string | null;
}
```

`ListProfilesArgs` 수정 — `NormalizedListArgs`의 q/col/qfield 대신 condition 전달:
```typescript
export type ListProfilesArgs = Omit<NormalizedListArgs, 'q' | 'col'> & {
  surveyId: string;
  pageSize: number;
  condition: ProfilesCondition | null;
};
```

- [ ] **Step 2: condition → SQL 헬퍼 추가**

`listResponsesForProfiles` 위에 추가:
```typescript
/**
 * ProfilesCondition → outer WHERE SQL fragment. null 이면 null(필터 없음).
 *
 * idx/browser 는 survey_responses 파생 컬럼이라 numbered alias 직접 참조.
 * resid/attrs/pii 는 진척률 buildFilterSql 재사용 — numbered 가 LEFT JOIN 한
 * contact_targets 컬럼을 alias 로 주입. 익명 응답(contact_target_id NULL)은
 * resid/attrs/pii 매칭이 자동 false 라 제외된다(의도).
 */
function profilesConditionToSql(
  condition: ProfilesCondition | null,
  numbered: {
    idx: SQL.Aliased<number>;
    browser: AnyColumn | SQL.Aliased;
    contactResid: AnyColumn | SQL.Aliased;
    contactAttrs: AnyColumn | SQL.Aliased;
    contactTargetId: AnyColumn | SQL.Aliased;
  },
): SQL | null {
  if (!condition) return null;

  if (condition.source === 'idx') {
    return sql`${numbered.idx} = ${condition.value}`;
  }

  if (condition.source === 'browser') {
    const pattern = `%${escapeLikePattern(condition.value)}%`;
    return ilike(numbered.browser, pattern);
  }

  return buildFilterSql(condition, {
    resid: sql`${numbered.contactResid}`,
    attrs: sql`${numbered.contactAttrs}`,
    contactId: sql`${numbered.contactTargetId}`,
  });
}
```

(타입 주석이 까다로우면 `numbered: typeof numbered`를 inline으로 두기 어려우므로, Step 3에서 numbered 정의 후 `profilesConditionToSql`을 함수 내부 클로저로 옮겨도 된다. 구현 시 tsc 통과를 우선하고, 가장 단순한 형태로 작성한다 — 핵심은 idx=정확매치 / browser=ilike / 나머지=buildFilterSql 위임.)

- [ ] **Step 3: `numbered` subquery에 ct LEFT JOIN + 컬럼 추가**

`numbered` 정의(`:76-108`)의 `.select({...})`에 ct 컬럼 추가, `.from(...)` 뒤에 `.leftJoin` 추가:
```typescript
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
      groupValue: contactTargets.groupValue,
      contactResid: contactTargets.resid,
      contactAttrs: contactTargets.attrs,
      contactTargetId: surveyResponses.contactTargetId,
    })
    .from(surveyResponses)
    .leftJoin(contactTargets, eq(contactTargets.id, surveyResponses.contactTargetId))
    .where(
      and(
        eq(surveyResponses.surveyId, surveyId),
        view === 'deleted' ? deletedResponse : notDeletedResponse,
        sql`NOT EXISTS (
          SELECT 1 FROM contact_targets ct
          WHERE ct.id = ${surveyResponses.contactTargetId}
            AND (
              ct.unsubscribed_at IS NOT NULL
              ${negativeCodeBranch}
            )
        )`,
      ),
    )
    .as('numbered');
```

- [ ] **Step 4: outer WHERE — condition 필터로 교체**

함수 시그니처 구조분해(`:65`)에서 `q, qfield` 제거하고 `condition` 추가:
```typescript
  const { surveyId, page, pageSize, status, sort, dir, view, condition } = args;
```

`whereParts` 빌드 구간(`:118-145`)을 교체:
```typescript
  const whereParts: SQL[] = [];

  if (view === 'active' && status !== 'all') {
    whereParts.push(eq(numbered.status, status));
  }

  const conditionSql = profilesConditionToSql(condition, {
    idx: numbered.idx,
    browser: numbered.browser,
    contactResid: numbered.contactResid,
    contactAttrs: numbered.contactAttrs,
    contactTargetId: numbered.contactTargetId,
  });
  if (conditionSql) whereParts.push(conditionSql);
```

- [ ] **Step 5: data select + row map에 groupValue 추가**

`dataQuery`의 `.select({...})`(`:164-174`)에 `groupValue: numbered.groupValue,` 추가. 결과 map(`:182-192`)에 `groupValue: r.groupValue ?? null,` 추가:
```typescript
  const rows: ProfilesRow[] = dataRows.map((r) => ({
    id: r.id,
    idx: r.idx,
    platform: r.platform as Platform | null,
    browser: r.browser,
    status: r.status,
    currentStepId: r.currentStepId,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    totalSeconds: r.totalSeconds,
    groupValue: r.groupValue ?? null,
  }));
```

- [ ] **Step 6: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음. (`profilesConditionToSql`의 numbered 타입이 까다로우면 인자 타입을 `Record<string, AnyColumn | SQL.Aliased>` 등으로 느슨하게 하거나 클로저로 이동. idx=정확매치/browser=ilike/나머지=buildFilterSql 위임 동작만 유지.)

- [ ] **Step 7: 통합 테스트 mock — leftJoin 지원 추가**

`tests/integration/profiles-exclusion.test.ts`의 select 체인 mock은 `.from(...).where(...).as('numbered')`만 지원한다. `.leftJoin(...)`이 추가됐으므로 mock 체인에 pass-through `leftJoin` 핸들러를 추가하고, `NumberedRow` 인터페이스와 합성 로직에 `groupValue: string | null`(미매칭 시 null)을 추가한다. 기존 테스트의 검증 의도(exclusion 필터)는 그대로 두고, leftJoin은 동작에 영향 없는 pass-through로 처리한다.

구현 지침: mock 객체에서 `from()`이 반환하는 체인 객체에 `leftJoin: () => chain`(자기 자신 반환)을 추가. `numberedRows` 합성 시 각 행에 `groupValue: null`을 기본 부여(테스트 시드가 group_value를 다루지 않으므로). 실제 파일 구조를 읽고(`Read tests/integration/profiles-exclusion.test.ts`) 체인 정의 위치에 맞춰 최소 수정.

- [ ] **Step 8: 통합 테스트 통과 확인**

Run: `npx vitest run tests/integration/profiles-exclusion.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/operations/profiles.server.ts tests/integration/profiles-exclusion.test.ts
git commit -m "feat: 응답 내역 어댑터에 컨택 명단 join과 condition 필터 추가"
```

---

## Task 5: `profiles-filter-bar.tsx` — 진척률 스타일 UI

필터바를 `[컬럼 선택 Select] [검색어 Input] [전체 상태 Select] [적용]`로 재작성한다.

**Files:**
- Modify: `src/components/operations/profiles/profiles-filter-bar.tsx` (전체 교체)

- [ ] **Step 1: 전체 교체**

```tsx
'use client';

import { useEffect, useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSearchParamsMutator } from '@/hooks/use-search-params-mutator';
import { hasActiveFilters, type StatusFilter } from '@/lib/operations/profiles';
import {
  placeholderFor as sharedPlaceholderFor,
  type ColumnCandidate,
} from '@/lib/operations/filter-shared';

import { PiiExactMarker } from '@/components/operations/filter-pii-marker';

interface Props {
  initialSource: string;
  initialValue: string;
  initialStatus: StatusFilter;
  columnCandidates: ColumnCandidate[];
}

const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: '전체 상태' },
  { value: 'completed', label: '완료만' },
  { value: 'in_progress', label: '진행중만' },
  { value: 'drop', label: '이탈만' },
  { value: 'screened_out', label: '자격 미달' },
  { value: 'quotaful_out', label: '쿼터마감' },
  { value: 'bad', label: '불량' },
];

/** idx/browser 는 응답 전용 placeholder, 그 외는 공유 헬퍼('부분일치'). */
function placeholderFor(source: string): string {
  if (source === 'idx') return '예: 5';
  if (source === 'browser') return '예: Chrome';
  return sharedPlaceholderFor(source || null, '부분일치');
}

/**
 * 응답 내역 필터바 (진척률 스타일).
 *
 * - 컬럼 select + 값 input + 상태 select + [적용] 한 줄
 * - form submit 으로만 URL 갱신 (적용 버튼 또는 Enter)
 * - URL ?col=&q=&status= 직렬화. 빈 값/기본값은 키 삭제. 필터 변경 시 page 리셋.
 * - 컬럼 미선택 + 검색어 입력 시 [적용] 비활성.
 */
export function ProfilesFilterBar({
  initialSource,
  initialValue,
  initialStatus,
  columnCandidates,
}: Props) {
  const [source, setSource] = useState(initialSource);
  const [value, setValue] = useState(initialValue);
  const [status, setStatus] = useState<StatusFilter>(initialStatus);
  const [, startTransition] = useTransition();
  const pushParams = useSearchParamsMutator();
  const searchParams = useSearchParams();

  // 뒤로/앞으로 가기 시 server 가 새 initial 을 내려주면 로컬 state 동기화.
  useEffect(() => {
    setSource(initialSource);
    setValue(initialValue);
    setStatus(initialStatus);
  }, [initialSource, initialValue, initialStatus]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    startTransition(() => {
      pushParams((p) => {
        if (!source || trimmed.length === 0) {
          p.delete('col');
          p.delete('q');
        } else {
          p.set('col', source);
          p.set('q', trimmed);
        }
        if (status !== 'all') p.set('status', status);
        else p.delete('status');
        p.delete('page');
      });
    });
  };

  const handleReset = () => {
    setSource('');
    setValue('');
    setStatus('all');
    pushParams((p) => {
      p.delete('col');
      p.delete('q');
      p.delete('status');
      p.delete('page');
    });
  };

  const showReset = hasActiveFilters({
    q: searchParams?.get('q') ?? undefined,
    col: searchParams?.get('col') ?? undefined,
    status: searchParams?.get('status') ?? undefined,
  });

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-wrap items-center gap-2"
      role="search"
      aria-label="응답 내역 필터"
    >
      <label htmlFor="profiles-filter-column" className="sr-only">검색 컬럼</label>
      <Select value={source || ''} onValueChange={(v) => setSource(v || '')}>
        <SelectTrigger id="profiles-filter-column" className="w-[160px] shrink-0">
          <SelectValue placeholder="컬럼 선택" />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {columnCandidates.map((c) => (
            <SelectItem key={c.source} value={c.source}>
              {c.label}
              <PiiExactMarker source={c.source} />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <label htmlFor="profiles-filter-value" className="sr-only">검색어</label>
      <Input
        id="profiles-filter-value"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholderFor(source)}
        className="h-10 w-[240px] shrink-0"
      />

      <label htmlFor="profiles-filter-status" className="sr-only">상태 필터</label>
      <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
        <SelectTrigger id="profiles-filter-status" className="w-[140px] shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        type="submit"
        className="h-10"
        disabled={!source && value.trim().length > 0}
      >
        적용
      </Button>
      {showReset && (
        <Button type="button" variant="outline" className="h-10" onClick={handleReset}>
          필터 초기화
        </Button>
      )}
    </form>
  );
}
```

(주의: 기존 status select에 있던 "삭제됨"(deleted) 옵션은 shadcn `Select`가 disabled separator를 지원하지 않으므로 제외. 삭제 뷰는 별도 진입점이 있다면 그대로 두고, 없으면 이 변경으로 deleted 뷰 진입이 사라진다 — Task 7 검증 시 확인하고, 필요하면 STATUS_OPTIONS에 `{ value: 'deleted', label: '삭제됨' }` 추가.)

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 3: Commit**

```bash
git add src/components/operations/profiles/profiles-filter-bar.tsx
git commit -m "feat: 응답 내역 필터바를 진척률 스타일로 재구성"
```

---

## Task 6: `profiles-table.tsx` — group 컬럼 실제 값

**Files:**
- Modify: `src/components/operations/profiles/profiles-table.tsx:60-70` (DisplayRow), `:107-118` (map), `:125-130` (group 컬럼)

- [ ] **Step 1: `DisplayRow`에 groupValue 추가** (`:60-70`)

```typescript
interface DisplayRow {
  id: string;
  idx: number;
  groupValue: string | null;
  platformKo: string;
  browser: string;
  pill: StatusPillResult;
  startedAt: Date;
  completedAt: Date | null;
  isInProgress: boolean;
  totalTimeText: string;
}
```

- [ ] **Step 2: display map에 groupValue 추가** (`:107-117`의 return 객체)

`idx: r.idx,` 다음 줄에 추가:
```typescript
          groupValue: r.groupValue,
```

- [ ] **Step 3: group 컬럼 accessorFn 교체** (`:125-130`)

```typescript
      {
        id: 'group',
        accessorFn: (r: DisplayRow) => r.groupValue ?? '공개링크',
        header: '조사 대상 그룹',
        meta: meta('left', false),
      },
```

- [ ] **Step 4: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 5: Commit**

```bash
git add src/components/operations/profiles/profiles-table.tsx
git commit -m "feat: 조사 대상 그룹 컬럼을 실제 명단 그룹 값으로 표시"
```

---

## Task 7: `profiles/page.tsx` — 후보 로드 + condition 파싱 통합

**Files:**
- Modify: `src/app/admin/surveys/[id]/operations/profiles/page.tsx`

- [ ] **Step 1: import + searchParams 타입 수정**

상단 import에 추가:
```typescript
import { getContactColumnScheme, buildColumnCandidates } from '@/lib/operations/contacts.server';
import { parseProfilesCondition, PROFILES_EXTRA_CANDIDATES } from '@/lib/operations/profiles-filters.server';
```

`searchParams` 타입(`:24-31`)에서 `qfield?: string;` → `col?: string;`.

- [ ] **Step 2: 후보 로드 + condition 파싱 + 어댑터 호출 수정**

`normalizeListArgs` 호출 다음에 후보·condition 구성. `Promise.all` 블록을 수정:
```typescript
  const args = normalizeListArgs(sp);

  const contactScheme = await getContactColumnScheme(surveyId);
  const columnCandidates = [
    ...PROFILES_EXTRA_CANDIDATES,
    ...buildColumnCandidates(contactScheme).filter(
      (c) =>
        c.source === 'system.resid' ||
        c.source.startsWith('attrs.') ||
        c.source.startsWith('pii.'),
    ),
  ];
  const condition = parseProfilesCondition(args.col, args.q, columnCandidates);

  const [{ rows, total, page: clampedPage }, qs] = await Promise.all([
    listResponsesForProfiles({
      surveyId,
      pageSize: PROFILES_PAGE_SIZE,
      page: args.page,
      status: args.status,
      sort: args.sort,
      dir: args.dir,
      view: args.view,
      condition,
    }),
    db
      .select({
        id: questionsTable.id,
        order: questionsTable.order,
        title: questionsTable.title,
      })
      .from(questionsTable)
      .where(eq(questionsTable.surveyId, surveyId))
      .orderBy(asc(questionsTable.order), asc(questionsTable.id)),
  ]);
```

(`buildColumnCandidates`가 이미 system.contact_result/system.web도 포함하므로 응답 내역에서 의미 없는 system.* 후보는 위 filter로 제외 — resid/attrs/pii만.)

- [ ] **Step 3: ProfilesFilterBar props 교체** (`:82-86`)

```tsx
            <ProfilesFilterBar
              initialSource={args.col}
              initialValue={args.q}
              initialStatus={args.status}
              columnCandidates={columnCandidates}
            />
```

- [ ] **Step 4: 타입 체크 + 빌드**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/surveys/[id]/operations/profiles/page.tsx
git commit -m "feat: 응답 내역 페이지에 컬럼 후보 로드와 condition 파싱 연결"
```

---

## Task 8: 전체 검증

**Files:** 없음 (검증 전용)

- [ ] **Step 1: 전체 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 2: 관련 테스트 전체**

Run: `npx vitest run tests/unit/domains/operations/profiles.test.ts tests/unit/domains/operations/profiles-filters.test.ts tests/unit/progress-filters.test.ts tests/integration/profiles-exclusion.test.ts tests/integration/report-progress-exclusion.test.ts tests/integration/response-progress.test.ts`
Expected: 전부 PASS.

- [ ] **Step 3: 프로덕션 빌드**

Run: `pnpm build`
Expected: 빌드 성공. (ESLint 인프라는 깨져 있어 build의 lint 단계가 막히면 메모리 `feedback_lint_infra_broken` 참고 — tsc+vitest로 대체 검증.)

- [ ] **Step 4: 수동 검증 체크리스트**

개발 서버(`pnpm dev`)에서 `/admin/surveys/<id>/operations/profiles`:
- 필터바가 `[컬럼 선택][검색어][전체 상태][적용]`로 표시.
- 컬럼 선택에 `순번`, `브라우저`, `번호`(resid), `전시회명(국문)` 등 명단 컬럼이 노출.
- `전시회명(국문)` 선택 + 값 입력 → 해당 그룹 응답만 필터(익명 제외).
- `순번` 선택 + 숫자 → 해당 순번 1건.
- `브라우저` 선택 + "Chrome" → 부분일치.
- 상태 필터 동작.
- "조사 대상 그룹" 컬럼: 명단 매칭 응답은 전시회명, 익명 응답은 "공개링크".
- 진척률 페이지 무회귀(필터 정상 동작).

- [ ] **Step 5: 최종 Commit (필요 시)**

검증 중 수정이 있었다면:
```bash
git add -A
git commit -m "fix: 응답 내역 필터 검증 중 발견된 이슈 수정"
```

---

## 완료 조건

- 응답 내역 필터바 = 진척률 스타일(`[컬럼 선택][검색어][전체 상태][적용]`), 후보에 순번·브라우저·명단 컬럼 포함.
- "조사 대상 그룹" = 매칭 응답은 전시회명 국문, 익명은 "공개링크".
- idx 순번 독립성 유지(필터 무관 절대 순번).
- 진척률 페이지 무회귀.
- tsc + 관련 vitest + build 통과.
