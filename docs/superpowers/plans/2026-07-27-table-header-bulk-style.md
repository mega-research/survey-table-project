# 테이블 전체 헤더 스타일 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기본 열 헤더와 다단계 헤더 전체에 사용자 지정 배경색과 텍스트 Bold를 일괄 적용하고 모든 설문 렌더링 경로에서 동일하게 표시한다.

**Architecture:** `TableColumn`과 `HeaderCell`에 기존 셀 스타일과 동일한 선택 필드를 추가한다. 스타일 일괄 적용은 불변 데이터를 반환하는 순수 유틸리티에서 처리하고, `useTableEditor`가 열·헤더 그리드 state/ref와 기존 `onTableChange` 저장 경로를 한 번에 동기화한다. 편집 다이얼로그는 기존 `CellStyleFields`의 색상 입력을 재사용하며, 빌더·미리보기·응답 렌더러는 기존 `cell-style` 표현 헬퍼를 사용한다.

**Tech Stack:** TypeScript strict, React 19, Next.js 16, Zustand, TailwindCSS 4, shadcn/ui, Vitest, Testing Library

## Global Constraints

- 적용 대상은 현재 존재하는 모든 기본 열 헤더와 모든 다단계 헤더 셀이다.
- Bold 해제와 배경색 초기화는 선택 속성을 제거하며, 새로 추가되는 헤더에는 자동 상속하지 않는다.
- 색상 입력은 `RGB`, `RRGGBB`, 선택적 `#`를 허용하고 저장 시 대문자 `#RRGGBB`로 정규화한다.
- 색상 프리셋, 글자색, 글자 크기, 개별 헤더 편집, 데이터 행 헤더 스타일은 추가하지 않는다.
- 다단계 헤더가 존재하면 `tableColumns`와 `tableHeaderGrid`를 모두 갱신한다.
- PostgreSQL/Drizzle 마이그레이션과 신규 외부 의존성은 추가하지 않는다.
- 기존 sticky, 병합, 조건, 열 너비, 모바일 카드 동작을 보존한다.
- 코드·주석·UI 텍스트에 이모지를 추가하지 않고 커밋 메시지는 한국어로 작성한다.

---

## File Structure

- `src/types/survey.ts`: `TableColumn`, `HeaderCell`의 영속 스타일 필드 계약.
- `src/utils/header-style.ts`: 전체 헤더 스타일 적용과 공통 스타일 판별을 담당하는 순수 함수.
- `src/components/survey-builder/header-bulk-style-dialog.tsx`: 전체 헤더 스타일 초안, 검증, 미리보기, 적용 UI.
- `src/components/survey-builder/hooks/use-table-editor.ts`: 열·다단계 헤더를 원자적으로 갱신하고 질문 변경을 알리는 액션.
- `src/components/survey-builder/dynamic-table-editor.tsx`: 일괄 스타일 버튼·다이얼로그 연결.
- `src/components/survey-builder/table-header-section.tsx`: 빌더 기본 열 헤더 스타일 표시.
- `src/components/survey-builder/header-grid-editor.tsx`: 빌더 다단계 헤더 스타일 표시.
- `src/components/survey-builder/table-preview.tsx`: 미리보기와 이를 재사용하는 모바일 원본 표 헤더 스타일 표시.
- `src/components/survey-builder/interactive-table-response.tsx`: 테스트 모드·공개 응답 헤더 스타일 표시.
- `tests/unit/utils/header-style.test.ts`: 전체 적용·초기화·혼합 상태 순수 로직 검증.
- `tests/unit/survey/header-bulk-style-dialog.test.tsx`: 색상 입력 검증과 적용 UI 검증.
- `tests/unit/survey/table-header-style-rendering.test.tsx`: 단일·다단계 헤더의 실제 렌더링 검증.

---

### Task 1: 헤더 스타일 데이터 계약과 순수 적용 로직

**Files:**
- Modify: `src/types/survey.ts:462-481`
- Create: `src/utils/header-style.ts`
- Create: `tests/unit/utils/header-style.test.ts`

**Interfaces:**
- Consumes: `normalizeCellHexColor(raw: string): string | null` from `src/utils/cell-style.ts`.
- Produces:

```ts
export interface HeaderBulkStyle {
  textBold: boolean;
  backgroundColor: string;
}

export interface AppliedHeaderStyle {
  columns: TableColumn[];
  headerGrid: HeaderCell[][] | undefined;
}

export function applyHeaderBulkStyle(
  columns: TableColumn[],
  headerGrid: HeaderCell[][] | undefined,
  style: HeaderBulkStyle,
): AppliedHeaderStyle;

export function getCommonHeaderStyle(
  columns: TableColumn[],
  headerGrid: HeaderCell[][] | undefined,
): HeaderBulkStyle;
```

- [ ] **Step 1: Write failing pure-function tests**

Create `tests/unit/utils/header-style.test.ts` with cases that prove:

```ts
import { describe, expect, it } from 'vitest';

import type { HeaderCell, TableColumn } from '@/types/survey';
import { applyHeaderBulkStyle, getCommonHeaderStyle } from '@/utils/header-style';

const columns: TableColumn[] = [
  { id: 'c1', label: '성별' },
  { id: 'c2', label: '연령' },
];
const grid: HeaderCell[][] = [
  [{ id: 'h1', label: '응답자 특성', colspan: 2, rowspan: 1 }],
  [
    { id: 'h2', label: '성별', colspan: 1, rowspan: 1 },
    { id: 'h3', label: '연령', colspan: 1, rowspan: 1 },
  ],
];

describe('applyHeaderBulkStyle', () => {
  it('모든 기본 헤더와 병합된 다단계 헤더에 정규화된 스타일을 불변 적용한다', () => {
    const result = applyHeaderBulkStyle(columns, grid, {
      textBold: true,
      backgroundColor: 'abc',
    });

    expect(result.columns).not.toBe(columns);
    expect(result.headerGrid).not.toBe(grid);
    expect(result.columns.every((column) => (
      column.textBold === true && column.backgroundColor === '#AABBCC'
    ))).toBe(true);
    expect(result.headerGrid?.flat().every((cell) => (
      cell.textBold === true && cell.backgroundColor === '#AABBCC'
    ))).toBe(true);
    expect(columns[0]).toEqual({ id: 'c1', label: '성별' });
  });

  it('해제 시 모든 헤더에서 선택 스타일 속성을 제거한다', () => {
    const styledColumns = columns.map((column) => ({
      ...column,
      textBold: true,
      backgroundColor: '#112233',
    }));
    const styledGrid = grid.map((row) => row.map((cell) => ({
      ...cell,
      textBold: true,
      backgroundColor: '#112233',
    })));

    const result = applyHeaderBulkStyle(styledColumns, styledGrid, {
      textBold: false,
      backgroundColor: '',
    });

    expect(result.columns.every((column) => (
      !('textBold' in column) && !('backgroundColor' in column)
    ))).toBe(true);
    expect(result.headerGrid?.flat().every((cell) => (
      !('textBold' in cell) && !('backgroundColor' in cell)
    ))).toBe(true);
  });

  it('다단계 헤더가 없으면 기본 열만 갱신한다', () => {
    const result = applyHeaderBulkStyle(columns, undefined, {
      textBold: true,
      backgroundColor: '#123456',
    });

    expect(result.headerGrid).toBeUndefined();
    expect(result.columns).toHaveLength(2);
  });

  it('모든 헤더가 같은 경우 공통 스타일을 반환하고 혼합 상태는 기본값으로 반환한다', () => {
    const uniform = applyHeaderBulkStyle(columns, grid, {
      textBold: true,
      backgroundColor: '#ABCDEF',
    });
    expect(getCommonHeaderStyle(uniform.columns, uniform.headerGrid)).toEqual({
      textBold: true,
      backgroundColor: '#ABCDEF',
    });

    expect(getCommonHeaderStyle(
      [{ ...columns[0]!, textBold: true }, columns[1]!],
      undefined,
    )).toEqual({ textBold: false, backgroundColor: '' });
  });
});
```

- [ ] **Step 2: Run the new test and verify the missing module/type failures**

Run:

```bash
pnpm test -- tests/unit/utils/header-style.test.ts
```

Expected: FAIL because `@/utils/header-style` and header style properties do not exist.

- [ ] **Step 3: Add the style fields and minimal pure implementation**

Add to both `TableColumn` and `HeaderCell` in `src/types/survey.ts`:

