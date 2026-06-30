# 수동 페이지 구분점 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 설문 응답 페이지의 페이지 분할을 자동(그룹 경계 + 테이블 단독)에서 운영자가 편집기에서 직접 찍는 수동 구분점(`pageBreakBefore`)으로 전환한다.

**Architecture:** 페이지 구분점을 질문 단위 boolean 필드로 영속한다. `group-ordering.ts`의 분할 엔진을 "그룹/테이블 자동 분할"에서 "전역 선형 질문열을 `pageBreakBefore`에서만 자르기"로 재작성하고, `RenderStep`을 단일 `page` 종류로 통합한다. 응답 렌더는 기존 `GroupStepItem`/`RootGroupNameBadge`를 재사용하는 단일 `PageStepView`로 합친다. 그룹은 페이지 경계가 아니라 헤더 출처가 된다.

**Tech Stack:** Next.js 16 / React 19 / TypeScript strict / Drizzle ORM(postgres-js) / Zustand / Vitest + Testing Library. 설계 문서: `docs/superpowers/specs/2026-06-30-manual-page-breaks-design.md`.

## Global Constraints

- 질문 영속 컬럼은 `PERSISTED_QUESTION_FIELDS`(SSOT, `src/db/schema/question-persisted-fields.ts`)에 반드시 등재한다. 등재하면 4개 쓰기 채널(create/upsert values/upsert onConflict set/duplicate)과 zod 커버리지 프로브가 컴파일 에러로 누락을 호명한다 — explicit field set, spread 금지.
- 스냅샷(`src/lib/versioning/snapshot-builder.ts`)은 SSOT 컴파일 가드가 닿지 않는 사각지대다. 새 질문 필드는 `SnapshotQuestion` 타입 + 매핑에 **수동으로** 추가해야 발행 설문에 반영된다.
- 문서/주석은 한국어, 식별자는 영어. 코드(주석/UI 텍스트/라벨)에 이모지 금지. git commit 메시지는 한국어 `feat: OOO 추가` 형식, 괄호 `()` 금지.
- 테스트 실행: `pnpm test`. Vitest include = `tests/**/*.test.{ts,tsx}` + `src/**/*.test.{ts,tsx}`. 실DB 왕복은 이 계획에서 사용하지 않는다(순수 함수/컴포넌트 단위 테스트만).
- 마이그레이션은 `pnpm db:generate`로 생성하고 `_journal.json` 경유로만 적용한다. 컬럼 추가는 가산(default false)이라 비파괴.
- **중간 tsc 상태**: Task 2(엔진)가 `RenderStep` 모양을 바꾸면 Task 3~4 완료 전까지 일부 소비처에서 타입 에러가 난다. 각 Task의 게이트는 해당 Task의 vitest(파일 단위 esbuild 컴파일)다. 프로젝트 전체 `tsc`(=`pnpm build`)는 **Task 4 완료 후** 그린이어야 한다. Task 5(빌더 UI)는 독립적이다.

---

## File Structure

| 파일 | 책임 | Task |
|------|------|------|
| `src/db/schema/surveys.ts` | `questions.page_break_before` 컬럼 | 1 |
| `src/types/survey.ts` | `Question.pageBreakBefore` 타입 | 1 |
| `src/features/survey-builder/domain/question.ts` | Create/Update zod 입력 | 1 |
| `src/db/schema/question-persisted-fields.ts` | SSOT 등재 | 1 |
| `src/features/survey-builder/server/services/questions.service.ts` | create 쓰기 | 1 |
| `src/features/survey-builder/server/services/survey-save.service.ts` | upsert values + onConflict set | 1 |
| `src/features/survey-builder/server/services/surveys.service.ts` | duplicate 쓰기 | 1 |
| `src/lib/versioning/snapshot-builder.ts` | 스냅샷 타입 + 매핑 | 1 |
| `src/lib/group-ordering.ts` | 분할 엔진(`RenderStep`/`StepItem`/`buildRenderSteps`/`stepIdOf`/`findStepIndexOfQuestion`) | 2 |
| `src/components/survey-response/step-views/page-step-view.tsx` | 통합 페이지 렌더(신규) | 3 |
| `src/components/survey-response/survey-response-flow.tsx` | 렌더 분기 통합 + 컨테이너 너비 | 3 |
| `src/components/survey-response/hooks/use-response-lifecycle.ts` | 스텝 인덱스 조회 통일 | 3 |
| `src/components/survey-response/step-views/group-step-view.tsx`, `table-step-view.tsx` | 삭제(통합) | 3 |
| `src/lib/operations/profiles.ts` | `buildStepLocationMap` 대표 질문 추출 | 4 |
| `src/lib/operations/page-dwell.ts` | `buildCanonicalSteps`를 `buildRenderSteps`로 통일 | 4 |
| `src/components/survey-builder/page-break-divider.tsx` | 구분점 인서터(신규) | 5 |
| `src/components/survey-builder/sortable-question-list.tsx` | 인서터 배치 | 5 |

