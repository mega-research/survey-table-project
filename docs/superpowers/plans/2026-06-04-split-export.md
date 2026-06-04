# 분할 내보내기 (Split Raw Export) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 변수가 임계치(10,000열)를 넘는 대형 설문의 raw export를, 사용자가 고른 기준 문항의 옵션별로 시트를 분할해 한 워크북으로 내보낸다.

**Architecture:** 순수 버킷팅/계획 함수(`split-export.ts`)와 워크북 생성(`excel-transformer.ts`)을 분리하되 **동일한 버킷팅 함수를 공유**해 미리보기 숫자와 실제 다운로드가 일치하게 한다. API는 미리보기용 JSON 엔드포인트(`split-preview`)와 기존 export route의 `raw-split` 분기로 나눈다. 모달은 기존 `export-data-modal.tsx`를 4-step 상태머신으로 확장한다.

**Tech Stack:** TypeScript(strict), Next.js App Router, Drizzle ORM, ExcelJS, vitest, TanStack Query, shadcn/ui, lucide-react, TailwindCSS.

**관련 문서:** 설계 스펙 `docs/superpowers/specs/2026-06-04-split-export-design.md`. 검증된 1회성 스크립트 `scripts/export-pummok-split.mts`(버킷팅 로직 원형).

**검증 명령(메모: ESLint 인프라 깨짐 — lint 대신 tsc/vitest/build 사용):**
- 단위 테스트: `npx vitest run tests/unit/analytics/split-export.test.ts`
- 타입 체크: `npx tsc --noEmit`
- 빌드: `pnpm build`

---

## File Structure

| 파일 | 역할 | 신규/수정 |
|------|------|-----------|
| `src/lib/analytics/split-export.ts` | 순수 함수: `valueMatchSet`, `bucketQuestions`, `optionTokensForBasis`, `planSplit`, `detectSplitCandidates` + 타입 + 상수. ExcelJS 의존 없음. | 신규 |
| `tests/unit/analytics/split-export.test.ts` | 위 순수 함수 단위 테스트 + planSplit↔buildSplitWorkbook 일관성 테스트 | 신규 |
| `src/lib/excel-transformer.ts` | `buildSplitWorkbook()` 추가. 기존 `generateRawDataWorkbook`는 손대지 않고, 옵션 시트용 private 헬퍼 `addVariableSheet` 추가. | 수정 |
| `src/app/api/surveys/[surveyId]/export/split-preview/route.ts` | GET JSON: basis 없으면 후보, 있으면 plan(+resp 집계) | 신규 |
| `src/app/api/surveys/[surveyId]/export/route.ts` | `ALLOWED_EXPORT_TYPES`에 `'raw-split'` 추가 + 분기 | 수정 |
| `src/components/analytics/export-data-modal.tsx` | 4-step 분할 흐름으로 확장 | 수정 |

**경계 원칙:** `split-export.ts`는 순수(테스트 쉬움) — DB/ExcelJS 불포함. resp 카운트는 route가 계산해 `planSplit`에 주입한다. 워크북 생성은 private 헬퍼가 많은 `excel-transformer.ts`에 둬 재사용한다.

---

## Task 1: split-export 모듈 — 타입·상수·valueMatchSet

**Files:**
- Create: `src/lib/analytics/split-export.ts`
- Test: `tests/unit/analytics/split-export.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/unit/analytics/split-export.test.ts
import { describe, it, expect } from 'vitest';

import { valueMatchSet } from '@/lib/analytics/split-export';
import type { QuestionConditionGroup } from '@/types/survey';

const vm = (sourceQuestionId: string, requiredValues: string[]): QuestionConditionGroup => ({
  logicType: 'AND',
  conditions: [
    { id: 'c1', sourceQuestionId, conditionType: 'value-match', requiredValues, logicType: 'AND' },
  ],
});

describe('valueMatchSet', () => {
  it('value-match 조건의 requiredValues를 Set으로 모은다', () => {
    const set = valueMatchSet(vm('Q2', ['opt1', 'opt3']), 'Q2');
    expect(set).not.toBeNull();
    expect([...set!].sort()).toEqual(['opt1', 'opt3']);
  });

  it('다른 sourceQuestionId는 무시한다', () => {
    expect(valueMatchSet(vm('Q9', ['opt1']), 'Q2')).toBeNull();
  });

  it('value-match가 아닌 conditionType은 무시한다', () => {
    const dc: QuestionConditionGroup = {
      logicType: 'AND',
      conditions: [
        { id: 'c1', sourceQuestionId: 'Q2', conditionType: 'table-cell-check', logicType: 'AND' },
      ],
    };
    expect(valueMatchSet(dc, 'Q2')).toBeNull();
  });

  it('조건이 없으면 null', () => {
    expect(valueMatchSet(undefined, 'Q2')).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/unit/analytics/split-export.test.ts`
Expected: FAIL — `Cannot find module '@/lib/analytics/split-export'`

- [ ] **Step 3: 모듈 최소 구현**

```ts
// src/lib/analytics/split-export.ts
import type { Question, QuestionConditionGroup } from '@/types/survey';

export const SPLIT_SOFT_LIMIT = 10000;
export const SPLIT_EXCEL_LIMIT = 16384;

/** displayCondition 중 basisId를 value-match 하는 조건의 requiredValues 합집합. 없으면 null. */
export function valueMatchSet(
  dc: QuestionConditionGroup | undefined,
  basisId: string,
): Set<string> | null {
  if (!dc || !Array.isArray(dc.conditions)) return null;
  let s: Set<string> | null = null;
  for (const c of dc.conditions) {
    if (
      c.conditionType === 'value-match' &&
      c.sourceQuestionId === basisId &&
      Array.isArray(c.requiredValues) &&
      c.requiredValues.length > 0
    ) {
      s = s ?? new Set<string>();
      for (const v of c.requiredValues) s.add(v);
    }
  }
  return s;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/unit/analytics/split-export.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/analytics/split-export.ts tests/unit/analytics/split-export.test.ts
git commit -m "feat: 분할 내보내기 valueMatchSet 추가"
```

---

## Task 2: bucketQuestions — 버킷별 질문/행 필터

`scripts/export-pummok-split.mts`의 `filterForBucket()`를 임의 basis로 일반화한다.

**Files:**
- Modify: `src/lib/analytics/split-export.ts`
- Test: `tests/unit/analytics/split-export.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** (기존 파일에 append)

```ts
import { bucketQuestions } from '@/lib/analytics/split-export';

const q = (over: Partial<Question>): Question => ({
  id: 'x', surveyId: 's', type: 'text', title: 't', required: false, order: 0,
  ...over,
} as unknown as Question);

