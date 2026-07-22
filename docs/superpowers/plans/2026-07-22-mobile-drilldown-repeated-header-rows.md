# Mobile Drilldown Repeated Header Rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모바일 `드릴다운 후 선택 행 원본` 상세에서 정식 헤더와 지정한 본문 행 범위를 반복하고, 반복 본문 행은 목차와 진행률에서 제외한다.

**Architecture:** 질문의 반복 범위는 nullable 정수 두 개로 저장하고, 새 순수 유틸리티가 문자열 파싱·과거값 폴백·작성 행 위치→행 ID 변환·목차용 행 제거를 전담한다. 기존 `projectMobileOriginalRow`는 같은 열 투영을 유지하면서 반복 본문 행과 선택 응답 행을 하나의 상세 블록으로 만들고, `MobileOriginalRowTable`은 반복 행에는 기존 `PreviewCell`을 사용해 표시 전용으로, 선택 행에만 기존 응답 렌더러를 사용한다. 일반 table과 설명 테이블 radio/checkbox는 같은 범위 유틸리티와 투영 결과를 소비한다.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Zustand, Zod 4, Drizzle ORM, PostgreSQL/Supabase, TailwindCSS 4, Vitest, Testing Library

## Global Constraints

- 범위 입력은 빈 값, `숫자`, `숫자-숫자`만 허용한다.
- 빈 값은 `null/null`이며 반복 헤더를 표시하지 않는다.
- `0`은 `tableHeaderGrid` 전체 또는 기존 `tableColumns[].label` 단일 헤더 폴백을 의미한다.
- `3`은 작성된 본문 3행만, `2-3`은 본문 2~3행만, `0-2`는 정식 헤더와 본문 1~2행을 의미한다.
- 본문 번호는 현재 `tableRowsData` 작성 순서를 1부터 세며 행 ID에 의미를 고정하지 않는다.
- 정상 범위가 현재 본문 행 수를 벗어나도 clamp하거나 저장값을 변경하지 않는다.
- 필드가 모두 없는 과거 질문은 `0/0`, 명시적 `null/null`은 반복 없음으로 해석한다.
- 음수·비정수·역전 범위·한쪽만 null/undefined인 저장값은 `0/0`으로 폴백하고 본문 행을 목차에서 제거하지 않는다.
- 반복 본문 행은 현재 표시되는 경우에만 상세에 나오며 목차와 전체·섹션 진행률에서 제외한다.
- 반복 행에 입력 셀이 있어도 별도 경고나 예외를 만들지 않고 기존 모양의 비활성 컨트롤로 렌더한다.
- 반복 범위가 모든 본문 행을 포함하면 빈 목차와 `0/0` 진행률을 그대로 허용한다.
- `mobileDrilldownOmitLeadingColumns`는 정식 헤더·반복 본문 행·선택 응답 행 모두에 동일하게 적용한다.
- 범위에 `0`이 있으면 모바일 선택 행 상세에서만 `hideColumnLabels`보다 정식 헤더 표시가 우선한다.
- 반복 헤더 블록은 세로 sticky로 고정하지 않으며 기존 가로 스크롤 위치 공유·항목 간 유지·목차 복귀 초기화를 보존한다.
- 반복 행/선택 행 경계를 가로지르는 rowspan은 경계에서 분리하고 선택 행 continuation은 기존 anchor materialize 규칙을 유지한다.
- 데스크톱, `auto`, `original`, 분석, 분기, SPSS/엑셀 export 동작은 변경하지 않는다.
- 동적 생성 행, 비연속 범위, 섹션별 범위, 입력행 안전 검사, 필수·조합 검증 예외를 추가하지 않는다.
- 새 코드의 주석·로그·UI 문구는 한국어로 작성하고 이모지를 사용하지 않는다.
- 운영 DB에 `db:push`를 사용하지 않는다. Supabase CLI로 빈 마이그레이션을 만든 뒤 실행 직전 모든 worktree의 최신 수동 번호를 다시 확인해 저장소 규칙의 번호로 이름을 확정한다. `0058`이 점유됐으면 파일명과 manifest 항목을 함께 다음 번호로 올린다.
- 이 브랜치에서는 마이그레이션 파일 생성과 로컬 검증까지만 수행한다. 공유 Supabase 원격 적용은 다른 DB 작업과 합쳐진 뒤 한 명의 배포 담당자가 수행하며, 이 계획의 자동 실행 범위에 포함하지 않는다.

---

## File Map

### 새 파일

- `src/utils/mobile-drilldown-repeat-header.ts`: 범위 파싱·포맷·저장값 폴백·작성 위치 기반 행 ID 선택·목차용 행 재계산.
- `tests/unit/utils/mobile-drilldown-repeat-header.test.ts`: 범위 문법, 비정상값, out-of-range, 조건부 가시 행, rowspan 승격 단위 테스트.
- `supabase/migrations/0058_add_mobile_drilldown_repeat_header_rows.sql`: nullable 시작·끝 정수 컬럼과 기본값 `0`.

### 수정 파일

- `src/types/survey.ts`: 질문 반복 범위 필드.
- `src/db/schema/schema-types.ts`: 스냅샷 반복 범위 필드.
- `src/lib/question/variants.ts`, `src/lib/question/schema.ts`: radio/checkbox/table capability 및 strict 정규화 키.
- `src/features/survey-builder/domain/question.ts`: create/update nullable 입력.
- `src/db/schema/surveys.ts`, `src/db/schema/question-persisted-fields.ts`: Drizzle 컬럼과 영속 필드 SSOT.
- `src/features/survey-builder/server/services/questions.service.ts`: 단건 생성 필드.
- `src/features/survey-builder/server/services/survey-save.service.ts`: 전체·diff 저장 upsert 필드.
- `src/features/survey-builder/server/services/surveys.service.ts`: 설문 복제 필드.
- `src/data/surveys.ts`: DB read에서 명시적 null 보존.
- `src/lib/versioning/snapshot-builder.ts`: 버전 스냅샷 null 왕복.
- `src/features/library/server/services/saved-questions.service.ts`: 과거 보관 질문의 기본 `0/0` canonicalize와 명시적 null 보존.
- `src/stores/survey-store.ts`: 새 radio/checkbox/table 질문의 명시적 `0/0` 초기값.
- `supabase/migrations/manual-migrations.json`: `0058` 추적.
- `src/components/survey-builder/mobile-table-display-settings.tsx`: 반복 범위 text input과 Enter/blur commit.
- `src/components/survey-builder/dynamic-table-editor.tsx`: 설정값 해석·store 갱신.
- `src/components/survey-builder/question-edit-modal.tsx`: store-only 두 필드의 저장·취소·null 보존.
- `src/components/survey-builder/table-preview.tsx`: row-aware render override, non-sticky 옵션, 선택적 행 높이 보존, 중복 셀 key 분리.
- `src/components/survey-builder/cells/preview-cell.tsx`: 반복행 checkbox/radio 컨트롤 비활성화.
- `src/utils/mobile-original-row.ts`: 반복 본문 블록 투영, 헤더 유무 판정, rowspan 경계 분리.
- `src/components/survey-builder/mobile-original-row-table.tsx`: 여러 행 중 선택 행만 인터랙티브 렌더.
- `src/components/survey-builder/interactive-table-response.tsx`: authored rows와 범위 설정 전달.
- `src/components/survey-builder/mobile-table-drilldown.tsx`: 반복 행을 제외한 분류·진행률과 반복 블록 상세.
- `src/components/survey-builder/question-test-card.tsx`, `src/components/survey-response/question-input.tsx`: table 설정 prop 전달.
- `src/components/survey-response/choice-table-drilldown.tsx`: choice 목차·진행률·상세에 공통 반복 규칙 적용.
- `tests/unit/question/schema-matrix.test.ts`, `tests/unit/question/normalize.test.ts`: variant/strict snapshot 키와 비정상값 폴백 입력.
- `tests/unit/domains/versioning/snapshot-builder.test.ts`: `0/0`, `null/null` 스냅샷 보존.
- `tests/unit/features/library/apply-multiple-questions-order.test.ts`: 과거 질문 기본값과 명시적 off 보존.
- `tests/integration/survey-builder-roundtrip.realdb.test.ts`: 생성·복제 null 왕복.
- `tests/unit/survey/mobile-table-display-settings.test.tsx`: 입력 노출·commit·rollback·모드 전환 보존.
- `tests/unit/survey/question-edit-modal-mobile-display.test.tsx`: 저장·취소에서 null/undefined 구분.
- `tests/unit/utils/mobile-original-row.test.ts`: 다중 행 투영과 rowspan 경계.
- `tests/unit/survey/mobile-original-row-table.test.tsx`: 반복행 disabled·hidden·높이·non-sticky·스크롤.
- `tests/unit/survey/mobile-table-drilldown-original-row.test.tsx`: 일반 table 목차·진행률·헤더 순서·조건부 표시 통합.
- `tests/unit/survey/choice-table-drilldown-original-row.test.tsx`: choice table 동일 규칙 통합.
- `tests/unit/survey/table-mobile-display-prop-forwarding.test.tsx`: 테스트/응답 경로의 새 prop 전달.
- `CONTEXT.md`: 반복 헤더 범위와 반복 본문 행 도메인 용어.

---

### Task 1: 반복 헤더 범위 도메인과 질문 타입

**Files:**
- Create: `src/utils/mobile-drilldown-repeat-header.ts`
- Create: `tests/unit/utils/mobile-drilldown-repeat-header.test.ts`
- Modify: `src/types/survey.ts:555-562`
- Modify: `src/db/schema/schema-types.ts:264-270`
- Modify: `src/lib/question/variants.ts:54-58`
- Modify: `src/lib/question/schema.ts:67-71`
- Modify: `tests/unit/question/schema-matrix.test.ts:64-72`
- Modify: `tests/unit/question/normalize.test.ts:250-290`

**Interfaces:**
- Produces: `MobileDrilldownRepeatHeaderRange = { startRow: number; endRow: number }`.
- Produces: `resolveMobileDrilldownRepeatHeaderRange(input): MobileDrilldownRepeatHeaderRange | null`.
- Produces: `parseMobileDrilldownRepeatHeaderText(text): { ok: true; value: MobileDrilldownRepeatHeaderRange | null } | { ok: false }`.
- Produces: `formatMobileDrilldownRepeatHeaderRange(range): string`.
- Produces: `includesMobileDrilldownColumnHeader(range): boolean`.
- Produces: `getMobileDrilldownRepeatedBodyRowIds(authoredRows, range): Set<string>`.
- Produces: `excludeMobileDrilldownRepeatedRows(displayRows, repeatedRowIds): TableRow[]`.
- Produces: `Question.mobileDrilldownRepeatHeaderStartRow`와 `Question.mobileDrilldownRepeatHeaderEndRow`.

- [ ] **Step 1: 범위 문법과 행 선택 실패 테스트 작성**

`tests/unit/utils/mobile-drilldown-repeat-header.test.ts`를 다음 내용으로 만든다.