---

## Task 1: `pageBreakBefore` 필드 end-to-end

**Files:**
- Modify: `src/db/schema/surveys.ts:168` (hideTitle 컬럼 뒤)
- Modify: `src/types/survey.ts:506` (hideTitle 뒤)
- Modify: `src/features/survey-builder/domain/question.ts:53` 및 `:95`
- Modify: `src/db/schema/question-persisted-fields.ts:42`
- Modify: `src/features/survey-builder/server/services/questions.service.ts:64`
- Modify: `src/features/survey-builder/server/services/survey-save.service.ts` (values + onConflict set)
- Modify: `src/features/survey-builder/server/services/surveys.service.ts` (duplicate)
- Modify: `src/lib/versioning/snapshot-builder.ts:64` 및 `:128`
- Test: `tests/unit/survey/snapshot-page-break.test.ts` (신규)

**Interfaces:**
- Produces: `Question.pageBreakBefore?: boolean`. drizzle `NewQuestion['pageBreakBefore']: boolean | null | undefined`. `CreateQuestionInput.pageBreakBefore?: boolean`, `UpdateQuestionData.pageBreakBefore?: boolean`. `SurveySnapshot.questions[].pageBreakBefore?: boolean`.

- [ ] **Step 1: 실패하는 스냅샷 라운드트립 테스트 작성**

Create `tests/unit/survey/snapshot-page-break.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildSurveySnapshot } from '@/lib/versioning/snapshot-builder';
import type { Survey } from '@/types/survey';

function minimalSurvey(pageBreakBefore: boolean): Survey {
  return {
    id: 's1',
    title: '설문',
    questions: [
      { id: 'q1', type: 'radio', title: 'Q1', required: false, order: 0 },
      { id: 'q2', type: 'radio', title: 'Q2', required: false, order: 1, pageBreakBefore },
    ],
    groups: [],
    settings: {
      isPublic: true,
      allowMultipleResponses: false,
      showProgressBar: true,
      shuffleQuestions: false,
      requireLogin: false,
      thankYouMessage: '감사합니다',
    },
  } as unknown as Survey;
}

describe('스냅샷이 pageBreakBefore를 보존한다', () => {
  it('pageBreakBefore=true 질문이 스냅샷에 실린다', () => {
    const snap = buildSurveySnapshot(minimalSurvey(true));
    const q2 = snap.questions.find((q) => q.id === 'q2');
    expect(q2?.pageBreakBefore).toBe(true);
  });

  it('pageBreakBefore 미설정은 스냅샷에서 undefined', () => {
    const snap = buildSurveySnapshot(minimalSurvey(false));
    const q1 = snap.questions.find((q) => q.id === 'q1');
    expect(q1?.pageBreakBefore).toBeUndefined();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test snapshot-page-break`
Expected: FAIL — `q2.pageBreakBefore`가 `undefined`(스냅샷 매핑에 아직 없음). 두 번째 테스트는 통과할 수도 있음(필드 부재). 첫 테스트 FAIL이 핵심.

- [ ] **Step 3: drizzle 컬럼 추가**

`src/db/schema/surveys.ts`의 `hideTitle` 정의(`hideTitle: boolean('hide_title').default(false),`, line 168) **바로 뒤**에 추가:

```ts
  // 응답 페이지 수동 페이지 구분점 — true면 이 질문 앞에서 새 페이지 시작
  pageBreakBefore: boolean('page_break_before').default(false),
```

- [ ] **Step 4: `Question` 타입에 필드 추가**

`src/types/survey.ts`의 `hideTitle?: boolean;`(line 506) **바로 뒤**에 추가:

```ts
  // 응답 페이지 수동 페이지 구분점 — 이 질문 앞에서 새 페이지를 시작한다
  pageBreakBefore?: boolean;
```

- [ ] **Step 5: SSOT 등재**

`src/db/schema/question-persisted-fields.ts`의 배열에서 `'hideTitle',`(line 42) **뒤**에 추가:

```ts
  'pageBreakBefore',
```

- [ ] **Step 6: zod 입력 스키마에 추가**

`src/features/survey-builder/domain/question.ts`:
- `CreateQuestionInput`의 `hideTitle: z.boolean().optional(),`(line 53) 뒤에 `pageBreakBefore: z.boolean().optional(),` 추가.
- `UpdateQuestionData`의 `hideTitle: z.boolean().optional(),`(line 95) 뒤에 `pageBreakBefore: z.boolean().optional(),` 추가.

- [ ] **Step 7: 컴파일 에러로 호명된 쓰기 채널 채우기**

Run: `pnpm exec tsc --noEmit` — 다음 4곳이 `CompleteQuestionWrite`/zod 프로브 위반으로 호명된다. 각각 추가:

`questions.service.ts` createQuestion 객체 끝(`spssMeasure: data.spssMeasure,` 뒤):
```ts
    pageBreakBefore: data.pageBreakBefore,
```

