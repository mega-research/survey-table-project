# 응답 헤더 정렬 옵션 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 응답 헤더에 제목 정렬(왼쪽/중앙/오른쪽, 전 스타일 공통)과 로고 세로 정렬(위/중앙/아래, 양끝 정보형 전용) 옵션을 추가한다.

**Architecture:** `SurveyResponseHeaderConfig` 에 optional `titleAlign`(세 변형)·`logoAlign`(official-band) 를 추가하고, `normalizeResponseHeaderConfig` 가 스타일별 기본값으로 보강한다. 렌더(`SurveyResponseHeader`)·빌더 UI(`ResponseHeaderSettings`)·미리보기가 같은 정규화 설정을 사용한다. JSONB 컬럼은 이미 존재하므로 마이그레이션은 없다.

**Tech Stack:** Next.js 16, React 19, TypeScript strict(+exactOptionalPropertyTypes), TailwindCSS, Vitest, Testing Library.

## Global Constraints

- 파일명 kebab-case `.tsx`/`.ts`; 변수/함수명 영어; 주석/UI 텍스트 한국어; 이모지 금지.
- git commit 메시지 한국어 `feat:` 형식, 괄호 `()` 금지.
- TypeScript strict + `exactOptionalPropertyTypes`: optional union 에 `| undefined` 명시.
- 신규 config 필드는 optional 로 추가(레거시 JSONB 호환). 정규화가 런타임 기본값을 채운다.
- 기본값: `titleAlign` plain=`left`, logo-title/official-band=`center`; `logoAlign`(official-band)=`top`(현재 동작 보존).

---

## File Structure

- Modify `src/db/schema/schema-types.ts` — 정렬 타입 + config 필드 추가.
- Modify `src/lib/survey/response-header-config.ts` — 정규화 보강 + `getTitleAlignClass`/`getLogoAlignClass`.
- Modify `tests/unit/survey/response-header-config.test.ts` — 헬퍼/정규화 기본값 테스트 + 기존 정규화 단언 갱신.
- Modify `src/features/survey-builder/server/services/survey-read.service.test.ts` — 정규화 출력 변경에 따른 기대값 갱신.
- Modify `src/components/survey-response/survey-response-header.tsx` — `TitleBlock` 정렬 + official-band 로고 정렬 + data 속성.
- Modify `tests/unit/survey/survey-response-header.test.tsx` — 정렬 반영 테스트.
- Modify `src/components/survey-builder/response-header-settings.tsx` — 정렬 컨트롤 + 핸들러 + setter 보존.
- Modify `tests/unit/survey/response-header-settings.test.tsx` — 정렬 UI 테스트.

---

### Task 1: Config Types, Normalize Defaults, And Class Helpers

**Files:**
- Modify: `src/db/schema/schema-types.ts`
- Modify: `src/lib/survey/response-header-config.ts`
- Modify: `tests/unit/survey/response-header-config.test.ts`
- Modify: `src/features/survey-builder/server/services/survey-read.service.test.ts`

**Interfaces:**
- Produces: `ResponseHeaderTitleAlign = 'left'|'center'|'right'`, `ResponseHeaderLogoAlign = 'top'|'center'|'bottom'`; `getTitleAlignClass(align): string`; `getLogoAlignClass(align): string`; normalize fills `titleAlign`(all) and `logoAlign`(official-band).

- [ ] **Step 1: Write failing helper + normalize-default tests**

In `tests/unit/survey/response-header-config.test.ts`, extend the import to include the new helpers:

```ts
import {
  DEFAULT_RESPONSE_HEADER_CONFIG,
  DEFAULT_STATISTIC_NOTICE,
  getLogoSizeClass,
  getLogoAlignClass,
  getNoticeWidthClass,
  getTitleAlignClass,
  getTitleSizeClass,
  normalizeResponseHeaderConfig,
} from '@/lib/survey/response-header-config';
```

Add these tests inside the top-level `describe('response-header-config', ...)` block:

```ts
  it('제목 정렬 클래스를 매핑한다', () => {
    expect(getTitleAlignClass('left')).toBe('text-left');
    expect(getTitleAlignClass('center')).toBe('text-center');
    expect(getTitleAlignClass('right')).toBe('text-right');
  });

  it('로고 세로 정렬 클래스를 매핑한다', () => {
    expect(getLogoAlignClass('top')).toBe('md:items-start');
    expect(getLogoAlignClass('center')).toBe('md:items-center');
    expect(getLogoAlignClass('bottom')).toBe('md:items-end');
  });

  it('정규화는 제목 정렬 기본값을 스타일별로 채운다', () => {
    expect(normalizeResponseHeaderConfig({ style: 'plain', titleSize: 'auto' }).titleAlign).toBe(
      'left',
    );
    expect(
      normalizeResponseHeaderConfig({
        style: 'logo-title',
        titleSize: 'auto',
        logo: { imageUrl: 'https://example.com/logo.png' },
      }).titleAlign,
    ).toBe('center');
  });

  it('정규화는 official-band 로고 세로 정렬 기본값을 top 으로 채운다', () => {
    const config = normalizeResponseHeaderConfig({
      style: 'official-band',
      titleSize: 'auto',
      logo: { imageUrl: 'https://example.com/logo.png' },
    });
    expect(config.style === 'official-band' ? config.officialBand.logoAlign : null).toBe('top');
  });
```

- [ ] **Step 2: Run the new tests and verify they fail**

Run:

```bash
pnpm test tests/unit/survey/response-header-config.test.ts
```

Expected: FAIL (helpers/fields do not exist).

- [ ] **Step 3: Add types to schema-types.ts**

Modify `src/db/schema/schema-types.ts`. Add near the other response-header types (after `ResponseHeaderNoticeWidth`):

```ts
export type ResponseHeaderTitleAlign = 'left' | 'center' | 'right';
export type ResponseHeaderLogoAlign = 'top' | 'center' | 'bottom';
```

Add `titleAlign?: ResponseHeaderTitleAlign;` immediately after each `titleSize: ResponseHeaderTitleSize;` line in all three variants of `SurveyResponseHeaderConfig`.

In the `official-band` variant's `officialBand` object, add `logoAlign?: ResponseHeaderLogoAlign;` immediately after the `arrangement: ...` line.

- [ ] **Step 4: Add helpers and normalize defaults**

Modify `src/lib/survey/response-header-config.ts`.

Extend the type import:

```ts
import type {
  ResponseHeaderLogoAlign,
  ResponseHeaderLogoSize,
  ResponseHeaderNoticeWidth,
  ResponseHeaderTitleAlign,
  ResponseHeaderTitleSize,
  SurveyResponseHeaderConfig,
} from '@/db/schema/schema-types';
```

Add value sets near the other sets (e.g. after `noticeWidths`):

```ts
const titleAligns = new Set<ResponseHeaderTitleAlign>(['left', 'center', 'right']);
const logoAligns = new Set<ResponseHeaderLogoAlign>(['top', 'center', 'bottom']);
```

Add normalize helpers near `normalizeArrangement`:

```ts
function normalizeTitleAlign(
  value: unknown,
  fallback: ResponseHeaderTitleAlign,
): ResponseHeaderTitleAlign {
  return typeof value === 'string' && titleAligns.has(value as ResponseHeaderTitleAlign)
    ? (value as ResponseHeaderTitleAlign)
    : fallback;
}

function normalizeLogoAlign(value: unknown): ResponseHeaderLogoAlign {
  return typeof value === 'string' && logoAligns.has(value as ResponseHeaderLogoAlign)
    ? (value as ResponseHeaderLogoAlign)
    : 'top';
}
```

In `normalizeResponseHeaderConfig`, add `titleAlign` to each returned object and `logoAlign` to official-band:

- plain block — add after `titleSize`: `titleAlign: normalizeTitleAlign(raw['titleAlign'], 'left'),`
- logo-title block — add after `titleSize`: `titleAlign: normalizeTitleAlign(raw['titleAlign'], 'center'),`
- official-band block — add after `titleSize`: `titleAlign: normalizeTitleAlign(raw['titleAlign'], 'center'),` and inside the `officialBand` object add after `arrangement`: `logoAlign: normalizeLogoAlign(officialBand?.['logoAlign']),`

