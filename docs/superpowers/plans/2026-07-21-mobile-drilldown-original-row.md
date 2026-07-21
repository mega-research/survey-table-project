# Mobile Drilldown Original Row Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모바일 테이블에서 기존 드릴다운으로 항목을 고른 뒤 선택한 행만 원본 헤더·열 배치로 보여주는 질문별 표시 모드를 추가한다.

**Architecture:** 질문에는 `auto | drilldown-original-row | original` 단일 모드와 제외할 원본 선행 열 수를 저장한다. 런타임은 기존 분류·행 완료·셀 입력 로직을 adapter로 감싸고, 공통 드릴다운 탐색 껍데기와 한 행짜리 `TablePreview` 래퍼를 `table` 및 설명 테이블 `radio`/`checkbox`가 공유한다. 기존 `mobileOriginalTable`은 과거 DB와 불변 스냅샷을 읽는 폴백으로만 남긴다.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Zustand, Zod 4, Drizzle ORM, TailwindCSS 4, Vitest, Testing Library

## Global Constraints

- 모바일 표시 모드는 정확히 `auto | drilldown-original-row | original` 세 값만 허용한다.
- `mobileDrilldownOmitLeadingColumns` 기본값은 `1`, 유효 범위는 `0..authoredColumns.length - 1`이며 런타임에서 clamp한다.
- 제외 대상은 현재 보이는 열이 아니라 작성된 원본 열 순서로 결정한다. 조건으로 이미 숨은 열 때문에 다음 가시 열을 추가로 제외하지 않는다.
- 새 모드는 `table`과 설명 테이블 소스 `radio`/`checkbox`에만 적용한다. `ranking`은 표시 설정을 소유하거나 소비하지 않는다.
- 명시 모드는 `decideDrilldown()` 임계값을 우회하고, 단일 행도 `카드 → 상세` 순서를 지킨다.
- 입력 후 자동 이동하지 않는다. 이전 항목, 다음 항목, 다음 섹션, 목차로 이동만 사용한다.
- `isHidden`, `_isContinuation`, colspan, rowspan, `isHeaderHidden`, `hideColumnLabels`를 보존한다.
- 정적 셀의 `mobileDisplay='hidden'`은 콘텐츠를 숨긴다. 인터랙티브 셀과 `choice_opt`는 라벨만 숨기고 응답 컨트롤은 유지한다.
- 같은 질문의 상세 항목 이동에서는 가로 위치를 유지하고, 목차 복귀 또는 질문 unmount 시 `scrollLeft=0`으로 초기화한다.
- 응답 키는 계속 `cell.id`를 사용하며 데스크톱 렌더, 분석, 분기, SPSS/엑셀 export를 변경하지 않는다.
- 새 코드의 주석·로그·UI 문구는 한국어로 작성하고 이모지를 사용하지 않는다.
- 운영 DB에는 이 계획 실행 중 직접 `db:push` 또는 수동 SQL을 적용하지 않는다. 마이그레이션 파일과 추적 manifest만 작성한다.

---

## File Map

### 새 파일

- `src/types/mobile-table-display.ts`: 표시 모드 어휘와 런타임 타입 가드.
- `src/utils/mobile-table-display-mode.ts`: 레거시 폴백을 포함한 모드 resolver와 제외 열 수 clamp.
- `src/utils/mobile-original-row.ts`: 작성 열 기준 행 투영, 인터랙티브 셀 판정, 설명 테이블 행 제목 계산.
- `src/utils/table-radio-groups.ts`: 동일 행 radio 그룹 bucket 및 `InteractiveCell` props 계산.
- `src/components/survey-builder/mobile-table-display-settings.tsx`: 빌더의 3개 모드 선택과 숫자 입력.
- `src/components/survey-builder/mobile-original-row-table.tsx`: `TablePreview`를 재사용하는 한 행 원본 렌더러.
- `src/components/survey-builder/mobile-drilldown-shell.tsx`: 목차·리프·breadcrumb·하단 탐색을 공유하는 탐색 껍데기.
- `src/components/survey-response/choice-table-drilldown.tsx`: 설명 테이블 선택형 adapter.
- `tests/unit/utils/mobile-table-display-mode.test.ts`: resolver와 clamp 테스트.
- `tests/unit/utils/mobile-original-row.test.ts`: 투영·병합·hidden·행 제목 테스트.
- `tests/unit/utils/table-radio-groups.test.ts`: radio 그룹 props 테스트.
- `tests/unit/survey/mobile-table-display-settings.test.tsx`: 빌더 설정 UI 테스트.
- `tests/unit/survey/mobile-original-row-table.test.tsx`: 한 행 원본 렌더·스크롤 테스트.
- `tests/unit/survey/mobile-table-drilldown-original-row.test.tsx`: table 새 모드 통합 테스트.
- `tests/unit/survey/choice-table-drilldown-original-row.test.tsx`: 설명 테이블 새 모드 통합 테스트.
- `supabase/migrations/0056_add_mobile_table_display_mode.sql`: 새 컬럼, enum check, 레거시 백필.

### 수정 파일

- `src/types/survey.ts`, `src/db/schema/schema-types.ts`: 질문 및 스냅샷 필드 타입.
- `src/lib/question/variants.ts`, `src/lib/question/schema.ts`: radio/checkbox/table 전용 표시 설정 capability.
- `src/features/survey-builder/domain/question.ts`: create/update Zod 입력.
- `src/db/schema/surveys.ts`, `src/db/schema/question-persisted-fields.ts`: Drizzle 컬럼과 영속 SSOT.
- `src/features/survey-builder/server/services/questions.service.ts`: 질문 생성 필드.
- `src/features/survey-builder/server/services/survey-save.service.ts`: 전체·diff 저장 upsert 필드.
- `src/features/survey-builder/server/services/surveys.service.ts`: 설문 복제 필드.
- `src/data/surveys.ts`: DB 질문 read mapping.
- `src/lib/versioning/snapshot-builder.ts`: 배포 스냅샷 보존.
- `supabase/migrations/manual-migrations.json`: `0056` 추적.
- `src/components/survey-builder/dynamic-table-editor.tsx`: 기존 boolean 토글 교체.
- `src/components/survey-builder/question-edit-modal.tsx`: store 최신값을 저장 payload에 병합.
- `src/utils/classify-table.ts`: adapter별 answerable 셀 타입 주입.
- `src/utils/table-row-completion.ts`: 새 모드가 answerable 타입을 명시할 수 있도록 기본값 보존 옵션 추가.
- `src/components/survey-builder/table-preview.tsx`: 외부 scrollLeft ref, 오류 셀 표시 지원.
- `src/components/survey-builder/mobile-table-drilldown.tsx`: 공통 shell adapter 및 원본 행 상세 분기.
- `src/components/survey-builder/interactive-table-response.tsx`: 정규화 모드 분기와 명시 드릴다운.
- `src/components/survey-builder/question-test-card.tsx`: 새 설정 전달.
- `src/components/survey-response/question-input.tsx`: 새 설정 전달.
- `src/components/survey-response/choice-table-response.tsx`: auto/original/new 모드 분기와 기존 toggle 주입.
- `tests/unit/question/schema-matrix.test.ts`, `tests/unit/question/normalize.test.ts`: variant 및 과거 snapshot 호환.
- `tests/unit/domains/versioning/snapshot-builder.test.ts`: snapshot 필드 보존.
- `tests/unit/classify-table.test.ts`: `choice_opt` 분류.
- `tests/unit/utils/table-row-completion.test.ts`: 기본 동작 보존과 새 answerable 집합.
- `tests/unit/survey/mobile-original-table.test.tsx`: 레거시와 새 enum 분기 회귀.
- `tests/unit/survey/choice-table-response-mobile.test.tsx`: auto 모드의 셀별 카드 회귀.
- `tests/integration/survey-builder-roundtrip.realdb.test.ts`: create/duplicate roundtrip 필드.

---

### Task 1: 표시 모드 도메인 타입과 읽기 resolver

**Files:**
- Create: `src/types/mobile-table-display.ts`
- Create: `src/utils/mobile-table-display-mode.ts`
- Create: `tests/unit/utils/mobile-table-display-mode.test.ts`
- Modify: `src/types/survey.ts:1-15, 540-560`
- Modify: `src/lib/question/variants.ts:35-85`
- Modify: `src/lib/question/schema.ts:35-105`
- Modify: `tests/unit/question/schema-matrix.test.ts:20-95`
- Modify: `tests/unit/question/normalize.test.ts:20-260`

**Interfaces:**
- Produces: `MOBILE_TABLE_DISPLAY_MODES`, `MobileTableDisplayMode`, `isMobileTableDisplayMode(value)`.
- Produces: `resolveMobileTableDisplayMode(input): MobileTableDisplayMode`.
- Produces: `clampMobileDrilldownOmitLeadingColumns(value, authoredColumnCount): number`.
- Produces: `Question.mobileTableDisplayMode`, `Question.mobileDrilldownOmitLeadingColumns`.

- [ ] **Step 1: resolver와 strict snapshot 호환 실패 테스트 작성**

```ts
// tests/unit/utils/mobile-table-display-mode.test.ts
import { describe, expect, it } from 'vitest';

import {
  clampMobileDrilldownOmitLeadingColumns,
  resolveMobileTableDisplayMode,
} from '@/utils/mobile-table-display-mode';

describe('resolveMobileTableDisplayMode', () => {
  it.each([
    ['auto', 'auto'],
    ['drilldown-original-row', 'drilldown-original-row'],
    ['original', 'original'],
  ] as const)('유효 enum %s를 정본으로 사용', (input, expected) => {
    expect(resolveMobileTableDisplayMode({ mobileTableDisplayMode: input, mobileOriginalTable: true }))
      .toBe(expected);
  });

  it('enum 키가 없는 과거 snapshot은 legacy true를 original로 복원', () => {
    expect(resolveMobileTableDisplayMode({ mobileOriginalTable: true })).toBe('original');
  });

  it('유효하지 않은 enum은 legacy boolean 후 auto 순서로 폴백', () => {
    expect(resolveMobileTableDisplayMode({ mobileTableDisplayMode: 'bad', mobileOriginalTable: true }))
      .toBe('original');
    expect(resolveMobileTableDisplayMode({ mobileTableDisplayMode: 'bad' })).toBe('auto');
  });
});

describe('clampMobileDrilldownOmitLeadingColumns', () => {
  it.each([
    [undefined, 11, 1],
    [0, 11, 0],
    [2, 11, 2],
    [99, 11, 10],
    [-2, 11, 0],
    [1.8, 11, 1],
    [1, 1, 0],
    [1, 0, 0],
  ])('값 %s, 열 %s개를 %s로 정규화', (value, count, expected) => {
    expect(clampMobileDrilldownOmitLeadingColumns(value, count)).toBe(expected);
  });
});
```

`tests/unit/question/normalize.test.ts`의 strict 블록에 다음 회귀를 추가한다.

```ts
it('과거 table snapshot의 mobileOriginalTable 키를 strict 모드에서도 보존한다', () => {
  const parsed = normalizeQuestion(
    { ...GEN_NEW_TABLE, mobileOriginalTable: true },
    'strict',
  );
  expect(parsed.mobileOriginalTable).toBe(true);
  expect(parsed.mobileTableDisplayMode).toBeUndefined();
});

it('유효하지 않은 snapshot enum은 strict 모드에서 legacy fallback 가능한 형태로 수렴한다', () => {
  const parsed = normalizeQuestion(
    { ...GEN_NEW_TABLE, mobileTableDisplayMode: 'broken', mobileOriginalTable: true },
    'strict',
  );
  expect(parsed.mobileTableDisplayMode).toBeUndefined();
  expect(parsed.mobileOriginalTable).toBe(true);
});
```

- [ ] **Step 2: 테스트가 새 모듈 부재와 schema strip으로 실패하는지 확인**

Run:

```bash
pnpm exec vitest run tests/unit/utils/mobile-table-display-mode.test.ts tests/unit/question/normalize.test.ts
```

Expected: `mobile-table-display-mode` 모듈을 찾지 못하고 strict 결과에서 `mobileOriginalTable`이 제거되어 FAIL.

- [ ] **Step 3: 모드 어휘와 resolver 구현**

```ts
// src/types/mobile-table-display.ts
export const MOBILE_TABLE_DISPLAY_MODES = [
  'auto',
  'drilldown-original-row',
  'original',
] as const;

export type MobileTableDisplayMode = (typeof MOBILE_TABLE_DISPLAY_MODES)[number];

export function isMobileTableDisplayMode(value: unknown): value is MobileTableDisplayMode {
  return typeof value === 'string'
    && (MOBILE_TABLE_DISPLAY_MODES as readonly string[]).includes(value);
}
```