`survey-save.service.ts` `questionValues` map 객체 끝(`emptyDefault: question.emptyDefault ?? null,` 뒤, `updatedAt` 앞):
```ts
          pageBreakBefore: question.pageBreakBefore,
```

`survey-save.service.ts` `onConflictDoUpdate.set` 끝(`emptyDefault: sql\`excluded.empty_default\`,` 뒤, `updatedAt` 앞):
```ts
              pageBreakBefore: sql`excluded.page_break_before`,
```

`surveys.service.ts` duplicate `newQuestionsData` map 객체 끝(`displayCondition: ... as NewQuestion['displayCondition'],` 뒤):
```ts
        pageBreakBefore: question.pageBreakBefore,
```

- [ ] **Step 8: 스냅샷 빌더에 추가 (사각지대 가드)**

`src/lib/versioning/snapshot-builder.ts`:
- `SnapshotQuestion` 인터페이스의 `hideTitle?: boolean | undefined;`(line 64) 뒤에 추가:
```ts
  pageBreakBefore?: boolean | undefined;
```
- `buildSurveySnapshot`의 questions map 객체 `hideTitle: q.hideTitle,`(line 128) 뒤에 추가:
```ts
      pageBreakBefore: q.pageBreakBefore,
```

- [ ] **Step 9: 마이그레이션 생성**

Run: `pnpm db:generate`
Expected: `page_break_before` 컬럼을 ADD 하는 새 마이그레이션 파일 생성. 내용에 `ADD COLUMN "page_break_before" boolean DEFAULT false` 포함 확인.

- [ ] **Step 10: 테스트 + 타입 통과 확인**

Run: `pnpm test snapshot-page-break && pnpm exec tsc --noEmit`
Expected: 테스트 PASS, tsc 에러 0.

- [ ] **Step 11: 커밋**

```bash
git add -A
git commit -m "feat: 질문 pageBreakBefore 필드와 스냅샷 보존 추가"
```

---

## Task 2: 분할 엔진을 수동 구분점으로 재작성

**Files:**
- Modify: `src/lib/group-ordering.ts` (`StepItem`/`RenderStep`/`stepIdOf`/`findStepIndexOfQuestion`/`buildRenderSteps`, `splitByTable` 삭제)
- Test: `tests/unit/lib/group-ordering-page-breaks.test.ts` (신규)

**Interfaces:**
- Produces:
  - `type StepItem = { question: Question; rootGroupId: string | null; rootGroupName: string | null; rootGroupNameDesign?: GroupNameDesign | undefined; subgroupName: string | null }`
  - `type RenderStep = { kind: 'page'; items: StepItem[] }`
  - `buildRenderSteps(questions: Question[], groups: QuestionGroup[]): RenderStep[]` — 구분점 없으면 길이 1.
  - `stepIdOf(step: RenderStep): string` → `page:<첫 질문 id>`.
  - `findStepIndexOfQuestion(steps: RenderStep[], questionId: string): number`.
- Consumes: 기존 `flattenRootScope`/`getInterleavedChildren`(불변).

- [ ] **Step 1: 실패하는 엔진 테스트 작성**

Create `tests/unit/lib/group-ordering-page-breaks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildRenderSteps, stepIdOf, findStepIndexOfQuestion } from '@/lib/group-ordering';
import type { Question, QuestionGroup } from '@/types/survey';

const G = (id: string, order: number, extra: Partial<QuestionGroup> = {}): QuestionGroup =>
  ({ id, surveyId: 's', name: id.toUpperCase(), order, ...extra }) as QuestionGroup;
const Q = (id: string, order: number, extra: Partial<Question> = {}): Question =>
  ({ id, type: 'radio', title: id.toUpperCase(), required: false, order, ...extra }) as Question;

describe('buildRenderSteps — 수동 구분점', () => {
  it('구분점이 없으면 모든 질문이 한 페이지 (테이블 포함)', () => {
    const questions = [Q('q1', 0), Q('q2', 1, { type: 'table' }), Q('q3', 2)];
    const steps = buildRenderSteps(questions, []);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.items.map((i) => i.question.id)).toEqual(['q1', 'q2', 'q3']);
  });

  it('pageBreakBefore 질문에서만 페이지를 자른다', () => {
    const questions = [Q('q1', 0), Q('q2', 1), Q('q3', 2, { pageBreakBefore: true }), Q('q4', 3)];
    const steps = buildRenderSteps(questions, []);
    expect(steps.map((s) => s.items.map((i) => i.question.id))).toEqual([
      ['q1', 'q2'],
      ['q3', 'q4'],
    ]);
  });

  it('첫 질문의 pageBreakBefore는 무시한다', () => {
    const questions = [Q('q1', 0, { pageBreakBefore: true }), Q('q2', 1)];
    const steps = buildRenderSteps(questions, []);
    expect(steps).toHaveLength(1);
  });

  it('페이지가 그룹 경계를 가로질러도 항목별 그룹 컨텍스트가 붙는다', () => {
    const groups = [G('g1', 0), G('g2', 1)];
    const questions = [Q('q1', 0, { groupId: 'g1' }), Q('q2', 0, { groupId: 'g2' })];
    const steps = buildRenderSteps(questions, groups);
    expect(steps).toHaveLength(1);
    const items = steps[0]!.items;
    expect(items[0]!.rootGroupId).toBe('g1');
    expect(items[0]!.rootGroupName).toBe('G1');
    expect(items[1]!.rootGroupId).toBe('g2');
  });

  it('stepId는 페이지 첫 질문 id 기반', () => {
    const questions = [Q('q1', 0), Q('q2', 1, { pageBreakBefore: true })];
    const steps = buildRenderSteps(questions, []);
    expect(stepIdOf(steps[0]!)).toBe('page:q1');
    expect(stepIdOf(steps[1]!)).toBe('page:q2');
    expect(findStepIndexOfQuestion(steps, 'q2')).toBe(1);
    expect(findStepIndexOfQuestion(steps, 'zzz')).toBe(-1);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test group-ordering-page-breaks`