Update `DEFAULT_RESPONSE_HEADER_CONFIG` to include the plain default:

```ts
export const DEFAULT_RESPONSE_HEADER_CONFIG: SurveyResponseHeaderConfig = {
  style: 'plain',
  titleSize: 'auto',
  titleAlign: 'left',
};
```

Add the two class helpers (near `getTitleSizeClass`):

```ts
export function getTitleAlignClass(align: ResponseHeaderTitleAlign): string {
  switch (align) {
    case 'left':
      return 'text-left';
    case 'right':
      return 'text-right';
    case 'center':
      return 'text-center';
  }
}

export function getLogoAlignClass(align: ResponseHeaderLogoAlign): string {
  switch (align) {
    case 'top':
      return 'md:items-start';
    case 'bottom':
      return 'md:items-end';
    case 'center':
      return 'md:items-center';
  }
}
```

- [ ] **Step 5: Update existing normalize exact-object assertions**

The normalize output now carries `titleAlign` (and `logoAlign` for official-band). Update the existing `.toEqual(...)` assertions in `tests/unit/survey/response-header-config.test.ts`:

- In the `logo-title 설정의 누락된 중첩값을 기본값으로 채운다` test, add `titleAlign: 'center',` to the expected object (top level, alongside `style`/`titleSize`).
- In the `official-band 설정의 통계 안내문과 폭 기본값을 채운다` test, add `titleAlign: 'center',` to the expected object (top level), and add `logoAlign: 'top',` inside the expected `officialBand` object (alongside `arrangement`).

- [ ] **Step 6: Update survey-read compatibility test expectations**

In `src/features/survey-builder/server/services/survey-read.service.test.ts`, the two assertions that expect `{ style: 'plain', titleSize: 'auto' }` must include the new default. Change BOTH occurrences of:

```ts
    expect(result?.survey.settings.responseHeader).toEqual({
      style: 'plain',
      titleSize: 'auto',
    });
```

to:

```ts
    expect(result?.survey.settings.responseHeader).toEqual({
      style: 'plain',
      titleSize: 'auto',
      titleAlign: 'left',
    });
```

- [ ] **Step 7: Run Task 1 tests**

Run:

```bash
pnpm test tests/unit/survey/response-header-config.test.ts src/features/survey-builder/server/services/survey-read.service.test.ts
```

Expected: PASS.

- [ ] **Step 8: Typecheck and commit**

Run:

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: 0 errors. Then:

```bash
git add src/db/schema/schema-types.ts src/lib/survey/response-header-config.ts tests/unit/survey/response-header-config.test.ts src/features/survey-builder/server/services/survey-read.service.test.ts
git commit -m "feat: 응답 헤더 제목 정렬 로고 세로 정렬 설정 추가"
```

---

### Task 2: Response Header Rendering

**Files:**
- Modify: `src/components/survey-response/survey-response-header.tsx`
- Modify: `tests/unit/survey/survey-response-header.test.tsx`

**Interfaces:**
- Consumes: `getTitleAlignClass`, `getLogoAlignClass`, `normalizeResponseHeaderConfig` from Task 1; config `titleAlign`/`officialBand.logoAlign`.

- [ ] **Step 1: Write failing rendering tests**

In `tests/unit/survey/survey-response-header.test.tsx`, add these tests inside `describe('SurveyResponseHeader', ...)`:

```ts
  it('제목 정렬을 data-title-align 으로 반영한다', () => {
    render(
      <SurveyResponseHeader
        title="정렬 설문"
        description=""
        responseHeader={{ style: 'plain', titleSize: 'auto', titleAlign: 'right' }}
      />,
    );

    expect(screen.getByTestId('title-block')).toHaveAttribute('data-title-align', 'right');
  });

  it('양끝 정보형 로고 세로 정렬을 data-logo-align 으로 반영한다', () => {
    render(
      <SurveyResponseHeader
        title="공문서 설문"
        description=""
        responseHeader={{
          style: 'official-band',
          titleSize: 'auto',
          titleAlign: 'center',
          logo: { imageUrl: 'https://example.com/logo.png', altText: '로고', size: 'md' },
          officialBand: {
            arrangement: 'stat-left-logo-right',
            logoAlign: 'center',
            statisticNotice: { title: 'a', body: 'b', width: 'md' },
          },
        }}
      />,
    );

    expect(screen.getByTestId('official-band-row')).toHaveAttribute('data-logo-align', 'center');
  });
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
pnpm test tests/unit/survey/survey-response-header.test.tsx
```

Expected: FAIL (`title-block`/`official-band-row` testids and alignment not present).

- [ ] **Step 3: Update imports and TitleBlock**

Modify `src/components/survey-response/survey-response-header.tsx`.

Extend the helper import:

```ts
import {
  getLogoAlignClass,
  getLogoSizeClass,
  getNoticeWidthClass,
  getTitleAlignClass,
  getTitleSizeClass,
  normalizeResponseHeaderConfig,
} from '@/lib/survey/response-header-config';
```

Add to the type-only import from schema-types:

```ts
import type {
  ResponseHeaderTitleAlign,
  SurveyResponseHeaderConfig,
} from '@/db/schema/schema-types';
```

Replace the entire `TitleBlock` component with an align-aware version:

```tsx
function TitleBlock({
  title,
  description,
  titleSize,
  align = 'center',
}: {
  title: string;
  description?: string | null | undefined;
  titleSize: SurveyResponseHeaderConfig['titleSize'];
  align?: ResponseHeaderTitleAlign;
}) {
  return (
    <div data-testid="title-block" data-title-align={align} className={getTitleAlignClass(align)}>
      <h1 className={cn('font-semibold leading-tight text-gray-900', getTitleSizeClass(titleSize ?? 'auto'))}>
        {title}
      </h1>
      {!isEmptyHtml(description) && (
        <p
          className={cn(
            'mt-1 text-base text-gray-600 md:text-sm',
            align === 'center' ? 'mx-auto max-w-3xl' : '',
          )}
        >
          {description}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Pass align in all three style paths and apply logoAlign**

In `SurveyResponseHeader`, the `config` is already normalized via `normalizeResponseHeaderConfig`. Update each `<TitleBlock ... />` usage:

- logo-title path: change `<TitleBlock title={title} description={description} titleSize={config.titleSize} centered />` to:

```tsx
<TitleBlock title={title} description={description} titleSize={config.titleSize} align={config.titleAlign} />
```

- official-band path: same change (`centered` → `align={config.titleAlign}`).
- plain path: change `<TitleBlock title={title} description={description} titleSize={config.titleSize} />` to:

```tsx
<TitleBlock title={title} description={description} titleSize={config.titleSize} align={config.titleAlign} />
```

In the official-band path, change the logo+notice flex row. Replace:

```tsx
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
```

with:

```tsx
        <div
          data-testid="official-band-row"
          data-logo-align={config.officialBand?.logoAlign ?? 'top'}
          className={cn(
            'flex flex-col gap-4 md:flex-row md:justify-between',
            getLogoAlignClass(config.officialBand?.logoAlign ?? 'top'),
          )}
        >
```

- [ ] **Step 5: Run rendering tests**

Run:

```bash
pnpm test tests/unit/survey/survey-response-header.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

Run:

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: 0 errors. Then:

```bash
git add src/components/survey-response/survey-response-header.tsx tests/unit/survey/survey-response-header.test.tsx
git commit -m "feat: 응답 헤더 제목 로고 정렬 렌더링"
```

---

### Task 3: Builder Settings UI

**Files:**
- Modify: `src/components/survey-builder/response-header-settings.tsx`
- Modify: `tests/unit/survey/response-header-settings.test.tsx`

**Interfaces:**
- Consumes: `onChange(config)`; reuses local `PresetButtonGroup`.

