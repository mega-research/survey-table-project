# Survey Response Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 설문 편집자가 `Survey.settings.responseHeader`로 응답 페이지 헤더 프리셋을 설정하고, 공개 응답 페이지가 배포 스냅샷 기준으로 헤더를 렌더링하게 한다.

**Architecture:** 앱 내부 인터페이스는 `survey.settings.responseHeader` 하나로 고정한다. DB에는 `surveys.response_header` JSONB 컬럼으로 저장하지만, 읽기/쓰기 서비스 경계에서 기존 `Survey.settings` 흐름으로 조립해 빌더, diff 저장, 스냅샷, 응답 로더가 같은 위치를 보게 한다.

**Tech Stack:** Next.js 16, React 19, TypeScript strict, Drizzle ORM, PostgreSQL JSONB, Zustand, Vitest, Testing Library, TailwindCSS, shadcn/ui.

---

## File Structure

- Create `src/lib/survey/response-header-config.ts`
  - 헤더 설정 기본값, 통계법 기본 문구, 레거시 fallback, 크기 class 매핑을 소유한다.
- Modify `src/db/schema/schema-types.ts`
  - `SurveyResponseHeaderConfig` JSONB 타입과 `SurveyVersionSnapshot.settings.responseHeader` 타입을 추가한다.
- Modify `src/db/schema/surveys.ts`
  - `responseHeader` JSONB 컬럼을 추가한다.
- Create `supabase/migrations/0041_add_survey_response_header.sql`
  - `surveys.response_header` nullable JSONB 컬럼을 추가한다.
- Modify `src/types/survey.ts`
  - `SurveySettings.responseHeader`를 추가한다.
- Modify `src/stores/survey-store.ts`
  - 새 설문의 기본 설정에 기본형 헤더를 추가한다.
- Modify `src/data/surveys.ts`
  - DB row의 `responseHeader`를 `Survey.settings.responseHeader`로 조립한다.
- Modify `src/features/survey-builder/server/services/survey-save.service.ts`
  - diff 저장과 전체 저장 모두 `settings.responseHeader`를 `surveys.response_header`에 쓴다.
- Modify `src/features/survey-builder/server/services/surveys.service.ts`
  - ensure/create/duplicate/update 경로가 `responseHeader`를 보존한다.
- Modify `src/lib/versioning/snapshot-builder.ts`
  - 배포 스냅샷에 `settings.responseHeader`를 포함한다.
- Modify `src/features/survey-builder/server/services/survey-read.service.ts`
  - 공개 응답 조회에서 snapshot 값을 우선하고, 레거시는 기본형으로 fallback한다.
- Modify `src/components/survey-response/hooks/use-survey-loader.ts`
  - admin-edit snapshot 복원 경로도 `settings.responseHeader`를 복원한다.
- Create `src/components/survey-builder/response-header-settings.tsx`
  - 설정 패널 안의 응답 페이지 헤더 섹션을 담당한다.
- Modify `src/components/survey-builder/survey-settings-panel.tsx`
  - 새 설정 섹션을 삽입한다.
- Create `src/components/survey-response/survey-response-header.tsx`
  - 응답 페이지 헤더 프리셋 렌더링을 담당한다.
- Modify `src/components/survey-response/survey-response-flow.tsx`
  - 기존 헤더 title/description 영역을 `SurveyResponseHeader`로 대체하고 진행률 영역은 유지한다.
- Create tests:
  - `tests/unit/survey/response-header-config.test.ts`
  - `tests/unit/survey/diff-payload-response-header.test.ts`
  - `tests/unit/survey/survey-response-header.test.tsx`
  - `tests/unit/survey/response-header-settings.test.tsx`
- Modify tests:
  - `tests/unit/domains/versioning/snapshot-builder.test.ts`
  - `src/features/survey-builder/server/services/survey-read.service.test.ts`

---

### Task 1: Header Config Type And Fallback

**Files:**
- Create: `src/lib/survey/response-header-config.ts`
- Create: `tests/unit/survey/response-header-config.test.ts`
- Modify: `src/db/schema/schema-types.ts`
- Modify: `src/types/survey.ts`
- Modify: `src/stores/survey-store.ts`

- [ ] **Step 1: Write the failing config test**

Create `tests/unit/survey/response-header-config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RESPONSE_HEADER_CONFIG,
  DEFAULT_STATISTIC_NOTICE,
  getLogoSizeClass,
  getNoticeWidthClass,
  getTitleSizeClass,
  normalizeResponseHeaderConfig,
} from '@/lib/survey/response-header-config';

describe('response-header-config', () => {
  it('undefined 설정은 기본형 헤더로 정규화한다', () => {
    expect(normalizeResponseHeaderConfig(undefined)).toEqual(DEFAULT_RESPONSE_HEADER_CONFIG);
  });

  it('null 설정은 기본형 헤더로 정규화한다', () => {
    expect(normalizeResponseHeaderConfig(null)).toEqual(DEFAULT_RESPONSE_HEADER_CONFIG);
  });

  it('제목 옆 로고형은 logoTitle 기본 위치와 로고 크기를 채운다', () => {
    const config = normalizeResponseHeaderConfig({
      style: 'logo-title',
      titleSize: 'lg',
      logo: {
        imageUrl: 'https://example.com/logo.png',
      },
    });

    expect(config).toEqual({
      style: 'logo-title',
      titleSize: 'lg',
      logo: {
        imageUrl: 'https://example.com/logo.png',
        altText: '',
        size: 'md',
      },
      logoTitle: {
        logoPosition: 'left',
      },
    });
  });

  it('양끝 정보형은 통계법 기본 문구와 폭을 채운다', () => {
    const config = normalizeResponseHeaderConfig({
      style: 'official-band',
      titleSize: 'auto',
      logo: {
        imageUrl: 'https://example.com/logo.png',
        size: 'lg',
      },
      officialBand: {
        arrangement: 'logo-left-stat-right',
      },
    });

    expect(config).toEqual({
      style: 'official-band',
      titleSize: 'auto',
      logo: {
        imageUrl: 'https://example.com/logo.png',
        altText: '',
        size: 'lg',
      },
      officialBand: {
        arrangement: 'logo-left-stat-right',
        statisticNotice: {
          ...DEFAULT_STATISTIC_NOTICE,
          width: 'md',
        },
      },
    });
  });

  it('프리셋 크기 값을 Tailwind class로 매핑한다', () => {
    expect(getLogoSizeClass('sm')).toBe('h-14 max-w-28');
    expect(getLogoSizeClass('md')).toBe('h-20 max-w-40');
    expect(getLogoSizeClass('lg')).toBe('h-28 max-w-56');
    expect(getNoticeWidthClass('sm')).toBe('md:w-64');
    expect(getNoticeWidthClass('md')).toBe('md:w-80');
    expect(getNoticeWidthClass('lg')).toBe('md:w-96');
    expect(getTitleSizeClass('auto')).toBe('text-2xl md:text-3xl');
    expect(getTitleSizeClass('md')).toBe('text-2xl md:text-4xl');
    expect(getTitleSizeClass('lg')).toBe('text-3xl md:text-5xl');
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
pnpm test tests/unit/survey/response-header-config.test.ts
```

