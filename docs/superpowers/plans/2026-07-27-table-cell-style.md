# Table Cell Style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 설문 빌더의 단일 테이블 셀에 텍스트 Bold와 사용자 지정 배경색을 저장하고, PC 표·모바일 Bold·파생 옵션 UI에 설계된 우선순위로 표시한다.

**Architecture:** `TableCell`과 파생 `QuestionOption`에 선택적 스타일 필드를 추가하고, HEX 정규화와 공통 렌더링 해석은 새 `cell-style.ts`가 소유한다. 셀 편집 UI는 독립 `CellStyleFields` 컴포넌트로 분리하고 기존 `CellFormState → buildUpdatedCell` 저장 흐름을 확장한다. 각 표 렌더러는 공통 헬퍼를 사용하되 모바일 카드는 배경색을 의도적으로 무시한다.

**Tech Stack:** TypeScript 5.9 strict, React 19, Next.js 16, Tailwind CSS 4, Zustand, Vitest, Testing Library

## Global Constraints

- 선택한 `TableCell` 하나에만 스타일을 저장한다. 행·열 단위 스타일과 다중 셀 일괄 편집은 제외한다.
- Bold는 셀의 `content`와 `choice_opt`·`ranking_opt` 파생 옵션 라벨에만 적용한다. 입력값과 셀 내부 옵션 글씨에는 적용하지 않는다.
- 배경색은 PC의 해당 셀 하나에만 적용한다. 병합 셀은 병합 영역 전체에 적용한다.
- 모바일 카드는 기존 배경을 유지하고 Bold만 적용한다.
- 사용자 지정 색상 선택기와 HEX 직접 입력만 제공한다. 프리셋은 제공하지 않는다.
- `RGB`, `RRGGBB`, 선택적 `#`를 받고 대문자 `#RRGGBB`로 저장한다. 알파 채널은 지원하지 않는다.
- 사용자 지정 배경색은 기본·완료·선택·호버 배경보다 우선한다. 상태 표시는 기존 테두리·링·컨트롤로 유지한다.
- 글자색은 자동 변경하지 않는다.
- 셀·영역 복사와 셀 보관함은 스타일을 함께 복사한다.
- 엑셀·SPSS 내보내기에는 스타일을 반영하지 않는다.
- 기존 셀과 기존 설문 스냅샷은 스타일 필드가 없어도 현재 모양을 유지해야 한다.
- PostgreSQL/Drizzle 마이그레이션을 추가하지 않는다. 스타일은 기존 JSONB에 저장한다.

---

## File Map

**Create**

- `src/utils/cell-style.ts` — HEX 정규화와 `TableCell`/`QuestionOption` 공통 스타일 해석
- `src/components/survey-builder/cell-style-fields.tsx` — Bold 토글, color picker, HEX 입력, 초기화
- `tests/unit/utils/cell-style.test.ts` — 색상 정규화와 스타일 헬퍼
- `tests/unit/survey/cell-style-fields.test.tsx` — 편집 컨트롤 상호작용
- `tests/unit/survey/table-cell-style-rendering.test.tsx` — 셀 단위 배경·Bold 렌더링
- `tests/unit/survey/ranking-option-style.test.tsx` — 순위 드롭다운 목록·선택 트리거 스타일

**Modify**