describe('bucketQuestions', () => {
  // basis Q2 + 공통질문 A + opt1전용 B + 테이블 T(공통행 r0 / opt1행 r1 / opt2행 r2)
  const basis = q({ id: 'Q2', type: 'checkbox', questionCode: 'Q2' });
  const A = q({ id: 'A', type: 'text' });
  const B = q({ id: 'B', type: 'radio', displayCondition: vm('Q2', ['opt1']) });
  const T = q({
    id: 'T', type: 'table',
    tableRowsData: [
      { id: 'r0', cells: [] },
      { id: 'r1', cells: [], displayCondition: vm('Q2', ['opt1']) },
      { id: 'r2', cells: [], displayCondition: vm('Q2', ['opt2']) },
    ],
  } as Partial<Question>);
  const all = [basis, A, B, T];

  it('common: 조건 없는 질문 + basis 조건 없는 테이블 행만', () => {
    const out = bucketQuestions(all, 'Q2', 'common');
    expect(out.map((x) => x.id).sort()).toEqual(['A', 'Q2', 'T']);
    const t = out.find((x) => x.id === 'T')!;
    expect(t.tableRowsData!.map((r) => r.id)).toEqual(['r0']);
  });

  it('opt1: opt1 전용 질문 + opt1 행만', () => {
    const out = bucketQuestions(all, 'Q2', 'opt1');
    expect(out.map((x) => x.id).sort()).toEqual(['B', 'T']);
    const t = out.find((x) => x.id === 'T')!;
    expect(t.tableRowsData!.map((r) => r.id)).toEqual(['r1']);
  });

  it('opt2: 전용 질문 없고 opt2 행만', () => {
    const out = bucketQuestions(all, 'Q2', 'opt2');
    expect(out.map((x) => x.id)).toEqual(['T']);
    expect(out[0].tableRowsData!.map((r) => r.id)).toEqual(['r2']);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/unit/analytics/split-export.test.ts`
Expected: FAIL — `bucketQuestions is not a function`

- [ ] **Step 3: 구현 추가**

```ts
// src/lib/analytics/split-export.ts 에 추가
/** bucket('common' | 옵션토큰)에 속한 질문/행만 남긴 복사본 리스트 */
export function bucketQuestions(
  questions: Question[],
  basisId: string,
  bucket: string,
): Question[] {
  const out: Question[] = [];
  for (const q of questions) {
    const qset = valueMatchSet(q.displayCondition, basisId);
    if (bucket === 'common') {
      if (qset !== null) continue; // 옵션 전용 질문
      if (q.type === 'table' && Array.isArray(q.tableRowsData)) {
        const rows = q.tableRowsData.filter((r) => valueMatchSet(r.displayCondition, basisId) === null);
        if (rows.length === 0) continue;
        out.push({ ...q, tableRowsData: rows });
      } else {
        out.push(q);
      }
    } else {
      if (qset !== null && !qset.has(bucket)) continue; // 다른 옵션 전용
      if (qset !== null) {
        out.push(q); // 이 옵션 전용 질문 → 전체 행
      } else if (q.type === 'table' && Array.isArray(q.tableRowsData)) {
        const rows = q.tableRowsData.filter((r) => {
          const rs = valueMatchSet(r.displayCondition, basisId);
          return rs !== null && rs.has(bucket);
        });
        if (rows.length === 0) continue;
        out.push({ ...q, tableRowsData: rows });
      }
      // 공통 비테이블 질문은 옵션 시트에 넣지 않음(공통 시트로 감)
    }
  }
  return out;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/unit/analytics/split-export.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/analytics/split-export.ts tests/unit/analytics/split-export.test.ts
git commit -m "feat: 분할 내보내기 bucketQuestions 추가"
```

---

## Task 3: optionTokensForBasis — 옵션 토큰 도출

**Files:**
- Modify: `src/lib/analytics/split-export.ts`
- Test: `tests/unit/analytics/split-export.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** (append)

```ts
import { optionTokensForBasis } from '@/lib/analytics/split-export';

describe('optionTokensForBasis', () => {
  it('basis.options 순서로 정렬하고, 옵션에 없는 토큰(other)은 뒤에 붙인다', () => {
    const basis = q({
      id: 'Q2', type: 'checkbox', questionCode: 'Q2',
      options: [
        { id: 'o1', value: 'opt1', label: '제재목' },
        { id: 'o2', value: 'opt2', label: '합판' },
      ],
    } as Partial<Question>);
    const B = q({ id: 'B', displayCondition: vm('Q2', ['opt2']) });
    const C = q({ id: 'C', displayCondition: vm('Q2', ['opt1', 'other']) });
    const tokens = optionTokensForBasis([basis, B, C], basis);
    expect(tokens).toEqual(['opt1', 'opt2', 'other']);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/unit/analytics/split-export.test.ts`
Expected: FAIL — `optionTokensForBasis is not a function`

- [ ] **Step 3: 구현 추가**

```ts
// src/lib/analytics/split-export.ts 에 추가
/** displayCondition들에 실제 등장하는 basis 옵션 토큰을, options 순서로 정렬해 반환 */
export function optionTokensForBasis(questions: Question[], basis: Question): string[] {
  const present = new Set<string>();
  for (const q of questions) {
    const qs = valueMatchSet(q.displayCondition, basis.id);
    qs?.forEach((t) => present.add(t));
    if (q.type === 'table' && Array.isArray(q.tableRowsData)) {
      for (const r of q.tableRowsData) {
        valueMatchSet(r.displayCondition, basis.id)?.forEach((t) => present.add(t));
      }
    }
  }
  const ordered: string[] = [];
  for (const o of basis.options ?? []) {
    if (present.has(o.value)) {
      ordered.push(o.value);
      present.delete(o.value);
    }
  }
  for (const t of present) ordered.push(t); // 옵션 목록에 없는 토큰(other 등)
  return ordered;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/unit/analytics/split-export.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/analytics/split-export.ts tests/unit/analytics/split-export.test.ts
git commit -m "feat: 분할 내보내기 optionTokensForBasis 추가"
```

---

## Task 4: planSplit — 시트 계획 + 변수 수

**Files:**
- Modify: `src/lib/analytics/split-export.ts`
- Test: `tests/unit/analytics/split-export.test.ts`

`generateSPSSColumns`로 버킷별 변수 수를 센다. resp 카운트는 외부에서 주입(순수성 유지).

- [ ] **Step 1: 실패하는 테스트 작성** (append)

```ts
import { planSplit } from '@/lib/analytics/split-export';

describe('planSplit', () => {
  const basis = q({
    id: 'Q2', type: 'radio', questionCode: 'Q2', title: '품목',
    options: [
      { id: 'o1', value: 'opt1', label: '제재목' },
      { id: 'o2', value: 'opt2', label: '합판' },
    ],
  } as Partial<Question>);
  const common = q({ id: 'A', type: 'text', title: '공통질문' });
  const only1 = q({ id: 'B', type: 'text', title: 'opt1전용', displayCondition: vm('Q2', ['opt1']) });
  const all = [basis, common, only1];

  it('공통/옵션 시트 변수 수와 메타를 계산한다', () => {
    const plan = planSplit(all, 'Q2', { opt1: 12, opt2: 5 });
    expect(plan.basisCode).toBe('Q2');
    expect(plan.basisLabel).toBe('품목');
    // 공통: basis(radio=1열) + 공통 text(1열) = 2
    expect(plan.common).toBe(2);
    // opt1 시트: only1 text 1열, opt2 시트: 변수 0 → 시트 제외
    const opt1 = plan.sheets.find((s) => s.token === 'opt1')!;
    expect(opt1.vars).toBe(1);
    expect(opt1.name).toBe('제재목');
    expect(opt1.resp).toBe(12);
    expect(plan.sheets.find((s) => s.token === 'opt2')).toBeUndefined(); // 빈 버킷 제외
    expect(plan.maxVars).toBe(2); // 공통이 최대
    expect(plan.exceedsSoftLimit).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/unit/analytics/split-export.test.ts`
Expected: FAIL — `planSplit is not a function`

- [ ] **Step 3: 구현 추가**

```ts
// src/lib/analytics/split-export.ts 상단 import에 추가
import { generateSPSSColumns } from './spss-excel-export';

// 타입 + planSplit 추가
export interface SplitSheetPlan {
  token: string;
  name: string;
  vars: number;
  resp: number;
}

export interface SplitPlan {
  basisQuestionId: string;
  basisCode: string;
  basisLabel: string;
  common: number;
  sheets: SplitSheetPlan[];
  maxVars: number;
  exceedsSoftLimit: boolean;
  exceedsExcelLimit: boolean;
}

export function planSplit(
  questions: Question[],
  basisQuestionId: string,
  respCounts: Record<string, number> = {},
): SplitPlan {
  const basis = questions.find((q) => q.id === basisQuestionId);
  if (!basis) throw new Error(`기준 문항을 찾을 수 없습니다: ${basisQuestionId}`);

  const labelMap = new Map((basis.options ?? []).map((o) => [o.value, o.label]));
  const tokens = optionTokensForBasis(questions, basis);

  const common = generateSPSSColumns(bucketQuestions(questions, basisQuestionId, 'common')).length;

  const sheets: SplitSheetPlan[] = [];
  for (const t of tokens) {
    const vars = generateSPSSColumns(bucketQuestions(questions, basisQuestionId, t)).length;
    if (vars === 0) continue; // 빈 버킷 제외
    sheets.push({ token: t, name: labelMap.get(t) ?? t, vars, resp: respCounts[t] ?? 0 });
  }

  const maxVars = Math.max(common, 0, ...sheets.map((s) => s.vars));
  return {
    basisQuestionId,
    basisCode: basis.questionCode ?? '',
    basisLabel: basis.title,
    common,
    sheets,
    maxVars,
    exceedsSoftLimit: maxVars > SPLIT_SOFT_LIMIT,
    exceedsExcelLimit: maxVars > SPLIT_EXCEL_LIMIT,
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/unit/analytics/split-export.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/analytics/split-export.ts tests/unit/analytics/split-export.test.ts
git commit -m "feat: 분할 내보내기 planSplit 추가"
```

---

## Task 5: detectSplitCandidates — 후보 추천

**Files:**
- Modify: `src/lib/analytics/split-export.ts`
- Test: `tests/unit/analytics/split-export.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** (append)

```ts
import { detectSplitCandidates } from '@/lib/analytics/split-export';

describe('detectSplitCandidates', () => {
  it('value-match 참조 문항을 후보로, maxVars 오름차순 정렬·권장 표시한다', () => {
    const basis = q({
      id: 'Q2', type: 'radio', questionCode: 'Q2', title: '품목',
      options: [
        { id: 'o1', value: 'opt1', label: '제재목' },
        { id: 'o2', value: 'opt2', label: '합판' },
      ],
    } as Partial<Question>);
    const b1 = q({ id: 'B1', type: 'text', displayCondition: vm('Q2', ['opt1']) });
    const b2 = q({ id: 'B2', type: 'text', displayCondition: vm('Q2', ['opt2']) });
    const cands = detectSplitCandidates([basis, b1, b2]);
    expect(cands).toHaveLength(1);
    expect(cands[0].questionId).toBe('Q2');
    expect(cands[0].refCount).toBe(2);
    expect(cands[0].buckets).toBe(2);
    expect(cands[0].recommended).toBe(true);
    expect(cands[0].note).not.toBe('');
  });

  it('시트가 2개 미만이면 후보에서 제외한다', () => {
    const basis = q({
      id: 'Q2', type: 'radio', questionCode: 'Q2',
      options: [{ id: 'o1', value: 'opt1', label: 'A' }],
    } as Partial<Question>);
    const b1 = q({ id: 'B1', type: 'text', displayCondition: vm('Q2', ['opt1']) });
    expect(detectSplitCandidates([basis, b1])).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/unit/analytics/split-export.test.ts`
Expected: FAIL — `detectSplitCandidates is not a function`

- [ ] **Step 3: 구현 추가**

```ts
// src/lib/analytics/split-export.ts 에 추가
const SPLIT_BASIS_TYPES = ['radio', 'checkbox', 'select', 'multiselect'];

export interface SplitCandidate {
  questionId: string;
  code: string;
  label: string;
  type: string;
  refCount: number;
  buckets: number;
  maxVars: number;
  recommended: boolean;
  note: string;
}

export function detectSplitCandidates(questions: Question[]): SplitCandidate[] {
  // 1) value-match sourceQuestionId 빈도 집계 (질문 + 테이블 행)
  const refCount = new Map<string, number>();
  const bump = (dc: QuestionConditionGroup | undefined) => {
    if (!dc || !Array.isArray(dc.conditions)) return;
    for (const c of dc.conditions) {
      if (c.conditionType === 'value-match' && c.sourceQuestionId &&
        Array.isArray(c.requiredValues) && c.requiredValues.length > 0) {
        refCount.set(c.sourceQuestionId, (refCount.get(c.sourceQuestionId) ?? 0) + 1);
      }
    }
  };
  for (const q of questions) {
    bump(q.displayCondition);
    if (q.type === 'table' && Array.isArray(q.tableRowsData)) {
      for (const r of q.tableRowsData) bump(r.displayCondition);
    }
  }

  // 2) 후보 생성
  const qmap = new Map(questions.map((q) => [q.id, q]));
  const candidates: SplitCandidate[] = [];
  for (const [qid, refs] of refCount) {
    const basis = qmap.get(qid);
    if (!basis || !SPLIT_BASIS_TYPES.includes(basis.type)) continue;
    const plan = planSplit(questions, qid);
    if (plan.sheets.length < 2) continue; // 분할 효과 없음
    candidates.push({
      questionId: qid, code: basis.questionCode ?? '', label: basis.title, type: basis.type,
      refCount: refs, buckets: plan.sheets.length, maxVars: plan.maxVars,
      recommended: false, note: '',
    });
  }

  // 3) 정렬: maxVars 작을수록 → buckets 적을수록
  candidates.sort((a, b) => a.maxVars - b.maxVars || a.buckets - b.buckets);

  // 4) 권장 + note
  for (const c of candidates) {
    c.recommended = c.maxVars <= SPLIT_SOFT_LIMIT;
    if (c.maxVars <= SPLIT_SOFT_LIMIT) {
      c.note = c.buckets >= 10
        ? `시트가 ${c.buckets}개로 많지만 시트당 변수는 가장 적음`
        : '분기 경계가 깔끔해 시트 변수가 고르게 작아짐';
    } else if (c.maxVars <= SPLIT_EXCEL_LIMIT) {
      c.note = '일부 시트가 한계에 근접';
    } else {
      c.note = '일부 시트가 Excel 한계를 초과';
    }
  }
  // 모두 임계 초과면 1순위에만 권장
  if (!candidates.some((c) => c.recommended) && candidates[0]) candidates[0].recommended = true;

  return candidates;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/unit/analytics/split-export.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/analytics/split-export.ts tests/unit/analytics/split-export.test.ts
git commit -m "feat: 분할 내보내기 detectSplitCandidates 추가"
```

---

## Task 6: buildSplitWorkbook — 워크북 생성 + 일관성 테스트

`excel-transformer.ts`의 private 헬퍼(`styleHeaderRows`, `row2Label`, `buildCodebookValueLabel`, `clampRawWidth`, `estimateTextWidth`, `autoFitRawColumns`, `formatPlatformKo`, `mapStatusPill`, `formatExcelDateTime`, `formatTotalTime`)를 재사용한다. 기존 `generateRawDataWorkbook`는 **수정하지 않는다**(회귀 위험 회피).

**Files:**
- Modify: `src/lib/excel-transformer.ts`
- Test: `tests/unit/analytics/split-export.test.ts`

- [ ] **Step 1: 실패하는 일관성 테스트 작성** (append)

```ts
import { buildSplitWorkbook } from '@/lib/excel-transformer';
import type { RawExportResponseRow } from '@/lib/excel-transformer';

describe('buildSplitWorkbook ↔ planSplit 일관성', () => {
  const basis = q({
    id: 'Q2', type: 'radio', questionCode: 'Q2', title: '품목', order: 0,
    options: [
      { id: 'o1', value: 'opt1', label: '제재목' },
      { id: 'o2', value: 'opt2', label: '합판' },
    ],
  } as Partial<Question>);
  const commonQ = q({ id: 'A', type: 'text', title: '공통', order: 1 });
  const only1 = q({ id: 'B', type: 'text', title: 'opt1전용', order: 2, displayCondition: vm('Q2', ['opt1']) });
  const only2 = q({ id: 'C', type: 'text', title: 'opt2전용', order: 3, displayCondition: vm('Q2', ['opt2']) });
  const questions = [basis, commonQ, only1, only2];

  const rows: RawExportResponseRow[] = [
    { id: 'r1', questionResponses: { Q2: 'opt1', A: 'x', B: 'y' }, groupValue: null, resid: null,
      platform: null, browser: null, status: 'completed', startedAt: new Date('2026-06-04T01:00:00Z'),
      completedAt: new Date('2026-06-04T01:05:00Z'), totalSeconds: 300 },
  ];

  it('시트 구성과 각 시트 변수 수가 planSplit과 일치한다', () => {
    const plan = planSplit(questions, 'Q2');
    const wb = buildSplitWorkbook(questions, rows, 'Q2', 'sequence');
    const names = wb.worksheets.map((w) => w.name);
    expect(names[0]).toBe('응답 내역');
    expect(names[1]).toBe('공통');
    expect(names[names.length - 1]).toBe('코딩북');
    // 옵션 시트는 plan.sheets 순서대로 그 사이에 위치
    expect(names.slice(2, names.length - 1)).toEqual(plan.sheets.map((s) => s.name));

    // 공통 시트 변수 수(헤더 1행 셀 수 - 식별자 1) == plan.common
    const commonWs = wb.getWorksheet('공통')!;
    expect(commonWs.getRow(1).cellCount - 1).toBe(plan.common);

    // 각 옵션 시트 변수 수 == plan.sheets[].vars
    for (const s of plan.sheets) {
      const ws = wb.getWorksheet(s.name)!;
      expect(ws.getRow(1).cellCount - 1).toBe(s.vars);
    }
  });
});
```

> 참고: ExcelJS의 `row.cellCount`는 해당 행에 실제 추가된 셀 수다. 헤더 1행은 `[식별자, ...변수]`이므로 변수 수 = `cellCount - 1`.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/unit/analytics/split-export.test.ts`
Expected: FAIL — `buildSplitWorkbook is not a function` (export 안 됨)

- [ ] **Step 3: buildSplitWorkbook 구현** (`excel-transformer.ts`에 추가)

`generateRawDataWorkbook` 함수 정의 바로 아래에 추가한다. 같은 파일의 private 헬퍼를 직접 호출한다.

```ts
import {
  bucketQuestions,
  optionTokensForBasis,
} from '@/lib/analytics/split-export';

/** 분할 내보내기 워크북: 응답내역 + 공통 + 옵션별 + 코딩북 (열만 분할, 행 전체 공통) */
export function buildSplitWorkbook(
  questions: Question[],
  rows: RawExportResponseRow[],
  basisQuestionId: string,
  identifierMode: RawIdentifierMode,
): ExcelJS.Workbook {
  const idHeader = identifierMode === 'systemId' ? 'systemID' : '순번';
  const idValue = (row: RawExportResponseRow, idx: number): string | number =>
    identifierMode === 'systemId' ? (row.resid ?? '') : idx + 1;

  const sortedQuestions = [...questions].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const basis = sortedQuestions.find((q) => q.id === basisQuestionId);
  if (!basis) throw new Error(`기준 문항을 찾을 수 없습니다: ${basisQuestionId}`);

  const workbook = new ExcelJS.Workbook();
  const usedNames = new Set<string>();

  // Excel 시트명 제약(31자, [];:*?/\ 제거) + 중복 접미사
  const sheetName = (raw: string): string => {
    let name = (raw || '시트').replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 28) || '시트';
    let candidate = name;
    let n = 2;
    while (usedNames.has(candidate)) candidate = `${name}~${n++}`.slice(0, 31);
    usedNames.add(candidate);
    return candidate;
  };

  // 시트 1: 응답 내역 (전체 응답자)
  const ws1 = workbook.addWorksheet(sheetName('응답 내역'));
  ws1.addRow([idHeader, '조사 대상 그룹', '접속 단말', '브라우저', '상태', '시작일시', '종료일시', '소요시간']);
  rows.forEach((row, i) => {
    ws1.addRow([
      idValue(row, i),
      row.groupValue ?? '공개링크',
      formatPlatformKo(row.platform as Platform | null),
      row.browser ?? 'Other',
      mapStatusPill({ status: row.status }).label,
      formatExcelDateTime(row.startedAt),
      formatExcelDateTime(row.completedAt),
      formatTotalTime(row.totalSeconds, row.status),
    ]);
  });
  styleHeaderRows(ws1, [1], 8);
  autoFitRawColumns(ws1, 8);

  // 변수 시트(공통/옵션) — bucketQuestions 결과로 헤더 3행 + 전체 응답자 데이터
  const addVariableSheet = (name: string, bucketQs: Question[]) => {
    const columns = generateSPSSColumns(bucketQs);
    const ws = workbook.addWorksheet(sheetName(name));
    const colCount = columns.length + 1;
    ws.addRow([idHeader, ...columns.map((c) => c.questionText)]);
    ws.addRow(['', ...columns.map((c) => row2Label(c))]);
    ws.addRow(['', ...columns.map((c) => c.spssVarName)]);
    // 데이터는 전체 응답자 + 이 버킷 컬럼만 (열만 분할)
    const dataMatrix = buildDataRows(columns, sortedQuestions, rows as unknown as SurveySubmission[]);
    rows.forEach((row, i) => ws.addRow([idValue(row, i), ...dataMatrix[i]]));

    styleHeaderRows(ws, [1, 2, 3], colCount);
    ws.mergeCells(1, 1, 3, 1);
    let start = 0;
    while (start < columns.length) {
      let end = start;
      while (end + 1 < columns.length && columns[end + 1].questionId === columns[start].questionId) end++;
      if (end > start) ws.mergeCells(1, start + 2, 1, end + 2);
      start = end + 1;
    }
    ws.getColumn(1).width = clampRawWidth(estimateTextWidth(idHeader));
    columns.forEach((c, i) => {
      ws.getColumn(i + 2).width = clampRawWidth(estimateTextWidth(row2Label(c)));
    });
  };

  // 시트 2: 공통
  addVariableSheet('공통', bucketQuestions(sortedQuestions, basisQuestionId, 'common'));

  // 시트 3..N: 옵션별
  const labelMap = new Map((basis.options ?? []).map((o) => [o.value, o.label]));
  for (const token of optionTokensForBasis(sortedQuestions, basis)) {
    const bucketQs = bucketQuestions(sortedQuestions, basisQuestionId, token);
    if (generateSPSSColumns(bucketQs).length === 0) continue; // 빈 버킷 제외 (planSplit과 동일)
    addVariableSheet(labelMap.get(token) ?? token, bucketQs);
  }

  // 마지막 시트: 코딩북 (전체 변수)
  const allColumns = generateSPSSColumns(sortedQuestions);
  const questionMap = new Map(sortedQuestions.map((q) => [q.id, q]));
  const ws3 = workbook.addWorksheet(sheetName('코딩북'));
  ws3.addRow(['변수번호', 'SPSS 변수명', '질문 제목', '셀라벨', '값 라벨']);
  allColumns.forEach((c, i) => {
    ws3.addRow([i + 1, c.spssVarName, c.questionText, c.cellExportLabel ?? '', buildCodebookValueLabel(c, questionMap)]);
  });
  styleHeaderRows(ws3, [1], 5);
  autoFitRawColumns(ws3, 5);

  return workbook;
}
```

> 주의: `import` 추가 시 `excel-transformer.ts` 상단 기존 import 그룹에 `bucketQuestions`/`optionTokensForBasis`를 합친다. `Platform`, `SurveySubmission`, `RawIdentifierMode`, `generateSPSSColumns`, `buildDataRows`는 이 파일에 이미 존재/사용 중이다(없으면 기존 import 확인). 순환 import 주의: `split-export.ts`는 `excel-transformer.ts`를 import하지 않으므로(반대 방향만) 순환 없음.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/unit/analytics/split-export.test.ts`
Expected: PASS (전체 스위트)

- [ ] **Step 5: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 6: 커밋**

```bash
git add src/lib/excel-transformer.ts tests/unit/analytics/split-export.test.ts
git commit -m "feat: 분할 내보내기 buildSplitWorkbook 추가"
```

---

## Task 7: split-preview API 라우트

**Files:**
- Create: `src/app/api/surveys/[surveyId]/export/split-preview/route.ts`

기존 `export/route.ts`의 인증·hydrate·응답 모수 패턴을 그대로 따른다.

- [ ] **Step 1: 라우트 구현**

```ts
// src/app/api/surveys/[surveyId]/export/split-preview/route.ts
import { NextRequest, NextResponse } from 'next/server';

import { and, eq, isNull, ne } from 'drizzle-orm';

import { db } from '@/db';
import { surveyResponses, surveys } from '@/db/schema';
import { requireAuth } from '@/lib/auth';
import {
  detectSplitCandidates,
  planSplit,
  SPLIT_SOFT_LIMIT,
  SPLIT_EXCEL_LIMIT,
} from '@/lib/analytics/split-export';
import { generateSPSSColumns } from '@/lib/analytics/spss-excel-export';
import { Question } from '@/types/survey';
import { generateAllOptionCodes } from '@/utils/option-code-generator';
import { generateAllCellCodes } from '@/utils/table-cell-code-generator';

export const maxDuration = 30;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ surveyId: string }> },
) {
  try {
    await requireAuth();
    const { surveyId } = await params;
    const basis = request.nextUrl.searchParams.get('basis');

    const surveyData = await db.query.surveys.findFirst({
      where: eq(surveys.id, surveyId),
      with: { questions: true },
    });
    if (!surveyData) return NextResponse.json({ error: 'Survey not found' }, { status: 404 });

    // 셀/옵션 코드 hydrate (export/route.ts와 동일 패턴)
    for (const q of surveyData.questions) {
      if (q.type === 'table' && q.tableRowsData && q.tableColumns) {
        (q as any).tableRowsData = generateAllCellCodes(
          q.questionCode ?? undefined, q.title, q.tableColumns as any, q.tableRowsData as any,
        );
      }
      if ((q as any).options && ['radio', 'checkbox', 'select', 'multiselect'].includes(q.type)) {
        (q as any).options = generateAllOptionCodes(q.questionCode ?? undefined, (q as any).options);
      }
    }

    const questions = surveyData.questions as unknown as Question[];

    if (!basis) {
      const totalVars = generateSPSSColumns([...questions].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))).length;
      return NextResponse.json({
        totalVars,
        softLimit: SPLIT_SOFT_LIMIT,
        excelLimit: SPLIT_EXCEL_LIMIT,
        candidates: detectSplitCandidates(questions),
      });
    }

    // resp 집계: raw export와 동일 모수
    const responses = await db.query.surveyResponses.findMany({
      where: and(
        eq(surveyResponses.surveyId, surveyId),
        isNull(surveyResponses.deletedAt),
        ne(surveyResponses.status, 'in_progress'),
      ),
      columns: { questionResponses: true },
    });
    const respCounts: Record<string, number> = {};
    for (const r of responses) {
      const ans = (r.questionResponses as Record<string, unknown> | null)?.[basis];
      const vals = Array.isArray(ans) ? ans : ans != null ? [ans] : [];
      for (const v of new Set(vals.map((x) => String(x)))) {
        respCounts[v] = (respCounts[v] ?? 0) + 1;
      }
    }

    return NextResponse.json({ plan: planSplit(questions, basis, respCounts) });
  } catch (error) {
    console.error('split-preview error:', error);
    return NextResponse.json({ error: '미리보기 생성 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
```

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/surveys/\[surveyId\]/export/split-preview/route.ts
git commit -m "feat: 분할 내보내기 미리보기 API 추가"
```

---

## Task 8: export route에 raw-split 분기 추가

**Files:**
- Modify: `src/app/api/surveys/[surveyId]/export/route.ts`

- [ ] **Step 1: ALLOWED_EXPORT_TYPES 확장**

`route.ts`의 다음 줄을 찾는다:

```ts
const ALLOWED_EXPORT_TYPES = ['summary', 'map', 'sav', 'raw'] as const;
```

다음으로 교체:

```ts
const ALLOWED_EXPORT_TYPES = ['summary', 'map', 'sav', 'raw', 'raw-split'] as const;
```

- [ ] **Step 2: import 추가**

`route.ts` 상단 `generateRawDataWorkbook` import 블록에 `buildSplitWorkbook`을 추가한다:

```ts
import {
  buildSplitWorkbook,
  generateRawDataWorkbook,
  generateSummaryWorkbook,
  generateVariableMapWorkbook,
  type RawExportResponseRow,
} from '@/lib/excel-transformer';
```

- [ ] **Step 3: raw-split 분기 구현**

`route.ts`에서 `if (type === 'raw') { ... }` 블록의 **닫는 중괄호 바로 다음**에 아래 블록을 추가한다. raw 분기의 응답 조회·resid 매핑·rows 구성을 재사용하기 위해, raw 분기와 동일한 모수/매핑 로직을 그대로 복제하되 마지막 워크북 생성만 분기한다.

```ts
    if (type === 'raw-split') {
      const basis = request.nextUrl.searchParams.get('basis');
      if (!basis) {
        return NextResponse.json({ error: '분할 기준 문항이 필요합니다.' }, { status: 400 });
      }

      const rawResponses = await db.query.surveyResponses.findMany({
        where: and(
          eq(surveyResponses.surveyId, surveyId),
          isNull(surveyResponses.deletedAt),
          ne(surveyResponses.status, 'in_progress'),
        ),
        orderBy: (r, { asc }) => [asc(r.startedAt)],
      });

      if (rawResponses.length > MAX_EXPORT_RESPONSES) {
        return NextResponse.json(
          { error: `응답이 ${MAX_EXPORT_RESPONSES.toLocaleString()}건을 초과하여 내보내기할 수 없습니다.` },
          { status: 413 },
        );
      }

      const contactIds = rawResponses
        .map((r) => r.contactTargetId)
        .filter((v): v is string => !!v);
      const contactMap = new Map<string, { resid: number; groupValue: string | null }>();
      if (contactIds.length > 0) {
        const targets = await db
          .select({ id: contactTargets.id, resid: contactTargets.resid, groupValue: contactTargets.groupValue })
          .from(contactTargets)
          .where(inArray(contactTargets.id, contactIds));
        for (const t of targets) contactMap.set(t.id, { resid: t.resid, groupValue: t.groupValue });
      }

      const identifierMode = surveyData.requireInviteToken ? 'systemId' : 'sequence';
      const rows: RawExportResponseRow[] = rawResponses.map((r) => {
        const c = r.contactTargetId ? contactMap.get(r.contactTargetId) : undefined;
        return {
          id: r.id,
          questionResponses: (r.questionResponses ?? {}) as Record<string, unknown>,
          groupValue: c?.groupValue ?? null,
          resid: c?.resid ?? null,
          platform: r.platform,
          browser: r.browser,
          status: r.status,
          startedAt: r.startedAt,
          completedAt: r.completedAt,
          totalSeconds: r.totalSeconds,
        };
      });

      const workbook = buildSplitWorkbook(
        surveyData.questions as unknown as Question[],
        rows,
        basis,
        identifierMode,
      );
      const buffer = await workbook.xlsx.writeBuffer();
      const basisCode = (surveyData.questions as unknown as Question[]).find((q) => q.id === basis)?.questionCode ?? 'split';
      const filename = `${safeTitle}_분할_${basisCode}_${dateSlice}.xlsx`;
      return new NextResponse(buffer as ArrayBuffer, {
        headers: {
          'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
          'Content-Type': XLSX_MIME,
        },
      });
    }
```

> 참고: `safeTitle`, `dateSlice`, `MAX_EXPORT_RESPONSES`, `XLSX_MIME`, `contactTargets`, `inArray` 는 이미 `route.ts`에 정의/임포트되어 있다(raw 분기에서 사용 중). `Content-Disposition`에 한글 파일명이 들어가므로 `encodeURIComponent`로 감싼다(raw 분기와 동일하게 클라이언트가 디코드).

- [ ] **Step 4: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/surveys/\[surveyId\]/export/route.ts
git commit -m "feat: export route에 raw-split 분기 추가"
```

---

## Task 9: 모달 — split-preview 타입·페치 훅

**Files:**
- Modify: `src/components/analytics/export-data-modal.tsx`

UI 작업이라 단위 테스트 대신 typecheck/build/수동 검증으로 검증한다.

- [ ] **Step 1: 응답 타입 + 페치 함수 추가**

`export-data-modal.tsx` 상단(컴포넌트 밖)에 추가:

```ts
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, ChevronRight, Layers, Sparkles, SplitSquareHorizontal, Check } from 'lucide-react';

interface SplitCandidateDTO {
  questionId: string; code: string; label: string; type: string;
  refCount: number; buckets: number; maxVars: number; recommended: boolean; note: string;
}
interface SplitSheetDTO { token: string; name: string; vars: number; resp: number }
interface SplitPlanDTO {
  basisQuestionId: string; basisCode: string; basisLabel: string;
  common: number; sheets: SplitSheetDTO[]; maxVars: number;
  exceedsSoftLimit: boolean; exceedsExcelLimit: boolean;
}
interface PreviewSummary {
  totalVars: number; softLimit: number; excelLimit: number; candidates: SplitCandidateDTO[];
}

const fmtNum = (n: number) => n.toLocaleString('ko-KR');

async function fetchSplitSummary(surveyId: string): Promise<PreviewSummary> {
  const res = await fetch(`/api/surveys/${surveyId}/export/split-preview`);
  if (!res.ok) throw new Error('미리보기 정보를 불러오지 못했습니다.');
  return res.json();
}
async function fetchSplitPlan(surveyId: string, basis: string): Promise<{ plan: SplitPlanDTO }> {
  const res = await fetch(`/api/surveys/${surveyId}/export/split-preview?basis=${encodeURIComponent(basis)}`);
  if (!res.ok) throw new Error('시트 미리보기를 불러오지 못했습니다.');
  return res.json();
}
```

> 참고: 프로젝트는 TanStack Query를 사용한다(CLAUDE.md). 최상위에 QueryClientProvider가 이미 있다고 가정(analytics 페이지). 없으면 `fetch`+`useState`/`useEffect`로 대체 가능하나, 우선 useQuery로 작성.

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음 (아직 미사용 import 경고는 lint가 깨져 있어 무시 — 다음 태스크에서 사용)

- [ ] **Step 3: 커밋**

```bash
git add src/components/analytics/export-data-modal.tsx
git commit -m "feat: 분할 미리보기 타입과 페치 함수 추가"
```

---

## Task 10: 모달 — 4-step 상태머신 + 단계 UI

디자인(`응답 데이터 내보내기.html`)의 4-step을 shadcn/Tailwind로 포팅한다. 식별자 Segmented는 실제 raw export가 서버에서 `requireInviteToken`으로 결정하므로 **기능 컨트롤로 노출하지 않는다**(스펙 §6: 현행 유지). 형식 선택도 현재 raw만 활성이므로 분할은 raw 기반으로만 동작한다.

**Files:**
- Modify: `src/components/analytics/export-data-modal.tsx`

- [ ] **Step 1: ExportDataModal 본문을 상태머신으로 교체**

`ExportDataModal` 컴포넌트의 `return (...)` 내부 `<DialogContent>` 안을 단계별 렌더로 교체한다. 기존 `handleExport`('raw') 카드 흐름은 `step==='options'`의 기본 형식 카드로 유지하고, 분할 흐름을 추가한다.

컴포넌트 상태/로직:

```tsx
type SplitStep = 'options' | 'candidates' | 'preview' | 'downloading' | 'done';

export function ExportDataModal({ surveyId, surveyTitle, onExportCleaningExcel }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [exportingType, setExportingType] = useState<string | null>(null);
  const [includeMacroSync, setIncludeMacroSync] = useState(true);
  const [step, setStep] = useState<SplitStep>('options');
  const [basis, setBasis] = useState<string | null>(null);

  const summary = useQuery({
    queryKey: ['split-summary', surveyId],
    queryFn: () => fetchSplitSummary(surveyId),
    enabled: isOpen,
  });
  const overLimit = !!summary.data && summary.data.totalVars > summary.data.softLimit;

  const planQuery = useQuery({
    queryKey: ['split-plan', surveyId, basis],
    queryFn: () => fetchSplitPlan(surveyId, basis!),
    enabled: isOpen && !!basis && (step === 'preview' || step === 'downloading' || step === 'done'),
  });

  // 모달 닫힘 시 단계 초기화
  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) { setStep('options'); setBasis(null); }
  };

  const handleExport = async (type: string) => { /* 기존 코드 그대로 유지 */ };

  const handleSplitDownload = async () => {
    if (!basis) return;
    setStep('downloading');
    try {
      const res = await fetch(`/api/surveys/${surveyId}/export?type=raw-split&basis=${encodeURIComponent(basis)}`);
      if (!res.ok) {
        const e = await res.json().catch(() => null);
        throw new Error(e?.error || '분할 내보내기에 실패했습니다.');
      }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition');
      let filename = buildSafeFilename(surveyTitle, 'Split', 'xlsx');
      const m = cd?.match(/filename="?([^"]+)"?/);
      if (m) filename = decodeURIComponent(m[1]);
      downloadBlob(blob, filename);
      setStep('done');
    } catch (err) {
      alert(err instanceof Error ? err.message : '분할 내보내기 중 오류가 발생했습니다.');
      setStep('preview');
    }
  };

  // ... return: Dialog with step-based body (Step 2 참조)
}
```

- [ ] **Step 2: 단계별 본문 렌더 작성**

`<DialogContent className="sm:max-w-[600px]">` 내부를 다음으로 구성한다(기존 헤더/푸터는 단계에 맞게 조정).

```tsx
<DialogContent className="sm:max-w-[600px]">
  <DialogHeader>
    <DialogTitle>{step === 'options' ? '데이터 내보내기' : '분할 내보내기'}</DialogTitle>
    <DialogDescription>{surveyTitle}</DialogDescription>
  </DialogHeader>

  {step === 'options' && (
    <div className="grid grid-cols-1 gap-4 py-4">
      <ExportCard
        title="Raw Data 엑셀"
        description="응답 내역 + 변수별 코드값 + 코딩북 (3시트)"
        icon={<FileSpreadsheet className="h-5 w-5 text-blue-600" />}
        isLoading={exportingType === 'raw'}
        disabled={!!exportingType}
        onClick={() => handleExport('raw')}
      />

      {overLimit && summary.data && (
        <div className="rounded-xl border border-amber-200 bg-gradient-to-b from-amber-50 to-white p-4">
          <div className="flex gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-600">
              <AlertTriangle className="h-[18px] w-[18px]" />
            </div>
            <div className="flex-1">
              <div className="mb-1 text-sm font-bold text-amber-800">
                변수가 {fmtNum(summary.data.totalVars)}개 — 한 시트에 담기 부담스러운 양입니다
              </div>
              <p className="text-[13px] leading-relaxed text-amber-700">
                Excel 한 시트 열 한계는 {fmtNum(summary.data.excelLimit)}개입니다. 기준 문항으로 시트를 나누면 각 시트의 변수 수가 크게 줄어듭니다.
              </p>
            </div>
          </div>
          <button
            onClick={() => setStep('candidates')}
            className="mt-3 flex w-full items-center justify-between gap-2 rounded-lg border border-blue-600 bg-blue-600 px-4 py-3 text-white"
          >
            <span className="flex items-center gap-2.5">
              <SplitSquareHorizontal className="h-[18px] w-[18px]" />
              <span className="text-sm font-bold">분할 내보내기 설정</span>
            </span>
            <ChevronRight className="h-[18px] w-[18px]" />
          </button>
        </div>
      )}
    </div>
  )}

  {step === 'candidates' && (
    <div className="py-4">
      <div className="mb-1 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-blue-600" />
        <span className="text-[13px] font-bold text-slate-800">추천 분할 기준</span>
      </div>
      <p className="mb-3.5 text-xs leading-relaxed text-slate-500">
        응답자 분기를 가르는 문항을 분석했습니다. 기준 문항의 값마다 시트가 하나씩 생성됩니다.
      </p>
      {summary.isLoading && <p className="text-sm text-slate-400">분석 중…</p>}
      {summary.data && summary.data.candidates.length === 0 && (
        <p className="rounded-lg border bg-slate-50 p-4 text-sm text-slate-500">
          분할 기준이 될 value-match 조건 문항이 없어 분할할 수 없습니다.
        </p>
      )}
      <div className="flex flex-col gap-2.5">
        {summary.data?.candidates.map((c) => {
          const on = basis === c.questionId;
          const safe = c.maxVars <= summary.data!.softLimit;
          return (
            <button
              key={c.questionId}
              onClick={() => setBasis(c.questionId)}
              className={`flex items-center gap-3 rounded-xl border-[1.5px] p-3.5 text-left transition-colors ${on ? 'border-blue-600 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
            >
              <span className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-2 ${on ? 'border-blue-600 bg-blue-600' : 'border-slate-300 bg-white'}`}>
                {on && <Check className="h-2.5 w-2.5 text-white" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="mb-0.5 flex items-center gap-1.5">
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-600">{c.code || '—'}</code>
                  <span className="text-sm font-bold text-slate-900">{c.label}</span>
                  {c.recommended && <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">권장</span>}
                </span>
                <span className="block text-xs leading-snug text-slate-500">{c.note}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="mb-1 flex items-center justify-end gap-1">
                  <Layers className="h-3 w-3 text-slate-400" />
                  <span className="text-[13px] font-bold text-slate-700">{c.buckets}개 시트</span>
                </span>
                <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ${safe ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                  최대 {fmtNum(c.maxVars)}변수 {safe ? '✓' : '⚠'}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  )}

  {step === 'preview' && (
    <div className="py-4">
      {planQuery.isLoading && <p className="text-sm text-slate-400">시트 구성 계산 중…</p>}
      {planQuery.data && (() => {
        const plan = planQuery.data.plan;
        const softLimit = summary.data?.softLimit ?? 10000;
        const excelLimit = summary.data?.excelLimit ?? 16384;
        return (
          <>
            <div className="mb-3.5 flex items-center gap-2 rounded-lg bg-blue-50 px-3.5 py-2.5">
              <SplitSquareHorizontal className="h-4 w-4 text-blue-600" />
              <span className="text-[13px] text-blue-800">
                <b>{plan.basisCode || '—'} {plan.basisLabel}</b> 기준 · {plan.sheets.length}개 시트로 분할
              </span>
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <div className="grid grid-cols-[1fr_92px_110px_56px] items-center border-b border-slate-200 bg-slate-50">
                <div className="px-3.5 py-2 text-[11px] font-bold text-slate-500">시트명</div>
                <div className="px-3.5 py-2 text-right text-[11px] font-bold text-slate-500">응답 수</div>
                <div className="px-3.5 py-2 text-right text-[11px] font-bold text-slate-500">변수(열)</div>
                <div className="px-3.5 py-2 text-center text-[11px] font-bold text-slate-500">상태</div>
              </div>
              <div className="max-h-[196px] overflow-y-auto">
                {plan.sheets.map((s) => {
                  const safe = s.vars <= softLimit;
                  const pct = Math.min(100, Math.round((s.vars / excelLimit) * 100));
                  return (
                    <div key={s.token} className="grid grid-cols-[1fr_92px_110px_56px] items-center border-b border-slate-100 last:border-0">
                      <div className="truncate px-3.5 py-2.5 text-[13px] font-semibold text-slate-900">{s.name}</div>
                      <div className="px-3.5 py-2.5 text-right text-[13px] tabular-nums text-slate-500">{fmtNum(s.resp)}</div>
                      <div className="px-3.5 py-2.5 text-right text-[13px] tabular-nums">
                        <div className={`font-bold ${safe ? 'text-slate-900' : 'text-red-700'}`}>{fmtNum(s.vars)}</div>
                        <div className="mt-1 h-[3px] overflow-hidden rounded bg-slate-100">
                          <div className={`h-full ${safe ? 'bg-green-500' : 'bg-red-500'}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                      <div className="px-3.5 py-2.5 text-center">
                        {safe ? <Check className="mx-auto h-4 w-4 text-green-500" /> : <AlertTriangle className="mx-auto h-[15px] w-[15px] text-red-500" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="mt-3 flex gap-3.5 text-xs text-slate-500">
              <span>공통 변수 <b className="text-slate-700">{fmtNum(plan.common)}</b>개는 별도 공통 시트로</span>
              <span className="ml-auto">최대 <b className={plan.maxVars <= softLimit ? 'text-green-700' : 'text-red-700'}>{fmtNum(plan.maxVars)}</b>변수</span>
            </div>
          </>
        );
      })()}
    </div>
  )}

  {(step === 'downloading' || step === 'done') && (
    <div className="px-6 py-10 text-center">
      <div className={`mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full ${step === 'done' ? 'bg-green-50 text-green-500' : 'bg-blue-50 text-blue-600'}`}>
        {step === 'done' ? <Check className="h-8 w-8" /> : <Loader2 className="h-7 w-7 animate-spin" />}
      </div>
      <div className="mb-1.5 text-[17px] font-bold">{step === 'done' ? '다운로드가 시작되었습니다' : '워크북 생성 중…'}</div>
      <p className="mx-auto max-w-[360px] text-[13px] leading-relaxed text-slate-500">
        {step === 'done' ? '브라우저 다운로드를 확인하세요.' : '기준 문항으로 시트를 나눠 생성하고 있습니다.'}
      </p>
    </div>
  )}

  <DialogFooter>
    {step === 'options' && (
      <Button variant="outline" onClick={() => setIsOpen(false)}>닫기</Button>
    )}
    {step === 'candidates' && (
      <>
        <Button variant="ghost" onClick={() => setStep('options')}><ArrowLeft className="mr-1 h-4 w-4" />뒤로</Button>
        <Button onClick={() => setStep('preview')} disabled={!basis}>시트 미리보기<ChevronRight className="ml-1 h-4 w-4" /></Button>
      </>
    )}
    {step === 'preview' && (
      <>
        <Button variant="ghost" onClick={() => setStep('candidates')}><ArrowLeft className="mr-1 h-4 w-4" />기준 변경</Button>
        <Button onClick={handleSplitDownload} disabled={!planQuery.data}><FileDown className="mr-1 h-4 w-4" />분할 다운로드</Button>
      </>
    )}
    {step === 'done' && (
      <Button onClick={() => { setStep('options'); setBasis(null); }}>완료</Button>
    )}
  </DialogFooter>
</DialogContent>
```

`<Dialog open={isOpen} onOpenChange={handleOpenChange}>`로 변경하고, 미사용이 된 기존 `{false && (...)}` 보존 블록은 그대로 둔다. `FileDown` import가 없으면 lucide import에 추가한다.

- [ ] **Step 3: 타입 체크 + 빌드**

Run: `npx tsc --noEmit && pnpm build`
Expected: 타입 에러 없음, 빌드 성공

- [ ] **Step 4: 수동 검증 (개발 서버)**

```bash
pnpm dev
```
확인 항목:
1. 변수 ≤ 10,000 설문: analytics → "엑셀 다운로드" → 경고 카드 **미노출**, Raw Data 카드만.
2. 변수 > 10,000 설문(예: 목재이용실태조사): 경고 카드 + "분할 내보내기 설정" 노출 → 후보 목록 → 후보 선택 → 시트 미리보기(시트별 변수/응답수) → 분할 다운로드 → .xlsx 열어 시트 구성(응답내역/공통/옵션별/코딩북) 확인.
3. 미리보기의 시트별 변수 수가 실제 다운로드 파일의 각 시트 열 수와 일치.

- [ ] **Step 5: 커밋**

```bash
git add src/components/analytics/export-data-modal.tsx
git commit -m "feat: 분할 내보내기 모달 4단계 흐름 추가"
```

---

## Task 11: 최종 검증

**Files:** 없음 (검증만)

- [ ] **Step 1: 전체 단위 테스트**

Run: `npx vitest run tests/unit/analytics/split-export.test.ts`
Expected: 전체 PASS

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: 빌드**

Run: `pnpm build`
Expected: 성공

- [ ] **Step 4: superpowers:finishing-a-development-branch 로 마무리**

`feat/split-export` 브랜치를 정리한다(merge/PR 결정은 사용자).

---

## Self-Review 결과

**스펙 커버리지:**
- §2 결정(추천+미리보기/초과시 노출/임계 10,000/시트 구성/열만 분할/다중토큰 중복/value-match) → Task 1~5(로직), 6(워크북), 10(UI 노출 조건) 커버.
- §4 모듈 함수 전부 → Task 1~5.
- §4.6 워크북(응답내역+공통+옵션별+코딩북, 열만 분할, 헬퍼 재사용) → Task 6.
- §5 API(split-preview / raw-split, 인증·hydrate·resp 집계) → Task 7, 8.
- §6 모달 4-step → Task 9, 10. (식별자 Segmented는 §6 메모대로 비노출.)
- §7 엣지(후보 없음/시트명 sanitize/other 토큰/빈 버킷) → Task 5·6·10에 반영.
- §8 테스트(일관성 포함) → Task 1~6.

**Placeholder 스캔:** 없음(모든 코드 블록 실제 내용).

**타입 일관성:** `valueMatchSet`/`bucketQuestions`/`optionTokensForBasis`/`planSplit`/`detectSplitCandidates`/`buildSplitWorkbook` 시그니처가 정의 태스크와 사용 태스크(7,8,10)에서 일치. `SPLIT_SOFT_LIMIT`/`SPLIT_EXCEL_LIMIT` 상수명 일관. DTO 필드명(SplitPlanDTO/SplitSheetDTO)이 서버 타입과 1:1.

**알려진 가정:**
- analytics 페이지 트리에 QueryClientProvider 존재(없으면 Task 9 참고대로 fetch+useState 대체).
- `requireInviteToken` 컬럼이 `surveys`에 존재(raw 분기가 이미 사용 중이므로 보장).