Expected: FAIL because `@/lib/survey/response-header-config` does not exist.

- [ ] **Step 3: Add JSONB and Survey types**

Modify `src/db/schema/schema-types.ts`. Add this near the other JSONB type definitions:

```ts
export type ResponseHeaderStyle = 'plain' | 'logo-title' | 'official-band';
export type ResponseHeaderLogoSize = 'sm' | 'md' | 'lg';
export type ResponseHeaderTitleSize = 'auto' | 'md' | 'lg';
export type ResponseHeaderNoticeWidth = 'sm' | 'md' | 'lg';

export interface SurveyResponseHeaderLogo {
  imageUrl: string;
  altText?: string;
  size?: ResponseHeaderLogoSize;
}

export type SurveyResponseHeaderConfig =
  | {
      style: 'plain';
      titleSize?: ResponseHeaderTitleSize;
    }
  | {
      style: 'logo-title';
      titleSize?: ResponseHeaderTitleSize;
      logo: SurveyResponseHeaderLogo;
      logoTitle?: {
        logoPosition?: 'left' | 'right';
      };
    }
  | {
      style: 'official-band';
      titleSize?: ResponseHeaderTitleSize;
      logo: SurveyResponseHeaderLogo;
      officialBand?: {
        arrangement?: 'stat-left-logo-right' | 'logo-left-stat-right';
        statisticNotice?: {
          title?: string;
          body?: string;
          width?: ResponseHeaderNoticeWidth;
        };
      };
    };
```

In the same file, add `responseHeader?: SurveyResponseHeaderConfig;` inside `SurveyVersionSnapshot.settings`:

```ts
    thankYouMessage: string;
    requireInviteToken?: boolean;
    responseHeader?: SurveyResponseHeaderConfig;
```

Modify the first import line of `src/types/survey.ts`:

```ts
import type {
  ContactColumnScheme,
  SurveyResponseHeaderConfig,
} from '@/db/schema/schema-types';
```

Then add this to `SurveySettings`:

```ts
  responseHeader?: SurveyResponseHeaderConfig;
```

- [ ] **Step 4: Implement config helper**

Create `src/lib/survey/response-header-config.ts`:

```ts
import type {
  ResponseHeaderLogoSize,
  ResponseHeaderNoticeWidth,
  ResponseHeaderTitleSize,
  SurveyResponseHeaderConfig,
} from '@/db/schema/schema-types';
import { cn } from '@/lib/utils';

export const DEFAULT_STATISTIC_NOTICE = {
  title: '통계법 제33조(비밀의 보호)',
  body: '통계의 작성 과정에서 알려진 사항으로서 개인이나 법인 또는 단체의 비밀에 속하는 사항은 보호되어야 한다.',
} as const;

export const DEFAULT_RESPONSE_HEADER_CONFIG = {
  style: 'plain',
  titleSize: 'auto',
} satisfies SurveyResponseHeaderConfig;

export function normalizeResponseHeaderConfig(
  config: SurveyResponseHeaderConfig | null | undefined,
): SurveyResponseHeaderConfig {
  if (!config) return DEFAULT_RESPONSE_HEADER_CONFIG;

  if (config.style === 'logo-title') {
    return {
      style: 'logo-title',
      titleSize: config.titleSize ?? 'auto',
      logo: {
        imageUrl: config.logo.imageUrl,
        altText: config.logo.altText ?? '',
        size: config.logo.size ?? 'md',
      },
      logoTitle: {
        logoPosition: config.logoTitle?.logoPosition ?? 'left',
      },
    };
  }

  if (config.style === 'official-band') {
    return {
      style: 'official-band',
      titleSize: config.titleSize ?? 'auto',
      logo: {
        imageUrl: config.logo.imageUrl,
        altText: config.logo.altText ?? '',
        size: config.logo.size ?? 'md',
      },
      officialBand: {
        arrangement: config.officialBand?.arrangement ?? 'stat-left-logo-right',
        statisticNotice: {
          title: config.officialBand?.statisticNotice?.title ?? DEFAULT_STATISTIC_NOTICE.title,
          body: config.officialBand?.statisticNotice?.body ?? DEFAULT_STATISTIC_NOTICE.body,
          width: config.officialBand?.statisticNotice?.width ?? 'md',
        },
      },
    };
  }

  return {
    style: 'plain',
    titleSize: config.titleSize ?? 'auto',
  };
}

export function getLogoSizeClass(size: ResponseHeaderLogoSize | undefined): string {
  if (size === 'sm') return 'h-14 max-w-28';
  if (size === 'lg') return 'h-28 max-w-56';
  return 'h-20 max-w-40';
}

export function getNoticeWidthClass(width: ResponseHeaderNoticeWidth | undefined): string {
  if (width === 'sm') return 'md:w-64';
  if (width === 'lg') return 'md:w-96';
  return 'md:w-80';
}

export function getTitleSizeClass(size: ResponseHeaderTitleSize | undefined): string {
  if (size === 'md') return 'text-2xl md:text-4xl';
  if (size === 'lg') return 'text-3xl md:text-5xl';
  return 'text-2xl md:text-3xl';
}

export function responseHeaderButtonClass(selected: boolean): string {
  return cn(
    'rounded-lg border px-3 py-2 text-sm transition-colors',
    selected
      ? 'border-blue-500 bg-blue-50 font-semibold text-blue-700'
      : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
  );
}
```

- [ ] **Step 5: Add store default**

Modify `src/stores/survey-store.ts`.

Add import:

```ts
import { DEFAULT_RESPONSE_HEADER_CONFIG } from '@/lib/survey/response-header-config';
```

Add this field to `defaultSurveySettings`:

```ts
  responseHeader: DEFAULT_RESPONSE_HEADER_CONFIG,
```

- [ ] **Step 6: Run the config test and typecheck-related tests**

Run:

```bash
pnpm test tests/unit/survey/response-header-config.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

Run:

```bash
git add src/db/schema/schema-types.ts src/types/survey.ts src/lib/survey/response-header-config.ts src/stores/survey-store.ts tests/unit/survey/response-header-config.test.ts
git commit -m "feat: 응답 헤더 설정 기본값 추가"
```

---

### Task 2: DB Column And Survey Save/Read Compatibility

**Files:**
- Create: `supabase/migrations/0041_add_survey_response_header.sql`
- Create: `tests/unit/survey/diff-payload-response-header.test.ts`
- Modify: `src/db/schema/surveys.ts`
- Modify: `src/data/surveys.ts`
- Modify: `src/features/survey-builder/server/services/survey-save.service.ts`
- Modify: `src/features/survey-builder/server/services/surveys.service.ts`

- [ ] **Step 1: Write the failing diff payload test**

Create `tests/unit/survey/diff-payload-response-header.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { buildSurveyDiffPayload } from '@/lib/survey-builder/diff-payload';
import type { Survey } from '@/types/survey';

const baseSurvey: Survey = {
  id: 'survey-1',
  title: '설문',
  description: '',
  questions: [],
  groups: [],
  settings: {
    isPublic: true,
    allowMultipleResponses: false,
    showProgressBar: true,
    shuffleQuestions: false,
    requireLogin: false,
    thankYouMessage: '감사합니다',
    responseHeader: {
      style: 'logo-title',
      titleSize: 'lg',
      logo: {
        imageUrl: 'https://example.com/logo.png',
        size: 'md',
      },
      logoTitle: {
        logoPosition: 'right',
      },
    },
  },
  createdAt: new Date('2026-06-29T00:00:00.000Z'),
  updatedAt: new Date('2026-06-29T00:00:00.000Z'),
};

describe('buildSurveyDiffPayload responseHeader', () => {
  it('메타데이터 dirty 저장 payload에 settings.responseHeader를 포함한다', () => {
    const payload = buildSurveyDiffPayload(baseSurvey, {
      isMetadataDirty: true,
      questionChanges: {
        added: {},
        updated: {},
        deleted: {},
        reordered: false,
      },
    });

    expect(payload?.metadata?.settings.responseHeader).toEqual(baseSurvey.settings.responseHeader);
  });
});
```

- [ ] **Step 2: Run the diff payload test**

Run:

```bash
pnpm test tests/unit/survey/diff-payload-response-header.test.ts
```

Expected: PASS after Task 1 because `metadata.settings` already sends the whole settings object. This test protects the existing compatibility seam.

- [ ] **Step 3: Add DB schema and migration**

Modify `src/db/schema/surveys.ts`.

Add `SurveyResponseHeaderConfig` to the type import block from `./schema-types`:

```ts
  SurveyResponseHeaderConfig,
```

Add this column after `thankYouMessage`:

```ts
  responseHeader: jsonb('response_header').$type<SurveyResponseHeaderConfig>(),
```

Create `supabase/migrations/0041_add_survey_response_header.sql`:

```sql
ALTER TABLE surveys
ADD COLUMN IF NOT EXISTS response_header jsonb;
```

- [ ] **Step 4: Map DB row to Survey.settings in data/surveys.ts**

Modify `src/data/surveys.ts`.

Add import:

```ts
import { normalizeResponseHeaderConfig } from '@/lib/survey/response-header-config';
```

In `getSurveyWithDetails`, add this field inside `settings`:

```ts
      responseHeader: normalizeResponseHeaderConfig(survey.responseHeader),
```

- [ ] **Step 5: Persist responseHeader in diff and full save**

Modify `src/features/survey-builder/server/services/survey-save.service.ts`.

In the diff metadata update `.set({ ... })`, add:

```ts
          responseHeader: metadata.settings.responseHeader ?? null,
```

In `saveSurveyWithDetails`, add to the existing survey `updateSet`:

```ts
        responseHeader: surveyData.settings.responseHeader ?? null,
```

In `saveSurveyWithDetails`, add to the insert values:

```ts
        responseHeader: surveyData.settings.responseHeader ?? null,
```

- [ ] **Step 6: Preserve responseHeader in create/ensure/duplicate/update services**

Modify `src/features/survey-builder/server/services/surveys.service.ts`.

In `ensureSurveyInDb` insert values, add:

```ts
    responseHeader: input.settings.responseHeader ?? null,
```

In `createSurvey`, add to `newSurvey`:

```ts
    responseHeader: data.settings?.responseHeader ?? null,
```

Extend `UpdateSurveyDataSchema` in `src/features/survey-builder/domain/survey.ts` by importing `SurveyResponseHeaderConfig` through `SurveyType['settings']['responseHeader']` shape already available:

```ts
    responseHeader: SurveyType['settings']['responseHeader'];
```

In `duplicateSurvey`, add to the insert values:

```ts
        responseHeader: original.responseHeader,
```

- [ ] **Step 7: Run Task 2 tests**

Run:

```bash
pnpm test tests/unit/survey/diff-payload-response-header.test.ts
pnpm test tests/unit/features/builder/survey-save-slug-normalize.test.ts src/features/survey-builder/server/procedures/save.test.ts src/features/survey-builder/server/procedures/surveys.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

Run:

```bash
git add supabase/migrations/0041_add_survey_response_header.sql src/db/schema/surveys.ts src/data/surveys.ts src/features/survey-builder/server/services/survey-save.service.ts src/features/survey-builder/server/services/surveys.service.ts src/features/survey-builder/domain/survey.ts tests/unit/survey/diff-payload-response-header.test.ts
git commit -m "feat: 응답 헤더 설정 저장 추가"
```

---

### Task 3: Publish Snapshot And Response Loader Compatibility

**Files:**
- Modify: `src/lib/versioning/snapshot-builder.ts`
- Modify: `tests/unit/domains/versioning/snapshot-builder.test.ts`
- Modify: `src/features/survey-builder/server/services/survey-read.service.ts`
- Modify: `src/features/survey-builder/server/services/survey-read.service.test.ts`
- Modify: `src/components/survey-response/hooks/use-survey-loader.ts`

