# 설문 헤더 빌더 진입점 + 설정 모달 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 빌더 좌측 "질문 생성" 팔레트 맨 위에 "설문 헤더" 카드를 추가해, 클릭 시 실시간 미리보기가 있는 설정 모달을 열고, 우측 패널의 헤더 설정 섹션은 제거한다.

**Architecture:** 자체완결 client 컴포넌트 `ResponseHeaderSettingsModal`이 트리거 카드 + Dialog + 미리보기(`SurveyResponseHeader` 재사용) + 설정(`ResponseHeaderSettings` 재사용)을 캡슐화한다. store(`useSurveyBuilderStore`) 단일 출처로 설정과 미리보기가 동기화된다. edit/create 페이지는 컴포넌트를 한 줄 배치하고, 설정 패널에서 기존 섹션을 제거한다.

**Tech Stack:** Next.js 16, React 19, TypeScript strict, Zustand(+useShallow), shadcn/ui Dialog/Card, Vitest, Testing Library, TailwindCSS.

## Global Constraints

- 컴포넌트 파일명 kebab-case `.tsx`, 변수/함수명 영어, 주석/UI 텍스트 한국어, 이모지 금지.
- git commit 메시지 한국어 `feat:`/`refactor:` 형식, 괄호 `()` 금지.
- TypeScript strict + `exactOptionalPropertyTypes`: 선택 prop union에 `| undefined` 명시.
- 기존 `ResponseHeaderSettings`(`{ settings, onChange }`)·`SurveyResponseHeader`(`{ title, description?, responseHeader?, sideMeta? }`) 시그니처 변경 금지 — 재사용만.
- store 구독은 `useShallow`로 리렌더 억제(우측 패널과 동일 패턴).

---

## File Structure

- Create `src/components/survey-builder/response-header-settings-modal.tsx`
  - 트리거 카드 + Dialog + 미리보기 + 설정을 캡슐화하는 자체완결 client 컴포넌트.
- Create `tests/unit/survey/response-header-settings-modal.test.tsx`
  - 모달 열림 / 미리보기+설정 동시 렌더 / 프리셋 변경 시 store 갱신·미리보기 반영.
- Modify `src/app/admin/surveys/[id]/edit/page.tsx`
  - 질문 생성 팔레트 `space-y-3` 컨테이너 최상단에 `<ResponseHeaderSettingsModal />` 배치.
- Modify `src/app/admin/surveys/create/page.tsx`
  - 동일하게 팔레트 최상단에 배치.
- Modify `src/components/survey-builder/survey-settings-panel.tsx`
  - 우측 패널의 `<ResponseHeaderSettings>` 섹션과 import 제거.

---

### Task 1: Response Header Settings Modal Component

**Files:**
- Create: `src/components/survey-builder/response-header-settings-modal.tsx`
- Test: `tests/unit/survey/response-header-settings-modal.test.tsx`

**Interfaces:**
- Consumes: `ResponseHeaderSettings` (`{ settings: SurveySettings, onChange: (config: SurveyResponseHeaderConfig) => void }`), `SurveyResponseHeader` (`{ title: string, description?: string | null, responseHeader?: SurveyResponseHeaderConfig | null, sideMeta?: ReactNode }`), `useSurveyBuilderStore` (`currentSurvey.settings`/`.title`/`.description`, `updateSurveySettings(Partial<SurveySettings>)`, `setSurvey(survey)`), `Card`, `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`.
- Produces: `export function ResponseHeaderSettingsModal(): JSX.Element` — props 없음, store 직접 구독.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/survey/response-header-settings-modal.test.tsx`:

```tsx
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// CellImageEditor 는 업로드 의존성을 끌고 오므로 stub (로고형 선택 시 렌더됨)
vi.mock('@/components/survey-builder/cell-image-editor', () => ({
  CellImageEditor: () => null,
}));

import { ResponseHeaderSettingsModal } from '@/components/survey-builder/response-header-settings-modal';
import { DEFAULT_RESPONSE_HEADER_CONFIG } from '@/lib/survey/response-header-config';
import { useSurveyBuilderStore } from '@/stores/survey-store';
import type { Survey } from '@/types/survey';

function seedSurvey() {
  const survey: Survey = {
    id: 's1',
    title: '내 설문',
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
      responseHeader: DEFAULT_RESPONSE_HEADER_CONFIG,
    },
    createdAt: new Date('2026-06-29T00:00:00.000Z'),
    updatedAt: new Date('2026-06-29T00:00:00.000Z'),
  };
  useSurveyBuilderStore.getState().setSurvey(survey);
}