- `src/types/survey.ts` — `TableCell`, `QuestionOption` 스타일 필드
- `src/utils/serialize-cell.ts` — 폼 hydrate/직렬화/기본값 제거
- `src/components/survey-builder/hooks/use-cell-form.ts` — 스타일 setter
- `src/components/survey-builder/cell-content-modal.tsx` — `CellStyleFields` 연결과 미리보기
- `src/components/survey-builder/cells/cell-content-layout.tsx` — 셀 라벨 Bold
- `src/components/survey-builder/cells/text-cell.tsx` — text 셀 Bold
- `src/components/survey-builder/cells/preview-cell.tsx` — 특수 셀 content Bold
- `src/components/survey-builder/editor-table-row.tsx` — 빌더 셀 배경·Bold 및 선택/호버 우선순위
- `src/components/survey-builder/table-preview.tsx` — 미리보기 셀 배경
- `src/components/survey-builder/interactive-table-response.tsx` — 실제 응답 셀 배경
- `src/components/survey-builder/virtualized-table-grid.tsx` — 가상 표 셀 배경
- `src/components/survey/mobile-display-cells.tsx` — 모바일 표시 텍스트 Bold, 배경 미적용
- `src/components/survey-response/choice-table-response.tsx` — 파생 보기 라벨 Bold, 모바일 카드 배경 예외
- `src/components/survey-response/ranking-question.tsx` — 모바일 참조 카드 Bold
- `src/components/survey-response/ranking-dropdown-stack.tsx` — 파생 순위 옵션 목록·트리거 스타일
- `src/utils/choice-source.ts` — `choice_opt` 스타일을 `QuestionOption`으로 전달
- `src/utils/ranking-source.ts` — `ranking_opt` 스타일을 `QuestionOption`으로 전달
- `tests/unit/serialize-cell.test.ts` — 스타일 왕복과 초기화
- `tests/unit/lib/choice-source.test.ts` — 보기 옵션 스타일 변환
- `tests/unit/utils/ranking-source.test.ts` — 순위 옵션 스타일 변환
- `tests/unit/utils/drag-copy-region.test.ts` — 영역 복사 스타일 보존 characterization
- `tests/unit/survey/choice-table-response-mobile.test.tsx` — 모바일 옵션 카드 Bold·배경 예외

---

### Task 1: Cell Style Domain Contract

**Files:**

- Create: `src/utils/cell-style.ts`
- Create: `tests/unit/utils/cell-style.test.ts`
- Modify: `src/types/survey.ts`

**Interfaces:**

- Produces: `CellVisualStyle`, `normalizeCellHexColor(raw): string | null`, `getCellBackgroundStyle(style): React.CSSProperties | undefined`, `getCellTextClassName(style): string | undefined`
- Produces: `TableCell.textBold`, `TableCell.backgroundColor`, `QuestionOption.textBold`, `QuestionOption.backgroundColor`

- [ ] **Step 1: Write failing HEX and style helper tests**

```ts
import {
  getCellBackgroundStyle,
  getCellTextClassName,
  normalizeCellHexColor,
} from '@/utils/cell-style';

it.each([
  ['abc', '#AABBCC'],
  ['#abc', '#AABBCC'],
  ['a1b2c3', '#A1B2C3'],
  ['#A1B2C3', '#A1B2C3'],
])('HEX %s를 canonical 색상으로 정규화한다', (raw, expected) => {
  expect(normalizeCellHexColor(raw)).toBe(expected);
});

it.each(['', '#12', 'GGGGGG', '#12345', '#12345678'])(
  '잘못된 HEX %s는 거부한다',
  (raw) => expect(normalizeCellHexColor(raw)).toBeNull(),
);

it('스타일 필드가 없으면 렌더링 기본값을 건드리지 않는다', () => {
  expect(getCellBackgroundStyle({})).toBeUndefined();
  expect(getCellTextClassName({})).toBeUndefined();
});

it('명시 스타일만 렌더링 값으로 변환한다', () => {
  expect(getCellBackgroundStyle({ backgroundColor: '#AABBCC' })).toEqual({
    backgroundColor: '#AABBCC',
  });
  expect(getCellTextClassName({ textBold: true })).toBe('font-bold');
});
```

- [ ] **Step 2: Run the helper test and verify RED**

Run: `pnpm exec vitest run tests/unit/utils/cell-style.test.ts`

Expected: FAIL because `@/utils/cell-style` and style fields do not exist.

- [ ] **Step 3: Add the style fields and minimal helper**