```ts
// src/utils/mobile-table-display-mode.ts
import {
  isMobileTableDisplayMode,
  type MobileTableDisplayMode,
} from '@/types/mobile-table-display';

interface MobileTableDisplayInput {
  mobileTableDisplayMode?: unknown;
  mobileOriginalTable?: unknown;
}

export function resolveMobileTableDisplayMode(
  input: MobileTableDisplayInput,
): MobileTableDisplayMode {
  if (isMobileTableDisplayMode(input.mobileTableDisplayMode)) {
    return input.mobileTableDisplayMode;
  }
  if (input.mobileOriginalTable === true) return 'original';
  return 'auto';
}

export function clampMobileDrilldownOmitLeadingColumns(
  value: unknown,
  authoredColumnCount: number,
): number {
  const max = Math.max(0, Math.trunc(authoredColumnCount) - 1);
  const candidate = typeof value === 'number' && Number.isFinite(value)
    ? Math.trunc(value)
    : 1;
  return Math.min(max, Math.max(0, candidate));
}
```

`src/types/survey.ts`에서 타입을 re-export하고 `Question`에 필드를 추가한다.

```ts
import type { MobileTableDisplayMode } from '@/types/mobile-table-display';
export type { MobileTableDisplayMode } from '@/types/mobile-table-display';

// Question
mobileOriginalTable?: boolean; // 레거시 read 호환 전용
mobileTableDisplayMode?: MobileTableDisplayMode;
mobileDrilldownOmitLeadingColumns?: number;
```

- [ ] **Step 4: radio/checkbox/table에만 모바일 표시 capability를 추가**

`src/lib/question/variants.ts`에 별도 capability를 만들고 ranking에는 섞지 않는다.

```ts
type MobileTableDisplayFields = Pick<
  Question,
  'mobileOriginalTable' | 'mobileTableDisplayMode' | 'mobileDrilldownOmitLeadingColumns'
>;

export interface RadioQuestion
  extends QuestionBase, OptionListFields, EmbeddedTableFields, MobileTableDisplayFields, ChoiceGroupFields {
  type: 'radio';
}

export interface CheckboxQuestion
  extends QuestionBase, OptionListFields, EmbeddedTableFields, MobileTableDisplayFields,
    ChoiceGroupFields, Pick<Question, 'minSelections' | 'maxSelections'> {
  type: 'checkbox';
}

export interface TableQuestion
  extends QuestionBase, EmbeddedTableFields, MobileTableDisplayFields,
    Pick<Question, 'tableValidationRules' | 'dynamicRowConfigs'> {
  type: 'table';
}
```

`src/lib/question/schema.ts`에는 default를 넣지 않는 optional shape를 추가한다. 키 부재가 legacy resolver까지 살아 있어야 한다.

```ts
import { MOBILE_TABLE_DISPLAY_MODES } from '@/types/mobile-table-display';

const mobileTableDisplay = z.object({
  mobileOriginalTable: z.boolean().optional(),
  mobileTableDisplayMode: z.enum(MOBILE_TABLE_DISPLAY_MODES).optional().catch(undefined),
  mobileDrilldownOmitLeadingColumns: z.number().int().min(0).optional(),
});

export const RadioQuestionSchema = base
  .extend(optionList.shape)
  .extend(embeddedTable.shape)
  .extend(mobileTableDisplay.shape)
  .extend(choiceGroups.shape)
  .extend({ type: z.literal('radio') });

export const CheckboxQuestionSchema = base
  .extend(optionList.shape)
  .extend(embeddedTable.shape)
  .extend(mobileTableDisplay.shape)
  .extend(choiceGroups.shape)
  .extend({
    type: z.literal('checkbox'),
    minSelections: z.number().optional(),
    maxSelections: z.number().optional(),
  });

export const TableQuestionSchema = base
  .extend(embeddedTable.shape)
  .extend(mobileTableDisplay.shape)
  .extend({
    type: z.literal('table'),
    tableValidationRules: z.custom<NonNullable<Question['tableValidationRules']>>().optional(),
    dynamicRowConfigs: z.custom<NonNullable<Question['dynamicRowConfigs']>>().optional(),
  });
```

`RankingQuestionSchema`는 현재 정의를 변경하지 않는다. strict parse에서 ranking에 섞인 세 키는 계속
cross-type 오염으로 제거되어야 한다.

`tests/unit/question/schema-matrix.test.ts`에는 다음 키 그룹을 추가하고 radio/checkbox/table 예상값에만 포함한다.

```ts
const MOBILE_TABLE_DISPLAY_KEYS = [
  'mobileOriginalTable',
  'mobileTableDisplayMode',
  'mobileDrilldownOmitLeadingColumns',
];
```

- [ ] **Step 5: 도메인 테스트와 타입 검사를 통과시킨 뒤 커밋**

Run:

```bash
pnpm exec vitest run tests/unit/utils/mobile-table-display-mode.test.ts tests/unit/question/schema-matrix.test.ts tests/unit/question/normalize.test.ts
pnpm exec tsc --noEmit
```

Expected: 모든 테스트 PASS, TypeScript 오류 0개.

```bash
git add src/types/mobile-table-display.ts src/types/survey.ts src/utils/mobile-table-display-mode.ts src/lib/question/variants.ts src/lib/question/schema.ts tests/unit/utils/mobile-table-display-mode.test.ts tests/unit/question/schema-matrix.test.ts tests/unit/question/normalize.test.ts
git commit -m "feat: 모바일 테이블 표시 모드 모델 추가"
```

---

### Task 2: DB 영속성, 설문 저장·복제, 배포 스냅샷

**Files:**
- Create: `supabase/migrations/0056_add_mobile_table_display_mode.sql`
- Modify: `supabase/migrations/manual-migrations.json`
- Modify: `src/db/schema/surveys.ts:1-10, 175-200`
- Modify: `src/db/schema/schema-types.ts:245-270`
- Modify: `src/db/schema/question-persisted-fields.ts:35-55`
- Modify: `src/features/survey-builder/domain/question.ts:20-115`
- Modify: `src/features/survey-builder/server/services/questions.service.ts:35-80`
- Modify: `src/features/survey-builder/server/services/survey-save.service.ts:230-320, 575-660`
- Modify: `src/features/survey-builder/server/services/surveys.service.ts:235-280`
- Modify: `src/components/survey-builder/question-edit-modal.tsx:330-400`
- Modify: `src/data/surveys.ts:105-140`
- Modify: `src/lib/versioning/snapshot-builder.ts:45-145`
- Modify: `tests/unit/domains/versioning/snapshot-builder.test.ts`
- Modify: `tests/integration/survey-builder-roundtrip.realdb.test.ts`

**Interfaces:**
- Consumes: Task 1의 `MobileTableDisplayMode`, 질문 필드.
- Produces: DB 컬럼 `mobile_table_display_mode`, `mobile_drilldown_omit_leading_columns`.
- Produces: create/update/save/duplicate/read/publish 전 경로의 필드 보존.

- [ ] **Step 1: snapshot과 real DB roundtrip 실패 테스트 작성**

`tests/unit/domains/versioning/snapshot-builder.test.ts`에 추가한다.

```ts
it('모바일 표시 모드와 상세 제외 선행 열 수를 스냅샷에 보존한다', () => {
  const survey: Survey = {
    ...mockSurvey,
    questions: [{
      id: 'q-table',
      type: 'table',
      title: '척도',
      required: false,
      order: 0,
      tableColumns: [{ id: 'c0', label: '항목' }, { id: 'c1', label: '점수' }],
      tableRowsData: [],
      mobileTableDisplayMode: 'drilldown-original-row',
      mobileDrilldownOmitLeadingColumns: 1,
    }],
  };
  const question = buildSurveySnapshot(survey).questions[0];
  expect(question?.mobileTableDisplayMode).toBe('drilldown-original-row');
  expect(question?.mobileDrilldownOmitLeadingColumns).toBe(1);
});
```

`tests/integration/survey-builder-roundtrip.realdb.test.ts`의 duplicate fixture와 검증 필드에 다음 값을 추가한다.

```ts
mobileTableDisplayMode: 'drilldown-original-row',
mobileDrilldownOmitLeadingColumns: 2,
```

```ts
expect(duplicatedQuestion.mobileTableDisplayMode).toBe('drilldown-original-row');
expect(duplicatedQuestion.mobileDrilldownOmitLeadingColumns).toBe(2);
```

- [ ] **Step 2: snapshot 테스트 실패와 영속 SSOT 컴파일 공백 확인**

Run:

```bash
pnpm exec vitest run tests/unit/domains/versioning/snapshot-builder.test.ts
```

Expected: snapshot 질문에 새 필드가 없어 FAIL.

- [ ] **Step 3: Drizzle 스키마와 수동 마이그레이션 작성**

`src/db/schema/surveys.ts`에서 모드 타입을 사용한다.

```ts
import { relations, sql } from 'drizzle-orm';
import { boolean, check, doublePrecision, integer, jsonb, pgTable, smallint, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { MOBILE_TABLE_DISPLAY_MODES } from '@/types/mobile-table-display';

// questions columns
mobileTableDisplayMode: text('mobile_table_display_mode', {
  enum: MOBILE_TABLE_DISPLAY_MODES,
}).default('auto'),
mobileDrilldownOmitLeadingColumns: integer('mobile_drilldown_omit_leading_columns').default(1),

// pgTable 세 번째 인자
(table) => [
  check(
    'questions_mobile_table_display_mode_check',
    sql`${table.mobileTableDisplayMode} in ('auto', 'drilldown-original-row', 'original')`,
  ),
]
```

`supabase/migrations/0056_add_mobile_table_display_mode.sql` 전체 내용:

```sql
ALTER TABLE "questions"
  ADD COLUMN IF NOT EXISTS "mobile_table_display_mode" text DEFAULT 'auto';

ALTER TABLE "questions"
  ADD COLUMN IF NOT EXISTS "mobile_drilldown_omit_leading_columns" integer DEFAULT 1;

UPDATE "questions"
SET "mobile_table_display_mode" = 'original'
WHERE "mobile_original_table" = true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'questions_mobile_table_display_mode_check'
  ) THEN
    ALTER TABLE "questions"
      ADD CONSTRAINT "questions_mobile_table_display_mode_check"
      CHECK ("mobile_table_display_mode" IN ('auto', 'drilldown-original-row', 'original'));
  END IF;
END $$;
```

`supabase/migrations/manual-migrations.json`의 마지막 항목 뒤에 `0056_add_mobile_table_display_mode`를 추가한다.

- [ ] **Step 4: 모든 질문 영속 채널에 두 필드 추가**

`src/db/schema/question-persisted-fields.ts`에서 legacy 필드 다음에 두 필드를 등재한다.

```ts
'mobileOriginalTable',
'mobileTableDisplayMode',
'mobileDrilldownOmitLeadingColumns',
```

`src/features/survey-builder/domain/question.ts`의 create/update 양쪽에 default 없는 입력을 추가한다.

```ts
mobileTableDisplayMode: z.enum(MOBILE_TABLE_DISPLAY_MODES).optional(),
mobileDrilldownOmitLeadingColumns: z.number().int().min(0).optional(),
```

다음 네 explicit write 객체에는 동일한 값을 추가한다.

```ts
mobileTableDisplayMode: question.mobileTableDisplayMode,
mobileDrilldownOmitLeadingColumns: question.mobileDrilldownOmitLeadingColumns,
```

- `questions.service.ts`의 `createQuestion`에서는 `question` 대신 `data`를 사용한다.
- `survey-save.service.ts`의 full save와 diff save values 두 곳에 추가한다.
- 두 `onConflictDoUpdate.set`에는 각각 다음 SQL mapping을 추가한다.

```ts
mobileTableDisplayMode: sql`excluded.mobile_table_display_mode`,
mobileDrilldownOmitLeadingColumns: sql`excluded.mobile_drilldown_omit_leading_columns`,
```

- `surveys.service.ts`의 duplicate mapping에도 추가한다.
- `question-edit-modal.tsx`의 create payload에도 다음 두 필드를 추가한다. store 최신값 병합은 Task 3에서
  연결하지만, 이 단계에서 `CompleteQuestionWrite`의 키 집합을 먼저 충족한다.

```ts
mobileTableDisplayMode:
  currentFormData.mobileTableDisplayMode ?? question?.mobileTableDisplayMode,
mobileDrilldownOmitLeadingColumns:
  currentFormData.mobileDrilldownOmitLeadingColumns
  ?? question?.mobileDrilldownOmitLeadingColumns,
```