```ts
import { describe, expect, it } from 'vitest';

import type { TableCell, TableRow } from '@/types/survey';
import {
  excludeMobileDrilldownRepeatedRows,
  formatMobileDrilldownRepeatHeaderRange,
  getMobileDrilldownRepeatedBodyRowIds,
  includesMobileDrilldownColumnHeader,
  parseMobileDrilldownRepeatHeaderText,
  resolveMobileDrilldownRepeatHeaderRange,
} from '@/utils/mobile-drilldown-repeat-header';

const text = (id: string, content = id, rowspan?: number): TableCell => ({
  id,
  type: 'text',
  content,
  ...(rowspan === undefined ? {} : { rowspan }),
});

const row = (id: string, cells: TableCell[] = [text(`${id}-cell`)]): TableRow => ({
  id,
  label: id,
  cells,
});

describe('parseMobileDrilldownRepeatHeaderText', () => {
  it.each([
    ['', null],
    ['   ', null],
    ['0', { startRow: 0, endRow: 0 }],
    ['3', { startRow: 3, endRow: 3 }],
    ['2-3', { startRow: 2, endRow: 3 }],
    [' 0 - 2 ', { startRow: 0, endRow: 2 }],
  ])('%j를 정상 범위로 해석한다', (input, expected) => {
    expect(parseMobileDrilldownRepeatHeaderText(input)).toEqual({ ok: true, value: expected });
  });

  it.each(['-1', '3-2', '1-', '-2', '1-2-3', '1.5', '문자'])('%j는 저장하지 않는다', (input) => {
    expect(parseMobileDrilldownRepeatHeaderText(input)).toEqual({ ok: false });
  });
});

describe('resolveMobileDrilldownRepeatHeaderRange', () => {
  it('필드가 모두 없는 과거 질문은 0/0으로 해석한다', () => {
    expect(resolveMobileDrilldownRepeatHeaderRange({})).toEqual({ startRow: 0, endRow: 0 });
  });

  it('명시적 null/null은 반복 없음으로 보존한다', () => {
    expect(resolveMobileDrilldownRepeatHeaderRange({
      mobileDrilldownRepeatHeaderStartRow: null,
      mobileDrilldownRepeatHeaderEndRow: null,
    })).toBeNull();
  });

  it.each([
    { mobileDrilldownRepeatHeaderStartRow: 2, mobileDrilldownRepeatHeaderEndRow: null },
    { mobileDrilldownRepeatHeaderStartRow: undefined, mobileDrilldownRepeatHeaderEndRow: 2 },
    { mobileDrilldownRepeatHeaderStartRow: -1, mobileDrilldownRepeatHeaderEndRow: 2 },
    { mobileDrilldownRepeatHeaderStartRow: 3, mobileDrilldownRepeatHeaderEndRow: 2 },
    { mobileDrilldownRepeatHeaderStartRow: 1.5, mobileDrilldownRepeatHeaderEndRow: 2 },
  ])('비정상 저장값 $mobileDrilldownRepeatHeaderStartRow/$mobileDrilldownRepeatHeaderEndRow은 0/0으로 폴백한다', (input) => {
    expect(resolveMobileDrilldownRepeatHeaderRange(input)).toEqual({ startRow: 0, endRow: 0 });
  });
});

describe('반복 본문 행 선택', () => {
  const authoredRows = [row('r1'), row('r2'), row('r3')];

  it('작성 위치를 1부터 세고 out-of-range를 clamp하지 않는다', () => {
    expect([...getMobileDrilldownRepeatedBodyRowIds(authoredRows, { startRow: 2, endRow: 5 })])
      .toEqual(['r2', 'r3']);
    expect([...getMobileDrilldownRepeatedBodyRowIds(authoredRows, { startRow: 8, endRow: 10 })])
      .toEqual([]);
  });

  it('0은 정식 헤더로만 취급하고 본문 ID에 넣지 않는다', () => {
    const range = { startRow: 0, endRow: 2 };
    expect(includesMobileDrilldownColumnHeader(range)).toBe(true);
    expect([...getMobileDrilldownRepeatedBodyRowIds(authoredRows, range)]).toEqual(['r1', 'r2']);
    expect(formatMobileDrilldownRepeatHeaderRange(range)).toBe('0-2');
    expect(formatMobileDrilldownRepeatHeaderRange(null)).toBe('');
  });

  it('조건으로 이미 숨은 반복 행은 상세 후보에 없고 남은 목차 rowspan anchor를 승격한다', () => {
    const displayRows = [
      row('r1', [text('anchor', '공통', 3)]),
      row('r3', [{ id: 'continuation-3', type: 'text', content: '', isHidden: true, _isContinuation: true }]),
    ];
    const navigationRows = excludeMobileDrilldownRepeatedRows(displayRows, new Set(['r1', 'r2']));
    expect(navigationRows.map((item) => item.id)).toEqual(['r3']);
    expect(navigationRows[0]?.cells[0]).toMatchObject({ id: 'anchor', content: '공통' });
    expect(navigationRows[0]?.cells[0]).not.toHaveProperty('isHidden', true);
    expect(navigationRows[0]?.cells[0]?.rowspan ?? 1).toBe(1);
  });
});
```

- [ ] **Step 2: 새 유틸리티가 없어 테스트가 실패하는지 확인**

Run:

```bash
pnpm exec vitest run tests/unit/utils/mobile-drilldown-repeat-header.test.ts
```

Expected: `@/utils/mobile-drilldown-repeat-header` 모듈을 찾지 못해 FAIL.

- [ ] **Step 3: 범위 유틸리티 최소 구현**

`src/utils/mobile-drilldown-repeat-header.ts`를 다음 내용으로 만든다.

```ts
import type { TableRow } from '@/types/survey';
import { recalculateRowspansForVisibleRows } from '@/utils/table-merge-helpers';

export interface MobileDrilldownRepeatHeaderRange {
  startRow: number;
  endRow: number;
}

interface StoredRepeatHeaderRange {
  mobileDrilldownRepeatHeaderStartRow?: unknown;
  mobileDrilldownRepeatHeaderEndRow?: unknown;
}

export type MobileDrilldownRepeatHeaderParseResult =
  | { ok: true; value: MobileDrilldownRepeatHeaderRange | null }
  | { ok: false };

const DEFAULT_RANGE: MobileDrilldownRepeatHeaderRange = { startRow: 0, endRow: 0 };

function isValidRowNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function resolveMobileDrilldownRepeatHeaderRange(
  input: StoredRepeatHeaderRange,
): MobileDrilldownRepeatHeaderRange | null {
  const start = input.mobileDrilldownRepeatHeaderStartRow;
  const end = input.mobileDrilldownRepeatHeaderEndRow;

  if (start === undefined && end === undefined) return { ...DEFAULT_RANGE };
  if (start === null && end === null) return null;
  if (!isValidRowNumber(start) || !isValidRowNumber(end) || start > end) {
    return { ...DEFAULT_RANGE };
  }
  return { startRow: start, endRow: end };
}

export function parseMobileDrilldownRepeatHeaderText(
  text: string,
): MobileDrilldownRepeatHeaderParseResult {
  const normalized = text.replaceAll(/\s/g, '');
  if (normalized === '') return { ok: true, value: null };
  const match = /^(\d+)(?:-(\d+))?$/.exec(normalized);
  if (!match) return { ok: false };
  const startRow = Number(match[1]);
  const endRow = Number(match[2] ?? match[1]);
  if (!Number.isSafeInteger(startRow) || !Number.isSafeInteger(endRow) || startRow > endRow) {
    return { ok: false };
  }
  return { ok: true, value: { startRow, endRow } };
}

export function formatMobileDrilldownRepeatHeaderRange(
  range: MobileDrilldownRepeatHeaderRange | null,
): string {
  if (!range) return '';
  return range.startRow === range.endRow
    ? String(range.startRow)
    : `${range.startRow}-${range.endRow}`;
}

export function includesMobileDrilldownColumnHeader(
  range: MobileDrilldownRepeatHeaderRange | null,
): boolean {
  return range?.startRow === 0;
}

export function getMobileDrilldownRepeatedBodyRowIds(
  authoredRows: TableRow[],
  range: MobileDrilldownRepeatHeaderRange | null,
): Set<string> {
  if (!range) return new Set();
  const firstBodyRow = Math.max(1, range.startRow);
  const ids = authoredRows
    .slice(firstBodyRow - 1, range.endRow)
    .map((row) => row.id);
  return new Set(ids);
}

export function excludeMobileDrilldownRepeatedRows(
  displayRows: TableRow[],
  repeatedRowIds: ReadonlySet<string>,
): TableRow[] {
  const visibleIds = new Set(
    displayRows.filter((row) => !repeatedRowIds.has(row.id)).map((row) => row.id),
  );
  if (visibleIds.size === displayRows.length) return displayRows;
  return recalculateRowspansForVisibleRows(displayRows, visibleIds);
}
```

- [ ] **Step 4: 질문 타입과 strict schema에 nullable 필드 추가**

`Question`과 `SnapshotQuestion`에 다음 필드를 추가한다.

```ts
mobileDrilldownRepeatHeaderStartRow?: number | null;
mobileDrilldownRepeatHeaderEndRow?: number | null;
```

`MobileTableDisplayFields`의 `Pick`을 다음처럼 확장한다.

```ts
type MobileTableDisplayFields = Pick<
  Question,
  | 'mobileOriginalTable'
  | 'mobileTableDisplayMode'
  | 'mobileDrilldownOmitLeadingColumns'
  | 'mobileDrilldownRepeatHeaderStartRow'
  | 'mobileDrilldownRepeatHeaderEndRow'
>;
```

`mobileTableDisplay` Zod shape에 nullable 필드를 추가한다. `catch(undefined)`는 손상된 과거 snapshot을 읽기 경계에서 제거하고 런타임 resolver가 `0/0`으로 폴백하게 한다.

```ts
mobileDrilldownRepeatHeaderStartRow: z.number().int().min(0).nullable().optional().catch(undefined),
mobileDrilldownRepeatHeaderEndRow: z.number().int().min(0).nullable().optional().catch(undefined),
```

`tests/unit/question/schema-matrix.test.ts`의 모바일 키 목록에 두 키를 추가하고 radio/checkbox/table만 해당 키를 소유한다는 기존 기대를 유지한다. `tests/unit/question/normalize.test.ts`에는 다음 케이스를 추가한다.

```ts
it('strict 정규화가 반복 헤더 null/null을 보존한다', () => {
  const parsed = normalizeQuestion({
    ...GEN_NEW_TABLE,
    mobileDrilldownRepeatHeaderStartRow: null,
    mobileDrilldownRepeatHeaderEndRow: null,
  }, 'strict');
  expect(parsed['mobileDrilldownRepeatHeaderStartRow']).toBeNull();
  expect(parsed['mobileDrilldownRepeatHeaderEndRow']).toBeNull();
});

it('strict 정규화가 손상된 반복 헤더 숫자를 제거해 런타임 0 폴백을 허용한다', () => {
  const parsed = normalizeQuestion({
    ...GEN_NEW_TABLE,
    mobileDrilldownRepeatHeaderStartRow: -1,
    mobileDrilldownRepeatHeaderEndRow: 2,
  }, 'strict');
  expect(parsed['mobileDrilldownRepeatHeaderStartRow']).toBeUndefined();
  expect(resolveMobileDrilldownRepeatHeaderRange({
    mobileDrilldownRepeatHeaderStartRow:
      parsed['mobileDrilldownRepeatHeaderStartRow'],
    mobileDrilldownRepeatHeaderEndRow:
      parsed['mobileDrilldownRepeatHeaderEndRow'],
  })).toEqual({ startRow: 0, endRow: 0 });
});
```

- [ ] **Step 5: Task 1 테스트와 타입 검사를 통과시키기**

Run:

```bash
pnpm exec vitest run tests/unit/utils/mobile-drilldown-repeat-header.test.ts tests/unit/question/schema-matrix.test.ts tests/unit/question/normalize.test.ts
pnpm exec tsc --noEmit
```