```ts
// src/types/survey.ts — QuestionOption and TableCell
textBold?: boolean;
backgroundColor?: string;

// src/utils/cell-style.ts
import type { CSSProperties } from 'react';

export interface CellVisualStyle {
  textBold?: boolean | undefined;
  backgroundColor?: string | undefined;
}

export function normalizeCellHexColor(raw: string): string | null {
  const value = raw.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(value)) {
    return `#${value
      .split('')
      .map((char) => char + char)
      .join('')
      .toUpperCase()}`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(value)) return `#${value.toUpperCase()}`;
  return null;
}

export function getCellBackgroundStyle(
  style: CellVisualStyle,
): CSSProperties | undefined {
  return style.backgroundColor ? { backgroundColor: style.backgroundColor } : undefined;
}

export function getCellTextClassName(style: CellVisualStyle): string | undefined {
  return style.textBold ? 'font-bold' : undefined;
}
```

- [ ] **Step 4: Run the helper test and typecheck**

Run: `pnpm exec vitest run tests/unit/utils/cell-style.test.ts && pnpm exec tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit the domain contract**

```bash
git add src/types/survey.ts src/utils/cell-style.ts tests/unit/utils/cell-style.test.ts
git commit -m "feat: 개별 셀 스타일 데이터 모델 추가"
```

---

### Task 2: Cell Form Persistence and Editing Controls

**Files:**

- Create: `src/components/survey-builder/cell-style-fields.tsx`
- Create: `tests/unit/survey/cell-style-fields.test.tsx`
- Modify: `src/utils/serialize-cell.ts`
- Modify: `src/components/survey-builder/hooks/use-cell-form.ts`
- Modify: `src/components/survey-builder/cell-content-modal.tsx`
- Modify: `tests/unit/serialize-cell.test.ts`

**Interfaces:**

- Consumes: `normalizeCellHexColor`, `TableCell.textBold`, `TableCell.backgroundColor`
- Produces: `CellFormState.textBold: boolean`, `CellFormState.backgroundColor: string`, setters `setTextBold`, `setBackgroundColor`
- Produces: `<CellStyleFields textBold backgroundColor onTextBoldChange onBackgroundColorChange />`

- [ ] **Step 1: Add failing serialization tests**

```ts
it('개별 셀 Bold와 배경색을 폼으로 복원하고 저장한다', () => {
  const styled = {
    ...baseCell,
    textBold: true,
    backgroundColor: '#AABBCC',
  };
  const form = cellToFormState(styled);
  expect(form).toMatchObject({ textBold: true, backgroundColor: '#AABBCC' });
  expect(buildUpdatedCell(form, styled)).toMatchObject({
    textBold: true,
    backgroundColor: '#AABBCC',
  });
});

it('Bold 해제와 배경색 초기화는 기존 스타일 키를 제거한다', () => {
  const styled = {
    ...baseCell,
    textBold: true,
    backgroundColor: '#AABBCC',
  };
  const form = {
    ...cellToFormState(styled),
    textBold: false,
    backgroundColor: '',
  };
  const result = buildUpdatedCell(form, styled);
  expect(result).not.toHaveProperty('textBold');
  expect(result).not.toHaveProperty('backgroundColor');
});
```

- [ ] **Step 2: Run serialization tests and verify RED**

Run: `pnpm exec vitest run tests/unit/serialize-cell.test.ts`

Expected: FAIL because `CellFormState` has no style fields.

- [ ] **Step 3: Extend form hydrate, setters, and serialization**

Add to `CellFormState`:

```ts
textBold: boolean;
backgroundColor: string;
```

Hydrate with:

```ts
textBold: cell.textBold === true,
backgroundColor: cell.backgroundColor ?? '',
```

Remove `textBold` and `backgroundColor` from `cellBase`, then conditionally save:

```ts
...(form.textBold ? { textBold: true } : {}),
...(form.backgroundColor ? { backgroundColor: form.backgroundColor } : {}),
```

Add `setTextBold` and `setBackgroundColor` through the existing generic setter factory.

- [ ] **Step 4: Run serialization tests and verify GREEN**