- [ ] **Step 1: Write failing UI tests**

In `tests/unit/survey/response-header-settings.test.tsx`, add these tests inside `describe('ResponseHeaderSettings', ...)`:

```ts
  it('제목 정렬 버튼은 모든 스타일에서 표시되고 onChange 로 titleAlign 을 갱신한다', async () => {
    const onChange = vi.fn();
    render(<ResponseHeaderSettings settings={settings()} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: '오른쪽' }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ titleAlign: 'right' }));
  });

  it('로고 세로 정렬은 양끝 정보형에서만 표시된다', () => {
    const { rerender } = render(<ResponseHeaderSettings settings={settings()} onChange={vi.fn()} />);
    expect(screen.queryByText('로고 세로 정렬')).not.toBeInTheDocument();

    rerender(
      <ResponseHeaderSettings
        settings={settings({
          responseHeader: {
            style: 'official-band',
            titleSize: 'auto',
            titleAlign: 'center',
            logo: { imageUrl: '', size: 'md' },
            officialBand: {
              arrangement: 'stat-left-logo-right',
              logoAlign: 'top',
              statisticNotice: { title: 't', body: 'b', width: 'md' },
            },
          },
        })}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('로고 세로 정렬')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
pnpm test tests/unit/survey/response-header-settings.test.tsx
```

Expected: FAIL (`오른쪽` button / `로고 세로 정렬` not present).

- [ ] **Step 3: Add align types import and handlers**

Modify `src/components/survey-builder/response-header-settings.tsx`.

Extend the schema-types import:

```ts
import type {
  ResponseHeaderLogoAlign,
  ResponseHeaderTitleAlign,
  SurveyResponseHeaderConfig,
} from '@/db/schema/schema-types';
```

Add handlers near `updateTitleSize`:

```tsx
  const updateTitleAlign = (titleAlign: ResponseHeaderTitleAlign) => {
    onChange({ ...config, titleAlign });
  };

  const updateLogoAlign = (logoAlign: ResponseHeaderLogoAlign) => {
    if (config.style !== 'official-band') return;
    onChange({
      ...config,
      officialBand: {
        ...config.officialBand,
        logoAlign,
      },
    });
  };
```

- [ ] **Step 4: Preserve titleAlign/logoAlign in style setters**

In `setPlain`, add `titleAlign`:

```tsx
  const setPlain = () =>
    onChange({ style: 'plain', titleSize: config.titleSize ?? 'auto', titleAlign: config.titleAlign ?? 'left' });
```

In `setLogoTitle`, add `titleAlign: config.titleAlign ?? 'center',` right after the `titleSize:` line.

In `setOfficialBand`, add `titleAlign: config.titleAlign ?? 'center',` right after the `titleSize:` line, and add `logoAlign:` to the `officialBand` object right after the `arrangement:` line:

```tsx
        arrangement:
          config.style === 'official-band'
            ? config.officialBand?.arrangement ?? 'stat-left-logo-right'
            : 'stat-left-logo-right',
        logoAlign:
          config.style === 'official-band' ? config.officialBand?.logoAlign ?? 'top' : 'top',
```

- [ ] **Step 5: Render the 제목 정렬 control (all styles)**

Add this block in the JSX immediately after the closing `</div>` of the style-selection button grid (the grid containing `기본형`/`제목 옆 로고형`/`양끝 정보형`), before the `{config.style !== 'plain' && (...)}` block:

```tsx
      <PresetButtonGroup
        label="제목 정렬"
        value={config.titleAlign ?? 'center'}
        options={[
          ['left', '왼쪽'],
          ['center', '중앙'],
          ['right', '오른쪽'],
        ]}
        onChange={updateTitleAlign}
      />
```

- [ ] **Step 6: Render the 로고 세로 정렬 control (official-band only)**

Inside the `{config.style === 'official-band' && (...)}` block, after the 양끝 배치 control's closing `</div>` (the `space-y-2` div that holds the 통계법 왼쪽/로고 왼쪽 buttons), add:

```tsx
              <div className="space-y-2">
                <Label className="text-xs text-gray-600">로고 세로 정렬</Label>
                <div className="grid grid-cols-3 gap-2">
                  <Button type="button" variant="outline" size="sm" aria-pressed={config.officialBand?.logoAlign === 'top' || !config.officialBand?.logoAlign} className={responseHeaderButtonClass(config.officialBand?.logoAlign === 'top' || !config.officialBand?.logoAlign)} onClick={() => updateLogoAlign('top')}>
                    위
                  </Button>
                  <Button type="button" variant="outline" size="sm" aria-pressed={config.officialBand?.logoAlign === 'center'} className={responseHeaderButtonClass(config.officialBand?.logoAlign === 'center')} onClick={() => updateLogoAlign('center')}>
                    중앙
                  </Button>
                  <Button type="button" variant="outline" size="sm" aria-pressed={config.officialBand?.logoAlign === 'bottom'} className={responseHeaderButtonClass(config.officialBand?.logoAlign === 'bottom')} onClick={() => updateLogoAlign('bottom')}>
                    아래
                  </Button>
                </div>
              </div>
```

- [ ] **Step 7: Run UI tests**

Run:

```bash
pnpm test tests/unit/survey/response-header-settings.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Typecheck and commit**

Run:

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: 0 errors. Then:

```bash
git add src/components/survey-builder/response-header-settings.tsx tests/unit/survey/response-header-settings.test.tsx
git commit -m "feat: 응답 헤더 정렬 빌더 UI 추가"
```

---

### Task 4: Final Verification

**Files:** No new files.

- [ ] **Step 1: Run all header-related tests**

Run:

```bash
pnpm test tests/unit/survey/response-header-config.test.ts tests/unit/survey/survey-response-header.test.tsx tests/unit/survey/response-header-settings.test.tsx tests/unit/survey/response-header-settings-modal.test.tsx tests/unit/survey/diff-payload-response-header.test.ts tests/unit/domains/versioning/snapshot-builder.test.ts src/features/survey-builder/server/services/survey-read.service.test.ts
```

Expected: PASS.

- [ ] **Step 2: Lint**

Run:

```bash
pnpm lint
```

Expected: 0 errors.

- [ ] **Step 3: Build**

Run:

```bash
pnpm build
```

Expected: 컴파일 + TypeScript 성공. (page-data 수집은 `.env`/`.env.local` 심볼릭 링크 필요.)

- [ ] **Step 4: Manual browser check**

Run `pnpm dev`, open a survey edit page, open the 설문 헤더 modal, and verify:

- 제목 정렬 왼쪽/중앙/오른쪽이 미리보기 제목에 즉시 반영된다.
- 양끝 정보형에서 로고 세로 정렬 위/중앙/아래가 통계법 박스 기준으로 로고 위치를 바꾼다.
- 스타일을 바꿔도 제목 정렬 선택이 보존된다.

- [ ] **Step 5: Commit verification fixes if any**

```bash
git status --short
```

If changes were needed, stage the affected feature files and commit `fix: 응답 헤더 정렬 검증 결과 반영`. If none, skip.

---

## Self-Review

- Spec coverage:
  - titleAlign 전 스타일 + logoAlign official-band: Task 1(타입/정규화), Task 2(렌더), Task 3(UI).
  - 기본값(plain=left, 그외 center, logoAlign=top): Task 1.
  - 레거시 호환(정규화 보강): Task 1; 정규화 출력 변경에 따른 기존 테스트 갱신 Task 1 Step 5-6.
  - 미리보기 자동 반영: 모달이 `SurveyResponseHeader` 재사용(추가 변경 없음).
- Placeholder scan: 모든 step 에 실제 코드/명령/기대값 포함.
- Type consistency: `ResponseHeaderTitleAlign`/`ResponseHeaderLogoAlign`, `titleAlign`, `officialBand.logoAlign`, `getTitleAlignClass`/`getLogoAlignClass` 를 스키마·정규화·렌더·UI 에서 일관되게 사용. optional 필드는 호출부에서 `?? 기본값` 으로 좁힘.