Expected: 대상 테스트 PASS, TypeScript 오류 0개.

- [ ] **Step 6: Task 1 커밋**

```bash
git add src/utils/mobile-drilldown-repeat-header.ts src/types/survey.ts src/db/schema/schema-types.ts src/lib/question/variants.ts src/lib/question/schema.ts tests/unit/utils/mobile-drilldown-repeat-header.test.ts tests/unit/question/schema-matrix.test.ts tests/unit/question/normalize.test.ts
git commit -m "feat: 모바일 반복 헤더 범위 도메인 추가"
```

---

### Task 2: DB 컬럼과 모든 영속 경로

**Files:**
- Create: `supabase/migrations/0058_add_mobile_drilldown_repeat_header_rows.sql`
- Modify: `supabase/migrations/manual-migrations.json`
- Modify: `src/features/survey-builder/domain/question.ts:35-120`
- Modify: `src/db/schema/surveys.ts:187-195`
- Modify: `src/db/schema/question-persisted-fields.ts:44-51`
- Modify: `src/features/survey-builder/server/services/questions.service.ts:65-74`
- Modify: `src/features/survey-builder/server/services/survey-save.service.ts:258-318,604-664`
- Modify: `src/features/survey-builder/server/services/surveys.service.ts:268-277`
- Modify: `src/data/surveys.ts:125-135`
- Modify: `src/lib/versioning/snapshot-builder.ts:63-72,135-145`
- Modify: `src/features/library/server/services/saved-questions.service.ts:46-62`
- Modify: `src/stores/survey-store.ts:472-491`
- Modify: `tests/unit/domains/versioning/snapshot-builder.test.ts`
- Modify: `tests/unit/features/library/apply-multiple-questions-order.test.ts`
- Modify: `tests/integration/survey-builder-roundtrip.realdb.test.ts`

**Interfaces:**
- Consumes: Task 1의 질문 필드와 `resolveMobileDrilldownRepeatHeaderRange`.
- Produces: nullable DB columns `mobile_drilldown_repeat_header_start_row`, `mobile_drilldown_repeat_header_end_row`.
- Produces: create/update/complete-save/diff-save/duplicate/read/snapshot/library 왕복.

- [ ] **Step 1: 스냅샷·보관함·복제 왕복 실패 테스트 작성**

`tests/unit/domains/versioning/snapshot-builder.test.ts`의 기존 모바일 설정 테스트를 다음 기대까지 확장한다.

```ts
mobileDrilldownRepeatHeaderStartRow: null,
mobileDrilldownRepeatHeaderEndRow: null,
```

```ts
expect(question?.mobileDrilldownRepeatHeaderStartRow).toBeNull();
expect(question?.mobileDrilldownRepeatHeaderEndRow).toBeNull();
```

`tests/unit/features/library/apply-multiple-questions-order.test.ts`에 두 케이스를 추가한다.

```ts
it('필드가 없는 과거 모바일 표 질문은 적용 시 반복 헤더 0/0으로 canonicalize한다', async () => {
  findMany.mockResolvedValue([{
    id: 'legacy-repeat-header',
    question: {
      id: 'legacy-table',
      type: 'table',
      title: '과거 표',
      required: false,
      order: 0,
      tableColumns: [],
      tableRowsData: [],
    },
  }]);
  const [applied] = await applyMultipleSavedQuestions(['legacy-repeat-header']);
  expect(applied?.mobileDrilldownRepeatHeaderStartRow).toBe(0);
  expect(applied?.mobileDrilldownRepeatHeaderEndRow).toBe(0);
});

it('보관 질문의 명시적 반복 없음 null/null을 유지한다', async () => {
  findMany.mockResolvedValue([{
    id: 'repeat-header-off',
    question: {
      id: 'off-table',
      type: 'table',
      title: '반복 없음',
      required: false,
      order: 0,
      tableColumns: [],
      tableRowsData: [],
      mobileDrilldownRepeatHeaderStartRow: null,
      mobileDrilldownRepeatHeaderEndRow: null,
    },
  }]);
  const [applied] = await applyMultipleSavedQuestions(['repeat-header-off']);
  expect(applied?.mobileDrilldownRepeatHeaderStartRow).toBeNull();
  expect(applied?.mobileDrilldownRepeatHeaderEndRow).toBeNull();
});
```

`tests/integration/survey-builder-roundtrip.realdb.test.ts`의 복제 원본 insert, select, expect에 다음 값을 추가한다.

```ts
mobileDrilldownRepeatHeaderStartRow: null,
mobileDrilldownRepeatHeaderEndRow: null,
```

```ts
mobileDrilldownRepeatHeaderStartRow: questionsTable.mobileDrilldownRepeatHeaderStartRow,
mobileDrilldownRepeatHeaderEndRow: questionsTable.mobileDrilldownRepeatHeaderEndRow,
```

```ts
expect(copiedQuestion?.mobileDrilldownRepeatHeaderStartRow).toBeNull();
expect(copiedQuestion?.mobileDrilldownRepeatHeaderEndRow).toBeNull();
```

- [ ] **Step 2: 단위 테스트가 필드 누락으로 실패하는지 확인**

Run:

```bash
pnpm exec vitest run tests/unit/domains/versioning/snapshot-builder.test.ts tests/unit/features/library/apply-multiple-questions-order.test.ts
```

Expected: snapshot과 applied question에 새 필드가 없어 FAIL.

- [ ] **Step 3: Supabase CLI로 마이그레이션을 만들고 저장소 번호를 확정한 뒤 SQL 작성**

Run:

```bash
find /Users/megaresearch/mega-research/survey-table-project/supabase/migrations /Users/megaresearch/mega-research/survey-table-project/.worktrees -path '*/supabase/migrations/*.sql' -type f | sed 's#^.*/supabase/migrations/##' | sort -V | tail -5
pnpm exec supabase migration new add_mobile_drilldown_repeat_header_rows
repeat_header_generated_migration=$(find supabase/migrations -maxdepth 1 -type f -name '*_add_mobile_drilldown_repeat_header_rows.sql' | sort | tail -1)
test -n "$repeat_header_generated_migration"
mv "$repeat_header_generated_migration" supabase/migrations/0058_add_mobile_drilldown_repeat_header_rows.sql
```

Expected: CLI가 timestamp 이름의 빈 SQL을 만든다. 이 계획 작성 시점에는 다른 worktree의 `0057_survey_target_test_mode.sql`이 마지막이다. 생성된 빈 파일을 `0058_add_mobile_drilldown_repeat_header_rows.sql`로 이름을 바꾼다. `0058`이 이미 보이면 충돌하지 않는 다음 4자리 번호를 선택하고 아래 파일명, manifest tag, 검증 명령의 번호를 함께 변경한다.

`supabase/migrations/0058_add_mobile_drilldown_repeat_header_rows.sql`:

```sql
ALTER TABLE "questions"
  ADD COLUMN IF NOT EXISTS "mobile_drilldown_repeat_header_start_row" integer DEFAULT 0;

ALTER TABLE "questions"
  ADD COLUMN IF NOT EXISTS "mobile_drilldown_repeat_header_end_row" integer DEFAULT 0;

ALTER TABLE "questions"
  ALTER COLUMN "mobile_drilldown_repeat_header_start_row" SET DEFAULT 0;

ALTER TABLE "questions"
  ALTER COLUMN "mobile_drilldown_repeat_header_end_row" SET DEFAULT 0;
```

두 컬럼에 `NOT NULL`이나 CHECK를 추가하지 않는다. `null/null`이 반복 없음이고 손상값 폴백은 읽기 유틸리티 책임이다.

- [ ] **Step 4: Drizzle·RPC 입력·영속 SSOT에 필드 추가**

`questions` Drizzle schema에 다음 컬럼을 추가한다.

```ts
mobileDrilldownRepeatHeaderStartRow: integer(
  'mobile_drilldown_repeat_header_start_row',
).default(0),
mobileDrilldownRepeatHeaderEndRow: integer(
  'mobile_drilldown_repeat_header_end_row',
).default(0),
```

create/update Zod 입력에는 다음 shape를 동일하게 추가한다.

```ts
mobileDrilldownRepeatHeaderStartRow: z.number().int().min(0).nullable().optional(),
mobileDrilldownRepeatHeaderEndRow: z.number().int().min(0).nullable().optional(),
```

`PERSISTED_QUESTION_FIELDS`에는 두 키를 `mobileDrilldownOmitLeadingColumns` 다음에 추가한다. 그 결과 `CompleteQuestionWrite`가 가리키는 아래 모든 명시적 write object가 컴파일 오류로 위치를 알려야 한다.

- `questions.service.ts` 단건 생성
- `survey-save.service.ts` complete/diff insert와 conflict update 두 벌
- `surveys.service.ts` duplicate insert

각 insert object에는 다음 두 줄을 추가한다.

```ts
mobileDrilldownRepeatHeaderStartRow: question.mobileDrilldownRepeatHeaderStartRow,
mobileDrilldownRepeatHeaderEndRow: question.mobileDrilldownRepeatHeaderEndRow,
```

단건 create에서는 `question` 대신 `data`를 사용한다. 두 conflict set에는 다음을 추가한다.

```ts
mobileDrilldownRepeatHeaderStartRow:
  sql`excluded.mobile_drilldown_repeat_header_start_row`,
mobileDrilldownRepeatHeaderEndRow:
  sql`excluded.mobile_drilldown_repeat_header_end_row`,
```

- [ ] **Step 5: read·snapshot·library에서 명시적 null 보존**

`src/data/surveys.ts`는 `!= null` 조건을 사용하지 않고 DB가 반환한 null도 질문 객체에 넣는다.

```ts
mobileDrilldownRepeatHeaderStartRow: q.mobileDrilldownRepeatHeaderStartRow,
mobileDrilldownRepeatHeaderEndRow: q.mobileDrilldownRepeatHeaderEndRow,
```

`SnapshotQuestion` 타입과 `buildSurveySnapshot` mapping에도 두 필드를 그대로 대입한다.

`prepareAppliedQuestion`은 모바일 표시 capability 질문에서 범위를 한 번 해석해 canonical 값을 저장한다.

```ts
const repeatHeaderRange = supportsMobileTableDisplay
  ? resolveMobileDrilldownRepeatHeaderRange(question)
  : null;
const canonicalQuestion = supportsMobileTableDisplay
  ? {
      ...question,
      mobileTableDisplayMode: resolveMobileTableDisplayMode(question),
      mobileDrilldownRepeatHeaderStartRow: repeatHeaderRange?.startRow ?? null,
      mobileDrilldownRepeatHeaderEndRow: repeatHeaderRange?.endRow ?? null,
    }
  : question;
```

이 코드는 missing old snapshot을 `0/0`, explicit off를 `null/null`로 만든다.

`src/stores/survey-store.ts`의 `newQuestion` 생성 object에 radio/checkbox/table capability 기본값을 추가한다.

```ts
...((type === 'radio' || type === 'checkbox' || type === 'table') && {
  mobileDrilldownRepeatHeaderStartRow: 0,
  mobileDrilldownRepeatHeaderEndRow: 0,
}),
```

- [ ] **Step 6: manifest와 테스트를 갱신해 영속 경로 검증**

`supabase/migrations/manual-migrations.json` 배열 끝에 다음 tag를 추가한다.

```json
"0058_add_mobile_drilldown_repeat_header_rows"
```

Run:

```bash
pnpm exec vitest run tests/unit/domains/versioning/snapshot-builder.test.ts tests/unit/features/library/apply-multiple-questions-order.test.ts tests/unit/ci/migration-journal-gate.test.ts
pnpm exec tsc --noEmit
```

Expected: 대상 테스트 PASS, manifest gate PASS, TypeScript 오류 0개.

로컬 Supabase가 54322에서 실행 중일 때만 migration list로 상태를 확인하고 pending SQL을 적용한 뒤 실DB 테스트를 추가 실행한다.

```bash
pnpm exec supabase migration list --local
pnpm exec supabase migration up --local
pnpm test:integration -- tests/integration/survey-builder-roundtrip.realdb.test.ts
```

Expected: 로컬 DB에 `0058`이 적용된 환경에서 explicit `null/null` 복제 왕복 PASS. 로컬 DB가 없으면 이 명령은 실행하지 않고 최종 검증 기록에 미실행 사유를 남긴다.

원격 linked project에는 이 Task에서 `migration up --linked`, `db push`, 직접 SQL, MCP `apply_migration`을 실행하지 않는다. 다른 worktree의 DB 설계가 통합된 뒤 배포 담당자 한 명이 전체 migration list를 다시 확인해 별도 적용한다.

- [ ] **Step 7: Task 2 커밋**

```bash
git add src/types/survey.ts src/db/schema/schema-types.ts src/features/survey-builder/domain/question.ts src/db/schema/surveys.ts src/db/schema/question-persisted-fields.ts src/features/survey-builder/server/services/questions.service.ts src/features/survey-builder/server/services/survey-save.service.ts src/features/survey-builder/server/services/surveys.service.ts src/data/surveys.ts src/lib/versioning/snapshot-builder.ts src/features/library/server/services/saved-questions.service.ts src/stores/survey-store.ts supabase/migrations/0058_add_mobile_drilldown_repeat_header_rows.sql supabase/migrations/manual-migrations.json tests/unit/domains/versioning/snapshot-builder.test.ts tests/unit/features/library/apply-multiple-questions-order.test.ts tests/integration/survey-builder-roundtrip.realdb.test.ts
git commit -m "feat: 반복 헤더 범위 영속화 추가"
```

---

### Task 3: 빌더 범위 입력과 편집 모달 수명주기

**Files:**
- Modify: `src/components/survey-builder/mobile-table-display-settings.tsx`
- Modify: `src/components/survey-builder/dynamic-table-editor.tsx:97-105,447-463`
- Modify: `src/components/survey-builder/question-edit-modal.tsx:96-143,298-316,417-424`
- Modify: `tests/unit/survey/mobile-table-display-settings.test.tsx`
- Modify: `tests/unit/survey/question-edit-modal-mobile-display.test.tsx`

**Interfaces:**
- Consumes: Task 1의 parse/format/resolve 함수.
- Produces: `MobileTableDisplaySettings`의 start/end controlled 값과 Enter/blur commit.
- Produces: `onChange` payload에 `repeatHeaderStartRow`, `repeatHeaderEndRow`.

- [ ] **Step 1: 설정 입력 동작 실패 테스트 작성**

모든 `MobileTableDisplaySettings` 테스트 render에 다음 기본 props를 추가한다.

```tsx
repeatHeaderStartRow={0}
repeatHeaderEndRow={0}
```

기존 onChange 기대에도 다음 두 키를 추가한다.

```ts
repeatHeaderStartRow: 0,
repeatHeaderEndRow: 0,
```

그리고 다음 테스트를 추가한다.

```tsx
it('드릴다운 모드에서만 반복 헤더 입력과 도움말을 보여준다', () => {
  const props = {
    omitLeadingColumns: 1,
    columnCount: 5,
    repeatHeaderStartRow: 0,
    repeatHeaderEndRow: 2,
    onChange: vi.fn(),
  };
  const { rerender } = render(<MobileTableDisplaySettings mode="auto" {...props} />);
  expect(screen.queryByLabelText('상세에서 반복할 헤더 행')).toBeNull();
  rerender(<MobileTableDisplaySettings mode="drilldown-original-row" {...props} />);
  expect(screen.getByLabelText('상세에서 반복할 헤더 행')).toHaveValue('0-2');
  expect(screen.getByText('비우면 반복하지 않습니다. 0은 진짜 헤더이며, 3 또는 0-2처럼 입력합니다.'))
    .toBeInTheDocument();
});

it('Enter와 blur에서 정상 범위를 start/end로 확정한다', () => {
  const onChange = vi.fn();
  render(
    <MobileTableDisplaySettings
      mode="drilldown-original-row"
      omitLeadingColumns={1}
      columnCount={5}
      repeatHeaderStartRow={0}
      repeatHeaderEndRow={0}
      onChange={onChange}
    />,
  );
  const input = screen.getByLabelText('상세에서 반복할 헤더 행');
  fireEvent.change(input, { target: { value: '2-3' } });
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onChange).toHaveBeenLastCalledWith({
    mode: 'drilldown-original-row',
    omitLeadingColumns: 1,
    repeatHeaderStartRow: 2,
    repeatHeaderEndRow: 3,
  });
  fireEvent.change(input, { target: { value: '' } });
  fireEvent.blur(input);
  expect(onChange).toHaveBeenLastCalledWith({
    mode: 'drilldown-original-row',
    omitLeadingColumns: 1,
    repeatHeaderStartRow: null,
    repeatHeaderEndRow: null,
  });
});

it('잘못된 transient 입력은 직전 정상값으로 되돌린다', () => {
  render(
    <MobileTableDisplaySettings
      mode="drilldown-original-row"
      omitLeadingColumns={1}
      columnCount={5}
      repeatHeaderStartRow={2}
      repeatHeaderEndRow={3}
      onChange={vi.fn()}
    />,
  );
  const input = screen.getByLabelText('상세에서 반복할 헤더 행');
  fireEvent.change(input, { target: { value: '3-2' } });
  fireEvent.blur(input);
  expect(input).toHaveValue('2-3');
});

it('다른 모바일 모드로 바꿀 때 명시적 null/null을 보존한다', () => {
  const onChange = vi.fn();
  render(
    <MobileTableDisplaySettings
      mode="drilldown-original-row"
      omitLeadingColumns={1}
      columnCount={5}
      repeatHeaderStartRow={null}
      repeatHeaderEndRow={null}
      onChange={onChange}
    />,
  );
  fireEvent.click(screen.getByRole('radio', { name: '전체 원본 표' }));
  expect(onChange).toHaveBeenLastCalledWith({
    mode: 'original',
    omitLeadingColumns: 1,
    repeatHeaderStartRow: null,
    repeatHeaderEndRow: null,
  });
});
```

- [ ] **Step 2: 입력이 없어 UI 테스트가 실패하는지 확인**

Run:

```bash
pnpm exec vitest run tests/unit/survey/mobile-table-display-settings.test.tsx
```

Expected: 반복 헤더 label을 찾지 못하고 payload 키가 없어 FAIL.

- [ ] **Step 3: settings 컴포넌트에 draft/commit 구현**

props와 payload 타입을 다음처럼 확장한다.

```ts
interface MobileTableDisplaySettingsValue {
  mode: MobileTableDisplayMode;
  omitLeadingColumns: number;
  repeatHeaderStartRow: number | null;
  repeatHeaderEndRow: number | null;
}

interface MobileTableDisplaySettingsProps {
  mode: MobileTableDisplayMode;
  omitLeadingColumns: number;
  columnCount: number;
  repeatHeaderStartRow?: number | null | undefined;
  repeatHeaderEndRow?: number | null | undefined;
  onChange: (value: MobileTableDisplaySettingsValue) => void;
}
```

컴포넌트 본문에서 저장값을 해석하고 draft를 동기화한다.

```ts
const committedRange = resolveMobileDrilldownRepeatHeaderRange({
  mobileDrilldownRepeatHeaderStartRow: repeatHeaderStartRow,
  mobileDrilldownRepeatHeaderEndRow: repeatHeaderEndRow,
});
const committedText = formatMobileDrilldownRepeatHeaderRange(committedRange);
const [repeatHeaderDraft, setRepeatHeaderDraft] = useState(committedText);

useEffect(() => {
  setRepeatHeaderDraft(committedText);
}, [committedText]);

const emit = (next: Partial<MobileTableDisplaySettingsValue>) => onChange({
  mode,
  omitLeadingColumns: normalizedCount,
  repeatHeaderStartRow: committedRange?.startRow ?? null,
  repeatHeaderEndRow: committedRange?.endRow ?? null,
  ...next,
});

const commitRepeatHeaderDraft = () => {
  const parsed = parseMobileDrilldownRepeatHeaderText(repeatHeaderDraft);
  if (!parsed.ok) {
    setRepeatHeaderDraft(committedText);
    return;
  }
  const nextText = formatMobileDrilldownRepeatHeaderRange(parsed.value);
  setRepeatHeaderDraft(nextText);
  emit({
    repeatHeaderStartRow: parsed.value?.startRow ?? null,
    repeatHeaderEndRow: parsed.value?.endRow ?? null,
  });
};
```

기존 모드·제외 열 onChange를 `emit`으로 교체하고 드릴다운 설정 영역을 두 입력으로 구성한다.

```tsx
<div className="grid max-w-xl gap-3 sm:grid-cols-2">
  <div className="space-y-1.5">
    <Label htmlFor="mobile-drilldown-omit-leading">상세에서 제외할 앞쪽 열 수</Label>
    <Input
      id="mobile-drilldown-omit-leading"
      type="number"
      min={0}
      max={Math.max(0, columnCount - 1)}
      value={normalizedCount}
      onChange={(event) => emit({
        omitLeadingColumns: clampMobileDrilldownOmitLeadingColumns(
          Number(event.target.value),
          columnCount,
        ),
      })}
    />
  </div>
  <div className="space-y-1.5">
    <Label htmlFor="mobile-drilldown-repeat-header">상세에서 반복할 헤더 행</Label>
    <Input
      id="mobile-drilldown-repeat-header"
      type="text"
      inputMode="text"
      value={repeatHeaderDraft}
      onChange={(event) => setRepeatHeaderDraft(event.target.value)}
      onBlur={commitRepeatHeaderDraft}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commitRepeatHeaderDraft();
        }
      }}
    />
    <p className="text-xs text-gray-500">
      비우면 반복하지 않습니다. 0은 진짜 헤더이며, 3 또는 0-2처럼 입력합니다.
    </p>
  </div>
</div>
```

- [ ] **Step 4: DynamicTableEditor에서 값과 null을 store에 전달**

현재 질문의 범위를 resolver로 계산한다.

```ts
const mobileDrilldownRepeatHeaderRange = resolveMobileDrilldownRepeatHeaderRange(
  mobileTableQuestion ?? {},
);
```

settings props와 callback을 다음처럼 확장한다.

```tsx
repeatHeaderStartRow={mobileDrilldownRepeatHeaderRange?.startRow ?? null}
repeatHeaderEndRow={mobileDrilldownRepeatHeaderRange?.endRow ?? null}
onChange={({
  mode,
  omitLeadingColumns,
  repeatHeaderStartRow,
  repeatHeaderEndRow,
}) => {
  if (!editingQuestionId) return;
  silentUpdateQuestion(editingQuestionId, {
    mobileTableDisplayMode: mode,
    mobileDrilldownOmitLeadingColumns: omitLeadingColumns,
    mobileDrilldownRepeatHeaderStartRow: repeatHeaderStartRow,
    mobileDrilldownRepeatHeaderEndRow: repeatHeaderEndRow,
  });
}}
```