Expected: FAIL (현재 엔진은 그룹/테이블로 분할하므로 다수 케이스 불일치).

- [ ] **Step 3: 타입 재정의 — `StepItem`/`RenderStep`**

`src/lib/group-ordering.ts`의 `StepItem`/`RenderStep` 정의(line 153-174)를 아래로 교체:

```ts
export type StepItem = {
  question: Question;
  // 페이지 헤더 출처가 되는 root 그룹 컨텍스트
  rootGroupId: string | null;
  rootGroupName: string | null; // hideName 그룹이면 null
  rootGroupNameDesign?: GroupNameDesign | undefined;
  // 이 질문의 바로 위에 새 하위그룹이 시작되면 그 이름 (소제목 표시용)
  subgroupName: string | null;
};

export type RenderStep = {
  kind: 'page';
  items: StepItem[]; // 1개 이상
};
```

- [ ] **Step 4: `stepIdOf` / `findStepIndexOfQuestion` 교체**

`stepIdOf`(line 185-190)를 교체:

```ts
/**
 * 운영 현황 콘솔용 step 고유 식별자 (`survey_responses.current_step_id`).
 * 신모델: 'page:<페이지 첫 질문 id>'. 구조적 anchor라 분기/역매핑이 맞물린다.
 */
export function stepIdOf(step: RenderStep): string {
  return `page:${step.items[0]?.question.id ?? 'empty'}`;
}
```

`findStepIndexOfQuestion`(line 319-325)를 교체:

```ts
export function findStepIndexOfQuestion(steps: RenderStep[], questionId: string): number {
  return steps.findIndex((s) => s.items.some((it) => it.question.id === questionId));
}
```

- [ ] **Step 5: `flattenRootScope` 반환 타입 분리 + 분할 엔진 교체**

`flattenRootScope`는 그룹 컨텍스트 없는 내부 형태를 반환하므로 지역 타입을 쓰도록 시그니처만 조정한다. `flattenRootScope`(line 196-231)의 반환 타입 `StepItem[]`을 `FlatItem[]`으로 바꾸고, 함수 위에 지역 타입을 선언한다:

```ts
type FlatItem = { question: Question; subgroupName: string | null };
```

`flattenRootScope`의 `const result: StepItem[] = [];`를 `const result: FlatItem[] = [];`로, 반환 타입을 `: FlatItem[]`로 바꾼다(본문 push 객체는 `{ question, subgroupName }`로 이미 호환).

그 다음 `splitByTable`(line 236-275) 전체와 `buildRenderSteps`(line 287-312) 전체를 아래로 **교체**:

```ts
/**
 * 모든 최상위 그룹(order 순) + ungrouped를 이어 하나의 선형 StepItem 목록으로 만든다.
 * 각 항목에 root 그룹 컨텍스트(이름/디자인)를 주석한다 — 페이지는 그룹과 무관하게 잘리지만
 * 헤더는 항목이 속한 그룹에서 파생되기 때문이다.
 */
function buildLinearStepItems(questions: Question[], groups: QuestionGroup[]): StepItem[] {
  const result: StepItem[] = [];

  const topLevelGroups = groups
    .filter((g) => !g.parentGroupId)
    .sort((a, b) => a.order - b.order);

  for (const rootGroup of topLevelGroups) {
    const rootGroupName = rootGroup.hideName ? null : rootGroup.name;
    const design = rootGroup.hideName ? undefined : rootGroup.nameDesign;
    for (const it of flattenRootScope(rootGroup.id, questions, groups)) {
      result.push({
        question: it.question,
        rootGroupId: rootGroup.id,
        rootGroupName,
        rootGroupNameDesign: design,
        subgroupName: it.subgroupName,
      });
    }
  }

  for (const it of flattenRootScope(null, questions, groups)) {
    result.push({
      question: it.question,
      rootGroupId: null,
      rootGroupName: null,
      rootGroupNameDesign: undefined,
      subgroupName: it.subgroupName,
    });
  }

  return result;
}

/**
 * 전체 설문을 페이지 렌더 스텝 배열로 변환한다.
 *
 * 규칙(수동 구분점 모델):
 * 1. 그룹 계층 + 인터리브 순서를 보존한 전역 선형 질문열을 만든다.
 * 2. 첫 항목과, `pageBreakBefore === true`인 항목에서만 새 페이지를 시작한다.
 *    (전체 첫 질문의 플래그는 무시 — 이미 페이지 시작이다.)
 */
export function buildRenderSteps(
  questions: Question[],
  groups: QuestionGroup[],
): RenderStep[] {
  const linear = buildLinearStepItems(questions, groups);
  if (linear.length === 0) return [];

  const steps: RenderStep[] = [];
  let buffer: StepItem[] = [];

  linear.forEach((item, idx) => {
    if (idx > 0 && item.question.pageBreakBefore) {
      steps.push({ kind: 'page', items: buffer });
      buffer = [];
    }
    buffer.push(item);
  });
  if (buffer.length > 0) steps.push({ kind: 'page', items: buffer });

  return steps;
}
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `pnpm test group-ordering-page-breaks`
Expected: PASS (5 케이스).

- [ ] **Step 7: 기존 group-ordering 테스트 영향 확인**

Run: `pnpm test group-ordering`
Expected: `group-ordering-branch`/`group-ordering-design`이 구 `RenderStep` 모양에 의존하면 FAIL 가능. 실패 케이스는 신모델에 맞게 갱신한다 — 구 `kind: 'group'|'table'` 기대를 `kind: 'page'` + `items`/`stepIdOf`(`page:`) 기준으로 수정. (분기 테스트의 questionId 기반 goto는 그대로 유효.)

- [ ] **Step 8: 커밋**

```bash
git add src/lib/group-ordering.ts tests/unit/lib/group-ordering-page-breaks.test.ts tests/unit/lib/group-ordering-branch.test.ts tests/unit/lib/group-ordering-design.test.ts
git commit -m "feat: 페이지 분할 엔진을 수동 구분점 기반으로 재작성"
```

---

## Task 3: 응답 렌더를 PageStepView로 통합

**Files:**
- Create: `src/components/survey-response/step-views/page-step-view.tsx`
- Modify: `src/components/survey-response/survey-response-flow.tsx`
- Modify: `src/components/survey-response/hooks/use-response-lifecycle.ts`
- Delete: `src/components/survey-response/step-views/group-step-view.tsx`, `src/components/survey-response/step-views/table-step-view.tsx`
- Test: `tests/unit/survey/page-step-view.test.tsx` (신규)

**Interfaces:**
- Consumes: `RenderStep`(Task 2), `GroupStepItem`, `RootGroupNameBadge`(불변).
- Produces: `PageStepView` 컴포넌트. props `{ step: RenderStep; responses; questions; groups; evalCtx; onResponse; highlightQuestionIds }`.

- [ ] **Step 1: 실패하는 PageStepView 테스트 작성**

Create `tests/unit/survey/page-step-view.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageStepView } from '@/components/survey-response/step-views/page-step-view';
import type { RenderStep } from '@/lib/group-ordering';

// GroupStepItem 내부(useContactAttrs/QuestionInput)를 끌어오지 않도록 항목 렌더러를 목으로 대체.
// 이 테스트의 관심사는 PageStepView의 그룹 헤더 전환 로직 + 항목 위임이다.
vi.mock('@/components/survey-response/step-views/group-step-item', () => ({
  GroupStepItem: ({ item }: { item: { question: { id: string } } }) => (
    <div data-testid={`qi-${item.question.id}`} />
  ),
}));

// shouldDisplayQuestion이 evalCtx 없이도 true를 반환하도록 단순화.
vi.mock('@/utils/branch-logic', () => ({
  shouldDisplayQuestion: () => true,
}));

const step: RenderStep = {
  kind: 'page',
  items: [
    { question: { id: 'q1', type: 'radio', title: 'Q1', required: false, order: 0 } as never,
      rootGroupId: 'g1', rootGroupName: '기본정보', subgroupName: null },
    { question: { id: 'q2', type: 'radio', title: 'Q2', required: false, order: 1 } as never,
      rootGroupId: 'g2', rootGroupName: 'TV시청', subgroupName: null },
  ],
};