Run: `pnpm exec vitest run tests/unit/serialize-cell.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing `CellStyleFields` interaction tests**

```tsx
it('Bold를 토글하고 유효한 HEX만 canonical 값으로 전달한다', async () => {
  const user = userEvent.setup();
  const onBold = vi.fn();
  const onBackground = vi.fn();
  render(
    <CellStyleFields
      textBold={false}
      backgroundColor=""
      onTextBoldChange={onBold}
      onBackgroundColorChange={onBackground}
    />,
  );

  await user.click(screen.getByRole('switch', { name: '텍스트 굵게' }));
  expect(onBold).toHaveBeenCalledWith(true);

  await user.type(screen.getByLabelText('HEX 색상'), 'abc');
  await user.tab();
  expect(onBackground).toHaveBeenCalledWith('#AABBCC');
});

it('잘못된 HEX는 기존 색을 바꾸지 않고 초기화 버튼은 색을 제거한다', async () => {
  const user = userEvent.setup();
  const onBackground = vi.fn();
  render(
    <CellStyleFields
      textBold={false}
      backgroundColor="#112233"
      onTextBoldChange={() => {}}
      onBackgroundColorChange={onBackground}
    />,
  );

  await user.clear(screen.getByLabelText('HEX 색상'));
  await user.type(screen.getByLabelText('HEX 색상'), 'ZZZ');
  await user.tab();
  expect(onBackground).not.toHaveBeenCalled();

  await user.click(screen.getByRole('button', { name: '배경색 없음' }));
  expect(onBackground).toHaveBeenCalledWith('');
});
```

- [ ] **Step 6: Run component tests and verify RED**

Run: `pnpm exec vitest run tests/unit/survey/cell-style-fields.test.tsx`

Expected: FAIL because `CellStyleFields` does not exist.

- [ ] **Step 7: Implement the focused style editor**

Use `Switch` for Bold, `<input type="color">` for the picker, a controlled draft `Input` for HEX,
and an outline reset `Button`. The color picker sends uppercase `#RRGGBB`; HEX draft only calls
`onBackgroundColorChange` when `normalizeCellHexColor` returns a value. Do not render preset colors.

```tsx
<Switch
  aria-label="텍스트 굵게"
  checked={textBold}
  onCheckedChange={onTextBoldChange}
/>
<input
  type="color"
  aria-label="배경색 선택"
  value={backgroundColor || '#FFFFFF'}
  onChange={(event) => onBackgroundColorChange(event.target.value.toUpperCase())}
/>
<Input aria-label="HEX 색상" value={draft} onChange={...} onBlur={commitDraft} />
<Button type="button" variant="outline" onClick={() => onBackgroundColorChange('')}>
  배경색 없음
</Button>
```

- [ ] **Step 8: Connect the style editor and modal preview**

Destructure the new form values/setters in `CellContentModal`, render `CellStyleFields` above
`컨텐츠 정렬`, and apply `font-bold` plus inline `backgroundColor` to the existing preview box.
Pass `key={cell.id}` to `CellStyleFields` so an in-place cell change resets its HEX draft.

- [ ] **Step 9: Run form and modal-adjacent tests**

Run:

```bash
pnpm exec vitest run \
  tests/unit/serialize-cell.test.ts \
  tests/unit/survey/cell-style-fields.test.tsx \
  tests/unit/survey/cell-modal-stale-rows-group.test.tsx
```

Expected: PASS.

- [ ] **Step 10: Commit the editing flow**

```bash
git add \
  src/utils/serialize-cell.ts \
  src/components/survey-builder/hooks/use-cell-form.ts \
  src/components/survey-builder/cell-style-fields.tsx \
  src/components/survey-builder/cell-content-modal.tsx \
  tests/unit/serialize-cell.test.ts \
  tests/unit/survey/cell-style-fields.test.tsx
git commit -m "feat: 셀 스타일 편집과 저장 기능 추가"
```

---