- `src/data/surveys.ts`에는 null이 아닐 때만 flat 질문으로 복사한다.

```ts
...(q.mobileTableDisplayMode != null
  ? { mobileTableDisplayMode: q.mobileTableDisplayMode }
  : {}),
...(q.mobileDrilldownOmitLeadingColumns != null
  ? { mobileDrilldownOmitLeadingColumns: q.mobileDrilldownOmitLeadingColumns }
  : {}),
```

- [ ] **Step 5: schema-types와 배포 스냅샷에 필드 추가**

`src/db/schema/schema-types.ts` 상단과 `src/lib/versioning/snapshot-builder.ts` import에 타입을 추가한다.

```ts
import type { MobileTableDisplayMode } from '@/types/mobile-table-display';
```

두 파일의 `QuestionData`와 `SnapshotQuestion`에 다음 타입을 추가한다.

```ts
mobileTableDisplayMode?: MobileTableDisplayMode;
mobileDrilldownOmitLeadingColumns?: number;
```

snapshot mapping에는 키를 그대로 복사한다. default를 주입하지 않는다.

```ts
mobileTableDisplayMode: q.mobileTableDisplayMode,
mobileDrilldownOmitLeadingColumns: q.mobileDrilldownOmitLeadingColumns,
```

- [ ] **Step 6: 영속·migration 검증 후 커밋**

Run:

```bash
pnpm exec vitest run tests/unit/domains/versioning/snapshot-builder.test.ts tests/unit/ci/migration-journal-gate.test.ts
pnpm exec tsx .github/migration-journal-gate.ts supabase/migrations
pnpm exec tsc --noEmit
```

Expected: 모든 명령 성공, migration gate가 `OK` 출력, TypeScript 오류 0개.

로컬 Supabase가 54322에서 실행 중인 경우에만 추가 실행한다.

```bash
pnpm test:integration -- tests/integration/survey-builder-roundtrip.realdb.test.ts
```

Expected: create/duplicate roundtrip에서 두 필드가 동일하게 복원되어 PASS.

```bash
git add src/db/schema/surveys.ts src/db/schema/schema-types.ts src/db/schema/question-persisted-fields.ts src/features/survey-builder/domain/question.ts src/features/survey-builder/server/services/questions.service.ts src/features/survey-builder/server/services/survey-save.service.ts src/features/survey-builder/server/services/surveys.service.ts src/components/survey-builder/question-edit-modal.tsx src/data/surveys.ts src/lib/versioning/snapshot-builder.ts tests/unit/domains/versioning/snapshot-builder.test.ts tests/integration/survey-builder-roundtrip.realdb.test.ts
git add -f supabase/migrations/0056_add_mobile_table_display_mode.sql supabase/migrations/manual-migrations.json
git commit -m "feat: 모바일 테이블 표시 설정 영속화"
```

---

### Task 3: 빌더 표시 모드 선택과 숫자 입력

**Files:**
- Create: `src/components/survey-builder/mobile-table-display-settings.tsx`
- Create: `tests/unit/survey/mobile-table-display-settings.test.tsx`
- Modify: `src/components/survey-builder/dynamic-table-editor.tsx:1-75, 425-470`
- Modify: `src/components/survey-builder/question-edit-modal.tsx:260-295, 380-395`

**Interfaces:**
- Consumes: Task 1의 `MobileTableDisplayMode`, clamp 함수.
- Produces: `MobileTableDisplaySettings` controlled UI.
- Produces: 모달 저장 직전 최신 store 값 병합.

- [ ] **Step 1: UI 동작 실패 테스트 작성**

```tsx
// tests/unit/survey/mobile-table-display-settings.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MobileTableDisplaySettings } from '@/components/survey-builder/mobile-table-display-settings';

describe('MobileTableDisplaySettings', () => {
  it('새 모드에서만 제외 열 수 입력을 보여준다', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <MobileTableDisplaySettings mode="auto" omitLeadingColumns={1} columnCount={11} onChange={onChange} />,
    );
    expect(screen.queryByLabelText('상세에서 제외할 앞쪽 열 수')).toBeNull();
    rerender(
      <MobileTableDisplaySettings mode="drilldown-original-row" omitLeadingColumns={1} columnCount={11} onChange={onChange} />,
    );
    expect(screen.getByLabelText('상세에서 제외할 앞쪽 열 수')).toHaveAttribute('max', '10');
  });

  it('모드와 clamp된 숫자를 부모로 전달한다', () => {
    const onChange = vi.fn();
    render(
      <MobileTableDisplaySettings mode="auto" omitLeadingColumns={1} columnCount={3} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '드릴다운 후 선택 행 원본' }));
    expect(onChange).toHaveBeenCalledWith({ mode: 'drilldown-original-row', omitLeadingColumns: 1 });
  });
});
```

- [ ] **Step 2: 새 컴포넌트 부재로 테스트가 실패하는지 확인**

Run:

```bash
pnpm exec vitest run tests/unit/survey/mobile-table-display-settings.test.tsx
```

Expected: 모듈을 찾지 못해 FAIL.

- [ ] **Step 3: controlled 설정 컴포넌트 구현**

```tsx
// src/components/survey-builder/mobile-table-display-settings.tsx
'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { MobileTableDisplayMode } from '@/types/mobile-table-display';
import { clampMobileDrilldownOmitLeadingColumns } from '@/utils/mobile-table-display-mode';

interface Props {
  mode: MobileTableDisplayMode;
  omitLeadingColumns: number;
  columnCount: number;
  onChange: (value: { mode: MobileTableDisplayMode; omitLeadingColumns: number }) => void;
}

const OPTIONS: Array<{ value: MobileTableDisplayMode; label: string; description: string }> = [
  { value: 'auto', label: '자동 카드', description: '표 구조에 따라 카드 또는 드릴다운으로 표시합니다.' },
  { value: 'drilldown-original-row', label: '드릴다운 후 선택 행 원본', description: '항목을 고른 뒤 선택한 행만 원본 열 배치로 표시합니다.' },
  { value: 'original', label: '전체 원본 표', description: '모바일에서도 표 전체를 가로 스크롤로 표시합니다.' },
];

export function MobileTableDisplaySettings({ mode, omitLeadingColumns, columnCount, onChange }: Props) {
  const normalizedCount = clampMobileDrilldownOmitLeadingColumns(omitLeadingColumns, columnCount);
  return (
    <div className="space-y-3 rounded-lg border border-gray-200 p-4">
      <div>
        <Label className="text-sm font-medium">모바일 표시 방식</Label>
        <p className="text-xs text-gray-500">원본 배치가 중요한 척도형 표의 모바일 탐색 방식을 선택합니다.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={mode === option.value}
            onClick={() => onChange({ mode: option.value, omitLeadingColumns: normalizedCount })}
            className={cn(
              'rounded-lg border p-3 text-left',
              mode === option.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white',
            )}
          >
            <span className="block text-sm font-semibold text-gray-900">{option.label}</span>
            <span className="mt-1 block text-xs text-gray-500">{option.description}</span>
          </button>
        ))}
      </div>
      {mode === 'drilldown-original-row' && (
        <div className="max-w-xs space-y-1.5">
          <Label htmlFor="mobile-drilldown-omit-leading">상세에서 제외할 앞쪽 열 수</Label>
          <Input
            id="mobile-drilldown-omit-leading"
            type="number"
            min={0}
            max={Math.max(0, columnCount - 1)}
            value={normalizedCount}
            onChange={(event) => onChange({
              mode,
              omitLeadingColumns: clampMobileDrilldownOmitLeadingColumns(Number(event.target.value), columnCount),
            })}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: DynamicTableEditor의 legacy 토글을 새 UI로 교체**

store selector는 키 부재를 resolver로 읽고 두 값을 함께 저장한다.

```tsx
const mobileTableQuestion = useSurveyBuilderStore(
  (state) => state.currentSurvey.questions.find((q) => q.id === editingQuestionId),
);
const mobileTableDisplayMode = resolveMobileTableDisplayMode(mobileTableQuestion ?? {});
const mobileDrilldownOmitLeadingColumns = clampMobileDrilldownOmitLeadingColumns(
  mobileTableQuestion?.mobileDrilldownOmitLeadingColumns,
  currentColumns.length,
);

{mobileTableQuestion
  && (mobileTableQuestion.type === 'table'
    || mobileTableQuestion.type === 'radio'
    || mobileTableQuestion.type === 'checkbox')
  && (
    <MobileTableDisplaySettings
      mode={mobileTableDisplayMode}
      omitLeadingColumns={mobileDrilldownOmitLeadingColumns}
      columnCount={currentColumns.length}
      onChange={({ mode, omitLeadingColumns }) => {
        if (!editingQuestionId) return;
        silentUpdateQuestion(editingQuestionId, {
          mobileTableDisplayMode: mode,
          mobileDrilldownOmitLeadingColumns: omitLeadingColumns,
        });
      }}
    />
  )}
```

따라서 같은 `DynamicTableEditor`를 사용하는 ranking에서는 설정 블록이 렌더되지 않는다.

`question-edit-modal.tsx`의 store merge와 create payload에서 legacy boolean 대신 새 정본 필드를 추가한다. legacy 필드는 기존 질문을 다시 저장해도 읽기 호환을 위해 그대로 둘 수 있지만 UI가 쓰지 않는다.

```ts
...(storeQuestion?.mobileTableDisplayMode !== undefined
  ? { mobileTableDisplayMode: storeQuestion.mobileTableDisplayMode }
  : {}),
...(storeQuestion?.mobileDrilldownOmitLeadingColumns !== undefined
  ? { mobileDrilldownOmitLeadingColumns: storeQuestion.mobileDrilldownOmitLeadingColumns }
  : {}),
```

```ts
mobileTableDisplayMode:
  currentFormData.mobileTableDisplayMode ?? question?.mobileTableDisplayMode,
mobileDrilldownOmitLeadingColumns:
  currentFormData.mobileDrilldownOmitLeadingColumns
  ?? question?.mobileDrilldownOmitLeadingColumns,