- [ ] **Step 5: 편집 모달의 취소·저장에서 두 필드와 null을 보존**

cleanup closure에 원래값 두 개를 추가하고 기존 모바일 설정과 동일하게 `undefined`일 때만 property를 delete한다. `null`은 명시적 값으로 복원한다.

저장 직전 store merge에 다음을 추가한다.

```ts
...(storeQuestion?.mobileDrilldownRepeatHeaderStartRow !== undefined
  ? { mobileDrilldownRepeatHeaderStartRow: storeQuestion.mobileDrilldownRepeatHeaderStartRow }
  : {}),
...(storeQuestion?.mobileDrilldownRepeatHeaderEndRow !== undefined
  ? { mobileDrilldownRepeatHeaderEndRow: storeQuestion.mobileDrilldownRepeatHeaderEndRow }
  : {}),
```

create payload에서는 `??`를 쓰지 않고 명시적 null을 보존한다.

```ts
mobileDrilldownRepeatHeaderStartRow:
  currentFormData.mobileDrilldownRepeatHeaderStartRow !== undefined
    ? currentFormData.mobileDrilldownRepeatHeaderStartRow
    : question?.mobileDrilldownRepeatHeaderStartRow,
mobileDrilldownRepeatHeaderEndRow:
  currentFormData.mobileDrilldownRepeatHeaderEndRow !== undefined
    ? currentFormData.mobileDrilldownRepeatHeaderEndRow
    : question?.mobileDrilldownRepeatHeaderEndRow,
```

`tests/unit/survey/question-edit-modal-mobile-display.test.tsx`에 기존 store update payload를 두 필드까지 확장하고 다음 케이스를 추가한다.

```tsx
it('반복 헤더를 지운 null/null을 저장 payload와 store에 유지한다', async () => {
  render(<ModalHarness />);
  act(() => {
    useSurveyBuilderStore.getState().silentUpdateQuestion('q1', {
      mobileDrilldownRepeatHeaderStartRow: null,
      mobileDrilldownRepeatHeaderEndRow: null,
    });
  });
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
  await waitFor(() => expect(updateQuestionMock).toHaveBeenCalled());
  expect(getQuestion()?.mobileDrilldownRepeatHeaderStartRow).toBeNull();
  expect(getQuestion()?.mobileDrilldownRepeatHeaderEndRow).toBeNull();
});
```

- [ ] **Step 6: Task 3 테스트와 타입 검사**

Run:

```bash
pnpm exec vitest run tests/unit/survey/mobile-table-display-settings.test.tsx tests/unit/survey/question-edit-modal-mobile-display.test.tsx
pnpm exec tsc --noEmit
```

Expected: 대상 테스트 PASS, TypeScript 오류 0개.

- [ ] **Step 7: Task 3 커밋**

```bash
git add src/components/survey-builder/mobile-table-display-settings.tsx src/components/survey-builder/dynamic-table-editor.tsx src/components/survey-builder/question-edit-modal.tsx tests/unit/survey/mobile-table-display-settings.test.tsx tests/unit/survey/question-edit-modal-mobile-display.test.tsx
git commit -m "feat: 모바일 반복 헤더 범위 입력 추가"
```

---

### Task 4: 반복 행 블록 투영과 표시 전용 원본 렌더

**Files:**
- Modify: `src/utils/mobile-original-row.ts`
- Modify: `src/components/survey-builder/table-preview.tsx`
- Modify: `src/components/survey-builder/cells/preview-cell.tsx`
- Modify: `src/components/survey-builder/mobile-original-row-table.tsx`
- Modify: `tests/unit/utils/mobile-original-row.test.ts`
- Modify: `tests/unit/survey/mobile-original-row-table.test.tsx`

**Interfaces:**
- Consumes: Task 1이 계산한 `repeatedRowIds`와 `includeColumnHeader`.
- Produces: `MobileOriginalRowProjection.repeatedRows`, `showColumnHeader`.
- Produces: `TablePreview.renderCell(cell, row)` row-aware override.
- Produces: `MobileOriginalRowTable`의 `rows`, `interactiveRowId`, `choiceControlType` props.

- [ ] **Step 1: 반복 블록과 병합 경계 실패 테스트 작성**

`tests/unit/utils/mobile-original-row.test.ts`에 다음 테스트를 추가한다.

```ts
it('반복행 내부 rowspan은 유지하고 선택행 경계에서는 anchor를 다시 materialize한다', () => {
  const columns = [col('label'), col('shared'), col('value')];
  const projection = projectMobileOriginalRow({
    authoredColumns: columns,
    visibleColumns: columns,
    displayRows: [
      row('r1', [text('l1'), { ...text('shared', '공통'), rowspan: 3 }, radio('v1')]),
      row('r2', [text('l2'), { ...text('shared-c2', ''), isHidden: true, _isContinuation: true }, radio('v2')]),
      row('r3', [text('l3'), { ...text('shared-c3', ''), isHidden: true, _isContinuation: true }, radio('v3')]),
    ],
    selectedRowId: 'r3',
    omitLeadingAuthoredColumns: 1,
    repeatedRowIds: new Set(['r1', 'r2']),
    includeColumnHeader: false,
  });
  expect(projection?.repeatedRows.map((item) => item.id)).toEqual(['r1', 'r2']);
  expect(projection?.repeatedRows[0]?.cells[0]).toMatchObject({ id: 'shared', rowspan: 2 });
  expect(projection?.row.cells[0]).toMatchObject({ id: 'shared', content: '공통' });
  expect(projection?.row.cells[0]?.rowspan ?? 1).toBe(1);
  expect(projection?.showColumnHeader).toBe(false);
});

it('정식 헤더 요청은 다단 헤더 전체와 단일 label 폴백을 구분한다', () => {
  const withGrid = projectMobileOriginalRow({
    authoredColumns: [col('c1')],
    visibleColumns: [col('c1')],
    visibleHeaderGrid: [[header('h1')], [header('h2')]],
    displayRows: [row('r1', [radio('v1')])],
    selectedRowId: 'r1',
    omitLeadingAuthoredColumns: 0,
    includeColumnHeader: true,
  });
  expect(withGrid?.showColumnHeader).toBe(true);
  expect(withGrid?.headerGrid).toHaveLength(2);

  const withoutLabels = projectMobileOriginalRow({
    authoredColumns: [{ id: 'c1', label: '' }],
    visibleColumns: [{ id: 'c1', label: '' }],
    displayRows: [row('r1', [radio('v1')])],
    selectedRowId: 'r1',
    omitLeadingAuthoredColumns: 0,
    includeColumnHeader: true,
  });
  expect(withoutLabels?.showColumnHeader).toBe(false);
});
```

`tests/unit/survey/mobile-original-row-table.test.tsx`에 다음 렌더 테스트를 추가한다.

```tsx
it('반복행 입력은 disabled preview이고 선택행 입력만 응답 가능하다', () => {
  const onChange = vi.fn();
  render(
    <MobileOriginalRowTable
      columns={[col('점수')]}
      rows={[
        row([{ ...inputCell, id: 'repeat-input', placeholder: '반복 입력' }], 'repeat-row'),
        row([{ ...inputCell, id: 'answer-input', placeholder: '응답 입력' }], 'answer-row'),
      ]}
      interactiveRowId="answer-row"
      hideColumnLabels
      renderCell={(cell) => (
        <InteractiveCell cell={cell} questionId="q1" isTestMode value={{}} onChange={onChange} />
      )}
    />,
  );
  expect(screen.getByPlaceholderText('반복 입력')).toBeDisabled();
  expect(screen.getByPlaceholderText('응답 입력')).toBeEnabled();
  fireEvent.change(screen.getByPlaceholderText('응답 입력'), { target: { value: '7' } });
  expect(onChange).toHaveBeenLastCalledWith({ 'answer-input': '7' });
});

it('반복행 mobileDisplay hidden은 숨기고 응답행 hidden 입력 컨트롤은 유지한다', () => {
  render(
    <MobileOriginalRowTable
      columns={[col('설명'), col('입력')]}
      rows={[
        row([
          { id: 'repeat-static', type: 'text', content: '반복 숨김', mobileDisplay: 'hidden' },
          { ...inputCell, id: 'repeat-hidden-input', placeholder: '반복 숨김 입력', mobileDisplay: 'hidden' },
        ], 'repeat-row'),
        row([
          { id: 'answer-static', type: 'text', content: '응답 숨김', mobileDisplay: 'hidden' },
          { ...inputCell, id: 'answer-hidden-input', placeholder: '응답 숨김 입력', mobileDisplay: 'hidden' },
        ], 'answer-row'),
      ]}
      interactiveRowId="answer-row"
      hideColumnLabels
      renderCell={(cell) => (
        <InteractiveCell cell={cell} questionId="q1" isTestMode value={{}} onChange={vi.fn()} />
      )}
    />,
  );
  expect(screen.queryByText('반복 숨김')).toBeNull();
  expect(screen.queryByText('응답 숨김')).toBeNull();
  expect(screen.getByPlaceholderText('반복 숨김 입력')).toBeDisabled();
  expect(screen.getByPlaceholderText('응답 숨김 입력')).toBeEnabled();
});

it('상세 블록은 작성 행 높이를 보존하고 헤더 wrapper를 세로 sticky로 만들지 않는다', () => {
  render(
    <MobileOriginalRowTable
      columns={[col('점수')]}
      rows={[{ ...row([inputCell], 'answer-row'), height: 96 }]}
      interactiveRowId="answer-row"
      hideColumnLabels={false}
      renderCell={(cell) => <span>{cell.id}</span>}
    />,
  );
  expect(screen.getByTestId('cell-input')).toHaveStyle({ minHeight: '96px' });
  const headerScroller = getHeaderScroller();
  const stickyWrapper = headerScroller.parentElement?.parentElement;
  expect(stickyWrapper).not.toHaveClass('sticky', 'top-0');
});
```

- [ ] **Step 2: 기존 단일-row API와 투영 결과 때문에 테스트가 실패하는지 확인**

Run:

```bash
pnpm exec vitest run tests/unit/utils/mobile-original-row.test.ts tests/unit/survey/mobile-original-row-table.test.tsx
```

Expected: `repeatedRows`, `showColumnHeader`, `rows`, `interactiveRowId`가 없어 FAIL.

- [ ] **Step 3: projectMobileOriginalRow에 반복행과 헤더 판정 추가**

입력과 결과 타입을 다음처럼 확장한다.

```ts
export interface ProjectMobileOriginalRowInput {
  authoredColumns: TableColumn[];
  visibleColumns: TableColumn[];
  visibleHeaderGrid?: HeaderCell[][] | undefined;
  displayRows: TableRow[];
  selectedRowId: string;
  omitLeadingAuthoredColumns: number;
  repeatedRowIds?: ReadonlySet<string> | undefined;
  includeColumnHeader?: boolean | undefined;
}

export interface MobileOriginalRowProjection {
  columns: TableColumn[];
  row: TableRow;
  repeatedRows: TableRow[];
  headerGrid?: HeaderCell[][] | undefined;
  showColumnHeader: boolean;
  hasInteractiveCells: boolean;
  sourceRowIdByCellId: ReadonlyMap<string, string>;
}
```

열 투영 직후 반복행은 별도 visible set으로 rowspan을 재계산한다. 선택행 materialize는 기존 full projected rows coverage를 그대로 사용한다.