### Task 3: Desktop Table Rendering and State Precedence

**Files:**

- Create: `tests/unit/survey/table-cell-style-rendering.test.tsx`
- Modify: `src/components/survey-builder/cells/cell-content-layout.tsx`
- Modify: `src/components/survey-builder/cells/text-cell.tsx`
- Modify: `src/components/survey-builder/cells/preview-cell.tsx`
- Modify: `src/components/survey-builder/cells/cell-options-container.tsx`
- Modify: `src/components/survey-builder/cells/input-cell.tsx`
- Modify: `src/components/survey-builder/cells/select-cell.tsx`
- Modify: `src/components/survey-builder/cells/ranking-cell.tsx`
- Modify: `src/components/survey-builder/editor-table-row.tsx`
- Modify: `src/components/survey-builder/table-preview.tsx`
- Modify: `src/components/survey-builder/interactive-table-response.tsx`
- Modify: `src/components/survey-builder/virtualized-table-grid.tsx`

**Interfaces:**

- Consumes: `getCellBackgroundStyle(cell)`, `getCellTextClassName(cell)`
- Produces: `CellContentLayout.bold?: boolean`

- [ ] **Step 1: Write failing rendering tests**

Render a two-cell `TablePreview` where only the first cell has style:

```tsx
const rows = [{
  id: 'row-1',
  label: '',
  cells: [
    { id: 'styled', type: 'text', content: '강조', textBold: true, backgroundColor: '#AABBCC' },
    { id: 'plain', type: 'text', content: '일반' },
  ],
}];

render(<TablePreview columns={columns} rows={rows} />);

expect(screen.getByTestId('cell-styled')).toHaveStyle({ backgroundColor: '#AABBCC' });
expect(screen.getByText('강조')).toHaveClass('font-bold');
expect(screen.getByTestId('cell-plain')).not.toHaveStyle({ backgroundColor: '#AABBCC' });
expect(screen.getByText('일반')).not.toHaveClass('font-bold');
```

Render `InteractiveTableResponse` with an input cell carrying `backgroundColor: '#AABBCC'` and
`value={{ inputCellId: '완료 응답' }}` so its row-completion map is true. Query
`[data-cell-id="inputCellId"]` and assert the explicit inline color remains `#AABBCC`. Add a
merged-cell fixture (`colspan: 2` anchor plus `isHidden: true` continuation) and assert only the
visible anchor receives the style.

- [ ] **Step 2: Run rendering tests and verify RED**

Run: `pnpm exec vitest run tests/unit/survey/table-cell-style-rendering.test.tsx`

Expected: FAIL because the style is not rendered.

- [ ] **Step 3: Add Bold to common content renderers**

Add `bold?: boolean` to `CellContentLayoutProps` and merge `font-bold` after the default
`font-medium` class. Pass `bold={cell.textBold}` from input/select/options/ranking preview and
interactive callers. Apply `getCellTextClassName(cell)` to `TextCell`, `PreviewCell` special
`ranking_opt`/`choice_opt`/default/video content, and `EditorCellContent`.

Do not apply Bold to checkbox/radio option labels, input values, select option labels, or ranking
cell-internal options.

- [ ] **Step 4: Apply background style to desktop cell containers**

Merge `getCellBackgroundStyle(cell)` into the existing `style` object in:

```ts
Object.assign(style, getCellBackgroundStyle(cell));
```

Use it in `TablePreview`, `InteractiveTableResponse`, and `VirtualizedTableGrid`. In
`EditorTableRow`, apply it to the outer grid cell. When `cell.backgroundColor` exists, omit
`bg-blue-50` and `hover:bg-gray-50`; preserve selection rings and settings icons.

Because inline `backgroundColor` wins over Tailwind background classes, completed green remains
for unstyled cells and the explicit color remains for styled cells.

- [ ] **Step 5: Run rendering and existing table tests**

Run:

```bash
pnpm exec vitest run \
  tests/unit/survey/table-cell-style-rendering.test.tsx \
  tests/unit/survey/preview-cell-choice.test.tsx \
  tests/unit/survey/mobile-original-table.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit desktop rendering**

```bash
git add \
  src/components/survey-builder/cells/cell-content-layout.tsx \
  src/components/survey-builder/cells/text-cell.tsx \
  src/components/survey-builder/cells/preview-cell.tsx \
  src/components/survey-builder/cells/cell-options-container.tsx \
  src/components/survey-builder/cells/input-cell.tsx \
  src/components/survey-builder/cells/select-cell.tsx \
  src/components/survey-builder/cells/ranking-cell.tsx \
  src/components/survey-builder/editor-table-row.tsx \
  src/components/survey-builder/table-preview.tsx \
  src/components/survey-builder/interactive-table-response.tsx \
  src/components/survey-builder/virtualized-table-grid.tsx \
  tests/unit/survey/table-cell-style-rendering.test.tsx
git commit -m "feat: 개별 셀 스타일을 표 화면에 적용"
```

---

### Task 4: Mobile Exceptions, Option Propagation, and Copy Guarantees

**Files:**

- Modify: `src/components/survey/mobile-display-cells.tsx`
- Modify: `src/components/survey-response/choice-table-response.tsx`
- Modify: `src/components/survey-response/ranking-question.tsx`
- Modify: `src/utils/choice-source.ts`
- Modify: `src/utils/ranking-source.ts`
- Modify: `tests/unit/lib/choice-source.test.ts`
- Modify: `tests/unit/utils/ranking-source.test.ts`
- Modify: `tests/unit/utils/drag-copy-region.test.ts`
- Modify: `tests/unit/survey/choice-table-response-mobile.test.tsx`

**Interfaces:**

- Consumes: `QuestionOption.textBold`, `QuestionOption.backgroundColor`, `getCellTextClassName`
- Produces: table-source option conversion that preserves style
- Preserves: mobile card background remains the existing white/selected styling

- [ ] **Step 1: Write failing option conversion tests**

```ts
it('choice_opt 스타일을 파생 QuestionOption에 전달한다', () => {
  const options = resolveChoiceOptions(makeChoiceQuestion({
    textBold: true,
    backgroundColor: '#AABBCC',
  }));
  expect(options[0]).toMatchObject({ textBold: true, backgroundColor: '#AABBCC' });
});

it('ranking_opt 스타일을 파생 QuestionOption에 전달한다', () => {
  const options = resolveRankingOptionsFromCells([{
    id: 'rank-cell',
    type: 'ranking_opt',
    content: '항목',
    textBold: true,
    backgroundColor: '#AABBCC',
  }]);
  expect(options[0]).toMatchObject({ textBold: true, backgroundColor: '#AABBCC' });
});
```

- [ ] **Step 2: Run source tests and verify RED**

Run:

```bash
pnpm exec vitest run \
  tests/unit/lib/choice-source.test.ts \
  tests/unit/utils/ranking-source.test.ts