```

- [ ] **Step 5: UI 테스트와 타입 검사 후 커밋**

Run:

```bash
pnpm exec vitest run tests/unit/survey/mobile-table-display-settings.test.tsx
pnpm exec tsc --noEmit
```

Expected: 테스트 PASS, TypeScript 오류 0개.

```bash
git add src/components/survey-builder/mobile-table-display-settings.tsx src/components/survey-builder/dynamic-table-editor.tsx src/components/survey-builder/question-edit-modal.tsx tests/unit/survey/mobile-table-display-settings.test.tsx
git commit -m "feat: 모바일 테이블 표시 설정 UI 추가"
```

---

### Task 4: 분류·완료·원본 행 투영 순수 로직

**Files:**
- Create: `src/utils/mobile-original-row.ts`
- Create: `src/utils/table-radio-groups.ts`
- Create: `tests/unit/utils/mobile-original-row.test.ts`
- Create: `tests/unit/utils/table-radio-groups.test.ts`
- Modify: `src/utils/classify-table.ts:10-60, 120-220`
- Modify: `src/utils/table-row-completion.ts:1-80`
- Modify: `src/utils/table-merge-helpers.ts:291-430`
- Modify: `tests/unit/classify-table.test.ts`
- Modify: `tests/unit/utils/table-row-completion.test.ts`
- Modify: `tests/unit/utils/table-merge-colspan.test.ts`

**Interfaces:**
- Produces: `classifyTable(input)`의 `answerableCellTypes?` adapter seam.
- Produces: `projectMobileOriginalRow(input): MobileOriginalRowProjection | null`.
- Produces: `getMobileOriginalRowLabel(input): string`.
- Produces: `buildRadioGroupBuckets(row)`, `resolveRadioGroupProps(cell, rowId, buckets)`.

- [ ] **Step 1: choice 분류와 투영 실패 테스트 작성**

`tests/unit/classify-table.test.ts`에 다음 테스트를 추가한다.

```ts
it('choice_opt를 주입한 경우 기존 rowspan section과 원본 행 leaf를 만든다', () => {
  const input: ClassifyInput = {
    tableColumns: [C('대분류'), C('항목'), C('선택')],
    tableRowsData: [
      { id: 'r1', label: '', cells: [T('유저 지표', { rs: 2 }), T('활성 사용자'), { id: 'o1', type: 'choice_opt', content: '' }] },
      { id: 'r2', label: '', cells: [H(), T('재방문율'), { id: 'o2', type: 'choice_opt', content: '' }] },
    ],
    answerableCellTypes: ['choice_opt'],
  };
  const sections = classifyTable(input);
  expect(sections).toHaveLength(1);
  expect(sections[0]?.label).toBe('유저 지표');
  expect(sections[0]?.leaves.map((leaf) => leaf.rowId)).toEqual(['r1', 'r2']);
});
```

`tests/unit/utils/mobile-original-row.test.ts`에는 다음 핵심 fixture를 작성한다.

```ts
import type { HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';

const col = (id: string): TableColumn => ({ id, label: id });
const header = (id: string, colspan = 1, rowspan = 1): HeaderCell => ({
  id,
  label: id,
  colspan,
  rowspan,
});
const text = (id: string, content = id, rowspan?: number): TableCell => ({
  id,
  type: 'text',
  content,
  ...(rowspan ? { rowspan } : {}),
});
const radio = (id: string): TableCell => ({
  id,
  type: 'radio',
  content: '',
  radioOptions: [{ id: `${id}-1`, label: '1점', value: '1' }],
});
const row = (id: string, cells: TableCell[]): TableRow => ({ id, label: id, cells });

it('작성 열 2개를 제외하고 조건으로 숨은 열 때문에 다음 가시 열을 더 제외하지 않는다', () => {
  const projection = projectMobileOriginalRow({
    authoredColumns: [col('c0'), col('c1'), col('c2'), col('c3')],
    visibleColumns: [col('c0'), col('c2'), col('c3')],
    visibleHeaderGrid: [[header('항목', 1), header('척도', 2)]],
    displayRows: [row('r1', [text('a'), radio('v2'), radio('v3')])],
    selectedRowId: 'r1',
    omitLeadingAuthoredColumns: 2,
  });
  expect(projection?.columns.map((column) => column.id)).toEqual(['c2', 'c3']);
  expect(projection?.row.cells.map((cell) => cell.id)).toEqual(['v2', 'v3']);
});

it('본문 rowspan은 1로 만들고 다단 헤더 rowspan은 유지한다', () => {
  const columns = [col('c0'), col('c1'), col('c2')];
  const projection = projectMobileOriginalRow({
    authoredColumns: columns,
    visibleColumns: columns,
    visibleHeaderGrid: [
      [header('h0'), header('h1', 1, 2), header('h2')],
      [header('h3')],
    ],
    displayRows: [row('r1', [text('label'), { ...radio('v1'), rowspan: 2 }, radio('v2')])],
    selectedRowId: 'r1',
    omitLeadingAuthoredColumns: 1,
  });
  expect(projection?.row.cells.every((cell) => (cell.rowspan ?? 1) === 1)).toBe(true);
  expect(projection?.headerGrid?.[0]?.[0]?.rowspan).toBe(2);
});

it('interactive가 없으면 fallback 신호를 반환한다', () => {
  expect(projectMobileOriginalRow({
    authoredColumns: [col('c0'), col('c1')],
    visibleColumns: [col('c0'), col('c1')],
    displayRows: [row('r1', [text('label'), text('description')])],
    selectedRowId: 'r1',
    omitLeadingAuthoredColumns: 1,
  })?.hasInteractiveCells).toBe(false);
});
```

- [ ] **Step 2: 새 옵션과 유틸 부재로 테스트가 실패하는지 확인**

Run:

```bash
pnpm exec vitest run tests/unit/classify-table.test.ts tests/unit/utils/mobile-original-row.test.ts
```

Expected: `answerableCellTypes` 타입 오류와 새 모듈 부재로 FAIL.

- [ ] **Step 3: classifyTable에 answerable 타입 seam 추가**

```ts
export const DEFAULT_TABLE_ANSWERABLE_CELL_TYPES = [
  'input', 'radio', 'checkbox', 'select', 'ranking',
] as const satisfies readonly TableCell['type'][];

export interface ClassifyInput {
  tableColumns: TableColumn[];
  tableRowsData: TableRow[];
  tableHeaderGrid?: HeaderCell[][] | null | undefined;
  answerableCellTypes?: readonly TableCell['type'][] | undefined;
}

function answerableTypes(q: ClassifyInput): ReadonlySet<TableCell['type']> {
  return new Set(q.answerableCellTypes ?? DEFAULT_TABLE_ANSWERABLE_CELL_TYPES);
}

function isInput(cell: TableCell | undefined, types: ReadonlySet<TableCell['type']>) {
  return !!cell && !cell.isHidden && !cell._isContinuation && types.has(cell.type);
}
```

`valueColumns`와 `classifyTable` 내부는 다음처럼 같은 `types` 집합만 사용한다.

```ts
function valueColumns(q: ClassifyInput, types = answerableTypes(q)): number[] {
  const isValue = new Array(q.tableColumns.length).fill(false);
  for (const row of q.tableRowsData) {
    row.cells.forEach((cell, columnIndex) => {
      if (isInput(cell, types)) isValue[columnIndex] = true;
    });
  }
  return isValue.flatMap((value, columnIndex) => (value ? [columnIndex] : []));
}

const types = answerableTypes(q);
const cols = q.tableColumns;
const rows = q.tableRowsData;
const vcols = valueColumns(q, types);
```

section callback 안의 네 입력 판정 표현은 다음 코드로 정확히 교체한다.

```ts
const usedPerRow = sec.rows.map((row) =>
  vcols.filter((column) => isInput(row.cells[column], types)),
);
const inputRows = sec.rows.filter((row) =>
  row.cells.some((cell) => isInput(cell, types)),
);

row.cells.forEach((cell, columnIndex) => {
  if (isInput(cell, types)) cellByCol[columnIndex] = cell.id;
});

inputCellIds: row.cells
  .filter((cell) => isInput(cell, types))
  .map((cell) => cell.id),
```

kind·label·colGroups 계산은 변경하지 않는다. 옵션이 없을 때 기존 테스트 결과가 한 글자도 바뀌지
않아야 한다.

- [ ] **Step 4: 원본 행 투영과 행 제목 구현**

먼저 `tests/unit/utils/table-merge-colspan.test.ts`에 단일 행 헤더 병합 회귀를 추가한다.

```ts
it('가시 병합 시작 열이 남으면 isHeaderHidden continuation을 보존한다', () => {
  const columns = [
    col('A', { colspan: 3 }),
    col('B', { isHeaderHidden: true }),
    col('C', { isHeaderHidden: true }),
  ];
  const result = recalculateColspansForVisibleColumns(
    columns,
    [{ id: 'r1', label: '', cells: [cell('a'), cell('b'), cell('c')] }],
    new Set(['A', 'C']),
  );
  expect(result.columns[0]?.colspan).toBe(2);
  expect(result.columns[1]?.isHeaderHidden).toBe(true);
});

it('병합 시작 열이 빠지면 첫 가시 continuation 헤더를 승격한다', () => {
  const columns = [
    col('A', { colspan: 3 }),
    col('B', { isHeaderHidden: true }),
    col('C', { isHeaderHidden: true }),
  ];
  const result = recalculateColspansForVisibleColumns(
    columns,
    [{ id: 'r1', label: '', cells: [cell('a'), cell('b'), cell('c')] }],
    new Set(['B', 'C']),
  );
  expect(result.columns[0]?.isHeaderHidden).toBe(false);
});
```

`recalculateColspansForVisibleColumns`에서 모든 필터 열에 `isHeaderHidden=false`를 강제하는 코드를
다음 점유 집합 계산으로 교체한다.

```ts
const coveredHeaderIndices = new Set<number>();
for (let index = 0; index < originalColumns.length; index += 1) {
  if (!visibleColIndices.has(index)) continue;
  const start = originalColumns[index];
  if (!start || start.isHeaderHidden || (start.colspan ?? 1) <= 1) continue;
  const coveredVisible = Array.from(
    { length: start.colspan ?? 1 },
    (_, offset) => index + offset,
  ).filter((covered) => visibleColIndices.has(covered));
  coveredVisible.slice(1).forEach((covered) => coveredHeaderIndices.add(covered));
}

// filteredColumns push 직전
col.isHeaderHidden = coveredHeaderIndices.has(i);
```

그 다음 원본 행 투영 유틸을 작성한다.

```ts
// src/utils/mobile-original-row.ts
import type { HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';
import { clampMobileDrilldownOmitLeadingColumns } from '@/utils/mobile-table-display-mode';
import { recalculateColspansForVisibleColumns } from '@/utils/table-merge-helpers';

export const MOBILE_ORIGINAL_ROW_INTERACTIVE_TYPES = [
  'checkbox', 'radio', 'select', 'input', 'ranking', 'choice_opt',
] as const satisfies readonly TableCell['type'][];

const INTERACTIVE = new Set<TableCell['type']>(MOBILE_ORIGINAL_ROW_INTERACTIVE_TYPES);

export function isMobileOriginalRowInteractiveCell(cell: TableCell): boolean {
  return !cell.isHidden && !cell._isContinuation && INTERACTIVE.has(cell.type);
}

export interface ProjectMobileOriginalRowInput {
  authoredColumns: TableColumn[];
  visibleColumns: TableColumn[];
  visibleHeaderGrid?: HeaderCell[][] | undefined;
  displayRows: TableRow[];
  selectedRowId: string;
  omitLeadingAuthoredColumns: number;
}

export interface MobileOriginalRowProjection {
  columns: TableColumn[];
  row: TableRow;
  headerGrid?: HeaderCell[][] | undefined;
  hasInteractiveCells: boolean;
}

export function projectMobileOriginalRow(
  input: ProjectMobileOriginalRowInput,
): MobileOriginalRowProjection | null {
  const omit = clampMobileDrilldownOmitLeadingColumns(
    input.omitLeadingAuthoredColumns,
    input.authoredColumns.length,
  );
  const omittedIds = new Set(input.authoredColumns.slice(0, omit).map((column) => column.id));
  const keptVisibleIds = new Set(
    input.visibleColumns.filter((column) => !omittedIds.has(column.id)).map((column) => column.id),
  );
  const projected = recalculateColspansForVisibleColumns(
    input.visibleColumns,
    input.displayRows,
    keptVisibleIds,
    input.visibleHeaderGrid,
  );
  const selected = projected.rows.find((row) => row.id === input.selectedRowId);
  if (!selected) return null;
  const row: TableRow = {
    ...selected,
    cells: selected.cells.map((cell) => {
      const normalized = { ...cell };
      delete normalized.rowspan;
      return normalized;
    }),
  };
  return {
    columns: projected.columns,
    row,
    ...(projected.headerGrid ? { headerGrid: projected.headerGrid } : {}),
    hasInteractiveCells: row.cells.some(isMobileOriginalRowInteractiveCell),
  };
}
```

같은 파일에 설명 테이블 카드 제목 resolver를 추가한다.

```ts
export function getMobileOriginalRowLabel({
  authoredColumns,
  row,
  omitLeadingAuthoredColumns,
  resolveChoiceLabel,
}: {
  authoredColumns: TableColumn[];
  row: TableRow;
  omitLeadingAuthoredColumns: number;
  resolveChoiceLabel: (cellId: string) => string | undefined;
}): string {
  const omit = clampMobileDrilldownOmitLeadingColumns(
    omitLeadingAuthoredColumns,
    authoredColumns.length,
  );
  const omittedCells = row.cells.slice(0, omit);
  for (let index = omit - 1; index >= 0; index -= 1) {
    const cell = row.cells[index];
    if (
      cell?.type === 'text'
      && !cell.isHidden
      && !cell._isContinuation
      && cell.mobileDisplay !== 'hidden'
      && cell.content.trim()
    ) {
      return cell.content.trim();
    }
  }
  const explicitlyHiddenLabels = omittedCells
    .filter((cell) => cell.type === 'text' && cell.mobileDisplay === 'hidden')
    .map((cell) => cell.content.trim());
  if (row.label.trim() && !explicitlyHiddenLabels.includes(row.label.trim())) {
    return row.label.trim();
  }
  const choice = row.cells.find(
    (cell) => cell.type === 'choice_opt' && !cell.isHidden && !cell._isContinuation,
  );
  return (choice && resolveChoiceLabel(choice.id)) || '(라벨 없음)';
}
```

테스트에는 omitted text가 `mobileDisplay='hidden'`이고 `row.label`이 같은 값일 때 해당 문자열이 아닌
첫 `choice_opt` resolved label로 떨어지는 케이스를 추가한다.

- [ ] **Step 5: 행 완료 함수의 기본 동작을 보존하면서 새 모드 타입 집합 지원**

`isTableRowCompleted`에 세 번째 optional 인자를 추가한다. 기본 배열은 현재 테스트와 완전히 동일하게 유지한다.

```ts
const DEFAULT_ANSWERABLE_CELL_TYPES = ['text', 'checkbox', 'radio', 'select', 'input'] as const;

export function isTableRowCompleted(
  row: TableRow,
  response: Record<string, unknown>,
  answerableCellTypes: readonly TableCell['type'][] = DEFAULT_ANSWERABLE_CELL_TYPES,
): boolean {
  const answerable = new Set<TableCell['type']>(answerableCellTypes);
  const groupBuckets = buildRadioGroupBuckets(row);
  const groupCompleted = new Map<string, boolean>();
  for (const [name, ids] of groupBuckets) {
    groupCompleted.set(name, ids.some((id) => isCellAnswered(response[id])));
  }
  const cellGroupName = new Map<string, string>();
  for (const [name, ids] of groupBuckets) {
    for (const id of ids) cellGroupName.set(id, name);
  }

  return row.cells.every((cell) => {
    if (cell._isContinuation || cell.isHidden) return true;
    if (!answerable.has(cell.type)) return true;
    const groupName = cellGroupName.get(cell.id);
    if (groupName) return groupCompleted.get(groupName) ?? false;
    return isCellAnswered(response[cell.id]);
  });
}
```

`src/utils/mobile-original-row.ts`에는 table 완료 판정용 배열도 함께 export한다. 새 모드 호출자는 이
배열을 전달한다. 이로써 정적 text는 진행률에서 빠지고 ranking은 포함되며 auto 모드의 기존 기본
판정은 바뀌지 않는다.

```ts
export const MOBILE_TABLE_COMPLETION_TYPES = [
  'checkbox', 'radio', 'select', 'input', 'ranking',
] as const satisfies readonly TableCell['type'][];
```

테스트에 다음 두 assertion을 추가한다.

```ts
expect(isTableRowCompleted(row([cell({ id: 'label', type: 'text' }), cell({ id: 'v', type: 'input' })]), { v: '1' }, MOBILE_TABLE_COMPLETION_TYPES)).toBe(true);
expect(isTableRowCompleted(row([cell({ id: 'rank', type: 'ranking' })]), {}, MOBILE_TABLE_COMPLETION_TYPES)).toBe(false);
```

- [ ] **Step 6: radio 그룹 헬퍼를 기존 렌더러에서 추출**

```ts
// src/utils/table-radio-groups.ts
import type { TableCell, TableRow } from '@/types/survey';

export function buildRadioGroupBuckets(row: TableRow): Map<string, string[]> {
  const buckets = new Map<string, string[]>();
  for (const cell of row.cells) {
    if (cell.type !== 'radio' || cell.isHidden || cell._isContinuation || !cell.radioGroupName) continue;
    const members = buckets.get(cell.radioGroupName) ?? [];
    members.push(cell.id);
    buckets.set(cell.radioGroupName, members);
  }
  return buckets;
}

export function resolveRadioGroupProps(
  cell: TableCell,
  rowId: string,
  buckets: Map<string, string[]>,
): { groupName?: string; siblingCellIds?: string[] } {
  if (cell.type !== 'radio' || !cell.radioGroupName) return {};
  const members = buckets.get(cell.radioGroupName);
  if (!members || members.length < 2) return {};
  return {
    groupName: `${rowId}-${cell.radioGroupName}`,
    siblingCellIds: members.filter((id) => id !== cell.id),
  };
}
```

`interactive-table-response.tsx`의 로컬 bucket/props 구현과 `table-row-completion.ts`의 로컬
`buildRadioGroupBuckets`를 삭제하고 두 파일 모두 새 유틸을 import한다. 새 테스트는 두 멤버 그룹,
단일 멤버, hidden/continuation 제외를 각각 검증한다.

- [ ] **Step 7: 순수 로직 테스트와 회귀 테스트 후 커밋**

Run:

```bash
pnpm exec vitest run tests/unit/classify-table.test.ts tests/unit/utils/mobile-original-row.test.ts tests/unit/utils/table-radio-groups.test.ts tests/unit/utils/table-row-completion.test.ts tests/unit/utils/table-merge-colspan.test.ts
pnpm exec tsc --noEmit
```

Expected: 새 케이스와 기존 classify/completion characterization 모두 PASS.

```bash
git add src/utils/classify-table.ts src/utils/table-row-completion.ts src/utils/table-merge-helpers.ts src/utils/mobile-original-row.ts src/utils/table-radio-groups.ts src/components/survey-builder/interactive-table-response.tsx tests/unit/classify-table.test.ts tests/unit/utils/mobile-original-row.test.ts tests/unit/utils/table-radio-groups.test.ts tests/unit/utils/table-row-completion.test.ts tests/unit/utils/table-merge-colspan.test.ts
git commit -m "feat: 모바일 선택 행 투영 규칙 추가"
```

---

### Task 5: 기존 TablePreview 기반 한 행 원본 렌더러

**Files:**
- Create: `src/components/survey-builder/mobile-original-row-table.tsx`
- Create: `tests/unit/survey/mobile-original-row-table.test.tsx`
- Modify: `src/components/survey-builder/table-preview.tsx:35-90, 220-300`

**Interfaces:**
- Consumes: Task 4의 `MobileOriginalRowProjection`.
- Produces: `MobileOriginalRowTable`.
- Extends: `TablePreview` optional `scrollLeftRef`, `errorCellIds`, `data-cell-id`.

- [ ] **Step 1: hidden·header·scrollLeft 실패 테스트 작성**

```tsx
// tests/unit/survey/mobile-original-row-table.test.tsx
import type { MutableRefObject } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InteractiveCell } from '@/components/survey-builder/cells';
import { MobileOriginalRowTable } from '@/components/survey-builder/mobile-original-row-table';
import type { TableCell, TableColumn, TableRow } from '@/types/survey';

const col = (label: string): TableColumn => ({ id: label, label, width: 120 });
const row = (cells: TableCell[], id = 'r1'): TableRow => ({ id, label: id, cells });
const inputCell: TableCell = { id: 'input', type: 'input', content: '', placeholder: '점수' };

function renderOriginalRow({ hideColumnLabels = false } = {}) {
  return render(
    <MobileOriginalRowTable
      columns={[col('항목'), col('점수')]}
      row={row([{ id: 'label', type: 'text', content: '직무' }, inputCell])}
      headerGrid={[[{ id: 'h', label: '묶음 헤더', colspan: 2, rowspan: 1 }]]}
      hideColumnLabels={hideColumnLabels}
      renderCell={(cell) => (
        <InteractiveCell cell={cell} questionId="q1" isTestMode value={{}} onChange={vi.fn()} />
      )}
    />,
  );
}

it('정적 hidden 콘텐츠는 숨기고 interactive hidden 입력은 유지한다', () => {
  render(
    <MobileOriginalRowTable
      columns={[col('정적'), col('입력')]}
      row={row([
        { id: 'label', type: 'text', content: '숨길 내용', mobileDisplay: 'hidden' },
        { id: 'input', type: 'input', content: '숨길 라벨', placeholder: '점수', mobileDisplay: 'hidden' },
      ])}
      hideColumnLabels={false}
      renderCell={(cell) => <InteractiveCell cell={cell} questionId="q1" isTestMode value={{}} onChange={() => {}} />}
    />,
  );
  expect(screen.queryByText('숨길 내용')).toBeNull();
  expect(screen.queryByText('숨길 라벨')).toBeNull();
  expect(screen.getByPlaceholderText('점수')).toBeInTheDocument();
});

it('hideColumnLabels이면 다단 헤더 전체를 렌더하지 않는다', () => {
  renderOriginalRow({ hideColumnLabels: true });
  expect(screen.queryByRole('columnheader')).toBeNull();
});

it('_isContinuation 셀은 grid cell과 입력을 모두 렌더하지 않는다', () => {
  render(
    <MobileOriginalRowTable
      columns={[col('점수')]}
      row={row([{ ...inputCell, _isContinuation: true }])}
      hideColumnLabels={false}
      renderCell={(cell) => (
        <InteractiveCell cell={cell} questionId="q1" isTestMode value={{}} onChange={vi.fn()} />
      )}
    />,
  );
  expect(screen.queryByPlaceholderText('점수')).toBeNull();
  expect(screen.queryByTestId('cell-input')).toBeNull();
});

it('행이 바뀌어도 scrollLeft를 복원하고 reset key에서 0으로 초기화한다', () => {
  const scrollLeftRef: MutableRefObject<number> = { current: 120 };
  const renderCell = (cell: TableCell) => (
    <InteractiveCell cell={cell} questionId="q1" isTestMode value={{}} onChange={vi.fn()} />
  );
  const { rerender } = render(
    <MobileOriginalRowTable
      columns={[col('점수')]}
      row={row([inputCell])}
      hideColumnLabels={false}
      scrollLeftRef={scrollLeftRef}
      renderCell={renderCell}
    />,
  );
  const scroller = screen.getByTestId('table-preview-scroll');
  Object.defineProperty(scroller, 'scrollWidth', { configurable: true, value: 500 });
  Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 200 });
  rerender(
    <MobileOriginalRowTable
      columns={[col('점수')]}
      row={row([{ ...inputCell, id: 'input-2' }], 'r2')}
      hideColumnLabels={false}
      scrollLeftRef={scrollLeftRef}
      renderCell={renderCell}
    />,
  );
  expect(scroller.scrollLeft).toBe(120);
  scroller.scrollLeft = 80;
  fireEvent.scroll(scroller);
  expect(scrollLeftRef.current).toBe(80);
  rerender(
    <MobileOriginalRowTable
      columns={[col('점수')]}
      row={row([{ ...inputCell, id: 'input-2' }], 'r2')}
      hideColumnLabels={false}
      scrollLeftRef={scrollLeftRef}
      resetScrollKey="toc"
      renderCell={renderCell}
    />,
  );
  expect(scrollLeftRef.current).toBe(0);
  expect(scroller.scrollLeft).toBe(0);
});
```

- [ ] **Step 2: 새 컴포넌트 부재로 테스트가 실패하는지 확인**

Run:

```bash
pnpm exec vitest run tests/unit/survey/mobile-original-row-table.test.tsx
```

Expected: 새 모듈 부재로 FAIL.

- [ ] **Step 3: TablePreview에 외부 스크롤 상태와 오류 셀 seam 추가**

```ts
scrollLeftRef?: React.MutableRefObject<number> | undefined;
resetScrollKey?: string | number | undefined;
errorCellIds?: Set<string> | undefined;
```

body scroll div에 다음 복원·저장 로직을 연결한다.

```ts
useLayoutEffect(() => {
  const element = tableContainerRef.current;
  if (!element || !scrollLeftRef) return;
  element.scrollLeft = Math.min(
    scrollLeftRef.current,
    Math.max(0, element.scrollWidth - element.clientWidth),
  );
}, [columns, rows, scrollLeftRef]);