```ts
textBold?: boolean;
backgroundColor?: string;
```

Implement `src/utils/header-style.ts` so it:

- normalizes a non-empty background through `normalizeCellHexColor`;
- throws `new Error('유효하지 않은 헤더 배경색입니다.')` if a caller supplies a non-empty invalid color;
- clones every column and header cell;
- assigns `textBold: true` only when enabled and otherwise deletes the property;
- assigns a normalized color only when present and otherwise deletes the property;
- preserves `undefined` for an absent header grid;
- returns the shared style only when every existing header has the same Bold and color values; empty or mixed collections return `{ textBold: false, backgroundColor: '' }`.

Use a private generic helper with the exact shape below so both header types receive identical omission behavior:

```ts
function withHeaderStyle<T extends TableColumn | HeaderCell>(
  value: T,
  textBold: boolean,
  backgroundColor: string | undefined,
): T {
  const next = { ...value };
  if (textBold) next.textBold = true;
  else delete next.textBold;
  if (backgroundColor) next.backgroundColor = backgroundColor;
  else delete next.backgroundColor;
  return next;
}
```

- [ ] **Step 4: Run focused tests and type-check**

Run:

```bash
pnpm test -- tests/unit/utils/header-style.test.ts tests/unit/utils/cell-style.test.ts
pnpm exec tsc --noEmit
```

Expected: both test files PASS and TypeScript reports no new errors.

- [ ] **Step 5: Commit the data contract and pure logic**

```bash
git add src/types/survey.ts src/utils/header-style.ts tests/unit/utils/header-style.test.ts
git commit -m "feat: 테이블 헤더 스타일 데이터 처리 추가"
```

Before staging, use `git diff -- src/types/survey.ts` and stage only this task’s `TableColumn`/`HeaderCell` hunks because the file already contains unrelated user changes.

---

### Task 2: 전체 헤더 스타일 다이얼로그

**Files:**
- Modify: `src/components/survey-builder/cell-style-fields.tsx`
- Create: `src/components/survey-builder/header-bulk-style-dialog.tsx`
- Create: `tests/unit/survey/header-bulk-style-dialog.test.tsx`

**Interfaces:**
- Consumes: `HeaderBulkStyle` from `src/utils/header-style.ts` and `normalizeCellHexColor` from `src/utils/cell-style.ts`.
- Produces:

```ts
interface HeaderBulkStyleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialStyle: HeaderBulkStyle;
  onApply: (style: HeaderBulkStyle) => void;
}

export function HeaderBulkStyleDialog(props: HeaderBulkStyleDialogProps): React.ReactNode;
```

- [ ] **Step 1: Write failing dialog behavior tests**

Create `tests/unit/survey/header-bulk-style-dialog.test.tsx` using Testing Library. Mock no store; render the component with controlled props and verify:

```ts
it('Bold와 직접 입력한 3자리 HEX를 정규화해 적용한다', async () => {
  const onApply = vi.fn();
  render(
    <HeaderBulkStyleDialog
      open
      onOpenChange={vi.fn()}
      initialStyle={{ textBold: false, backgroundColor: '' }}
      onApply={onApply}
    />,
  );

  await userEvent.click(screen.getByRole('switch', { name: '텍스트 굵게' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'HEX 색상' }), 'abc');
  await userEvent.click(screen.getByRole('button', { name: '전체 헤더에 적용' }));

  expect(onApply).toHaveBeenCalledWith({
    textBold: true,
    backgroundColor: '#AABBCC',
  });
});

it('잘못된 HEX는 오류를 표시하고 적용하지 않는다', async () => {
  const onApply = vi.fn();
  render(
    <HeaderBulkStyleDialog
      open
      onOpenChange={vi.fn()}
      initialStyle={{ textBold: false, backgroundColor: '' }}
      onApply={onApply}
    />,
  );

  await userEvent.type(screen.getByRole('textbox', { name: 'HEX 색상' }), '12ZZ99');
  await userEvent.click(screen.getByRole('button', { name: '전체 헤더에 적용' }));

  expect(screen.getByText('3자리 또는 6자리 HEX 색상을 입력하세요.')).toBeInTheDocument();
  expect(onApply).not.toHaveBeenCalled();
});

it('배경색 없음과 Bold 해제를 빈 스타일로 적용한다', async () => {
  const onApply = vi.fn();
  render(
    <HeaderBulkStyleDialog
      open
      onOpenChange={vi.fn()}
      initialStyle={{ textBold: true, backgroundColor: '#112233' }}
      onApply={onApply}
    />,
  );

  await userEvent.click(screen.getByRole('switch', { name: '텍스트 굵게' }));
  await userEvent.click(screen.getByRole('button', { name: '배경색 없음' }));
  await userEvent.click(screen.getByRole('button', { name: '전체 헤더에 적용' }));

  expect(onApply).toHaveBeenCalledWith({ textBold: false, backgroundColor: '' });
});
```