```

Expected: FAIL because style fields are dropped.

- [ ] **Step 3: Preserve style in both option resolvers**

Add conditional spreads in both source utilities:

```ts
...(cell.textBold ? { textBold: true } : {}),
...(cell.backgroundColor ? { backgroundColor: cell.backgroundColor } : {}),
```

Apply the same spread to the `isOtherRankingCell` branch.

- [ ] **Step 4: Add mobile Bold without mobile background**

In `MobileDisplayCells`, apply `font-bold` to text content when `cell.textBold`; do not read
`backgroundColor`.

In `ChoiceTableResponse`, apply Bold to the desktop `choice_opt` content label. For
`MobileOptionCard.label`, wrap the label with `font-bold` when the source option/cell requests it;
do not pass a background style or change `MobileOptionCard` itself.

In `RankingQuestion` mobile reference cards, wrap the derived label with the option's Bold class;
do not change card background.

- [ ] **Step 5: Write mobile and copy characterization tests**

Extend `choice-table-response-mobile.test.tsx` with a `choice_opt` cell carrying both style fields.
Assert its `MobileOptionCard` label is bold while the closest card container still has `bg-white`
and no inline `backgroundColor`.

Extend `drag-copy-region.test.ts`:

```ts
it('영역 복사 스냅샷이 개별 셀 스타일을 보존한다', () => {
  const region = extractRegionFromRows(0, 0, 0, 0, [{
    id: 'row',
    label: '',
    cells: [{
      id: 'cell',
      type: 'text',
      content: 'A',
      textBold: true,
      backgroundColor: '#AABBCC',
    }],
  }]);
  expect(region.cells[0]?.[0]).toMatchObject({
    textBold: true,
    backgroundColor: '#AABBCC',
  });
});
```

This should pass without production copy changes because both single-cell and region copy clone
the complete `TableCell` except identity/location keys. If it fails, fix only the copy whitelist
that drops the style.

- [ ] **Step 6: Run mobile, resolver, and copy tests**

Run:

```bash
pnpm exec vitest run \
  tests/unit/lib/choice-source.test.ts \
  tests/unit/utils/ranking-source.test.ts \
  tests/unit/utils/drag-copy-region.test.ts \
  tests/unit/survey/choice-table-response-mobile.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit mobile and propagation behavior**

```bash
git add \
  src/components/survey/mobile-display-cells.tsx \
  src/components/survey-response/choice-table-response.tsx \
  src/components/survey-response/ranking-question.tsx \
  src/utils/choice-source.ts \
  src/utils/ranking-source.ts \
  tests/unit/lib/choice-source.test.ts \
  tests/unit/utils/ranking-source.test.ts \
  tests/unit/utils/drag-copy-region.test.ts \
  tests/unit/survey/choice-table-response-mobile.test.tsx
git commit -m "feat: 셀 스타일을 모바일과 파생 옵션에 연결"
```

---

### Task 5: Ranking Dropdown Option Styles

**Files:**

- Create: `tests/unit/survey/ranking-option-style.test.tsx`
- Modify: `src/components/survey-response/ranking-dropdown-stack.tsx`

**Interfaces:**

- Consumes: `QuestionOption.textBold`, `QuestionOption.backgroundColor`
- Produces: open Radix option rows and selected trigger styled from the selected option

- [ ] **Step 1: Write failing dropdown style tests**

Render `RankingDropdownStack` with:

```ts
const options = [
  {
    id: 'styled',
    value: 'styled',
    label: '강조 옵션',
    textBold: true,
    backgroundColor: '#AABBCC',
  },
  { id: 'plain', value: 'plain', label: '일반 옵션' },
];
```

Open the first rank select and assert the `강조 옵션` item has `font-bold` and
`background-color: #AABBCC`, while `일반 옵션` does not. Rerender with
`answers={[{ rank: 1, optionValue: 'styled' }]}` and assert the `1순위 선택` trigger has the same
style. Keep a separate compact-mode assertion that the native `<option>` receives the same
best-effort style without changing the native select architecture.

- [ ] **Step 2: Run dropdown tests and verify RED**

Run: `pnpm exec vitest run tests/unit/survey/ranking-option-style.test.tsx`

Expected: FAIL because options and trigger ignore style fields.

- [ ] **Step 3: Style Radix items, selected trigger, and compact native options**

Compute `selectedOpt` before constructing both select variants. Apply:

```tsx
const selectedStyle = selectedOpt?.backgroundColor
  ? { backgroundColor: selectedOpt.backgroundColor }
  : undefined;
const selectedBold = selectedOpt?.textBold ? 'font-bold' : undefined;

const triggerWidthStyle =
  isHorizontal && !isMobile ? { width: RANKING_HORIZONTAL_ITEM_WIDTH } : undefined;

<SelectTrigger
  className={cn(
    isHorizontal && !isMobile ? '' : 'w-full',
    'min-w-0',
    isMobile ? 'h-12 text-base' : 'h-11 text-sm',
    selectedBold,
  )}
  style={{ ...triggerWidthStyle, ...selectedStyle }}
>

<SelectItem
  className={cn(itemCls, opt.textBold && 'font-bold')}
  style={opt.backgroundColor ? { backgroundColor: opt.backgroundColor } : undefined}
>

<option
  className={opt.textBold ? 'font-bold' : undefined}
  style={opt.backgroundColor ? { backgroundColor: opt.backgroundColor } : undefined}
>
```