describe('ResponseHeaderSettingsModal', () => {
  beforeEach(() => {
    seedSurvey();
  });

  afterEach(() => {
    cleanup();
  });

  it('카드 클릭 시 미리보기와 설정이 함께 있는 모달이 열린다', async () => {
    render(<ResponseHeaderSettingsModal />);

    // 닫힌 상태: 설정 컨트롤은 보이지 않는다
    expect(screen.queryByRole('button', { name: '제목 옆 로고형' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('응답 페이지 머리말 설정'));

    // 미리보기(설문 제목) + 설정 컨트롤이 함께 렌더된다
    expect(screen.getByRole('heading', { name: '내 설문' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '기본형' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '제목 옆 로고형' })).toBeInTheDocument();
  });

  it('프리셋 변경 시 store 가 갱신되고 미리보기가 반영된다', async () => {
    render(<ResponseHeaderSettingsModal />);
    await userEvent.click(screen.getByText('응답 페이지 머리말 설정'));

    await userEvent.click(screen.getByRole('button', { name: '제목 옆 로고형' }));

    expect(
      useSurveyBuilderStore.getState().currentSurvey.settings.responseHeader?.style,
    ).toBe('logo-title');
    expect(screen.getByTestId('logo-title-layout')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm test tests/unit/survey/response-header-settings-modal.test.tsx
```

Expected: FAIL because `@/components/survey-builder/response-header-settings-modal` does not exist.

- [ ] **Step 3: Implement the modal component**

Create `src/components/survey-builder/response-header-settings-modal.tsx`:

```tsx
'use client';

import { useState } from 'react';

import { PanelTop } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { ResponseHeaderSettings } from '@/components/survey-builder/response-header-settings';
import { SurveyResponseHeader } from '@/components/survey-response/survey-response-header';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useSurveyBuilderStore } from '@/stores/survey-store';

export function ResponseHeaderSettingsModal() {
  const [open, setOpen] = useState(false);

  const updateSurveySettings = useSurveyBuilderStore((s) => s.updateSurveySettings);
  const settings = useSurveyBuilderStore(useShallow((s) => s.currentSurvey.settings));
  const title = useSurveyBuilderStore((s) => s.currentSurvey.title);
  const description = useSurveyBuilderStore((s) => s.currentSurvey.description);

  return (
    <>
      <Card
        className="hover-lift cursor-pointer border-gray-200 p-4 transition-all duration-200 hover:border-blue-200"
        onClick={() => setOpen(true)}
      >
        <div className="flex items-start space-x-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
            <PanelTop className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-medium text-gray-900">설문 헤더</h4>
            <p className="mt-1 text-xs text-gray-500">응답 페이지 머리말 설정</p>
          </div>
        </div>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col p-0">
          <DialogHeader className="border-b border-gray-200 px-6 py-4">
            <DialogTitle>설문 헤더</DialogTitle>
          </DialogHeader>

          {/* 미리보기: 스크롤되지 않는 고정 영역 (응답 페이지와 동일 컴포넌트) */}
          <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
            <SurveyResponseHeader
              title={title}
              description={description}
              responseHeader={settings.responseHeader}
            />
          </div>

          {/* 설정: 스크롤 영역 */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <ResponseHeaderSettings
              settings={settings}
              onChange={(responseHeader) => updateSurveySettings({ responseHeader })}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run:

```bash
pnpm test tests/unit/survey/response-header-settings-modal.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Typecheck**

Run:

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: 0 errors.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/components/survey-builder/response-header-settings-modal.tsx tests/unit/survey/response-header-settings-modal.test.tsx
git commit -m "feat: 설문 헤더 설정 모달 컴포넌트 추가"
```

---

### Task 2: Wire Modal Into Builder Palettes

**Files:**
- Modify: `src/app/admin/surveys/[id]/edit/page.tsx`
- Modify: `src/app/admin/surveys/create/page.tsx`

**Interfaces:**
- Consumes: `ResponseHeaderSettingsModal` from Task 1.

- [ ] **Step 1: Add the modal to the edit page palette**

Modify `src/app/admin/surveys/[id]/edit/page.tsx`.

Add import (near the other `@/components/survey-builder` imports):

```tsx
import { ResponseHeaderSettingsModal } from '@/components/survey-builder/response-header-settings-modal';
```

Place the component as the first child of the question-types `space-y-3` container. Find this block:

```tsx
              <TabsContent value="types" className="m-0 flex-1 overflow-y-auto p-4 pt-2">
                <div className="space-y-3">
                  {questionTypes.map((questionType) => {
```

Replace it with:

```tsx
              <TabsContent value="types" className="m-0 flex-1 overflow-y-auto p-4 pt-2">
                <div className="space-y-3">
                  <ResponseHeaderSettingsModal />
                  {questionTypes.map((questionType) => {
```

- [ ] **Step 2: Add the modal to the create page palette**

Modify `src/app/admin/surveys/create/page.tsx`.

Add import (near the other `@/components/survey-builder` imports):

```tsx
import { ResponseHeaderSettingsModal } from '@/components/survey-builder/response-header-settings-modal';
```

Find this block:

```tsx
                <div className="space-y-3">
                  {questionTypes.map((questionType) => {
```

Replace it with:

```tsx
                <div className="space-y-3">
                  <ResponseHeaderSettingsModal />
                  {questionTypes.map((questionType) => {
```

- [ ] **Step 3: Typecheck**

Run:

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: 0 errors.

- [ ] **Step 4: Commit Task 2**

```bash
git add "src/app/admin/surveys/[id]/edit/page.tsx" src/app/admin/surveys/create/page.tsx
git commit -m "feat: 빌더 질문 생성 팔레트에 설문 헤더 진입점 추가"
```

---

### Task 3: Remove Header Settings From Right Panel

**Files:**
- Modify: `src/components/survey-builder/survey-settings-panel.tsx`

- [ ] **Step 1: Remove the section and its import**

Modify `src/components/survey-builder/survey-settings-panel.tsx`.

Remove this import line:

```tsx
import { ResponseHeaderSettings } from '@/components/survey-builder/response-header-settings';
```

Remove this section block (the section added when the header settings first landed):

```tsx
        {/* 응답 페이지 헤더 */}
        <ResponseHeaderSettings
          settings={surveySettings}
          onChange={(responseHeader) => updateSurveySettings({ responseHeader })}
        />

```

- [ ] **Step 2: Verify no dangling references**

Run:

```bash
grep -n "ResponseHeaderSettings" src/components/survey-builder/survey-settings-panel.tsx
```

Expected: no output (no remaining references in this file).

- [ ] **Step 3: Typecheck**

Run:

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: 0 errors. (`updateSurveySettings` is still used elsewhere in the panel, so no unused-var error.)

- [ ] **Step 4: Commit Task 3**

```bash
git add src/components/survey-builder/survey-settings-panel.tsx
git commit -m "refactor: 우측 패널의 응답 헤더 설정 섹션 제거"
```

---

### Task 4: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused header tests**

Run:

```bash
pnpm test tests/unit/survey/response-header-settings-modal.test.tsx tests/unit/survey/response-header-settings.test.tsx tests/unit/survey/survey-response-header.test.tsx
```

Expected: PASS (모달 신규 + 기존 설정·렌더 단위 테스트 무변경 통과).

- [ ] **Step 2: Run lint**

Run:

```bash
pnpm lint
```

Expected: 0 errors (기존 warning 만 잔존).

- [ ] **Step 3: Run build**

Run:

```bash
pnpm build
```

Expected: 컴파일 + TypeScript 성공. (page-data 수집에는 `.env`/`.env.local` 필요 — 워크트리에 심볼릭 링크가 걸려 있어야 한다.)

- [ ] **Step 4: Manual browser check**

Run `pnpm dev`, open a survey edit page, and verify:

- "질문 생성" 탭 맨 위에 "설문 헤더" 카드가 보이고, 클릭 시 모달이 열린다.
- 모달 상단 미리보기에 현재 설문 제목/설명이 보이고, 프리셋/로고 위치/통계법 문구를 바꾸면 즉시 반영된다.
- 세부조정을 펼쳐 스크롤해도 미리보기는 계속 보인다.
- 우측 설정 패널에는 응답 헤더 섹션이 더 이상 없다.
- 모달을 닫고 상단 저장 후 공개 응답 페이지에 헤더가 반영된다.

- [ ] **Step 5: Commit verification fixes if any**

If verification required code changes, stage only the affected feature files and commit:

```bash
git add -A
git commit -m "fix: 설문 헤더 모달 검증 결과 반영"
```

If `git status --short` prints no files, do not create an empty commit.

---

## Self-Review

- Spec coverage:
  - 신규 모달 컴포넌트(트리거 카드 + Dialog + 미리보기 + 설정): Task 1.
  - 미리보기 상단 고정 + 설정 스크롤(question-edit-modal 패턴): Task 1 Step 3 (`flex flex-col` + 미리보기 고정 flex child + `flex-1 overflow-y-auto`).
  - 트리거 카드 질문 카드와 동일 스타일 + 설정 안내 텍스트: Task 1 Step 3.
  - edit/create 팔레트 최상단 배치: Task 2.
  - 우측 패널 섹션 제거: Task 3.
  - store 단일 출처 동기화·`useShallow`: Task 1 Step 3.
  - 테스트(열림/미리보기+설정/프리셋 변경): Task 1 Step 1.
- Placeholder scan: 모든 step에 실제 코드/명령/기대값 포함. 추상 지시 없음.
- Type consistency: `ResponseHeaderSettingsModal`(무인자), `updateSurveySettings({ responseHeader })`, `SurveyResponseHeader`/`ResponseHeaderSettings` prop 시그니처를 spec·기존 구현과 일치하게 사용.