```ts
const repeatedVisibleIds = new Set(
  projected.rows
    .filter((projectedRow) => input.repeatedRowIds?.has(projectedRow.id))
    .map((projectedRow) => projectedRow.id),
);
const repeatedRows = repeatedVisibleIds.size > 0
  ? recalculateRowspansForVisibleRows(projected.rows, repeatedVisibleIds)
  : [];
const includeColumnHeader = input.includeColumnHeader ?? true;
const hasHeaderGrid = (projected.headerGrid?.length ?? 0) > 0;
const hasColumnLabelFallback = projected.columns.some(
  (column) => !column.isHeaderHidden && column.label.trim() !== '',
);
const showColumnHeader = includeColumnHeader && (hasHeaderGrid || hasColumnLabelFallback);
```

return object에는 다음을 추가하고 `headerGrid`는 표시할 때만 유지한다.

```ts
repeatedRows,
showColumnHeader,
...(showColumnHeader && projected.headerGrid
  ? { headerGrid: projected.headerGrid }
  : {}),
```

- [ ] **Step 4: TablePreview를 row-aware로 만들고 detail 전용 표시 옵션 추가**

props를 다음처럼 확장한다.

```ts
renderCell?: (cell: TableCell, row: TableRow) => React.ReactNode;
stickyHeader?: boolean | undefined;
preserveRowHeights?: boolean | undefined;
```

기본값은 기존 화면 보존을 위해 `stickyHeader = true`, `preserveRowHeights = false`다. 헤더 wrapper class는 다음처럼 바꾼다.

```tsx
className={cn(
  'z-30 bg-white print:static print:z-auto',
  stickyHeader && 'sticky top-0',
)}
```

body 셀 key와 style, override 호출을 다음처럼 바꾼다.

```ts
if (preserveRowHeights) {
  const preservedHeight = row.height ?? row.minHeight;
  if (preservedHeight !== undefined) style.minHeight = `${preservedHeight}px`;
}
```

```tsx
key={`${row.id}:${cell.id}`}
```

```ts
const override = renderCell?.(cell, row);
```

중복 cell id는 반복행과 materialize된 선택행에 동시에 존재할 수 있으므로 key에 row id를 반드시 포함한다.

- [ ] **Step 5: PreviewCell의 표시 전용 checkbox/radio를 실제 disabled로 변경**

`checkbox`와 `radio` case의 input에 `disabled`를 추가하고 `readOnly`를 제거한다.

```tsx
<input
  type="checkbox"
  checked={option.checked || false}
  disabled
  className="mt-0.5 h-4 w-4 shrink-0 rounded"
/>
```

```tsx
<input
  type="radio"
  name={`preview-${cell.id}`}
  checked={option.selected || false}
  disabled
  className="mt-0.5 h-4 w-4 shrink-0"
/>
```

- [ ] **Step 6: MobileOriginalRowTable을 다중 행·선택 행 전용 override로 변경**

`mobile-original-row-table.tsx`에 기존 기본 셀 렌더러를 가져온다.

```ts
import { PreviewCell } from '@/components/survey-builder/cells/preview-cell';
```

props를 다음처럼 바꾼다.

```ts
interface Props {
  columns: TableColumn[];
  rows: TableRow[];
  interactiveRowId: string;
  headerGrid?: HeaderCell[][] | undefined;
  hideColumnLabels: boolean;
  renderCell: (cell: TableCell) => React.ReactNode;
  choiceControlType?:
    | 'radio'
    | 'checkbox'
    | ((cell: TableCell) => 'radio' | 'checkbox')
    | undefined;
  scrollLeftRef?: React.MutableRefObject<number> | undefined;
  resetScrollKey?: string | number | undefined;
  errorCellIds?: Set<string> | undefined;
}
```

row-aware render 함수는 반복행에는 `PreviewCell`, 선택행에만 기존 live renderer를 사용한다.

```tsx
const resolveChoiceControlType = (cell: TableCell) =>
  typeof choiceControlType === 'function'
    ? choiceControlType(cell)
    : (choiceControlType ?? 'checkbox');

const renderMobileCell = useCallback(
  (cell: TableCell, row: TableRow) => {
    const hidden = cell.mobileDisplay === 'hidden';
    if (row.id !== interactiveRowId) {
      if (hidden && !isMobileOriginalRowInteractiveCell(cell)) {
        return <span aria-hidden="true" />;
      }
      if (hidden) {
        return (
          <PreviewCell
            cell={{ ...cell, content: '' }}
            choiceControlType={resolveChoiceControlType(cell)}
          />
        );
      }
      return null;
    }
    if (!hidden) return renderCell(cell);
    if (!isMobileOriginalRowInteractiveCell(cell)) return <span aria-hidden="true" />;
    return renderCell({ ...cell, content: '' });
  },
  [choiceControlType, interactiveRowId, renderCell],
);
```

`TablePreview` 호출은 다음 props를 사용한다.

```tsx
rows={rows}
renderCell={renderMobileCell}
choiceControlType={choiceControlType}
stickyHeader={false}
preserveRowHeights
```

이 Task의 `mobile-original-row-table.test.tsx`에서 기존 `row={testRow}` 호출은 `rows={[testRow]}`와 `interactiveRowId={testRow.id}`로 바꾼다. production 호출부는 Task 5와 Task 6에서 projection의 반복행을 함께 전달하며 갱신한다.

- [ ] **Step 7: Task 4 테스트와 관련 회귀 실행**

Run:

```bash
pnpm exec vitest run tests/unit/utils/mobile-original-row.test.ts tests/unit/survey/mobile-original-row-table.test.tsx tests/unit/survey/preview-cell-choice.test.tsx tests/unit/survey/mobile-original-table.test.tsx
pnpm exec tsc --noEmit
```

Expected: 반복행 disabled·rowspan split·header fallback PASS, 기존 원본 표 테스트 PASS, TypeScript 오류 0개.

- [ ] **Step 8: Task 4 커밋**

```bash
git add src/utils/mobile-original-row.ts src/components/survey-builder/table-preview.tsx src/components/survey-builder/cells/preview-cell.tsx src/components/survey-builder/mobile-original-row-table.tsx tests/unit/utils/mobile-original-row.test.ts tests/unit/survey/mobile-original-row-table.test.tsx
git commit -m "feat: 반복 헤더 원본 행 블록 렌더 추가"
```

---

### Task 5: 일반 table 드릴다운 목차·진행률·상세 연결

**Files:**
- Modify: `src/components/survey-builder/interactive-table-response.tsx:305-350,828-866`
- Modify: `src/components/survey-builder/mobile-table-drilldown.tsx:21-68,224-327`
- Modify: `src/components/survey-builder/question-test-card.tsx:490-505`
- Modify: `src/components/survey-response/question-input.tsx:165-203`
- Modify: `tests/unit/survey/table-mobile-display-prop-forwarding.test.tsx`
- Modify: `tests/unit/survey/mobile-table-drilldown-original-row.test.tsx`

**Interfaces:**
- Consumes: Task 1의 range/ID/navigation 함수와 Task 4의 projection/render props.
- Produces: `InteractiveTableResponse`와 `MobileTableDrilldown`의 start/end props.
- Produces: 일반 table의 반복 행 제외 목차·진행률과 반복 상세 블록.

- [ ] **Step 1: 일반 table 통합 실패 테스트 작성**

`tests/unit/survey/mobile-table-drilldown-original-row.test.tsx`에 다음 완결된 fixture를 추가한다.

```tsx
const repeatHeaderFixtureRows = (): TableRow[] =>
  ['본문 1행', '본문 2행', '본문 3행', '응답 행'].map((label, index) => ({
    id: `repeat-r${index + 1}`,
    label,
    cells: [
      { id: `repeat-label-${index + 1}`, type: 'text', content: label },
      {
        id: `repeat-input-${index + 1}`,
        type: 'input',
        content: '',
        placeholder: `${label} 입력`,
      },
    ],
  }));

function renderRepeatHeaderFixture({
  start,
  end,
  rows = repeatHeaderFixtureRows(),
  hideColumnLabels = false,
  columns = [
    { id: 'repeat-label-column', label: '항목', width: 140 },
    { id: 'repeat-value-column', label: '점수', width: 180 },
  ],
  tableHeaderGrid,
  allQuestions,
  allResponses,
}: {
  start: number | null;
  end: number | null;
  rows?: TableRow[];
  hideColumnLabels?: boolean;
  columns?: TableColumn[];
  tableHeaderGrid?: NonNullable<Question['tableHeaderGrid']> | undefined;
  allQuestions?: Question[] | undefined;
  allResponses?: Record<string, unknown> | undefined;
}) {
  return render(
    <InteractiveTableResponse
      questionId="repeat-header-question"
      columns={columns}
      rows={rows}
      tableHeaderGrid={tableHeaderGrid}
      hideColumnLabels={hideColumnLabels}
      allQuestions={allQuestions}
      allResponses={allResponses}
      mobileTableDisplayMode="drilldown-original-row"
      mobileDrilldownOmitLeadingColumns={1}
      mobileDrilldownRepeatHeaderStartRow={start}
      mobileDrilldownRepeatHeaderEndRow={end}
      value={{}}
      onChange={vi.fn()}
    />,
  );
}

function enterRepeatResponseRow() {
  fireEvent.click(screen.getByRole('button', { name: /응답 행/ }));
}
```

다음 시나리오를 같은 파일에 추가한다.

```tsx
it('본문 1행 반복은 목차와 진행률에서 제외하고 모든 상세 위에 disabled 원본행을 붙인다', () => {
  renderRepeatHeaderFixture({ start: 1, end: 1 });
  expect(screen.queryByRole('button', { name: /본문 1행/ })).toBeNull();
  expect(screen.getByText(/전체/)).toHaveTextContent('전체 0 / 3개 항목');
  enterRepeatResponseRow();
  expect(screen.getByPlaceholderText('본문 1행 입력')).toBeDisabled();
  expect(screen.getByPlaceholderText('응답 행 입력')).toBeEnabled();
});

it.each([
  [null, null, false, []],
  [0, 0, true, []],
  [3, 3, false, ['본문 3행 입력']],
  [2, 3, false, ['본문 2행 입력', '본문 3행 입력']],
  [0, 2, true, ['본문 1행 입력', '본문 2행 입력']],
] as const)('범위 %s-%s의 헤더와 본문 순서를 적용한다', (start, end, showsHeader, repeatedLabels) => {
  renderRepeatHeaderFixture({ start, end });
  enterRepeatResponseRow();
  expect(screen.queryByRole('columnheader') !== null).toBe(showsHeader);
  const repeated = repeatedLabels.map((label) => screen.getByPlaceholderText(label));
  repeated.forEach((element, index) => {
    const next = repeated[index + 1];
    if (next) expect(element.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

it('조건부로 숨은 반복행은 생략하고 작성 번호를 다시 매기지 않는다', () => {
  const rows = repeatHeaderFixtureRows();
  const second = rows[1];
  if (!second) throw new Error('조건부 fixture 2행이 필요합니다.');
  second.displayCondition = {
    logicType: 'AND',
    conditions: [{
      id: 'hide-repeat-second',
      sourceQuestionId: visibilitySourceQuestion.id,
      conditionType: 'value-match',
      logicType: 'AND',
      requiredValues: ['show'],
    }],
  };
  renderRepeatHeaderFixture({
    start: 2,
    end: 3,
    rows,
    allQuestions: [visibilitySourceQuestion],
    allResponses: { [visibilitySourceQuestion.id]: 'hide' },
  });
  enterRepeatResponseRow();
  expect(screen.queryByPlaceholderText('본문 2행 입력')).toBeNull();
  expect(screen.getByPlaceholderText('본문 3행 입력')).toBeInTheDocument();
});

it('범위에 0이 있으면 선택 상세에서만 hideColumnLabels를 재정의한다', () => {
  renderRepeatHeaderFixture({ start: 0, end: 0, hideColumnLabels: true });
  enterRepeatResponseRow();
  expect(screen.getByRole('columnheader', { name: '점수' })).toBeInTheDocument();
});

it('8-10 out-of-range는 본문을 제거하지 않고 헤더도 반복하지 않는다', () => {
  renderRepeatHeaderFixture({ start: 8, end: 10 });
  expect(screen.getAllByRole('button', { name: /본문|응답/ })).toHaveLength(4);
});

it('모든 본문 행을 반복 범위에 넣으면 빈 목차와 0/0 진행률을 유지한다', () => {
  renderRepeatHeaderFixture({ start: 1, end: 4 });
  expect(screen.queryAllByRole('button', { name: /본문|응답/ })).toHaveLength(0);
  expect(screen.getByText(/전체/)).toHaveTextContent('전체 0 / 0개 항목');
});
```