- [ ] **Step 1: Add snapshot preservation test**

Modify `tests/unit/domains/versioning/snapshot-builder.test.ts`. Add this test inside `describe('buildSurveySnapshot', ...)`:

```ts
  it('responseHeader 를 스냅샷 settings 에 보존', () => {
    const surveyWithHeader: Survey = {
      ...mockSurvey,
      settings: {
        ...mockSurvey.settings,
        responseHeader: {
          style: 'official-band',
          titleSize: 'md',
          logo: {
            imageUrl: 'https://example.com/logo.png',
            size: 'lg',
          },
          officialBand: {
            arrangement: 'logo-left-stat-right',
            statisticNotice: {
              title: '비밀보호',
              body: '응답 내용은 보호됩니다.',
              width: 'lg',
            },
          },
        },
      },
    };

    const snapshot = buildSurveySnapshot(surveyWithHeader);

    expect(snapshot.settings.responseHeader).toEqual(surveyWithHeader.settings.responseHeader);
  });
```

- [ ] **Step 2: Run snapshot test and verify it fails**

Run:

```bash
pnpm test tests/unit/domains/versioning/snapshot-builder.test.ts
```

Expected: FAIL because `buildSurveySnapshot` does not include `responseHeader` yet.

- [ ] **Step 3: Preserve responseHeader in snapshot builder**

Modify `src/lib/versioning/snapshot-builder.ts`.

Add `responseHeader?: Survey['settings']['responseHeader'];` to `SurveySnapshot.settings`.

Add this field in the returned `settings` object:

```ts
      responseHeader: survey.settings.responseHeader,
```

- [ ] **Step 4: Add response read tests for snapshot priority and legacy fallback**

Modify `src/features/survey-builder/server/services/survey-read.service.test.ts`. Add two tests in the `getSurveyForResponse` describe block:

```ts
  it('responseHeader 는 published snapshot 값을 따르고 현재 surveys 행으로 덮어쓰지 않는다', async () => {
    const surveyId = 'survey-header-published';
    surveysFindFirst.mockResolvedValue({
      id: surveyId,
      currentVersionId: 'ver-header',
      requireInviteToken: false,
      responseHeader: {
        style: 'logo-title',
        titleSize: 'lg',
        logo: { imageUrl: 'https://example.com/draft.png', size: 'lg' },
        logoTitle: { logoPosition: 'right' },
      },
      slug: null,
      privateToken: null,
      contactColumns: null,
      contactEmail: null,
      lookups: [],
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    surveyVersionsFindFirst.mockResolvedValue({
      id: 'ver-header',
      snapshot: {
        title: '설문',
        questions: [],
        groups: [],
        settings: {
          ...snapshotSettings(false),
          responseHeader: {
            style: 'plain',
            titleSize: 'auto',
          },
        },
      },
    });

    const result = await getSurveyForResponse({ surveyId });

    expect(result?.survey.settings.responseHeader).toEqual({
      style: 'plain',
      titleSize: 'auto',
    });
  });

  it('responseHeader 가 없는 legacy snapshot 은 현재 surveys 행이 아니라 기본형으로 fallback 한다', async () => {
    const surveyId = 'survey-header-legacy';
    surveysFindFirst.mockResolvedValue({
      id: surveyId,
      currentVersionId: 'ver-header-legacy',
      requireInviteToken: false,
      responseHeader: {
        style: 'logo-title',
        titleSize: 'lg',
        logo: { imageUrl: 'https://example.com/draft.png', size: 'lg' },
        logoTitle: { logoPosition: 'right' },
      },
      slug: null,
      privateToken: null,
      contactColumns: null,
      contactEmail: null,
      lookups: [],
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    surveyVersionsFindFirst.mockResolvedValue({
      id: 'ver-header-legacy',
      snapshot: {
        title: '설문',
        questions: [],
        groups: [],
        settings: snapshotSettings(false),
      },
    });

    const result = await getSurveyForResponse({ surveyId });

    expect(result?.survey.settings.responseHeader).toEqual({
      style: 'plain',
      titleSize: 'auto',
    });
  });
```

- [ ] **Step 5: Implement response read mapping**

Modify `src/features/survey-builder/server/services/survey-read.service.ts`.

Add import:

```ts
import { normalizeResponseHeaderConfig } from '@/lib/survey/response-header-config';
```

Extend the local snapshot type:

```ts
          responseHeader?: SurveyType['settings']['responseHeader'];
```

Add this field inside `settings` for the snapshot path:

```ts
          responseHeader: normalizeResponseHeaderConfig(snapshot.settings.responseHeader),
```

Do not fallback to `survey.responseHeader` in the published snapshot path.

- [ ] **Step 6: Restore admin-edit snapshot loader**

Modify `src/components/survey-response/hooks/use-survey-loader.ts`.

When building `settings` from `adminContext.versionSnapshot`, add:

```ts
                responseHeader: normalizeResponseHeaderConfig(snapshot.settings.responseHeader),
```

Add import:

```ts
import { normalizeResponseHeaderConfig } from '@/lib/survey/response-header-config';
```

- [ ] **Step 7: Run Task 3 tests**

Run:

```bash
pnpm test tests/unit/domains/versioning/snapshot-builder.test.ts src/features/survey-builder/server/services/survey-read.service.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

Run:

```bash
git add src/lib/versioning/snapshot-builder.ts tests/unit/domains/versioning/snapshot-builder.test.ts src/features/survey-builder/server/services/survey-read.service.ts src/features/survey-builder/server/services/survey-read.service.test.ts src/components/survey-response/hooks/use-survey-loader.ts
git commit -m "feat: 응답 헤더 스냅샷 보존"
```

---

### Task 4: Builder Settings UI

**Files:**
- Create: `src/components/survey-builder/response-header-settings.tsx`
- Create: `tests/unit/survey/response-header-settings.test.tsx`
- Modify: `src/components/survey-builder/survey-settings-panel.tsx`

- [ ] **Step 1: Write UI tests**

Create `tests/unit/survey/response-header-settings.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ResponseHeaderSettings } from '@/components/survey-builder/response-header-settings';
import { DEFAULT_RESPONSE_HEADER_CONFIG } from '@/lib/survey/response-header-config';
import type { SurveySettings } from '@/types/survey';