Also assert the preview element with `data-testid="header-style-preview"` receives the chosen `backgroundColor` and Bold class.

- [ ] **Step 2: Run the dialog test and verify it fails**

Run:

```bash
pnpm test -- tests/unit/survey/header-bulk-style-dialog.test.tsx
```

Expected: FAIL because `HeaderBulkStyleDialog` does not exist.

- [ ] **Step 3: Expose reusable field validation and implement the dialog**

Extend `CellStyleFields` with optional validation props without changing existing callers:

```ts
interface CellStyleFieldsProps {
  textBold: boolean;
  backgroundColor: string;
  onTextBoldChange: (value: boolean) => void;
  onBackgroundColorChange: (value: string) => void;
  onBackgroundColorDraftChange?: ((value: string) => void) | undefined;
  error?: string | undefined;
  onInvalidColor?: ((raw: string) => void) | undefined;
}
```

Call `onBackgroundColorDraftChange` on every HEX text change so the dialog owns the exact uncommitted draft. On HEX blur, call `onInvalidColor(draft)` when normalization fails; render `error` below the input with `role="alert"`. Keep the existing cell modal behavior unchanged when the optional props are omitted.

Implement `HeaderBulkStyleDialog` with shadcn `Dialog`, controlled `textBold`, committed `backgroundColor`, exact `backgroundColorDraft`, and `error` state reset from `initialStyle` whenever it opens. Reuse `CellStyleFields` and connect `onBackgroundColorDraftChange={setBackgroundColorDraft}`. The apply handler must validate `backgroundColorDraft` even if the input has not blurred, show `3자리 또는 6자리 HEX 색상을 입력하세요.`, and keep the dialog open on failure. On success call `onApply` with the normalized draft, then `onOpenChange(false)`.

Render this preview:

```tsx
<div
  data-testid="header-style-preview"
  className={cn(
    'rounded-md border border-gray-300 bg-gray-50 px-4 py-3 text-center',
    getCellTextClassName({ textBold }),
  )}
  style={getCellBackgroundStyle({ backgroundColor: normalizedPreviewColor })}
>
  헤더 미리보기
</div>
```

- [ ] **Step 4: Run the dialog and existing cell field tests**

Run:

```bash
pnpm test -- tests/unit/survey/header-bulk-style-dialog.test.tsx tests/unit/survey/cell-style-fields.test.tsx
```

Expected: all dialog tests and existing cell-style field tests PASS.

- [ ] **Step 5: Commit the reusable fields and dialog**

```bash
git add src/components/survey-builder/cell-style-fields.tsx src/components/survey-builder/header-bulk-style-dialog.tsx tests/unit/survey/header-bulk-style-dialog.test.tsx
git commit -m "feat: 전체 헤더 스타일 편집창 추가"
```

---

### Task 3: 빌더 상태 저장과 편집 화면 연결

**Files:**
- Modify: `src/components/survey-builder/hooks/use-table-editor.ts:1262-1301,1398-1411`
- Modify: `src/components/survey-builder/dynamic-table-editor.tsx:1-170,397-425`
- Modify: `src/components/survey-builder/table-header-section.tsx:1-130`
- Modify: `src/components/survey-builder/header-grid-editor.tsx:470-548`
- Create: `tests/unit/survey/table-header-bulk-style-editor.test.tsx`

**Interfaces:**
- Consumes:

```ts
applyHeaderBulkStyle(
  columns: TableColumn[],
  headerGrid: HeaderCell[][] | undefined,
  style: HeaderBulkStyle,
): AppliedHeaderStyle;

getCommonHeaderStyle(
  columns: TableColumn[],
  headerGrid: HeaderCell[][] | undefined,
): HeaderBulkStyle;
```