useEffect(() => {
  if (resetScrollKey === undefined || !scrollLeftRef) return;
  scrollLeftRef.current = 0;
  if (tableContainerRef.current) tableContainerRef.current.scrollLeft = 0;
}, [resetScrollKey, scrollLeftRef]);
```

```tsx
<div
  ref={tableContainerRef}
  data-testid="table-preview-scroll"
  onScroll={(event) => {
    if (scrollLeftRef) scrollLeftRef.current = event.currentTarget.scrollLeft;
  }}
>
```

body cell map의 첫 guard를 `if (cell.isHidden || cell._isContinuation) return null`로 바꾼다. 각 body
cell에는 `data-testid={\`cell-${cell.id}\`}`, `data-cell-id={cell.id}`와
`errorCellIds?.has(cell.id) && 'ring-2 ring-inset ring-red-300'`를 추가한다.

- [ ] **Step 4: MobileOriginalRowTable을 얇은 wrapper로 구현**

```tsx
// src/components/survey-builder/mobile-original-row-table.tsx
'use client';

import type React from 'react';

import { TablePreview } from '@/components/survey-builder/table-preview';
import type { HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';
import { isMobileOriginalRowInteractiveCell } from '@/utils/mobile-original-row';

interface Props {
  columns: TableColumn[];
  row: TableRow;
  headerGrid?: HeaderCell[][] | undefined;
  hideColumnLabels: boolean;
  renderCell: (cell: TableCell) => React.ReactNode;
  scrollLeftRef?: React.MutableRefObject<number> | undefined;
  resetScrollKey?: string | number | undefined;
  errorCellIds?: Set<string> | undefined;
}

export function MobileOriginalRowTable({
  columns,
  row,
  headerGrid,
  hideColumnLabels,
  renderCell,
  scrollLeftRef,
  resetScrollKey,
  errorCellIds,
}: Props) {
  return (
    <TablePreview
      columns={columns}
      rows={[row]}
      tableHeaderGrid={headerGrid}
      hideColumnLabels={hideColumnLabels}
      className="border-0 shadow-none"
      scrollLeftRef={scrollLeftRef}
      resetScrollKey={resetScrollKey}
      errorCellIds={errorCellIds}
      renderCell={(cell) => {
        if (cell.mobileDisplay !== 'hidden') return renderCell(cell);
        if (!isMobileOriginalRowInteractiveCell(cell)) {
          return <span aria-hidden="true" />;
        }
        return renderCell({ ...cell, content: '' });
      }}
    />
  );
}
```

- [ ] **Step 5: renderer 테스트와 기존 TablePreview 회귀 후 커밋**

Run:

```bash
pnpm exec vitest run tests/unit/survey/mobile-original-row-table.test.tsx tests/integration/choice-table-response-label.test.tsx tests/unit/survey/preview-cell-choice.test.tsx
pnpm exec tsc --noEmit
```

Expected: 신규·기존 TablePreview 테스트 PASS, TypeScript 오류 0개.

```bash
git add src/components/survey-builder/table-preview.tsx src/components/survey-builder/mobile-original-row-table.tsx tests/unit/survey/mobile-original-row-table.test.tsx
git commit -m "feat: 모바일 원본 행 렌더러 추가"
```

---

### Task 6: 공통 드릴다운 탐색 껍데기 추출

**Files:**
- Create: `src/components/survey-builder/mobile-drilldown-shell.tsx`
- Modify: `src/components/survey-builder/mobile-table-drilldown.tsx:1-430`
- Create: `tests/unit/survey/mobile-table-drilldown-original-row.test.tsx`

**Interfaces:**
- Produces: `MobileDrilldownShell` controlled adapter surface.
- Preserves: auto 모드의 acknowledged cell-count 진행률과 scalar/list inline 렌더.
- Adds: `leafNavigation='always'`인 새 모드의 모든 leaf 카드 → 상세 이동.

- [ ] **Step 1: 기존 탐색과 새 leaf-navigation 계약 테스트 작성**

`tests/unit/survey/mobile-table-drilldown-original-row.test.tsx`에서 shell을 직접 렌더한다.

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import { MobileDrilldownShell } from '@/components/survey-builder/mobile-drilldown-shell';
import type { ClassifiedLeaf, ClassifiedSection } from '@/utils/classify-table';

const leaf = (rowId: string, label: string): ClassifiedLeaf => ({
  rowId,
  label,
  subGroup: '',
  inputCellIds: [`${rowId}-value`],
  cellByCol: { 1: `${rowId}-value` },
});

const section = (leaves: ClassifiedLeaf[]): ClassifiedSection => ({
  label: leaves.length === 1 ? '항목' : '척도',
  kind: 'matrix',
  reason: '테스트',
  leaves,
  colGroups: [{ label: '점수', cols: [{ col: 1, label: '1점' }] }],
  totalInputs: leaves.length,
});

const singleLeafSections = () => [section([leaf('r1', '첫 항목')])];
const twoLeafMatrix = () => [section([leaf('r1', '첫 항목'), leaf('r2', '둘째 항목')])];

function renderShell({
  sections = twoLeafMatrix(),
  leafNavigation = 'always',
  onReturnToRoot = vi.fn(),
}: {
  sections?: ClassifiedSection[];
  leafNavigation?: 'matrix-only' | 'always';
  onReturnToRoot?: () => void;
} = {}) {
  return render(
    <MobileDrilldownShell
      sections={sections}
      leafNavigation={leafNavigation}
      overallStatus={{ completed: 0, total: sections.flatMap((item) => item.leaves).length, unit: '개 항목' }}
      getSectionStatus={(item) => ({ completed: 0, total: item.leaves.length, unit: '개 항목' })}
      getLeafStatus={() => ({ completed: 0, total: 1, unit: '개 항목' })}
      renderLeafDetail={(item) => (
        <div data-testid="leaf-detail">
          <span>{item.label}</span>
          <input type="radio" aria-label="1점" />
        </div>
      )}
      onReturnToRoot={onReturnToRoot}
    />,
  );
}

function enterFirstLeaf() {
  fireEvent.click(screen.getByRole('button', { name: /척도/ }));
  fireEvent.click(screen.getByRole('button', { name: /첫 항목/ }));
}

it('always 모드는 단일 leaf도 루트 카드 클릭 후 상세를 연다', () => {
  renderShell({ sections: singleLeafSections(), leafNavigation: 'always' });
  expect(screen.getByRole('button', { name: /항목/ })).toBeInTheDocument();
  expect(screen.queryByTestId('leaf-detail')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /항목/ }));
  expect(screen.getByTestId('leaf-detail')).toBeInTheDocument();
});