function settings(overrides: Partial<SurveySettings> = {}): SurveySettings {
  return {
    isPublic: true,
    allowMultipleResponses: false,
    showProgressBar: true,
    shuffleQuestions: false,
    requireLogin: false,
    thankYouMessage: '감사합니다',
    responseHeader: DEFAULT_RESPONSE_HEADER_CONFIG,
    ...overrides,
  };
}

describe('ResponseHeaderSettings', () => {
  it('기본형에서는 로고 위치와 통계법 문구 입력을 숨긴다', () => {
    render(<ResponseHeaderSettings settings={settings()} onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: '기본형' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('로고 위치')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('통계법 제목')).not.toBeInTheDocument();
  });

  it('제목 옆 로고형 선택 시 로고 위치 선택을 표시하고 설정을 갱신한다', async () => {
    const onChange = vi.fn();
    render(<ResponseHeaderSettings settings={settings()} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: '제목 옆 로고형' }));

    expect(onChange).toHaveBeenCalledWith({
      style: 'logo-title',
      titleSize: 'auto',
      logo: {
        imageUrl: '',
        altText: '',
        size: 'md',
      },
      logoTitle: {
        logoPosition: 'left',
      },
    });
  });

  it('양끝 정보형 선택 시 통계법 문구 입력을 표시한다', () => {
    render(
      <ResponseHeaderSettings
        settings={settings({
          responseHeader: {
            style: 'official-band',
            titleSize: 'auto',
            logo: {
              imageUrl: '',
              size: 'md',
            },
            officialBand: {
              arrangement: 'stat-left-logo-right',
              statisticNotice: {
                title: '통계법',
                body: '보호됩니다.',
                width: 'md',
              },
            },
          },
        })}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('통계법 제목')).toHaveValue('통계법');
    expect(screen.getByLabelText('통계법 문구')).toHaveValue('보호됩니다.');
  });
});
```

- [ ] **Step 2: Run UI test and verify it fails**

Run:

```bash
pnpm test tests/unit/survey/response-header-settings.test.tsx
```

Expected: FAIL because `ResponseHeaderSettings` does not exist.

- [ ] **Step 3: Implement ResponseHeaderSettings**

Create `src/components/survey-builder/response-header-settings.tsx`.

Use these imports:

```tsx
'use client';

import { ChevronDown, ImageIcon } from 'lucide-react';

import { CellImageEditor } from '@/components/survey-builder/cell-image-editor';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  DEFAULT_STATISTIC_NOTICE,
  normalizeResponseHeaderConfig,
  responseHeaderButtonClass,
} from '@/lib/survey/response-header-config';
import type { SurveyResponseHeaderConfig } from '@/db/schema/schema-types';
import type { SurveySettings } from '@/types/survey';
```

Implement these exported props and component shape:

```tsx
interface ResponseHeaderSettingsProps {
  settings: SurveySettings;
  onChange: (config: SurveyResponseHeaderConfig) => void;
}

export function ResponseHeaderSettings({ settings, onChange }: ResponseHeaderSettingsProps) {
  const config = normalizeResponseHeaderConfig(settings.responseHeader);

  const setPlain = () => onChange({ style: 'plain', titleSize: config.titleSize ?? 'auto' });
  const setLogoTitle = () =>
    onChange({
      style: 'logo-title',
      titleSize: config.titleSize ?? 'auto',
      logo: {
        imageUrl: config.style === 'plain' ? '' : config.logo.imageUrl,
        altText: config.style === 'plain' ? '' : config.logo.altText ?? '',
        size: config.style === 'plain' ? 'md' : config.logo.size ?? 'md',
      },
      logoTitle: {
        logoPosition: config.style === 'logo-title' ? config.logoTitle?.logoPosition ?? 'left' : 'left',
      },
    });
  const setOfficialBand = () =>
    onChange({
      style: 'official-band',
      titleSize: config.titleSize ?? 'auto',
      logo: {
        imageUrl: config.style === 'plain' ? '' : config.logo.imageUrl,
        altText: config.style === 'plain' ? '' : config.logo.altText ?? '',
        size: config.style === 'plain' ? 'md' : config.logo.size ?? 'md',
      },
      officialBand: {
        arrangement:
          config.style === 'official-band'
            ? config.officialBand?.arrangement ?? 'stat-left-logo-right'
            : 'stat-left-logo-right',
        statisticNotice:
          config.style === 'official-band'
            ? {
                title: config.officialBand?.statisticNotice?.title ?? DEFAULT_STATISTIC_NOTICE.title,
                body: config.officialBand?.statisticNotice?.body ?? DEFAULT_STATISTIC_NOTICE.body,
                width: config.officialBand?.statisticNotice?.width ?? 'md',
              }
            : {
                ...DEFAULT_STATISTIC_NOTICE,
                width: 'md',
              },
      },
    });

  const updateLogoUrl = (imageUrl: string) => {
    if (config.style === 'plain') return;
    onChange({
      ...config,
      logo: {
        ...config.logo,
        imageUrl,
      },
    });
  };

  return (
    <section className="space-y-4 border-t border-gray-200 pt-6">
      <div>
        <h4 className="text-sm font-medium text-gray-700">응답 페이지 헤더</h4>
        <p className="mt-1 text-xs text-gray-400">설문지 원본과 비슷한 머리말을 표시합니다.</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" size="sm" aria-pressed={config.style === 'plain'} className={responseHeaderButtonClass(config.style === 'plain')} onClick={setPlain}>
          기본형
        </Button>
        <Button type="button" variant="outline" size="sm" aria-pressed={config.style === 'logo-title'} className={responseHeaderButtonClass(config.style === 'logo-title')} onClick={setLogoTitle}>
          제목 옆 로고형
        </Button>
        <Button type="button" variant="outline" size="sm" aria-pressed={config.style === 'official-band'} className={responseHeaderButtonClass(config.style === 'official-band') + ' col-span-2'} onClick={setOfficialBand}>
          양끝 정보형
        </Button>
      </div>

      {config.style !== 'plain' && (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label className="text-xs text-gray-600">
              <ImageIcon className="mr-1 inline h-3.5 w-3.5" />
              로고 이미지
            </Label>
            <CellImageEditor imageUrl={config.logo.imageUrl} onImageUrlChange={updateLogoUrl} />
          </div>
        </div>
      )}
    </section>
  );
}
```

Add these helper functions before the `return`:

```tsx
  const updateLogoPosition = (logoPosition: 'left' | 'right') => {
    if (config.style !== 'logo-title') return;
    onChange({
      ...config,
      logoTitle: { logoPosition },
    });
  };

  const updateArrangement = (
    arrangement: 'stat-left-logo-right' | 'logo-left-stat-right',
  ) => {
    if (config.style !== 'official-band') return;
    onChange({
      ...config,
      officialBand: {
        ...config.officialBand,
        arrangement,
      },
    });
  };

  const updateStatisticNotice = (
    field: 'title' | 'body',
    value: string,
  ) => {
    if (config.style !== 'official-band') return;
    onChange({
      ...config,
      officialBand: {
        ...config.officialBand,
        statisticNotice: {
          title: config.officialBand?.statisticNotice?.title ?? DEFAULT_STATISTIC_NOTICE.title,
          body: config.officialBand?.statisticNotice?.body ?? DEFAULT_STATISTIC_NOTICE.body,
          width: config.officialBand?.statisticNotice?.width ?? 'md',
          [field]: value,
        },
      },
    });
  };

  const updateLogoSize = (size: 'sm' | 'md' | 'lg') => {
    if (config.style === 'plain') return;
    onChange({
      ...config,
      logo: {
        ...config.logo,
        size,
      },
    });
  };

  const updateTitleSize = (titleSize: 'auto' | 'md' | 'lg') => {
    onChange({
      ...config,
      titleSize,
    });
  };

  const updateNoticeWidth = (width: 'sm' | 'md' | 'lg') => {
    if (config.style !== 'official-band') return;
    onChange({
      ...config,
      officialBand: {
        ...config.officialBand,
        statisticNotice: {
          title: config.officialBand?.statisticNotice?.title ?? DEFAULT_STATISTIC_NOTICE.title,
          body: config.officialBand?.statisticNotice?.body ?? DEFAULT_STATISTIC_NOTICE.body,
          width,
        },
      },
    });
  };