- Produces from `useTableEditor().actions`:

```ts
applyHeaderStyle(style: HeaderBulkStyle): void;
```

- [ ] **Step 1: Write failing editor integration tests**

Create `tests/unit/survey/table-header-bulk-style-editor.test.tsx`. Mock only the builder/UI stores required by `DynamicTableEditor`, render a two-column table with a two-row merged `tableHeaderGrid`, and verify:

```ts
await userEvent.click(screen.getByRole('button', { name: '헤더 일괄 스타일' }));
await userEvent.click(screen.getByRole('switch', { name: '텍스트 굵게' }));
await userEvent.clear(screen.getByRole('textbox', { name: 'HEX 색상' }));
await userEvent.type(screen.getByRole('textbox', { name: 'HEX 색상' }), '#ddeeff');
await userEvent.click(screen.getByRole('button', { name: '전체 헤더에 적용' }));

expect(onTableChange).toHaveBeenLastCalledWith(expect.objectContaining({
  tableColumns: expect.arrayContaining([
    expect.objectContaining({ textBold: true, backgroundColor: '#DDEEFF' }),
  ]),
  tableHeaderGrid: expect.arrayContaining([
    expect.arrayContaining([
      expect.objectContaining({ textBold: true, backgroundColor: '#DDEEFF' }),
    ]),
  ]),
}));
```

Add a second case without `tableHeaderGrid` that verifies `tableColumns` is updated and `tableHeaderGrid` remains absent. Assert the button is disabled when `currentColumns.length === 0`.

- [ ] **Step 2: Run the integration test and verify it fails**

Run:

```bash
pnpm test -- tests/unit/survey/table-header-bulk-style-editor.test.tsx
```

Expected: FAIL because the button and `applyHeaderStyle` action do not exist.

- [ ] **Step 3: Add the atomic hook action**

In `use-table-editor.ts`, implement:

```ts
const applyHeaderStyle = useCallback((style: HeaderBulkStyle) => {
  const result = applyHeaderBulkStyle(
    currentColumnsRef.current,
    headerGridRef.current,
    style,
  );

  commitColumns(result.columns);
  if (result.headerGrid !== undefined) {
    headerGridRef.current = result.headerGrid;
    setCurrentHeaderGrid(result.headerGrid);
  }

  onTableChangeRef.current({
    tableTitle: currentTitleRef.current,
    tableColumns: result.columns,
    tableRowsData: currentRowsRef.current,
    ...(result.headerGrid !== undefined
      ? { tableHeaderGrid: result.headerGrid }
      : {}),
  });
}, [commitColumns]);
```

Return `applyHeaderStyle` in the `actions` object. Do not call `notifyChange` after `onTableChangeRef.current`; doing both would produce a stale second update.

- [ ] **Step 4: Connect the button and dialog**

In `DynamicTableEditor`:

- import `Palette`, `HeaderBulkStyleDialog`, and `getCommonHeaderStyle`;
- keep `headerStyleDialogOpen` in local state;
- destructure `applyHeaderStyle`;
- add an outline button labeled `헤더 일괄 스타일` beside the `다단계 헤더` label, disabled when no columns exist;
- pass `getCommonHeaderStyle(currentColumns, currentHeaderGrid)` as `initialStyle`;
- pass `applyHeaderStyle` as `onApply`.

Use this button content:

```tsx
<Button
  type="button"
  variant="outline"
  size="sm"
  disabled={currentColumns.length === 0}
  onClick={() => setHeaderStyleDialogOpen(true)}
>
  <Palette className="mr-1.5 h-4 w-4" />
  헤더 일괄 스타일
</Button>
```

- [ ] **Step 5: Render styles in both builder header editors**

In `table-header-section.tsx`, import `cn`, `getCellBackgroundStyle`, and `getCellTextClassName`. Apply the custom background to the outer `ColumnHeader` div and the Bold class to its label `Input`:

```tsx
style={{
  ...getGridSpanStyle(headerColspan),
  ...getCellBackgroundStyle(column),
}}

className={cn(
  'h-7 w-full border border-gray-200 bg-transparent pr-7 text-center text-sm',
  getCellTextClassName(column),
)}
```

Do not style the sticky `행` header.