Preserve disabled/taken state, selected indicators, widths, and mobile sizing.

- [ ] **Step 4: Run dropdown and ranking regression tests**

Run:

```bash
pnpm exec vitest run \
  tests/unit/survey/ranking-option-style.test.tsx \
  tests/integration/ranking-grouped-response.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit ranking option rendering**

```bash
git add \
  src/components/survey-response/ranking-dropdown-stack.tsx \
  tests/unit/survey/ranking-option-style.test.tsx
git commit -m "feat: 순위 옵션에 셀 스타일 표시"
```

---

### Task 6: Full Verification and Documentation Alignment

**Files:**

- Modify only if verification exposes a regression in the files listed above.

**Interfaces:**

- Consumes: all previous task contracts
- Produces: verified implementation matching `docs/superpowers/specs/2026-07-27-table-cell-style-design.md`

- [ ] **Step 1: Run the focused feature suite**

```bash
pnpm exec vitest run \
  tests/unit/utils/cell-style.test.ts \
  tests/unit/serialize-cell.test.ts \
  tests/unit/survey/cell-style-fields.test.tsx \
  tests/unit/survey/table-cell-style-rendering.test.tsx \
  tests/unit/lib/choice-source.test.ts \
  tests/unit/utils/ranking-source.test.ts \
  tests/unit/utils/drag-copy-region.test.ts \
  tests/unit/survey/choice-table-response-mobile.test.tsx \
  tests/unit/survey/ranking-option-style.test.tsx
```

Expected: all listed tests PASS.

- [ ] **Step 2: Run typecheck and scoped lint**

```bash
pnpm exec tsc --noEmit
pnpm exec eslint --quiet \
  src/types/survey.ts \
  src/utils/cell-style.ts \
  src/utils/serialize-cell.ts \
  src/utils/choice-source.ts \
  src/utils/ranking-source.ts \
  src/components/survey-builder/cell-style-fields.tsx \
  src/components/survey-builder/hooks/use-cell-form.ts \
  src/components/survey-builder/cell-content-modal.tsx \
  src/components/survey-builder/cells \
  src/components/survey-builder/editor-table-row.tsx \
  src/components/survey-builder/table-preview.tsx \
  src/components/survey-builder/interactive-table-response.tsx \
  src/components/survey-builder/virtualized-table-grid.tsx \
  src/components/survey/mobile-display-cells.tsx \
  src/components/survey-response/choice-table-response.tsx \
  src/components/survey-response/ranking-question.tsx \
  src/components/survey-response/ranking-dropdown-stack.tsx
```

Expected: both commands exit 0.

- [ ] **Step 3: Run the complete Vitest suite**

Run: `pnpm test`

Expected: PASS, allowing only the documented `profiles-row-actions.test.ts` full-suite flake when an
isolated rerun passes.

- [ ] **Step 4: Review the final diff against every global constraint**

Confirm:

- No SQL migration or package dependency was added.
- Unstyled cells have no new inline background and no new font class.
- Only the selected cell stores style.
- Mobile cards never consume `backgroundColor`.
- Derived choice/ranking options preserve both style fields.
- Exports and response values are unchanged.
- Existing unrelated dirty worktree changes are not staged.

- [ ] **Step 5: Commit verification-only fixes if needed**

If Step 1–4 required code corrections, stage only those exact files and commit:

```bash
git commit -m "fix: 개별 셀 스타일 회귀 수정"
```

If no correction was needed, do not create an empty commit.