- [ ] **Step 2: 반복행이 아직 목차에 남아 테스트가 실패하는지 확인**

Run:

```bash
pnpm exec vitest run tests/unit/survey/mobile-table-drilldown-original-row.test.tsx
```

Expected: 반복 본문 행 카드가 남고 progress total이 줄지 않아 FAIL.

- [ ] **Step 3: InteractiveTableResponse prop과 전달값 확장**

props에 다음을 추가한다.

```ts
mobileDrilldownRepeatHeaderStartRow?: number | null | undefined;
mobileDrilldownRepeatHeaderEndRow?: number | null | undefined;
```

`mobileTableProps`에는 authored rows와 두 저장값을 추가한다.

```ts
authoredRows: rows,
mobileDrilldownRepeatHeaderStartRow,
mobileDrilldownRepeatHeaderEndRow,
```

`question-test-card.tsx`와 `question-input.tsx`의 `InteractiveTableResponse` 호출에도 질문 필드를 optional spread로 전달한다. `tests/unit/survey/table-mobile-display-prop-forwarding.test.tsx`의 fixture와 기대 props를 다음 값으로 확장한다.

```ts
mobileDrilldownRepeatHeaderStartRow: 0,
mobileDrilldownRepeatHeaderEndRow: 2,
```

- [ ] **Step 4: MobileTableDrilldown에서 목차용 행과 상세용 행 분리**

props에 authored rows와 두 필드를 추가한다.

```ts
authoredRows: TableRow[];
mobileDrilldownRepeatHeaderStartRow?: number | null | undefined;
mobileDrilldownRepeatHeaderEndRow?: number | null | undefined;
```

컴포넌트 시작에서 범위와 행 집합을 계산한다.

```ts
const repeatHeaderRange = useMemo(
  () => resolveMobileDrilldownRepeatHeaderRange({
    mobileDrilldownRepeatHeaderStartRow,
    mobileDrilldownRepeatHeaderEndRow,
  }),
  [mobileDrilldownRepeatHeaderEndRow, mobileDrilldownRepeatHeaderStartRow],
);
const repeatedBodyRowIds = useMemo(
  () => getMobileDrilldownRepeatedBodyRowIds(authoredRows, repeatHeaderRange),
  [authoredRows, repeatHeaderRange],
);
const navigationRows = useMemo(
  () => excludeMobileDrilldownRepeatedRows(displayRows, repeatedBodyRowIds),
  [displayRows, repeatedBodyRowIds],
);
const includeColumnHeader = includesMobileDrilldownColumnHeader(repeatHeaderRange);
```

`classifyTable`에는 `navigationRows`를 전달한다. `cellById`와 `rowById`는 상세 투영과 materialize를 위해 계속 원본 `displayRows`로 만든다. `answerableRows`, completed count, section/leaf status는 `sections`와 `navigationRows` 기반으로 계산한다.

투영 호출에는 다음 두 값을 추가한다.

```ts
repeatedRowIds: repeatedBodyRowIds,
includeColumnHeader,
```

렌더 호출은 Task 4 API로 바꾼다.

```tsx
<MobileOriginalRowTable
  columns={projection.columns}
  rows={[...projection.repeatedRows, projection.row]}
  interactiveRowId={projection.row.id}
  headerGrid={projection.headerGrid}
  hideColumnLabels={!projection.showColumnHeader}
  scrollLeftRef={horizontalScrollRef}
  errorCellIds={errorCellIds}
  renderCell={(cell) => {
    const sourceRowId = projection.sourceRowIdByCellId.get(cell.id) ?? leaf.rowId;
    const radioBuckets = radioBucketsByRowId.get(sourceRowId) ?? selectedRowBuckets;
    return (
      <InteractiveCell
        cell={cell}
        questionId={questionId}
        isTestMode={isTestMode}
        value={value}
        onChange={onChange}
        {...resolveRadioGroupProps(cell, sourceRowId, radioBuckets)}
      />
    );
  }}
/>
```

`hideColumnLabels={!projection.showColumnHeader}`가 다음 두 경우를 동시에 만족한다.

- 범위에 0이 없으면 원래 `hideColumnLabels=false`여도 헤더를 반복하지 않음.
- 범위에 0이 있고 실제 헤더가 있으면 원래 `hideColumnLabels=true`여도 이 상세에서만 표시.

- [ ] **Step 5: 일반 table 테스트와 기존 드릴다운 회귀 실행**

Run:

```bash
pnpm exec vitest run tests/unit/survey/mobile-table-drilldown-original-row.test.tsx tests/unit/survey/mobile-table-stepper-resync.test.tsx tests/unit/survey/mobile-row-card-display.test.tsx tests/unit/survey/table-mobile-display-prop-forwarding.test.tsx tests/unit/survey/mobile-original-table.test.tsx tests/unit/classify-table.test.ts
pnpm exec tsc --noEmit
```

Expected: 새 범위 시나리오와 기존 auto/original/legacy 드릴다운 회귀 모두 PASS, TypeScript 오류 0개.

- [ ] **Step 6: Task 5 커밋**

```bash
git add src/components/survey-builder/interactive-table-response.tsx src/components/survey-builder/mobile-table-drilldown.tsx src/components/survey-builder/question-test-card.tsx src/components/survey-response/question-input.tsx tests/unit/survey/table-mobile-display-prop-forwarding.test.tsx tests/unit/survey/mobile-table-drilldown-original-row.test.tsx
git commit -m "feat: 일반 표 반복 헤더 드릴다운 연결"
```

---

### Task 6: choice table 연결, 문서와 전체 검증

**Files:**
- Modify: `src/components/survey-response/choice-table-drilldown.tsx`
- Modify: `tests/unit/survey/choice-table-drilldown-original-row.test.tsx`
- Modify: `CONTEXT.md`

**Interfaces:**
- Consumes: Task 1 범위 유틸, Task 4 다중 행 렌더.
- Produces: radio/checkbox 설명 테이블의 동일 목차·상세 규칙.
- Produces: 반복 헤더 도메인 용어 문서.

- [ ] **Step 1: choice table 실패 테스트 작성**

`tests/unit/survey/choice-table-drilldown-original-row.test.tsx`에 다음 완결된 fixture를 추가한다.

```tsx
function repeatedChoiceQuestion(
  type: 'radio' | 'checkbox',
  overrides: Partial<Question> = {},
): Question {
  return {
    id: `repeat-choice-${type}`,
    type,
    title: '반복 선택 표',
    required: false,
    order: 0,
    mobileTableDisplayMode: 'drilldown-original-row',
    mobileDrilldownOmitLeadingColumns: 1,
    mobileDrilldownRepeatHeaderStartRow: 1,
    mobileDrilldownRepeatHeaderEndRow: 1,
    tableColumns: [
      { id: 'choice-label-column', label: '항목', width: 140 },
      { id: 'choice-a-column', label: 'A', width: 120 },
      { id: 'choice-b-column', label: 'B', width: 120 },
    ],
    tableRowsData: [
      {
        id: 'repeat-choice-row',
        label: '척도 헤더',
        cells: [
          { id: 'repeat-choice-label', type: 'text', content: '척도 헤더' },
          { id: 'repeat-choice-a', type: 'choice_opt', content: '', choiceLabel: '반복 선택 A' },
          { id: 'repeat-choice-b', type: 'choice_opt', content: '', choiceLabel: '반복 선택 B' },
        ],
      },
      {
        id: 'answer-choice-row',
        label: '직무',
        cells: [
          { id: 'answer-choice-label', type: 'text', content: '직무' },
          { id: 'answer-choice-a', type: 'choice_opt', content: '', choiceLabel: '직무 선택 A' },
          { id: 'answer-choice-b', type: 'choice_opt', content: '', choiceLabel: '직무 선택 B' },
        ],
      },
    ],
    ...overrides,
  } as Question;
}

function enterRepeatedChoiceAnswer() {
  fireEvent.click(screen.getByRole('button', { name: /직무/ }));
}
```

다음 케이스를 추가한다.