In `header-grid-editor.tsx`, apply `getCellBackgroundStyle(cell)` after selection/merge background classes and apply `getCellTextClassName(cell)` to the label span and edit input. Keep selection rings visible; custom background affects the cell when not selected and is restored after deselection.

- [ ] **Step 6: Run editor tests**

Run:

```bash
pnpm test -- tests/unit/survey/table-header-bulk-style-editor.test.tsx tests/unit/survey/header-bulk-style-dialog.test.tsx tests/unit/utils/header-style.test.ts
```

Expected: all focused tests PASS.

- [ ] **Step 7: Commit builder persistence and editing UI**

```bash
git add src/components/survey-builder/hooks/use-table-editor.ts src/components/survey-builder/dynamic-table-editor.tsx src/components/survey-builder/table-header-section.tsx src/components/survey-builder/header-grid-editor.tsx tests/unit/survey/table-header-bulk-style-editor.test.tsx
git commit -m "feat: 테이블 전체 헤더 스타일 편집 연결"
```

---

### Task 4: 미리보기·테스트·공개 응답 렌더링

**Files:**
- Modify: `src/components/survey-builder/table-preview.tsx:1-205`
- Modify: `src/components/survey-builder/interactive-table-response.tsx:128-220`
- Create: `tests/unit/survey/table-header-style-rendering.test.tsx`

**Interfaces:**
- Consumes:

```ts
getCellBackgroundStyle(style: CellVisualStyle): CSSProperties | undefined;
getCellTextClassName(style: CellVisualStyle): string | undefined;
```

- Produces: no new public interface; existing `TablePreview` and `InteractiveTableResponse` props render the style fields already carried by `TableColumn` and `HeaderCell`.

- [ ] **Step 1: Write failing renderer tests**

Create `tests/unit/survey/table-header-style-rendering.test.tsx` with two focused cases:

```ts
it('TablePreview 단일 헤더에 배경색과 Bold를 표시한다', () => {
  render(
    <TablePreview
      columns={[
        {
          id: 'c1',
          label: '성별',
          textBold: true,
          backgroundColor: '#DDEEFF',
        },
      ]}
      rows={[]}
    />,
  );

  const header = screen.getByRole('columnheader', { name: '성별' });
  expect(header).toHaveStyle({ backgroundColor: '#DDEEFF' });
  expect(header).toHaveClass('font-bold');
});

it('InteractiveTableResponse 병합 다단계 헤더에 배경색과 Bold를 표시한다', () => {
  render(
    <InteractiveTableResponse
      questionId="q1"
      columns={[
        { id: 'c1', label: '남성' },
        { id: 'c2', label: '여성' },
      ]}
      rows={[]}
      tableHeaderGrid={[
        [{
          id: 'h1',
          label: '성별',
          colspan: 2,
          rowspan: 1,
          textBold: true,
          backgroundColor: '#FFEEDD',
        }],
      ]}
      value={{}}
      onChange={vi.fn()}
    />,
  );

  const header = screen.getByRole('columnheader', { name: '성별' });
  expect(header).toHaveStyle({ backgroundColor: '#FFEEDD' });
  expect(header).toHaveClass('font-bold');
  expect(header).toHaveAttribute('aria-colspan', '2');
});
```

The shown `InteractiveTableResponse` props are sufficient because its remaining props are optional; do not mock the render components themselves.

- [ ] **Step 2: Run the rendering test and verify it fails**

Run:

```bash
pnpm test -- tests/unit/survey/table-header-style-rendering.test.tsx
```

Expected: FAIL because header background and Bold are not yet attached to the rendered header elements.

- [ ] **Step 3: Apply styles in `TablePreview`**

Import `getCellTextClassName` alongside `getCellBackgroundStyle` and use `cn` for classes. In both multiheader and fallback branches:

```tsx
className={cn(HEADER_CELL_CLASS, getCellTextClassName(cellOrColumn))}
style={{
  ...existingGridAndStickyStyle,
  ...getCellBackgroundStyle(cellOrColumn),
}}
```

Spread the custom background after `getHeaderCellStickyStyle` so `backgroundColor` wins over the default `bg-gray-50`, while sticky `left`, `zIndex`, and grid placement remain unchanged.

- [ ] **Step 4: Apply styles in `InteractiveTableResponse`**