it('입력 후 자동 이동하지 않고 다음 항목 버튼으로만 이동한다', () => {
  renderShell({ sections: twoLeafMatrix(), leafNavigation: 'always' });
  enterFirstLeaf();
  fireEvent.click(screen.getByRole('radio', { name: '1점' }));
  expect(screen.getByText('첫 항목')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '다음 항목' }));
  expect(screen.getByText('둘째 항목')).toBeInTheDocument();
});

it('목차로 이동할 때 onReturnToRoot를 호출한다', () => {
  const onReturnToRoot = vi.fn();
  renderShell({ onReturnToRoot, sections: twoLeafMatrix() });
  enterFirstLeaf();
  fireEvent.click(screen.getByRole('button', { name: '목차로' }));
  expect(onReturnToRoot).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: shell 모듈 부재로 테스트가 실패하는지 확인**

Run:

```bash
pnpm exec vitest run tests/unit/survey/mobile-table-drilldown-original-row.test.tsx
```

Expected: 새 모듈 부재로 FAIL.

- [ ] **Step 3: 공통 shell의 adapter 인터페이스 구현**

```ts
// src/components/survey-builder/mobile-drilldown-shell.tsx
export interface DrilldownStatus {
  completed: number;
  total: number;
  unit: '칸' | '개 항목' | '개 선택';
}

interface Props {
  sections: ClassifiedSection[];
  leafNavigation: 'matrix-only' | 'always';
  overallStatus?: DrilldownStatus | undefined;
  getSectionStatus: (section: ClassifiedSection) => DrilldownStatus;
  getLeafStatus: (leaf: ClassifiedLeaf) => DrilldownStatus;
  renderLeafDetail: (leaf: ClassifiedLeaf, section: ClassifiedSection) => React.ReactNode;
  renderLegacySection?: (section: ClassifiedSection) => React.ReactNode;
  footer?: React.ReactNode;
  onLeaveLeafForward?: (leaf: ClassifiedLeaf) => void;
  onLeaveSection?: (section: ClassifiedSection) => void;
  onReturnToRoot?: () => void;
}
```

shell은 기존 `nav: { sec; leaf }`, `rootRef`, breadcrumb, root section 카드, subGroup divider, 이전/다음/다음 섹션/목차 버튼과 진행 바 JSX를 `mobile-table-drilldown.tsx`에서 그대로 이동한다. 분기 규칙은 다음 함수로 고정한다.

```ts
const requiresLeafList = (section: ClassifiedSection) =>
  leafNavigation === 'always'
    ? section.leaves.length > 1
    : section.kind === 'matrix' && section.leaves.length > 1;

const enterSection = (sectionIndex: number) => {
  const section = sections[sectionIndex];
  if (!section) return;
  if (leafNavigation === 'matrix-only' && section.kind !== 'matrix') {
    setNav({ sec: sectionIndex, leaf: null });
    return;
  }
  setNav({ sec: sectionIndex, leaf: requiresLeafList(section) ? null : 0 });
};

const goToRoot = () => {
  const current = nav.sec === null ? undefined : sections[nav.sec];
  if (current) onLeaveSection?.(current);
  setNav({ sec: null, leaf: null });
  onReturnToRoot?.();
};
```

`leafNavigation='matrix-only'`이고 scalar/list이면 `renderLegacySection(section)`을 사용한다. `always`이면 모든 종류가 leaf detail로 끝난다. status badge와 전체 progress는 주입된 숫자만 표시하며 shell이 응답값이나 acknowledged 상태를 만들지 않는다.
`overallStatus`가 없으면 전체 progress bar를 렌더하지 않고 `footer`만 렌더한다. 설명 테이블 adapter는
이 경로로 기존 min/max 선택 카운터만 표시한다.
breadcrumb나 하단 버튼이 실제 목차로 이동하는 모든 경로는 `setNav`를 직접 호출하지 않고
`goToRoot()`를 호출한다. 리프 목록으로만 돌아가는 breadcrumb는 scrollLeft를 유지하므로
`setNav({ sec: nav.sec, leaf: null })`를 사용한다.

- [ ] **Step 4: 기존 MobileTableDrilldown을 legacy adapter로 변경**

현재 `acknowledged`, `hasValue`, `leafFilled`, `secFilled`, `InteractiveCell` 렌더는 `mobile-table-drilldown.tsx`에 남긴다. 반환 JSX만 다음 adapter로 교체한다.

```tsx
<MobileDrilldownShell
  sections={sections}
  leafNavigation="matrix-only"
  overallStatus={{ completed: totalFilled, total: totalInputs, unit: '칸' }}
  getSectionStatus={(section) => ({
    completed: secFilled(section),
    total: section.totalInputs,
    unit: '칸',
  })}
  getLeafStatus={(leaf) => ({
    completed: leafFilled(leaf),
    total: leaf.inputCellIds.length,
    unit: '칸',
  })}
  renderLegacySection={renderScalarOrListSection}
  renderLeafDetail={renderMatrixLeafDetail}
  onLeaveLeafForward={(leaf) => ackCells(leaf.inputCellIds)}
  onLeaveSection={(section) => ackCells(section.leaves.flatMap((leaf) => leaf.inputCellIds))}
/>
```

기존 scalar/list와 matrix JSX는 각각 `renderScalarOrListSection`, `renderMatrixLeafDetail` 함수로 옮기고 마크업·문구·acknowledged 의미를 변경하지 않는다.

- [ ] **Step 5: 탐색 shell과 기존 모바일 drilldown 회귀 후 커밋**

Run:

```bash
pnpm exec vitest run tests/unit/survey/mobile-table-drilldown-original-row.test.tsx tests/unit/classify-table.test.ts tests/unit/survey/mobile-original-table.test.tsx
pnpm exec tsc --noEmit
```

Expected: 새 shell 계약과 기존 auto drilldown 테스트 PASS.

```bash
git add src/components/survey-builder/mobile-drilldown-shell.tsx src/components/survey-builder/mobile-table-drilldown.tsx tests/unit/survey/mobile-table-drilldown-original-row.test.tsx
git commit -m "refactor: 모바일 드릴다운 탐색 공통화"
```

---

### Task 7: table 질문의 선택 행 원본 상세 통합

**Files:**
- Modify: `src/components/survey-builder/mobile-table-drilldown.tsx`
- Modify: `src/components/survey-builder/interactive-table-response.tsx:330-370, 480-510, 660-690, 840-890`
- Modify: `src/components/survey-builder/question-test-card.tsx:490-515`
- Modify: `src/components/survey-response/question-input.tsx:160-190`
- Modify: `tests/unit/survey/mobile-table-drilldown-original-row.test.tsx`
- Modify: `tests/unit/survey/mobile-original-table.test.tsx`

**Interfaces:**
- Consumes: Tasks 1, 4, 5, 6.
- Produces: `InteractiveTableResponse`의 `mobileTableDisplayMode`, `mobileDrilldownOmitLeadingColumns` props.
- Produces: `MobileTableDrilldown`의 `detailMode='legacy' | 'original-row'`.

- [ ] **Step 1: 명시 모드·진행률·스크롤 통합 실패 테스트 작성**

`tests/unit/survey/mobile-table-drilldown-original-row.test.tsx`에 실제 `InteractiveTableResponse` 통합 케이스를 추가한다.

```tsx
const scaleColumns = (): TableColumn[] => [
  { id: 'c0', label: '항목', width: 140 },
  { id: 'c1', label: '전혀 도움 안 됨', width: 140 },
  { id: 'c2', label: '매우 도움 됨', width: 140 },
];

const scaleRows = (count: number): TableRow[] => Array.from({ length: count }, (_, index) => ({
  id: `r${index + 1}`,
  label: index === 0 ? '직무 설정' : '취업 도움',
  cells: [
    { id: `r${index + 1}-label`, type: 'text', content: index === 0 ? '직무 설정' : '취업 도움' },
    {
      id: `r${index + 1}-score-1`,
      type: 'radio',
      content: '',
      radioGroupName: `scale-${index + 1}`,
      radioOptions: [{ id: 'one', label: '1점', value: '1' }],
    },
    {
      id: `r${index + 1}-score-5`,
      type: 'radio',
      content: '',
      radioGroupName: `scale-${index + 1}`,
      radioOptions: [{ id: 'five', label: '5점', value: '5' }],
    },
  ],
}));

function ControlledScale() {
  const [value, setValue] = useState<Record<string, unknown>>({});
  return (
    <InteractiveTableResponse
      questionId="q1"
      columns={scaleColumns()}
      rows={scaleRows(2)}
      mobileTableDisplayMode="drilldown-original-row"
      mobileDrilldownOmitLeadingColumns={1}
      value={value}
      onChange={setValue}
    />
  );
}

it('임계값 이하 2행도 명시 모드면 카드부터 보여주고 선택 행 원본 헤더를 렌더한다', () => {
  render(
    <InteractiveTableResponse
      questionId="q1"
      columns={scaleColumns()}
      rows={scaleRows(2)}
      mobileTableDisplayMode="drilldown-original-row"
      mobileDrilldownOmitLeadingColumns={1}
      value={{}}
      onChange={vi.fn()}
    />,
  );
  expect(screen.getByText('직무 설정')).toBeInTheDocument();
  expect(screen.queryByText('전혀 도움 안 됨')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /직무 설정/ }));
  expect(screen.getByText('전혀 도움 안 됨')).toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: '항목' })).toBeNull();
});

it('방문만으로 완료되지 않고 radio 선택 후 완료 행 수가 1 증가한다', () => {
  render(<ControlledScale />);
  fireEvent.click(screen.getByRole('button', { name: /직무 설정/ }));
  expect(screen.getByText(/전체 0 \/ 2개 항목/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: '5점' }));
  expect(screen.getByText(/전체 1 \/ 2개 항목/)).toBeInTheDocument();
});
```

이 테스트 파일 import에 `useState`, `TableColumn`, `TableRow`, `InteractiveTableResponse`를 추가하고
`useMobileView`는 기존 테스트 mock처럼 `true`로 고정한다.

- [ ] **Step 2: 새 props가 없어 테스트가 실패하는지 확인**

Run:

```bash
pnpm exec vitest run tests/unit/survey/mobile-table-drilldown-original-row.test.tsx tests/unit/survey/mobile-original-table.test.tsx
```

Expected: 새 mode prop이 소비되지 않아 원본 행 상세를 찾지 못하고 FAIL.

- [ ] **Step 3: InteractiveTableResponse의 세 모드 분기를 정규화**

props에 새 필드를 추가하되 legacy boolean도 계속 받는다.

```ts
mobileOriginalTable?: boolean | undefined;
mobileTableDisplayMode?: MobileTableDisplayMode | undefined;
mobileDrilldownOmitLeadingColumns?: number | undefined;
```

```ts
const mobileMode = resolveMobileTableDisplayMode({
  mobileTableDisplayMode,
  mobileOriginalTable,
});
const useOriginalRowDetail = isMobileView && mobileMode === 'drilldown-original-row';
const mobileUsesCards = isMobileView && mobileMode !== 'original';
const rendersFullOriginalTable = mobileMode === 'original';
```

`interactive-table-response.tsx`의 레이아웃 class에서 legacy prop을 직접 읽는 네 곳
(`mx-0`, header `px-0`, body wrapper `mx-0`, body `px-0`)도 모두
`rendersFullOriginalTable`로 교체한다. 새 enum `original`과 legacy fallback `original`이 같은 CSS를
사용해야 한다.

렌더 분기는 명시 모드가 `useDrilldown`을 우회하도록 고정한다.

```tsx
{mobileUsesCards ? (
  useOriginalRowDetail || useDrilldown ? (
    <MobileTableDrilldown
      {...mobileTableProps}
      authoredColumns={columns}
      detailMode={useOriginalRowDetail ? 'original-row' : 'legacy'}
      omitLeadingAuthoredColumns={clampMobileDrilldownOmitLeadingColumns(
        mobileDrilldownOmitLeadingColumns,
        columns.length,
      )}
    />
  ) : (
    <MobileTableStepper {...mobileTableProps} />
  )
) : renderTableView()}
```

- [ ] **Step 4: MobileTableDrilldown에 original-row adapter 추가**

`detailMode='legacy'`는 Task 6 결과를 그대로 사용한다. `original-row`에서는 다음 상태를 주입한다.

```ts
const rowById = new Map(displayRows.map((row) => [row.id, row]));
const completedRows = displayRows.filter((row) =>
  isTableRowCompleted(row, currentResponse, MOBILE_TABLE_COMPLETION_TYPES),
).length;
const horizontalScrollRef = useRef(0);
```

```tsx
<MobileDrilldownShell
  sections={sections}
  leafNavigation="always"
  overallStatus={{ completed: completedRows, total: displayRows.length, unit: '개 항목' }}
  getSectionStatus={(section) => ({
    completed: section.leaves.filter((leaf) => {
      const row = rowById.get(leaf.rowId);
      return row ? isTableRowCompleted(row, currentResponse, MOBILE_TABLE_COMPLETION_TYPES) : false;
    }).length,
    total: section.leaves.length,
    unit: '개 항목',
  })}
  getLeafStatus={(leaf) => ({
    completed: rowById.get(leaf.rowId)
      && isTableRowCompleted(rowById.get(leaf.rowId)!, currentResponse, MOBILE_TABLE_COMPLETION_TYPES)
      ? 1 : 0,
    total: 1,
    unit: '개 항목',
  })}
  renderLeafDetail={(leaf) => renderOriginalRowDetail(leaf)}
  onReturnToRoot={() => { horizontalScrollRef.current = 0; }}
/>
```

`renderOriginalRowDetail`은 projection이 없거나 `hasInteractiveCells=false`면 현재 leaf의 입력 셀을
기존 `renderCell`로 세로 렌더하고, 정상 projection은 공통 원본 행 렌더러로 보낸다.

```tsx
const renderOriginalRowDetail = (leaf: ClassifiedLeaf) => {
  const projection = projectMobileOriginalRow({
    authoredColumns,
    visibleColumns,
    visibleHeaderGrid,
    displayRows,
    selectedRowId: leaf.rowId,
    omitLeadingAuthoredColumns,
  });
  if (!projection?.hasInteractiveCells) {
    return (
      <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        {leaf.inputCellIds.map((cellId) => (
          <div key={cellId}>{renderCell(cellId)}</div>
        ))}
      </div>
    );
  }
  const radioBuckets = buildRadioGroupBuckets(projection.row);
  return (
    <MobileOriginalRowTable
      columns={projection.columns}
      row={projection.row}
      headerGrid={projection.headerGrid}
      hideColumnLabels={hideColumnLabels}
      scrollLeftRef={horizontalScrollRef}
      errorCellIds={errorCellIds}
      renderCell={(cell) => (
        <InteractiveCell
          cell={cell}
          questionId={questionId}
          isTestMode={isTestMode}
          value={value}
          onChange={onChange}
          {...resolveRadioGroupProps(cell, projection.row.id, radioBuckets)}
        />
      )}
    />
  );
};
```

- [ ] **Step 5: 응답 페이지와 테스트 모드에서 새 props 전달**

`question-input.tsx`와 `question-test-card.tsx`의 table 렌더에 다음을 추가한다.

```tsx
mobileTableDisplayMode={question.mobileTableDisplayMode}
mobileDrilldownOmitLeadingColumns={question.mobileDrilldownOmitLeadingColumns}
```

legacy `mobileOriginalTable`도 과거 snapshot resolver를 위해 계속 전달한다.

`tests/unit/survey/mobile-original-table.test.tsx`에는 `mobileTableDisplayMode="original"`만 전달한
경우에도 stepper/drilldown이 없고 원본 헤더가 보이는 케이스를 추가한다.

- [ ] **Step 6: table 통합 테스트와 기존 모드 회귀 후 커밋**

Run:

```bash
pnpm exec vitest run tests/unit/survey/mobile-table-drilldown-original-row.test.tsx tests/unit/survey/mobile-original-table.test.tsx tests/unit/survey/mobile-table-stepper-resync.test.tsx tests/unit/survey/mobile-row-card-display.test.tsx
pnpm exec tsc --noEmit
```

Expected: 새 모드와 auto/original/legacy 경로 모두 PASS.

```bash
git add src/components/survey-builder/mobile-table-drilldown.tsx src/components/survey-builder/interactive-table-response.tsx src/components/survey-builder/question-test-card.tsx src/components/survey-response/question-input.tsx tests/unit/survey/mobile-table-drilldown-original-row.test.tsx tests/unit/survey/mobile-original-table.test.tsx
git commit -m "feat: 테이블 선택 행 원본 상세 추가"
```

---

### Task 8: 설명 테이블 radio·checkbox 통합

**Files:**
- Create: `src/components/survey-response/choice-table-drilldown.tsx`
- Create: `tests/unit/survey/choice-table-drilldown-original-row.test.tsx`
- Modify: `src/components/survey-response/choice-table-response.tsx:1-330`
- Modify: `tests/unit/survey/choice-table-response-mobile.test.tsx`
- Modify: `tests/unit/survey/mobile-original-table.test.tsx`

**Interfaces:**
- Consumes: Tasks 1, 4, 5, 6.
- Produces: 원본 행당 카드 하나인 설명 테이블 새 모드.
- Preserves: `getChoiceCellState`, `toggle`, grouped answer, `OptionTextInput`, min/max counter.

- [ ] **Step 1: 카드 탐색과 실제 선택을 분리하는 실패 테스트 작성**

```tsx
// tests/unit/survey/choice-table-drilldown-original-row.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import { ChoiceTableResponse } from '@/components/survey-response/choice-table-response';
import type { Question } from '@/types/survey';

vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => true,
  useMediaQuery: () => true,
}));
vi.mock('@/lib/survey/contact-attrs-context', () => ({ useContactAttrs: () => ({}) }));

function multiChoiceRowQuestion(): Question {
  return {
    id: 'q-choice',
    type: 'checkbox',
    title: '플랫폼 지표 선택',
    required: false,
    order: 0,
    mobileTableDisplayMode: 'drilldown-original-row',
    mobileDrilldownOmitLeadingColumns: 1,
    tableColumns: [
      { id: 'c0', label: '항목' },
      { id: 'c1', label: '활성' },
      { id: 'c2', label: '재방문' },
    ],
    tableRowsData: [{
      id: 'r1',
      label: '',
      cells: [
        { id: 'label', type: 'text', content: '플랫폼 지표' },
        { id: 'choice-active', type: 'choice_opt', content: '', choiceLabel: '활성 사용자' },
        { id: 'choice-return', type: 'choice_opt', content: '', choiceLabel: '재방문 사용자' },
      ],
    }],
  };
}

function hiddenChoiceQuestion(): Question {
  return {
    ...multiChoiceRowQuestion(),
    id: 'q-hidden',
    type: 'radio',
    tableRowsData: [{
      id: 'r1',
      label: '',
      cells: [
        { id: 'label', type: 'text', content: '지표' },
        {
          id: 'choice-hidden',
          type: 'choice_opt',
          content: '숨길 셀 라벨',
          choiceLabel: '선택',
          mobileDisplay: 'hidden',
        },
      ],
    }],
    tableColumns: [{ id: 'c0', label: '항목' }, { id: 'c1', label: '선택' }],
  };
}

function enterRow(label: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(label) }));
}

it('한 행에 choice_opt가 여러 개여도 카드는 하나이고 카드 탭은 응답을 바꾸지 않는다', () => {
  const onChange = vi.fn();
  render(<ChoiceTableResponse question={multiChoiceRowQuestion()} value={[]} onChange={onChange} />);
  expect(screen.getAllByRole('button', { name: /플랫폼 지표/ })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: /플랫폼 지표/ }));
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getAllByRole('checkbox')).toHaveLength(2);
});

it('상세 choice input만 기존 cell.id 배열을 저장한다', () => {
  const onChange = vi.fn();
  render(<ChoiceTableResponse question={multiChoiceRowQuestion()} value={[]} onChange={onChange} />);
  enterRow('플랫폼 지표');
  fireEvent.click(screen.getByLabelText('활성 사용자'));
  expect(onChange).toHaveBeenCalledWith(['choice-active']);
});

it('mobileDisplay hidden choice는 라벨을 숨기지만 control을 유지한다', () => {
  render(<ChoiceTableResponse question={hiddenChoiceQuestion()} value={null} onChange={vi.fn()} />);
  enterRow('지표');
  expect(screen.queryByText('숨길 셀 라벨')).toBeNull();
  expect(screen.getByRole('radio', { name: '선택' })).toBeInTheDocument();
});
```

- [ ] **Step 2: 현재 셀별 auto 카드 동작 때문에 테스트가 실패하는지 확인**

Run:

```bash
pnpm exec vitest run tests/unit/survey/choice-table-drilldown-original-row.test.tsx tests/unit/survey/choice-table-response-mobile.test.tsx
```

Expected: 새 모드가 없어 카드 탭이 즉시 값을 변경하거나 choice 셀마다 카드가 생겨 FAIL. 기존 auto 테스트는 PASS.

- [ ] **Step 3: ChoiceTableResponse에서 세 모드를 분리하고 기존 로직을 adapter로 전달**

```ts
const mobileMode = resolveMobileTableDisplayMode(question);

if (isMobile && mobileMode === 'drilldown-original-row') {
  return (
    <ChoiceTableDrilldown
      question={question}
      selectedIds={selectedIds}
      renderChoiceCell={renderCell}
      resolveChoiceLabel={(cellId) => optionByValue.get(cellId)?.label}
      counter={counter}
    />
  );
}

if (isMobile && mobileMode === 'auto') {
  return renderMobileOptionCards();
}

return renderOriginalTable();
```

현재 mobile `flatMap` JSX를 인자 없는 `renderMobileOptionCards` 렌더 함수로 옮기고, 마지막
`TablePreview` JSX를 `renderOriginalTable` 렌더 함수로 옮긴다. 두 함수의 props와 이벤트 handler는
이동 전과 동일한 `getChoiceCellState`, `toggle`, `counter` 클로저를 사용한다.

`renderCell`에서 `choice_opt.mobileDisplay='hidden'`이면 `rawLabel`을 빈 문자열로 처리한다. input 자체와 `aria-label={option?.label ?? '선택'}`은 유지한다.

```ts
const rawLabel = cell.mobileDisplay === 'hidden' ? '' : (cell.content ?? '').trim();
```

- [ ] **Step 4: ChoiceTableDrilldown adapter 구현**

```tsx
const sections = classifyTable({
  tableColumns: question.tableColumns ?? [],
  tableRowsData: question.tableRowsData ?? [],
  tableHeaderGrid: question.tableHeaderGrid,
  answerableCellTypes: ['choice_opt'],
});
const omit = clampMobileDrilldownOmitLeadingColumns(
  question.mobileDrilldownOmitLeadingColumns,
  question.tableColumns?.length ?? 0,
);
const horizontalScrollRef = useRef(0);
```

분류 결과의 section 계층은 그대로 두고 leaf label만 행 제목 resolver 결과로 교체한다.

```ts
const rowById = new Map((question.tableRowsData ?? []).map((row) => [row.id, row]));
const titledSections = sections.map((section) => {
  const leaves = section.leaves.map((leaf) => {
    const row = rowById.get(leaf.rowId);
    return row
      ? {
          ...leaf,
          label: substituteTokens(
            getMobileOriginalRowLabel({
              authoredColumns: question.tableColumns ?? [],
              row,
              omitLeadingAuthoredColumns: omit,
              resolveChoiceLabel,
            }),
            attrs,
          ),
        }
      : leaf;
  });
  const firstRow = section.leaves[0] ? rowById.get(section.leaves[0].rowId) : undefined;
  const sectionLabelIsHidden = firstRow?.cells
    .slice(0, omit)
    .some((cell) =>
      cell.type === 'text'
      && cell.mobileDisplay === 'hidden'
      && cell.content.trim() === section.label.trim(),
    ) ?? false;
  return {
    ...section,
    label: leaves.length === 1
      ? leaves[0]?.label ?? ''
      : sectionLabelIsHidden ? '' : section.label,
    leaves,
  };
});
```

각 section/leaf status는 해당 행의 가시 `choice_opt` 중 selectedIds에 포함된 수를 사용한다. shell은
다음 props로 호출해 전체 행 progress 대신 기존 counter를 표시하고 목차 복귀 시 가로 위치를 초기화한다.

```ts
const getLeafStatus = (leaf: ClassifiedLeaf): DrilldownStatus => {
  const choices = (rowById.get(leaf.rowId)?.cells ?? []).filter(
    (cell) => cell.type === 'choice_opt' && !cell.isHidden && !cell._isContinuation,
  );
  return {
    completed: choices.filter((cell) => selectedIds.includes(cell.id)).length,
    total: choices.length,
    unit: '개 선택',
  };
};

const getSectionStatus = (section: ClassifiedSection): DrilldownStatus => {
  const statuses = section.leaves.map(getLeafStatus);
  return {
    completed: statuses.reduce((sum, status) => sum + status.completed, 0),
    total: statuses.reduce((sum, status) => sum + status.total, 0),
    unit: '개 선택',
  };
};
```

```tsx
<MobileDrilldownShell
  sections={titledSections}
  leafNavigation="always"
  getSectionStatus={getSectionStatus}
  getLeafStatus={getLeafStatus}
  renderLeafDetail={(leaf) => renderLeafDetail(leaf)}
  footer={counter}
  onReturnToRoot={() => { horizontalScrollRef.current = 0; }}
/>
```

상세 함수는 `projectMobileOriginalRow`와 명시적 안전 폴백을 사용한다.

```tsx
const renderLeafDetail = (leaf: ClassifiedLeaf) => {
  const row = rowById.get(leaf.rowId);
  if (!row) return null;
  const projection = projectMobileOriginalRow({
    authoredColumns: question.tableColumns ?? [],
    visibleColumns: question.tableColumns ?? [],
    visibleHeaderGrid: question.tableHeaderGrid,
    displayRows: question.tableRowsData ?? [],
    selectedRowId: leaf.rowId,
    omitLeadingAuthoredColumns: omit,
  });
  if (!projection?.hasInteractiveCells) {
    return (
      <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        {row.cells
          .filter((cell) => cell.type === 'choice_opt' && !cell.isHidden && !cell._isContinuation)
          .map((cell) => <div key={cell.id}>{renderChoiceCell(cell)}</div>)}
      </div>
    );
  }
  return (
    <MobileOriginalRowTable
      columns={projection.columns}
      row={projection.row}
      headerGrid={projection.headerGrid}
      hideColumnLabels={question.hideColumnLabels ?? false}
      scrollLeftRef={horizontalScrollRef}
      renderCell={(cell) => renderChoiceCell(cell)}
    />
  );
};
```

shell에는 `overallStatus`를 전달하지 않고 `footer={counter}`를 전달한다. section/leaf 카드 badge는 선택
상태를 보여주지만 전체 행 완료 progress bar는 만들지 않는다.

카드 제목과 토큰 치환은 앞의 `titledSections` 생성에서 한 번만 수행한다.

- [ ] **Step 5: 설명 테이블 새 모드와 auto/original 회귀 후 커밋**

Run:

```bash
pnpm exec vitest run tests/unit/survey/choice-table-drilldown-original-row.test.tsx tests/unit/survey/choice-table-response-mobile.test.tsx tests/unit/survey/choice-table-response-grouped.test.tsx tests/unit/survey/mobile-original-table.test.tsx tests/integration/choice-table-response-label.test.tsx
pnpm exec tsc --noEmit
```

Expected: 새 모드의 행 카드·상세 선택·grouped shape와 기존 auto 셀별 카드·original 표가 모두 PASS.

```bash
git add src/components/survey-response/choice-table-drilldown.tsx src/components/survey-response/choice-table-response.tsx tests/unit/survey/choice-table-drilldown-original-row.test.tsx tests/unit/survey/choice-table-response-mobile.test.tsx tests/unit/survey/mobile-original-table.test.tsx
git commit -m "feat: 설명 테이블 선택 행 원본 상세 추가"
```

---

### Task 9: 전체 회귀 검증과 문서 상태 갱신

**Files:**
- Modify: `docs/superpowers/specs/2026-07-21-mobile-drilldown-original-row-design.md:1-6`

**Interfaces:**
- Consumes: Tasks 1-8의 완성된 기능.
- Produces: 검증된 구현과 설계 문서 상태.

- [ ] **Step 1: 관련 테스트 전체 실행**

Run:

```bash
pnpm exec vitest run \
  tests/unit/utils/mobile-table-display-mode.test.ts \
  tests/unit/utils/mobile-original-row.test.ts \
  tests/unit/utils/table-radio-groups.test.ts \
  tests/unit/utils/table-row-completion.test.ts \
  tests/unit/utils/table-merge-colspan.test.ts \
  tests/unit/classify-table.test.ts \
  tests/unit/question/schema-matrix.test.ts \
  tests/unit/question/normalize.test.ts \
  tests/unit/domains/versioning/snapshot-builder.test.ts \
  tests/unit/survey/mobile-table-display-settings.test.tsx \
  tests/unit/survey/mobile-original-row-table.test.tsx \
  tests/unit/survey/mobile-table-drilldown-original-row.test.tsx \
  tests/unit/survey/choice-table-drilldown-original-row.test.tsx \
  tests/unit/survey/mobile-original-table.test.tsx \
  tests/unit/survey/choice-table-response-mobile.test.tsx \
  tests/unit/survey/choice-table-response-grouped.test.tsx
```

Expected: 모든 관련 테스트 PASS.

- [ ] **Step 2: 정적 검사와 migration gate 실행**

Run:

```bash
pnpm exec tsc --noEmit
pnpm lint
pnpm exec tsx .github/migration-journal-gate.ts supabase/migrations
git diff --check
```

Expected: TypeScript·ESLint 오류 0개, migration gate `OK`, whitespace 오류 없음.

- [ ] **Step 3: 모바일 테스트 모드 수동 검증**

Run:

```bash
pnpm dev
```

브라우저 폭 390px에서 다음을 순서대로 확인한다.

1. 11개 척도 열과 5개 행인 table 질문에서 새 모드, 제외 열 수 `1`을 저장한다.
2. 테스트 모드 첫 화면에 행 카드 5개와 `0 / 5개 항목`이 표시되는지 확인한다.
3. 첫 카드를 누르면 항목 열은 빠지고 척도 헤더와 0~10 입력이 한 줄 가로 스크롤로 표시되는지 확인한다.
4. 오른쪽으로 이동한 후 `다음 항목`을 눌러 가로 위치가 유지되는지 확인한다.
5. 값을 고른 뒤 화면이 자동 이동하지 않고 완료가 `1 / 5개 항목`으로 바뀌는지 확인한다.
6. `목차로` 후 다른 항목에 들어가 가로 위치가 왼쪽으로 초기화되는지 확인한다.
7. `hideColumnLabels`, 다단 헤더, 병합 셀, 구조적 hidden, interactive `mobileDisplay='hidden'` fixture를 각각 확인한다.
8. 설명 테이블 checkbox에서 한 행의 선택 셀 두 개가 카드 한 개의 상세에 함께 나오며 cell.id 배열로 저장되는지 확인한다.
9. auto와 전체 원본 표 모드가 기존 화면과 동일한지 확인한다.

- [ ] **Step 4: 설계 문서 상태를 구현 완료로 변경하고 마지막 커밋**

`docs/superpowers/specs/2026-07-21-mobile-drilldown-original-row-design.md` 상단을 다음처럼 바꾼다.

```md
> 작성일: 2026-07-21
> 상태: 구현 완료, 회귀 검증 완료
> 구현 계획: [2026-07-21-mobile-drilldown-original-row.md](../plans/2026-07-21-mobile-drilldown-original-row.md)
```

```bash
git add -f docs/superpowers/specs/2026-07-21-mobile-drilldown-original-row-design.md docs/superpowers/plans/2026-07-21-mobile-drilldown-original-row.md
git commit -m "docs: 모바일 선택 행 원본 보기 구현 완료 반영"
```

---

## 완료 기준

- 새 질문과 기존 질문 모두 단일 mode resolver를 통해 정확한 모바일 분기로 들어간다.
- 과거 `mobileOriginalTable=true` DB 행과 snapshot은 계속 전체 원본 표를 보여준다.
- table 새 모드는 입력 수와 무관하게 카드부터 시작하고 행 완료 수를 표시한다.
- 설명 테이블 새 모드는 원본 행당 카드 하나를 만들고 카드 탭과 응답 선택을 분리한다.
- 제외 선행 열, 조건 숨김, 병합, 다단 헤더, 헤더 숨김, mobile hidden 규칙이 테스트로 고정된다.
- 같은 행 radio 그룹의 HTML name과 sibling clear가 원본 행 상세에서도 유지된다.
- auto/original/desktop/export 저장 shape에 회귀가 없다.
- 관련 Vitest, TypeScript, ESLint, migration journal gate가 모두 통과한다.