```tsx
it.each(['radio', 'checkbox'] as const)(
  '%s 설명 테이블에서 반복 본문 행을 목차에서 빼고 disabled control로 상세에 표시한다',
  (type) => {
    render(
      <ChoiceTableResponse
        question={repeatedChoiceQuestion(type)}
        value={type === 'checkbox' ? [] : null}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /척도 헤더/ })).toBeNull();
    enterRepeatedChoiceAnswer();
    const repeatControl = screen.getByRole(type, { name: '반복 선택 A' });
    const answerControl = screen.getByRole(type, { name: '직무 선택 A' });
    expect(repeatControl).toBeDisabled();
    expect(answerControl).toBeEnabled();
  },
);

it('0-2는 다단 헤더와 본문 1~2행을 같은 열 투영으로 보여준다', () => {
  const question = repeatedChoiceQuestion('checkbox', {
    mobileDrilldownRepeatHeaderStartRow: 0,
    mobileDrilldownRepeatHeaderEndRow: 2,
    tableHeaderGrid: [
      [
        { id: 'item-header', label: '항목', colspan: 1, rowspan: 1 },
        { id: 'scale-header', label: '척도', colspan: 2, rowspan: 1 },
      ],
    ],
    tableRowsData: [
      {
        id: 'first-repeat-row',
        label: '제외할 첫 반복 행 제목',
        cells: [
          { id: 'first-repeat-label', type: 'text', content: '제외할 첫 반복 행 제목' },
          { id: 'first-repeat-a', type: 'text', content: '본문 헤더 1A' },
          { id: 'first-repeat-b', type: 'text', content: '본문 헤더 1B' },
        ],
      },
      {
        id: 'second-repeat-row',
        label: '제외할 둘째 반복 행 제목',
        cells: [
          { id: 'second-repeat-label', type: 'text', content: '제외할 둘째 반복 행 제목' },
          { id: 'second-repeat-a', type: 'text', content: '본문 헤더 2A' },
          { id: 'second-repeat-b', type: 'text', content: '본문 헤더 2B' },
        ],
      },
      repeatedChoiceQuestion('checkbox').tableRowsData![1]!,
    ],
  });
  render(<ChoiceTableResponse question={question} value={[]} onChange={vi.fn()} />);
  enterRepeatedChoiceAnswer();
  expect(screen.getByRole('columnheader', { name: '척도' })).toBeInTheDocument();
  expect(screen.getByText('본문 헤더 1A')).toBeInTheDocument();
  expect(screen.getByText('본문 헤더 2B')).toBeInTheDocument();
  expect(screen.queryByText('제외할 첫 반복 행 제목')).toBeNull();
  expect(screen.queryByText('제외할 둘째 반복 행 제목')).toBeNull();
});

it('헤더 grid와 열 label이 모두 없으면 0만 건너뛰고 지정 본문 행을 반복한다', () => {
  const question = repeatedChoiceQuestion('checkbox', {
    mobileDrilldownRepeatHeaderStartRow: 0,
    mobileDrilldownRepeatHeaderEndRow: 1,
    tableHeaderGrid: undefined,
    tableColumns: [
      { id: 'blank-label', label: '' },
      { id: 'blank-a', label: '' },
      { id: 'blank-b', label: '' },
    ],
  });
  render(<ChoiceTableResponse question={question} value={[]} onChange={vi.fn()} />);
  enterRepeatedChoiceAnswer();
  expect(screen.queryByRole('columnheader')).toBeNull();
  expect(screen.getByText('척도 헤더')).toBeInTheDocument();
});

it('그룹 혼합 choice 반복행은 셀별 radio/checkbox 모양을 유지하되 모두 비활성화한다', () => {
  const question = repeatedChoiceQuestion('radio', {
    choiceGroups: [
      { id: 'repeat-radio-group', type: 'radio', groupKey: 'radio', label: '라디오' },
      { id: 'repeat-check-group', type: 'checkbox', groupKey: 'check', label: '체크' },
    ],
    tableRowsData: [
      {
        id: 'repeat-choice-row',
        label: '척도 헤더',
        cells: [
          { id: 'repeat-choice-label', type: 'text', content: '척도 헤더' },
          {
            id: 'repeat-choice-a',
            type: 'choice_opt',
            content: '',
            choiceLabel: '반복 라디오',
            choiceGroupId: 'repeat-radio-group',
          },
          {
            id: 'repeat-choice-b',
            type: 'choice_opt',
            content: '',
            choiceLabel: '반복 체크박스',
            choiceGroupId: 'repeat-check-group',
          },
        ],
      },
      {
        id: 'answer-choice-row',
        label: '직무',
        cells: [
          { id: 'answer-choice-label', type: 'text', content: '직무' },
          {
            id: 'answer-choice-a',
            type: 'choice_opt',
            content: '',
            choiceLabel: '직무 라디오',
            choiceGroupId: 'repeat-radio-group',
          },
          {
            id: 'answer-choice-b',
            type: 'choice_opt',
            content: '',
            choiceLabel: '직무 체크박스',
            choiceGroupId: 'repeat-check-group',
          },
        ],
      },
    ],
  });
  render(<ChoiceTableResponse question={question} value={{}} onChange={vi.fn()} />);
  enterRepeatedChoiceAnswer();
  expect(screen.getByRole('radio', { name: '반복 라디오' })).toBeDisabled();
  expect(screen.getByRole('checkbox', { name: '반복 체크박스' })).toBeDisabled();
});
```

- [ ] **Step 2: choice 목차에 반복행이 남아 실패하는지 확인**

Run:

```bash
pnpm exec vitest run tests/unit/survey/choice-table-drilldown-original-row.test.tsx
```

Expected: 반복 본문 행 카드가 남고 반복 control이 live 상태여서 FAIL.

- [ ] **Step 3: ChoiceTableDrilldown에 공통 범위·투영 연결**

choice group별 control type과 반복 범위 유틸을 import한다.

```ts
import {
  getGroupTypeOfCell,
  isGroupedChoiceQuestion,
} from '@/utils/choice-group-helpers';
import {
  excludeMobileDrilldownRepeatedRows,
  getMobileDrilldownRepeatedBodyRowIds,
  includesMobileDrilldownColumnHeader,
  resolveMobileDrilldownRepeatHeaderRange,
} from '@/utils/mobile-drilldown-repeat-header';
```

기존 `rows`는 작성 순서와 현재 표시 행을 동시에 사용하므로 안정화한 memo로 범위와 두 행 집합을 계산한다.

```ts
const repeatHeaderRange = useMemo(
  () => resolveMobileDrilldownRepeatHeaderRange({
    mobileDrilldownRepeatHeaderStartRow:
      question.mobileDrilldownRepeatHeaderStartRow,
    mobileDrilldownRepeatHeaderEndRow:
      question.mobileDrilldownRepeatHeaderEndRow,
  }),
  [
    question.mobileDrilldownRepeatHeaderEndRow,
    question.mobileDrilldownRepeatHeaderStartRow,
  ],
);
const repeatedBodyRowIds = useMemo(
  () => getMobileDrilldownRepeatedBodyRowIds(rows, repeatHeaderRange),
  [repeatHeaderRange, rows],
);
const navigationRows = useMemo(
  () => excludeMobileDrilldownRepeatedRows(rows, repeatedBodyRowIds),
  [repeatedBodyRowIds, rows],
);
const includeColumnHeader = includesMobileDrilldownColumnHeader(repeatHeaderRange);
```

`classifyTable`에는 `navigationRows`를 전달한다. `rowById`와 `cellById`는 상세를 위해 전체 `rows`를 유지한다. projection에는 다음을 추가한다.

```ts
repeatedRowIds: repeatedBodyRowIds,
includeColumnHeader,
```

렌더는 Task 4 API로 바꾸고 choice group별 컨트롤 타입을 전달한다.

```tsx
<MobileOriginalRowTable
  columns={projection.columns}
  rows={[...projection.repeatedRows, projection.row]}
  interactiveRowId={projection.row.id}
  headerGrid={projection.headerGrid}
  hideColumnLabels={!projection.showColumnHeader}
  scrollLeftRef={horizontalScrollRef}
  choiceControlType={(cell) => (
    isGroupedChoiceQuestion(question)
      ? getGroupTypeOfCell(question, cell.id)
      : question.type === 'checkbox'
        ? 'checkbox'
        : 'radio'
  )}
  renderCell={renderChoiceCell}
/>
```

`sections` memo의 `classifyTable` 입력을 `rows`에서 `navigationRows`로 교체하고 의존 배열도 `[columns, navigationRows, question.tableHeaderGrid]`로 맞춘다.

- [ ] **Step 4: CONTEXT.md에 도메인 용어 추가**

`모바일 테이블 표시 모드` 근처에 다음 두 항목을 추가한다.

```md
**반복 헤더 범위 (repeated header range)**:
선택 행 원본 보기의 각 상세 상단에 반복할 정식 헤더와 작성 본문 행의 연속 범위. 0은 정식 헤더 전체, 1 이상은 현재 tableRowsData 작성 위치를 뜻하며, 빈 값은 반복 없음이다. 범위는 행 ID가 아니라 현재 작성 순서를 따른다.
_Avoid_: 반복 행 ID 목록, 모바일 헤더 개수

**반복 본문 행 (repeated body row)**:
반복 헤더 범위에 포함되어 모바일 목차·진행률에서는 제외되고 각 선택 상세에서 표시 전용 원본 행으로 재사용되는 작성 본문 행. 입력 셀이 있어도 응답 채널이 아니라 비활성 PreviewCell로 렌더된다.
_Avoid_: 응답 행 복제, 고정 행
```

- [ ] **Step 5: choice·일반 드릴다운 전체 회귀 실행**

Run:

```bash
pnpm exec vitest run \
  tests/unit/utils/mobile-drilldown-repeat-header.test.ts \
  tests/unit/utils/mobile-original-row.test.ts \
  tests/unit/survey/mobile-table-display-settings.test.tsx \
  tests/unit/survey/mobile-original-row-table.test.tsx \
  tests/unit/survey/mobile-table-drilldown-original-row.test.tsx \
  tests/unit/survey/choice-table-drilldown-original-row.test.tsx \
  tests/unit/survey/choice-table-drilldown-review.test.tsx \
  tests/unit/survey/choice-table-response-mobile.test.tsx \
  tests/unit/survey/mobile-original-table.test.tsx \
  tests/unit/survey/table-mobile-display-prop-forwarding.test.tsx \
  tests/unit/question/schema-matrix.test.ts \
  tests/unit/question/normalize.test.ts \
  tests/unit/domains/versioning/snapshot-builder.test.ts \
  tests/unit/features/library/apply-multiple-questions-order.test.ts \
  tests/unit/ci/migration-journal-gate.test.ts
pnpm exec tsc --noEmit
pnpm lint
```

Expected: 대상 테스트 전부 PASS, TypeScript 오류 0개, ESLint 오류 0개. 전체 `pnpm test`에서 알려진 `tests/integration/profiles-row-actions.test.ts` flaky가 발생하면 해당 파일을 격리 재실행해 기존 flaky인지 확인하고, 새 모바일 테스트 실패와 분리해 기록한다.

- [ ] **Step 6: formatter와 diff 검증**

Run:

```bash
pnpm exec prettier --check \
  src/utils/mobile-drilldown-repeat-header.ts \
  src/utils/mobile-original-row.ts \
  src/components/survey-builder/mobile-table-display-settings.tsx \
  src/components/survey-builder/mobile-original-row-table.tsx \
  src/components/survey-builder/mobile-table-drilldown.tsx \
  src/components/survey-response/choice-table-drilldown.tsx \
  docs/superpowers/plans/2026-07-22-mobile-drilldown-repeated-header-rows.md
git diff --check
```

Expected: Prettier PASS, whitespace error 0개.

- [ ] **Step 7: Task 6 커밋**

```bash
git add src/components/survey-response/choice-table-drilldown.tsx tests/unit/survey/choice-table-drilldown-original-row.test.tsx CONTEXT.md
git commit -m "feat: 선택형 표 반복 헤더 연결"
```

- [ ] **Step 8: 최종 상태 확인**

Run:

```bash
git status --short
git log --oneline -6
```

Expected: 구현 파일이 모두 커밋되어 status가 비어 있고, Task 1~6의 한국어 커밋이 순서대로 보인다.

---

## Spec Coverage Matrix

| 설계 요구 | 구현 Task |
| --- | --- |
| 빈 값·0·3·2-3·0-2 문법 | Task 1, Task 3 |
| missing→0/0, explicit null/null, 손상값 폴백 | Task 1, Task 2 |
| out-of-range 무보정·현재 작성 위치 | Task 1 |
| 질문 생성·수정·복제·전체 저장·보관함·스냅샷 | Task 2 |
| 해당 모드에서만 입력, Enter/blur commit, 모드 전환 보존 | Task 3 |
| 반복 본문 행 목차·진행률 제외 | Task 1, Task 5, Task 6 |
| 조건부 숨김 행 생략·rowspan anchor 승격 | Task 1, Task 5 |
| 정식 다단 헤더·열 label 폴백·둘 다 없을 때 0 생략 | Task 4, Task 5, Task 6 |
| 앞쪽 열 제외·colspan·rowspan·hidden | Task 4 |
| 반복 입력 disabled·선택 행만 응답 | Task 4 |
| 반복/선택 경계 rowspan split | Task 4 |
| hideColumnLabels 상세 한정 override | Task 4, Task 5, Task 6 |
| 세로 non-sticky·가로 스크롤 공유와 복귀 초기화 | Task 4, Task 5, Task 6 |
| 일반 table과 choice table 동일 동작 | Task 5, Task 6 |
| 모든 행 반복 시 빈 목차 0/0 | Task 5 |
| 도메인 언어 갱신 | Task 6 |