describe('PageStepView', () => {
  it('페이지가 그룹을 가로지르면 두 그룹 헤더를 모두 렌더한다', () => {
    render(
      <PageStepView
        step={step}
        responses={{}}
        questions={step.items.map((i) => i.question)}
        groups={[]}
        evalCtx={undefined as never}
        onResponse={() => {}}
        highlightQuestionIds={new Set()}
      />,
    );
    expect(screen.getByText('기본정보')).toBeInTheDocument();
    expect(screen.getByText('TV시청')).toBeInTheDocument();
    expect(screen.getByTestId('qi-q1')).toBeInTheDocument();
    expect(screen.getByTestId('qi-q2')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test page-step-view`
Expected: FAIL — `page-step-view` 모듈 없음.

- [ ] **Step 3: PageStepView 작성**

Create `src/components/survey-response/step-views/page-step-view.tsx`:

```tsx
'use client';

import { useMemo } from 'react';

import { GroupStepItem } from '@/components/survey-response/step-views/group-step-item';
import { RootGroupNameBadge } from '@/components/survey-response/step-views/root-group-name-badge';
import { Card, CardContent } from '@/components/ui/card';
import { RenderStep, StepItem } from '@/lib/group-ordering';
import { Question, QuestionGroup } from '@/types/survey';
import { shouldDisplayQuestion, type BranchEvalCtx } from '@/utils/branch-logic';

type ResponsesMap = Record<string, unknown>;

export function PageStepView({
  step,
  responses,
  questions,
  groups,
  evalCtx,
  onResponse,
  highlightQuestionIds,
}: {
  step: RenderStep;
  responses: ResponsesMap;
  questions: Question[];
  groups: QuestionGroup[];
  evalCtx: BranchEvalCtx;
  onResponse: (questionId: string, value: unknown) => void;
  highlightQuestionIds: Set<string>;
}) {
  const visibleItems: StepItem[] = useMemo(
    () =>
      step.items.filter((it) =>
        shouldDisplayQuestion(it.question, responses, questions, groups, evalCtx),
      ),
    [step.items, responses, questions, groups, evalCtx],
  );

  if (visibleItems.length === 0) return null;

  return (
    <Card className="animate-in fade-in duration-200">
      <CardContent className="pt-6 md:px-8">
        <div className="divide-y divide-gray-100">
          {visibleItems.map((item, idx) => {
            const prev = visibleItems[idx - 1];
            // root 그룹이 바뀌는 지점(또는 페이지 첫 항목)에 그룹 헤더를 표시한다.
            const showRootBadge =
              !!item.rootGroupName && (idx === 0 || prev?.rootGroupId !== item.rootGroupId);
            return (
              <div key={item.question.id}>
                {showRootBadge && item.rootGroupName && (
                  <div className="pt-5 pb-2 first:pt-0">
                    <RootGroupNameBadge
                      name={item.rootGroupName}
                      design={item.rootGroupNameDesign}
                    />
                  </div>
                )}
                <GroupStepItem
                  item={item}
                  showSubgroupHeading={
                    !!item.subgroupName && item.subgroupName !== item.rootGroupName
                  }
                  responses={responses}
                  questions={questions}
                  onResponse={onResponse}
                  isHighlighted={highlightQuestionIds.has(item.question.id)}
                />
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test page-step-view`
Expected: PASS.

- [ ] **Step 5: 응답 플로우 — `getDisplayableItemsOfStep` 단순화**

`survey-response-flow.tsx`의 `getDisplayableItemsOfStep`(line 81-96)을 교체:

```ts
function getDisplayableItemsOfStep(
  step: RenderStep,
  responses: ResponsesMap,
  allQuestions: Question[],
  allGroups: QuestionGroup[],
  evalCtx?: BranchEvalCtx,
): Question[] {
  return step.items
    .filter((i) => shouldDisplayQuestion(i.question, responses, allQuestions, allGroups, evalCtx))
    .map((i) => i.question);
}
```

- [ ] **Step 6: 응답 플로우 — 컨테이너 너비 + 렌더 분기 교체**

`survey-response-flow.tsx`:
- line 573 `const isTableStep = currentStep.kind === 'table';`를 교체:
```ts
  const pageHasTable = currentStep.items.some((i) => i.question.type === 'table');
```
- 다음 줄 `const containerMaxWidth = isTableStep ? 'max-w-7xl' : 'max-w-4xl';`를 교체:
```ts
  const containerMaxWidth = pageHasTable ? 'max-w-7xl' : 'max-w-4xl';
```
- 렌더 분기(line 645-664, `{currentStep.kind === 'table' ? (<TableStepView .../>) : (<GroupStepView .../>)}`)를 교체:
```tsx
        <PageStepView
          step={currentStep}
          responses={responses}
          questions={questions}
          groups={groups}
          evalCtx={evalCtx}
          onResponse={handleResponse}
          highlightQuestionIds={highlightQuestionIds}
        />
```

- [ ] **Step 7: 응답 플로우 — import 교체**

`survey-response-flow.tsx` 상단의 `GroupStepView`/`TableStepView` import를 제거하고 추가:
```ts
import { PageStepView } from '@/components/survey-response/step-views/page-step-view';
```

- [ ] **Step 8: 라이프사이클 훅 — 스텝 인덱스 조회 통일**

`use-response-lifecycle.ts`의 인라인 조회(line 258-262)를 교체:
```ts
        const targetIdx = findStepIndexOfQuestion(steps, firstId);
```
파일 상단 group-ordering import에 `findStepIndexOfQuestion`를 추가한다(`stepIdOf` 등과 같은 import 구문).

- [ ] **Step 9: 구 뷰 삭제**

```bash
git rm src/components/survey-response/step-views/group-step-view.tsx \
       src/components/survey-response/step-views/table-step-view.tsx
```

- [ ] **Step 10: 응답 측 타입/테스트 확인**

Run: `pnpm exec tsc --noEmit src/components/survey-response/survey-response-flow.tsx 2>&1 | head` 로 응답 플로우 잔여 `kind`/`step.question` 참조가 없는지 확인. 이어서:
Run: `pnpm test page-step-view group-ordering`
Expected: PASS. (운영 콘솔 `profiles.ts`/`page-dwell.ts`는 Task 4 전까지 tsc 에러가 남아있을 수 있음 — 예상된 상태.)

- [ ] **Step 11: 커밋**

```bash
git add -A
git commit -m "feat: 응답 페이지 렌더를 PageStepView로 통합"
```

---

## Task 4: 운영 콘솔 stepId 통일

**Files:**
- Modify: `src/lib/operations/profiles.ts:256`
- Modify: `src/lib/operations/page-dwell.ts` (`buildCanonicalSteps`)
- Test: 기존 `tests/**/*page-dwell*`, `tests/**/*profiles*` 갱신

**Interfaces:**
- Consumes: `buildRenderSteps`/`stepIdOf`(Task 2).
- Produces: `buildCanonicalSteps(snapshot): CanonicalStep[]` — stepId가 `page:<첫 질문 id>` 체계. `CanonicalStep` 모양(`{ stepId; label; position; page }`) 유지.

- [ ] **Step 1: `profiles.ts` 대표 질문 추출 교체**

`profiles.ts`의 `buildStepLocationMap` 루프(line 255-260)에서:
```ts
    const rep = step.kind === 'table' ? step.question : step.items[0]?.question
```
를 교체:
```ts
    const rep = step.items[0]?.question
```

- [ ] **Step 2: `buildCanonicalSteps`를 `buildRenderSteps` 기반으로 재작성**

`page-dwell.ts`의 `buildCanonicalSteps`(line 145~) 본문 전체를 아래로 교체한다. `CanonicalStep` 인터페이스(stepId/label/position/page)는 유지. snapshot의 questions/groups를 `buildRenderSteps`가 읽는 최소 도메인 형태로 매핑(`pageBreakBefore` 포함)하고, 각 페이지를 1개 CanonicalStep으로 만든다. 라벨은 페이지 첫 항목의 root 그룹 이름 → 없으면 첫 질문의 questionCode → 없으면 `Q<position>`.

```ts
export function buildCanonicalSteps(snapshot: SurveyVersionSnapshot): CanonicalStep[] {
  const rawGroups = Array.isArray(snapshot.groups) ? snapshot.groups : [];
  const rawQuestions = Array.isArray(snapshot.questions) ? snapshot.questions : [];

  // buildRenderSteps 가 읽는 필드만 도메인 형태로 정규화한다 (profiles.ts 와 동일 패턴).
  const qs: Question[] = rawQuestions.map((q) => ({
    id: q.id,
    order: q.order,
    title: q.title,
    type: q.type as Question['type'],
    required: false,
    ...(q.groupId != null ? { groupId: q.groupId } : {}),
    ...(q.pageBreakBefore ? { pageBreakBefore: true } : {}),
  }));
  const gs: QuestionGroup[] = rawGroups.map((g) => ({
    id: g.id,
    surveyId: '',
    name: g.name,
    order: g.order,
    ...(g.parentGroupId != null ? { parentGroupId: g.parentGroupId } : {}),
    ...(g.hideName ? { hideName: true } : {}),
  }));

  const questionCodeOf = new Map<string, string | undefined>(
    rawQuestions.map((q) => [q.id, q.questionCode]),
  );

  const steps: CanonicalStep[] = [];
  buildRenderSteps(qs, gs).forEach((step, idx) => {
    const first = step.items[0];
    if (!first) return;
    const position = idx + 1;
    const code = questionCodeOf.get(first.question.id);
    const label = first.rootGroupName ?? code ?? `Q${position}`;
    steps.push({
      stepId: stepIdOf(step),
      label,
      position,
      page: position, // 신모델: 각 step 이 곧 한 페이지
    });
  });
  return steps;
}
```

파일 상단 import에 `buildRenderSteps`, `stepIdOf`를 추가하고(`@/lib/group-ordering`), `Question`/`QuestionGroup` 타입 import가 없으면 `@/types/survey`에서 추가한다. 구현에서 더 이상 쓰지 않는 지역 헬퍼(`flattenScope`, slot 인터리브 로직 등)는 제거한다.

- [ ] **Step 3: 운영 콘솔 테스트 갱신**

Run: `pnpm test page-dwell profiles drop-funnel`
Expected: 구 `group:`/`table:` stepId를 하드코딩한 케이스가 FAIL → 신 `page:<qid>` 기대값으로 갱신. drop-funnel의 legacy/validStepIds 버킷 동작(미상 stepId는 legacyCount)은 그대로 유지되는지 확인. crash 없음이 핵심.

- [ ] **Step 4: 전체 타입 통과 확인**

Run: `pnpm exec tsc --noEmit`
Expected: 에러 0 (응답 + 운영 콘솔 소비처 모두 신모델 정합).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/operations/profiles.ts src/lib/operations/page-dwell.ts tests/
git commit -m "feat: 운영 콘솔 스텝 식별을 page 구분점 체계로 통일"
```

---

## Task 5: 빌더 페이지 구분점 인서터

**Files:**
- Create: `src/components/survey-builder/page-break-divider.tsx`
- Modify: `src/components/survey-builder/sortable-question-list.tsx`
- Test: `tests/unit/survey/page-break-divider.test.tsx` (신규)

**Interfaces:**
- Consumes: survey-store `updateQuestion(questionId, updates: Partial<Question>)`.
- Produces: `PageBreakDivider` 컴포넌트. props `{ active: boolean; onToggle: () => void }`.

- [ ] **Step 1: 실패하는 divider 테스트 작성**

Create `tests/unit/survey/page-break-divider.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PageBreakDivider } from '@/components/survey-builder/page-break-divider';

describe('PageBreakDivider', () => {
  it('비활성 상태에서 클릭하면 onToggle을 호출한다', () => {
    const onToggle = vi.fn();
    render(<PageBreakDivider active={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: /페이지 나누기/ }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('활성 상태면 페이지 구분 라벨을 보여준다', () => {
    render(<PageBreakDivider active onToggle={() => {}} />);
    expect(screen.getByText('페이지 나눔')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test page-break-divider`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: PageBreakDivider 작성**

Create `src/components/survey-builder/page-break-divider.tsx`:

```tsx
'use client';

import { Scissors } from 'lucide-react';

export function PageBreakDivider({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  if (active) {
    return (
      <div className="group/divider relative my-2 flex items-center gap-2">
        <div className="h-px flex-1 bg-blue-300" />
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-1 rounded-full border border-blue-300 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-600 hover:bg-blue-100"
          title="페이지 나누기 해제"
        >
          <Scissors className="h-3 w-3" />
          페이지 나눔
        </button>
        <div className="h-px flex-1 bg-blue-300" />
      </div>
    );
  }
  return (
    <div className="flex h-6 items-center justify-center opacity-0 transition-opacity hover:opacity-100">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1 rounded-full border border-dashed border-gray-300 bg-white px-3 py-0.5 text-xs text-gray-400 hover:border-blue-300 hover:text-blue-500"
        title="여기서 페이지 나누기"
      >
        <Scissors className="h-3 w-3" />
        여기서 페이지 나누기
      </button>
    </div>
  );
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test page-break-divider`
Expected: PASS.

- [ ] **Step 5: 질문 목록에 인서터 배치**

`sortable-question-list.tsx`의 두 `SortableQuestion` 렌더 지점(line 743, 842)에서, 각 질문 카드 **위에** divider를 렌더한다. 리스트 map의 `index`를 이용해 선형 순서상 첫 질문(index 0)에는 표시하지 않는다. 예시(line 743 지점):

```tsx
        {index > 0 && (
          <PageBreakDivider
            active={!!question.pageBreakBefore}
            onToggle={() =>
              updateQuestion(question.id, { pageBreakBefore: !question.pageBreakBefore })
            }
          />
        )}
        <SortableQuestion
```

`updateQuestion`은 `useSurveyStore`에서 가져온다(파일이 이미 store를 쓰면 기존 구문에 추가, 아니면 `const { updateQuestion } = useSurveyStore();`). `PageBreakDivider` import를 상단에 추가. 두 번째 렌더 지점(line 842)에도 동일 패턴 적용.

> 주의: divider는 같은 컴포넌트 스코프에서 `index`/`question`이 보이는 위치여야 한다. 두 지점이 서로 다른 map(그룹/ungrouped 등)이면 각 map의 지역 index 기준 `index > 0`을 사용한다.

- [ ] **Step 6: 빌더 타입/테스트 확인**

Run: `pnpm exec tsc --noEmit && pnpm test page-break-divider`
Expected: PASS, tsc 에러 0.

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "feat: 설문 빌더에 페이지 구분점 인서터 추가"
```

---

## 최종 검증

- [ ] **Step 1: 전체 테스트 + 타입 + 린트**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm lint`
Expected: 전부 통과.

- [ ] **Step 2: 수동 스모크(선택)**

`pnpm dev` 후: 빌더에서 질문 사이 구분점 토글 → 응답 페이지(테스트 모드)에서 해당 지점에서 페이지가 나뉘는지, 구분점 0개 설문이 한 페이지로 나오는지, 그룹을 가로지른 페이지 헤더가 정상인지 확인. (응답 페이지 반영은 publish 후 — snapshot 기반.)