```

Inside the `{config.style !== 'plain' && (...)}` block, insert this JSX below the logo editor:

```tsx
          {config.style === 'logo-title' && (
            <div className="space-y-2">
              <Label className="text-xs text-gray-600">로고 위치</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" size="sm" aria-pressed={config.logoTitle?.logoPosition !== 'right'} className={responseHeaderButtonClass(config.logoTitle?.logoPosition !== 'right')} onClick={() => updateLogoPosition('left')}>
                  왼쪽
                </Button>
                <Button type="button" variant="outline" size="sm" aria-pressed={config.logoTitle?.logoPosition === 'right'} className={responseHeaderButtonClass(config.logoTitle?.logoPosition === 'right')} onClick={() => updateLogoPosition('right')}>
                  오른쪽
                </Button>
              </div>
            </div>
          )}

          {config.style === 'official-band' && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label className="text-xs text-gray-600">양끝 배치</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant="outline" size="sm" aria-pressed={config.officialBand?.arrangement !== 'logo-left-stat-right'} className={responseHeaderButtonClass(config.officialBand?.arrangement !== 'logo-left-stat-right')} onClick={() => updateArrangement('stat-left-logo-right')}>
                    통계법 왼쪽
                  </Button>
                  <Button type="button" variant="outline" size="sm" aria-pressed={config.officialBand?.arrangement === 'logo-left-stat-right'} className={responseHeaderButtonClass(config.officialBand?.arrangement === 'logo-left-stat-right')} onClick={() => updateArrangement('logo-left-stat-right')}>
                    로고 왼쪽
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="response-header-stat-title" className="text-xs text-gray-600">통계법 제목</Label>
                <Input id="response-header-stat-title" value={config.officialBand?.statisticNotice?.title ?? DEFAULT_STATISTIC_NOTICE.title} onChange={(event) => updateStatisticNotice('title', event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="response-header-stat-body" className="text-xs text-gray-600">통계법 문구</Label>
                <Textarea id="response-header-stat-body" value={config.officialBand?.statisticNotice?.body ?? DEFAULT_STATISTIC_NOTICE.body} onChange={(event) => updateStatisticNotice('body', event.target.value)} />
              </div>
            </div>
          )}
```

Add this collapsed advanced section below the conditional logo/settings block:

```tsx
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="w-full justify-between">
            세부 조정
            <ChevronDown className="h-4 w-4" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 pt-3">
          {config.style !== 'plain' && (
            <PresetButtonGroup
              label="로고 크기"
              value={config.logo.size ?? 'md'}
              options={[
                ['sm', '작게'],
                ['md', '보통'],
                ['lg', '크게'],
              ]}
              onChange={updateLogoSize}
            />
          )}
          <PresetButtonGroup
            label="제목 크기"
            value={config.titleSize ?? 'auto'}
            options={[
              ['auto', '자동'],
              ['md', '보통'],
              ['lg', '크게'],
            ]}
            onChange={updateTitleSize}
          />
          {config.style === 'official-band' && (
            <PresetButtonGroup
              label="통계법 박스 폭"
              value={config.officialBand?.statisticNotice?.width ?? 'md'}
              options={[
                ['sm', '좁게'],
                ['md', '보통'],
                ['lg', '넓게'],
              ]}
              onChange={updateNoticeWidth}
            />
          )}
        </CollapsibleContent>
      </Collapsible>
```

Add this helper component below `ResponseHeaderSettings`:

```tsx
function PresetButtonGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<[T, string]>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs text-gray-600">{label}</Label>
      <div className="grid grid-cols-3 gap-2">
        {options.map(([optionValue, optionLabel]) => (
          <Button
            key={optionValue}
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={value === optionValue}
            className={responseHeaderButtonClass(value === optionValue)}
            onClick={() => onChange(optionValue)}
          >
            {optionLabel}
          </Button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Integrate into settings panel**

Modify `src/components/survey-builder/survey-settings-panel.tsx`.

Add import:

```tsx
import { ResponseHeaderSettings } from '@/components/survey-builder/response-header-settings';
```

Add this section after the 문의 이메일 block and before 토큰 경고:

```tsx
        <ResponseHeaderSettings
          settings={surveySettings}
          onChange={(responseHeader) => updateSurveySettings({ responseHeader })}
        />
```

- [ ] **Step 5: Run builder UI test**

Run:

```bash
pnpm test tests/unit/survey/response-header-settings.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

Run:

```bash
git add src/components/survey-builder/response-header-settings.tsx src/components/survey-builder/survey-settings-panel.tsx tests/unit/survey/response-header-settings.test.tsx
git commit -m "feat: 응답 헤더 설정 UI 추가"
```

---

### Task 5: Response Page Header Rendering

**Files:**
- Create: `src/components/survey-response/survey-response-header.tsx`
- Create: `tests/unit/survey/survey-response-header.test.tsx`
- Modify: `src/components/survey-response/survey-response-flow.tsx`

- [ ] **Step 1: Write response header rendering tests**

Create `tests/unit/survey/survey-response-header.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SurveyResponseHeader } from '@/components/survey-response/survey-response-header';

describe('SurveyResponseHeader', () => {
  it('기본형은 기존 제목과 설명을 표시한다', () => {
    render(
      <SurveyResponseHeader
        title="테스트 설문"
        description="설명"
        responseHeader={{ style: 'plain', titleSize: 'auto' }}
        sideMeta={<span>1 / 3</span>}
      />,
    );

    expect(screen.getByRole('heading', { name: '테스트 설문' })).toBeInTheDocument();
    expect(screen.getByText('설명')).toBeInTheDocument();
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });

  it('제목 옆 로고형은 로고 오른쪽 배치를 반영한다', () => {
    render(
      <SurveyResponseHeader
        title="로고 설문"
        description=""
        responseHeader={{
          style: 'logo-title',
          titleSize: 'md',
          logo: {
            imageUrl: 'https://example.com/logo.png',
            altText: '기관 로고',
            size: 'sm',
          },
          logoTitle: {
            logoPosition: 'right',
          },
        }}
      />,
    );

    expect(screen.getByRole('img', { name: '기관 로고' })).toHaveAttribute(
      'src',
      'https://example.com/logo.png',
    );
    expect(screen.getByTestId('logo-title-layout')).toHaveAttribute('data-logo-position', 'right');
  });

  it('양끝 정보형은 ID 없이 통계법 문구와 로고를 표시한다', () => {
    render(
      <SurveyResponseHeader
        title="공문서 설문"
        description=""
        responseHeader={{
          style: 'official-band',
          titleSize: 'lg',
          logo: {
            imageUrl: 'https://example.com/logo.png',
            altText: '기관 로고',
            size: 'md',
          },
          officialBand: {
            arrangement: 'logo-left-stat-right',
            statisticNotice: {
              title: '통계법 제33조',
              body: '비밀은 보호됩니다.',
              width: 'sm',
            },
          },
        }}
      />,
    );

    expect(screen.getByText('통계법 제33조')).toBeInTheDocument();
    expect(screen.getByText('비밀은 보호됩니다.')).toBeInTheDocument();
    expect(screen.queryByText('ID')).not.toBeInTheDocument();
    expect(screen.getByTestId('official-band-layout')).toHaveAttribute(
      'data-arrangement',
      'logo-left-stat-right',
    );
  });
});
```

- [ ] **Step 2: Run response header test and verify it fails**

Run:

```bash
pnpm test tests/unit/survey/survey-response-header.test.tsx
```

Expected: FAIL because `SurveyResponseHeader` does not exist.

- [ ] **Step 3: Implement SurveyResponseHeader**

Create `src/components/survey-response/survey-response-header.tsx`.

Use this component interface:

```tsx
import type { ReactNode } from 'react';

import {
  getLogoSizeClass,
  getNoticeWidthClass,
  getTitleSizeClass,
  normalizeResponseHeaderConfig,
} from '@/lib/survey/response-header-config';
import { cn, isEmptyHtml } from '@/lib/utils';
import type { SurveyResponseHeaderConfig } from '@/db/schema/schema-types';

interface SurveyResponseHeaderProps {
  title: string;
  description?: string | null;
  responseHeader?: SurveyResponseHeaderConfig | null;
  sideMeta?: ReactNode;
}
```

Implement these rendering rules:

```tsx
export function SurveyResponseHeader({
  title,
  description,
  responseHeader,
  sideMeta,
}: SurveyResponseHeaderProps) {
  const config = normalizeResponseHeaderConfig(responseHeader);

  if (config.style === 'logo-title') {
    const logo = <HeaderLogo config={config.logo} />;
    const titleBlock = <TitleBlock title={title} description={description} titleSize={config.titleSize} centered />;
    const logoPosition = config.logoTitle?.logoPosition ?? 'left';

    return (
      <div
        data-testid="logo-title-layout"
        data-logo-position={logoPosition}
        className="space-y-4"
      >
        <div className="grid gap-4 md:grid-cols-[auto_1fr] md:items-center">
          {logoPosition === 'left' ? logo : titleBlock}
          {logoPosition === 'left' ? titleBlock : logo}
        </div>
        {sideMeta && <div className="hidden text-right text-sm text-gray-500 md:block">{sideMeta}</div>}
      </div>
    );
  }

  if (config.style === 'official-band') {
    const arrangement = config.officialBand?.arrangement ?? 'stat-left-logo-right';
    const notice = config.officialBand?.statisticNotice;
    const logo = <HeaderLogo config={config.logo} />;
    const noticeBox = (
      <div className={cn('w-full border border-gray-900 bg-white text-center', getNoticeWidthClass(notice?.width))}>
        <div className="bg-black px-3 py-2 text-sm font-semibold text-white">{notice?.title}</div>
        <div className="px-3 py-3 text-sm leading-relaxed text-gray-600">{notice?.body}</div>
      </div>
    );

    return (
      <div data-testid="official-band-layout" data-arrangement={arrangement} className="space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          {arrangement === 'stat-left-logo-right' ? noticeBox : logo}
          {arrangement === 'stat-left-logo-right' ? logo : noticeBox}
        </div>
        <TitleBlock title={title} description={description} titleSize={config.titleSize} centered />
        {sideMeta && <div className="hidden text-right text-sm text-gray-500 md:block">{sideMeta}</div>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
      <TitleBlock title={title} description={description} titleSize={config.titleSize} />
      {sideMeta && <div className="hidden self-start text-sm text-gray-500 md:block md:self-auto">{sideMeta}</div>}
    </div>
  );
}
```

Add internal helpers in the same file:

```tsx
function TitleBlock({
  title,
  description,
  titleSize,
  centered = false,
}: {
  title: string;
  description?: string | null;
  titleSize: SurveyResponseHeaderConfig['titleSize'];
  centered?: boolean;
}) {
  return (
    <div className={centered ? 'text-center' : ''}>
      <h1 className={cn('font-semibold leading-tight text-gray-900', getTitleSizeClass(titleSize))}>{title}</h1>
      {!isEmptyHtml(description) && (
        <p className={cn('mt-1 text-base text-gray-600 md:text-sm', centered ? 'mx-auto max-w-3xl' : '')}>
          {description}
        </p>
      )}
    </div>
  );
}

function HeaderLogo({
  config,
}: {
  config: {
    imageUrl: string;
    altText?: string;
    size?: 'sm' | 'md' | 'lg';
  };
}) {
  if (!config.imageUrl) {
    return <div className={cn('rounded border border-dashed border-gray-300 bg-gray-50', getLogoSizeClass(config.size))} />;
  }

  return (
    <img
      src={config.imageUrl}
      alt={config.altText || '설문 로고'}
      className={cn('w-auto object-contain', getLogoSizeClass(config.size))}
    />
  );
}
```

- [ ] **Step 4: Integrate into SurveyResponseFlow**

Modify `src/components/survey-response/survey-response-flow.tsx`.

Add import:

```tsx
import { SurveyResponseHeader } from '@/components/survey-response/survey-response-header';
```

Remove `isEmptyHtml` from the existing `@/lib/utils` import in this file because the new component owns description rendering.

Replace the existing header title/description flex block with:

```tsx
          <SurveyResponseHeader
            title={loadedSurvey.title}
            description={loadedSurvey.description}
            responseHeader={loadedSurvey.settings.responseHeader}
            sideMeta={
              <>
                {currentVisibleStepNumber || 1} / {Math.max(totalVisibleStepCount, 1)}
                <span className="ml-2 text-xs text-gray-400">(전체 {questions.length}개 질문)</span>
              </>
            }
          />
```

Keep the existing progress bar block immediately below it.

- [ ] **Step 5: Run response header tests**

Run:

```bash
pnpm test tests/unit/survey/survey-response-header.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

Run:

```bash
git add src/components/survey-response/survey-response-header.tsx src/components/survey-response/survey-response-flow.tsx tests/unit/survey/survey-response-header.test.tsx
git commit -m "feat: 응답 페이지 헤더 프리셋 렌더링"
```

---

### Task 6: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused unit tests**

Run:

```bash
pnpm test tests/unit/survey/response-header-config.test.ts tests/unit/survey/diff-payload-response-header.test.ts tests/unit/domains/versioning/snapshot-builder.test.ts src/features/survey-builder/server/services/survey-read.service.test.ts tests/unit/survey/response-header-settings.test.tsx tests/unit/survey/survey-response-header.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run broader survey-related tests**

Run:

```bash
pnpm test tests/unit/survey src/features/survey-builder/server/procedures/save.test.ts src/features/survey-builder/server/procedures/surveys.test.ts src/features/survey-builder/server/procedures/publish.test.ts
```

Expected: PASS. If an unrelated known flaky integration test fails, do not include it in this command; this command intentionally uses unit/procedure tests only.

- [ ] **Step 3: Run lint**

Run:

```bash
pnpm lint
```

Expected: PASS.

- [ ] **Step 4: Run build if lint and focused tests pass**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 5: Start dev server for manual check**

Run:

```bash
pnpm dev
```

Expected: local Next.js dev server starts and prints a localhost URL.

- [ ] **Step 6: Manual browser check**

Open a survey edit page and verify:

- 기본형 선택 시 로고/통계법 입력이 숨겨진다.
- 제목 옆 로고형 선택 시 로고 위치 왼쪽/오른쪽이 저장된다.
- 양끝 정보형 선택 시 통계법 왼쪽/오른쪽 배치가 저장된다.
- 세부 조정은 접힌 영역에 있고 `작게/보통/크게`, `자동/보통/크게`, `좁게/보통/넓게`만 제공한다.
- 공개 응답 페이지에서 ID 박스가 표시되지 않는다.
- 모바일 폭에서 로고, 통계법 박스, 제목이 세로로 쌓이고 겹치지 않는다.

- [ ] **Step 7: Commit verification fixes if any**

If verification required code changes, inspect the changed files:

```bash
git status --short
```

Stage only the files changed for this feature, then commit:

```bash
git add src/db/schema/schema-types.ts src/db/schema/surveys.ts src/types/survey.ts src/stores/survey-store.ts src/data/surveys.ts src/features/survey-builder/domain/survey.ts src/features/survey-builder/server/services/survey-save.service.ts src/features/survey-builder/server/services/surveys.service.ts src/lib/versioning/snapshot-builder.ts src/features/survey-builder/server/services/survey-read.service.ts src/components/survey-response/hooks/use-survey-loader.ts src/components/survey-builder/response-header-settings.tsx src/components/survey-builder/survey-settings-panel.tsx src/components/survey-response/survey-response-header.tsx src/components/survey-response/survey-response-flow.tsx tests/unit/survey/response-header-config.test.ts tests/unit/survey/diff-payload-response-header.test.ts tests/unit/survey/response-header-settings.test.tsx tests/unit/survey/survey-response-header.test.tsx tests/unit/domains/versioning/snapshot-builder.test.ts src/features/survey-builder/server/services/survey-read.service.test.ts
git commit -m "fix: 응답 헤더 검증 결과 반영"
```

If `git status --short` prints no files, do not create an empty commit.

---

## Self-Review

- Spec coverage:
  - 프리셋 세 가지: Task 4 and Task 5.
  - 좌우 선택: Task 4 and Task 5.
  - 접힌 고급 설정: Task 4.
  - `Survey.settings.responseHeader` 호환성: Task 1, Task 2, Task 3.
  - 배포 스냅샷 우선: Task 3.
  - 기존 설문 fallback: Task 1 and Task 3.
  - ID 제외: Task 5 tests.
  - 모바일 세로 배치: Task 5 CSS and Task 6 manual check.
- Red-flag scan:
  - The plan contains concrete file paths, commands, expected outcomes, and code snippets for each implementation step.
- Type consistency:
  - The plan uses `SurveyResponseHeaderConfig`, `responseHeader`, `logo-title`, `official-band`, `stat-left-logo-right`, and `logo-left-stat-right` consistently across schema, Survey settings, snapshot, builder UI, and response rendering.