Import `cn`, `getCellBackgroundStyle`, and `getCellTextClassName`. Apply the same class/style composition to:

- visible multiheader cells;
- visible fallback `TableColumn` headers.

Leave the `aria-hidden` placeholder for `isHeaderHidden` unchanged because it does not display a label and is only used for sticky geometry.

- [ ] **Step 5: Run renderer and related table tests**

Run:

```bash
pnpm test -- tests/unit/survey/table-header-style-rendering.test.tsx tests/unit/utils/reconcile-header-grid.test.ts tests/unit/utils/mobile-display-cells.test.ts
```

Expected: all focused renderer, header-grid, and mobile-display tests PASS.

- [ ] **Step 6: Commit all response rendering paths**

```bash
git add src/components/survey-builder/table-preview.tsx src/components/survey-builder/interactive-table-response.tsx tests/unit/survey/table-header-style-rendering.test.tsx
git commit -m "feat: 설문 테이블 헤더 스타일 렌더링 추가"
```

---

### Task 5: 회귀 검증과 최종 정리

**Files:**
- Modify only if verification exposes a regression in files already listed in Tasks 1-4.

**Interfaces:**
- Consumes: all interfaces from Tasks 1-4.
- Produces: a verified implementation with no new lint/type/test failures.

- [ ] **Step 1: Run all feature-focused tests**

Run:

```bash
pnpm test -- tests/unit/utils/header-style.test.ts tests/unit/utils/cell-style.test.ts tests/unit/survey/cell-style-fields.test.tsx tests/unit/survey/header-bulk-style-dialog.test.tsx tests/unit/survey/table-header-bulk-style-editor.test.tsx tests/unit/survey/table-header-style-rendering.test.tsx tests/unit/utils/reconcile-header-grid.test.ts tests/unit/utils/mobile-display-cells.test.ts
```

Expected: all selected tests PASS.

- [ ] **Step 2: Run static verification**

Run:

```bash
pnpm exec tsc --noEmit
pnpm lint
```

Expected: TypeScript and ESLint complete without new errors. If the repository reports a pre-existing failure, record the exact command and output separately and confirm the changed files have no corresponding diagnostic.

- [ ] **Step 3: Inspect persistence and scope diffs**

Run:

```bash
git diff --check
git diff --stat HEAD~4..HEAD
git status --short
```

Verify:

- no migration or dependency file changed;
- only `TableColumn`/`HeaderCell` receive the new fields;
- empty styles delete optional properties;
- both single and multiheader render branches use the style helpers;
- unrelated dirty user files remain untouched and unstaged.

- [ ] **Step 4: Perform a manual browser smoke test**

Run `pnpm dev`, then verify in the existing local survey builder:

1. Create or open a table with basic headers.
2. Open `헤더 일괄 스타일`, enable Bold, enter `abc`, and apply.
3. Confirm every basic header displays `#AABBCC` and Bold.
4. Enable a multirow header, merge at least two slots, reapply another color, and confirm every header level changes.
5. Open preview/test mode and confirm the styles persist.
6. Reload the editor and confirm saved styles remain.
7. Open the public response route and confirm the same style appears.
8. Clear the background and disable Bold, then confirm all headers return to defaults.
9. Add a new column after styling and confirm it does not inherit until the bulk action is applied again.

- [ ] **Step 5: Create a final fix commit only if verification required code changes**

If Tasks 1-4 already pass unchanged, do not create an empty commit. If verification required a scoped correction:

```bash
git add src/types/survey.ts src/utils/header-style.ts src/components/survey-builder/cell-style-fields.tsx src/components/survey-builder/header-bulk-style-dialog.tsx src/components/survey-builder/hooks/use-table-editor.ts src/components/survey-builder/dynamic-table-editor.tsx src/components/survey-builder/table-header-section.tsx src/components/survey-builder/header-grid-editor.tsx src/components/survey-builder/table-preview.tsx src/components/survey-builder/interactive-table-response.tsx tests/unit/utils/header-style.test.ts tests/unit/survey/header-bulk-style-dialog.test.tsx tests/unit/survey/table-header-bulk-style-editor.test.tsx tests/unit/survey/table-header-style-rendering.test.tsx
git commit -m "fix: 테이블 헤더 스타일 회귀 보완"
```
