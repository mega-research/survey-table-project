# 메일 템플릿 슬라이스 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 운영 콘솔에 "메일 템플릿" 페이지를 추가하여 설문별 템플릿을 만들고/저장하고, TipTap 에디터로 본문을 작성·변수 토큰 삽입·이미지/첨부 R2 업로드·미리보기·1명 테스트 발송까지 가능하게 한다.

**Architecture:** 4 phases (구조 → 에디터 → R2 업로드 → 발송) 각각 독립 PR. 데이터는 `mail_templates` 단일 테이블 (설문별, soft delete). 변수는 `{{토큰}}` 텍스트 + ProseMirror Decoration 시각화. 첨부는 R2 presigned PUT, 발송 시 본문 하단에 다운로드 링크 박스로 자동 삽입. 발송은 Resend + react-email shell.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM, Supabase Postgres, TipTap 3.15, ProseMirror plugin, shadcn/ui (Dialog/Popover) + cmdk, @aws-sdk/client-s3 (기존) + @aws-sdk/s3-request-presigner (신규), Resend, @react-email/components, Vitest (TDD 가능 영역).

**Spec 참조:** [docs/superpowers/specs/2026-05-08-mail-template-design.md](../specs/2026-05-08-mail-template-design.md) — 설계 결정 전체.

**커밋 컨벤션:** 한국어 `feat: OOO 추가` / `fix: OOO 수정` / `chore: ...` / `refactor: ...` 형식. 괄호 금지.

---

## File Structure

### Phase A — 구조 (CRUD)

**Create:**
- `supabase/migrations/0018_mail_templates.sql` — 마이그레이션
- `src/db/schema/mail.ts` — Drizzle schema
- `src/data/mail-templates.ts` — server fetch (React.cache)
- `src/actions/mail-template-actions.ts` — server actions (CRUD only, send 는 D 에서)
- `src/components/operations/mail-template/meta-fields.tsx` — 메타 입력 폼 (이름·제목·from·reply_to·첨부 placeholder)
- `src/components/operations/mail-template/mail-template-list.tsx` — 목록 row
- `src/components/operations/mail-template/delete-template-button.tsx` — 삭제 confirm
- `src/app/admin/surveys/[id]/operations/mail-templates/page.tsx` — 목록
- `src/app/admin/surveys/[id]/operations/mail-templates/new/page.tsx` — 생성
- `src/app/admin/surveys/[id]/operations/mail-templates/[mid]/edit/page.tsx` — 편집

**Modify:**
- `src/db/schema/schema-types.ts` — `MailAttachment` 타입 추가
- `src/db/schema/index.ts` — mail 스키마 re-export
- `src/components/operations/operations-tab-strip.tsx` — 컨택 드롭다운에 "메일 템플릿" 항목 추가

### Phase B — 에디터

**Create:**
- `src/components/operations/mail-template/editor-extensions.ts` — TipTap 확장 셋
- `src/components/operations/mail-template/mail-var-token-plugin.ts` — Decoration 플러그인
- `src/components/operations/mail-template/variable-catalog.ts` — 카탈로그 fetch
- `src/components/operations/mail-template/popover-variable-menu.tsx` — Popover + cmdk
- `src/components/operations/mail-template/editor-toolbar.tsx` — 툴바
- `src/components/operations/mail-template/mail-template-editor.tsx` — 메인 에디터
- `tests/unit/mail-template/mail-var-token-plugin.test.ts` — TDD

**Modify:**
- `src/app/globals.css` — `.mail-var-token` 스타일 추가
- `src/app/admin/surveys/[id]/operations/mail-templates/[mid]/edit/page.tsx` — body textarea → MailTemplateEditor
- `package.json` — TipTap underline / text-style / font-size 패키지 추가

### Phase C — R2 업로드

**Create:**
- `src/app/api/upload/presign/route.ts` — POST presigned URL 발급
- `src/lib/mail/r2-key.ts` — key 빌드 (sanitize)
- `src/components/operations/mail-template/use-r2-upload.ts` — 클라이언트 훅
- `src/components/operations/mail-template/attachment-uploader.tsx` — 첨부 박스 + 업로더
- `tests/unit/mail-template/r2-key.test.ts` — TDD

**Modify:**
- `src/components/operations/mail-template/mail-template-editor.tsx` — 이미지 업로드 통합
- `src/components/operations/mail-template/meta-fields.tsx` — attachment-uploader 통합
- `package.json` — `@aws-sdk/s3-request-presigner` 추가

### Phase D — 발송

**Create:**
- `src/lib/mail/render-template.ts` — 변수 치환
- `src/lib/mail/resend-client.ts` — lazy-init Resend instance
- `src/components/operations/mail-template/email-shell.tsx` — react-email shell
- `src/components/operations/mail-template/contact-picker.tsx` — cmdk Combobox
- `src/components/operations/mail-template/mail-preview-dialog.tsx`
- `src/components/operations/mail-template/test-send-dialog.tsx`
- `tests/unit/mail-template/render-template.test.ts` — TDD (핵심)

**Modify:**
- `src/actions/mail-template-actions.ts` — `sendTestMailAction` 추가
- `src/components/operations/mail-template/mail-template-editor.tsx` — 미리보기/테스트발송 버튼 통합
- `.env.example` — `RESEND_FROM_DOMAIN` 추가
- `package.json` — `resend`, `@react-email/components`, `@react-email/render`

---

# Phase A — 구조

## Task A.1: 마이그레이션 0018 SQL 작성

**Files:**
- Create: `supabase/migrations/0018_mail_templates.sql`

- [ ] **Step 1: SQL 파일 작성**

```sql
-- 0018_mail_templates.sql

CREATE TABLE mail_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',

  from_local TEXT NOT NULL DEFAULT '',
  from_name TEXT NOT NULL DEFAULT '',
  reply_to TEXT,

  attachments JSONB NOT NULL DEFAULT '[]',
  variables_used JSONB NOT NULL DEFAULT '[]',

  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX mail_templates_survey_id_idx
  ON mail_templates(survey_id) WHERE deleted_at IS NULL;
```

- [ ] **Step 2: 마이그레이션 적용 (dev DB)**

Run: `pnpm db:push`

Expected: 출력에 `mail_templates` 테이블 생성됨이 표시. Drizzle 가 schema 와 동기화 안 된 상태이므로 step 3 끝난 후 다시 push 해도 OK.

- [ ] **Step 3: 적용 확인**

Run (Supabase SQL editor 또는 psql): `\d mail_templates`

Expected: 테이블 + 인덱스 출력. `survey_id`, `body_html`, `from_local`, `from_name`, `reply_to`, `attachments`, `variables_used`, `deleted_at` 컬럼 확인.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0018_mail_templates.sql
git commit -m "feat: mail_templates 테이블 마이그레이션 추가"
```

---

## Task A.2: schema-types.ts 에 MailAttachment 타입 추가

**Files:**
- Modify: `src/db/schema/schema-types.ts` (파일 끝)

- [ ] **Step 1: 파일 끝에 타입 추가**

```ts
// ─────────────────────────────────────────────────────────────────────────────
// 메일 (mail_templates) 관련 JSONB 타입
// ─────────────────────────────────────────────────────────────────────────────

/** mail_templates.attachments 의 각 원소 */
export interface MailAttachment {
  /** R2 object key — 예: mail/<surveyId>/<uuid>.pdf */
  key: string;
  filename: string;
  size: number;   // bytes
  mime: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/db/schema/schema-types.ts
git commit -m "feat: MailAttachment 타입 추가"
```

---

## Task A.3: Drizzle schema (mail.ts) 작성

**Files:**
- Create: `src/db/schema/mail.ts`
- Modify: `src/db/schema/index.ts`

- [ ] **Step 1: src/db/schema/mail.ts 작성**

```ts
import { relations } from 'drizzle-orm';
import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import type { MailAttachment } from './schema-types';
import { surveys } from './surveys';

export const mailTemplates = pgTable('mail_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  surveyId: uuid('survey_id')
    .notNull()
    .references(() => surveys.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  subject: text('subject').notNull().default(''),
  bodyHtml: text('body_html').notNull().default(''),
  fromLocal: text('from_local').notNull().default(''),
  fromName: text('from_name').notNull().default(''),
  replyTo: text('reply_to'),
  attachments: jsonb('attachments')
    .notNull()
    .default([])
    .$type<MailAttachment[]>(),
  variablesUsed: jsonb('variables_used')
    .notNull()
    .default([])
    .$type<string[]>(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const mailTemplatesRelations = relations(mailTemplates, ({ one }) => ({
  survey: one(surveys, {
    fields: [mailTemplates.surveyId],
    references: [surveys.id],
  }),
}));

export type MailTemplate = typeof mailTemplates.$inferSelect;
export type NewMailTemplate = typeof mailTemplates.$inferInsert;
```

- [ ] **Step 2: src/db/schema/index.ts 끝에 re-export 추가**

기존 export 들 아래에:

```ts
export * from './mail';
```

- [ ] **Step 3: drizzle introspection 으로 schema ↔ DB 동기화 확인**

Run: `pnpm db:push`

Expected: "No changes detected" — Step A.1 의 SQL 과 Drizzle schema 가 일치. 만약 변경 감지되면 SQL 또는 schema 컬럼/타입 mismatch — 수정 필요.

- [ ] **Step 4: TypeScript 컴파일 검증**

Run: `pnpm exec tsc --noEmit`

Expected: 에러 0개.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema/mail.ts src/db/schema/index.ts
git commit -m "feat: mailTemplates Drizzle schema 추가"
```

---

## Task A.4: zod 입력 스키마 작성

**Files:**
- Create: `src/lib/mail/schema.ts`

- [ ] **Step 1: zod schema 작성**

```ts
import { z } from 'zod';

/** local-part RFC 5321 단순화: 영문/숫자/점/하이픈/언더스코어 */
const FROM_LOCAL_RE = /^[a-z0-9._-]+$/i;
/** 파일명 안전 문자 (윈도우 reserved 제외) */
const SAFE_FILENAME_RE = /^[^\\/:*?"<>|]{1,200}$/;

export const mailAttachmentSchema = z.object({
  key: z.string().min(1).max(500),
  filename: z.string().regex(SAFE_FILENAME_RE, '파일명에 사용할 수 없는 문자가 있습니다'),
  size: z.number().int().positive().max(15 * 1024 * 1024, '15MB 이하만 가능합니다'),
  mime: z.string().min(1).max(200),
});

export const mailTemplateInputSchema = z.object({
  name: z.string().min(1, '이름을 입력해 주세요').max(100),
  subject: z.string().min(1, '제목을 입력해 주세요').max(255),
  bodyHtml: z.string().default(''),
  fromLocal: z
    .string()
    .min(1, '보낸이 계정을 입력해 주세요')
    .max(64)
    .regex(FROM_LOCAL_RE, '영문/숫자/점/하이픈/언더스코어만'),
  fromName: z.string().min(1, '보낸이 표시명을 입력해 주세요').max(100),
  replyTo: z.string().email('유효한 이메일 주소를 입력해 주세요'),
  attachments: z.array(mailAttachmentSchema).default([]),
});

export type MailTemplateInput = z.infer<typeof mailTemplateInputSchema>;
```

- [ ] **Step 2: TypeScript 컴파일 검증**

Run: `pnpm exec tsc --noEmit`

Expected: 에러 0개.

- [ ] **Step 3: Commit**

```bash
git add src/lib/mail/schema.ts
git commit -m "feat: mailTemplate zod 입력 스키마 추가"
```

---

## Task A.5: server fetch 헬퍼 (data/mail-templates.ts)

**Files:**
- Create: `src/data/mail-templates.ts`

- [ ] **Step 1: server fetch 작성**

```ts
import 'server-only';

import { and, desc, eq, isNull } from 'drizzle-orm';
import { cache } from 'react';

import { db } from '@/db';
import { mailTemplates, type MailTemplate } from '@/db/schema/mail';

/**
 * 한 설문의 메일 템플릿 목록 (soft delete 제외, 최근 갱신순).
 * React.cache 로 동일 요청 내 중복 호출 dedupe.
 */
export const getMailTemplatesBySurvey = cache(
  async (surveyId: string): Promise<MailTemplate[]> => {
    return await db
      .select()
      .from(mailTemplates)
      .where(and(eq(mailTemplates.surveyId, surveyId), isNull(mailTemplates.deletedAt)))
      .orderBy(desc(mailTemplates.updatedAt));
  },
);

/**
 * 단건 조회. surveyId 가드 — 다른 설문의 템플릿 못 보게.
 * 없거나 다른 설문 소속이면 null.
 */
export const getMailTemplate = cache(
  async (surveyId: string, templateId: string): Promise<MailTemplate | null> => {
    const rows = await db
      .select()
      .from(mailTemplates)
      .where(
        and(
          eq(mailTemplates.id, templateId),
          eq(mailTemplates.surveyId, surveyId),
          isNull(mailTemplates.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  },
);
```

- [ ] **Step 2: 컴파일 검증**

Run: `pnpm exec tsc --noEmit`

Expected: 에러 0개.

- [ ] **Step 3: Commit**

```bash
git add src/data/mail-templates.ts
git commit -m "feat: mail-templates server fetch 헬퍼 추가"
```

---

## Task A.6: server actions (CRUD)

**Files:**
- Create: `src/actions/mail-template-actions.ts`

- [ ] **Step 1: action 파일 작성 (sendTest 제외, Phase D 에서 추가)**

```ts
'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { mailTemplates } from '@/db/schema/mail';
import { requireAuth } from '@/lib/auth';
import {
  mailTemplateInputSchema,
  type MailTemplateInput,
} from '@/lib/mail/schema';

interface ActionResult<T = void> {
  ok: boolean;
  error?: string;
  data?: T;
}

/**
 * body_html / subject / from_name 에서 사용된 변수 토큰 키 추출.
 * 같은 키 반복은 중복 제거. 발송 시 검증/UX 캐시.
 */
function extractVariableKeys(...sources: string[]): string[] {
  const set = new Set<string>();
  const re = /\{\{([^}]+)\}\}/g;
  for (const s of sources) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(s)) !== null) {
      set.add(m[1].trim());
    }
  }
  return Array.from(set);
}

export async function createMailTemplateAction(
  surveyId: string,
  input: MailTemplateInput,
): Promise<ActionResult<{ id: string }>> {
  await requireAuth();
  const parsed = mailTemplateInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다' };
  }

  const { name, subject, bodyHtml, fromLocal, fromName, replyTo, attachments } = parsed.data;
  const variablesUsed = extractVariableKeys(subject, bodyHtml, fromName);

  const [row] = await db
    .insert(mailTemplates)
    .values({
      surveyId,
      name,
      subject,
      bodyHtml,
      fromLocal,
      fromName,
      replyTo,
      attachments,
      variablesUsed,
    })
    .returning({ id: mailTemplates.id });

  revalidatePath(`/admin/surveys/${surveyId}/operations/mail-templates`);
  return { ok: true, data: { id: row.id } };
}

export async function updateMailTemplateAction(
  surveyId: string,
  templateId: string,
  input: MailTemplateInput,
): Promise<ActionResult> {
  await requireAuth();
  const parsed = mailTemplateInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다' };
  }

  const { name, subject, bodyHtml, fromLocal, fromName, replyTo, attachments } = parsed.data;
  const variablesUsed = extractVariableKeys(subject, bodyHtml, fromName);

  const result = await db
    .update(mailTemplates)
    .set({
      name,
      subject,
      bodyHtml,
      fromLocal,
      fromName,
      replyTo,
      attachments,
      variablesUsed,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(mailTemplates.id, templateId),
        eq(mailTemplates.surveyId, surveyId),
        isNull(mailTemplates.deletedAt),
      ),
    )
    .returning({ id: mailTemplates.id });

  if (result.length === 0) {
    return { ok: false, error: '템플릿을 찾을 수 없습니다' };
  }

  revalidatePath(`/admin/surveys/${surveyId}/operations/mail-templates`);
  revalidatePath(`/admin/surveys/${surveyId}/operations/mail-templates/${templateId}/edit`);
  return { ok: true };
}

export async function deleteMailTemplateAction(
  surveyId: string,
  templateId: string,
): Promise<ActionResult> {
  await requireAuth();

  const result = await db
    .update(mailTemplates)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(mailTemplates.id, templateId),
        eq(mailTemplates.surveyId, surveyId),
        isNull(mailTemplates.deletedAt),
      ),
    )
    .returning({ id: mailTemplates.id });

  if (result.length === 0) {
    return { ok: false, error: '템플릿을 찾을 수 없습니다' };
  }

  revalidatePath(`/admin/surveys/${surveyId}/operations/mail-templates`);
  return { ok: true };
}
```

- [ ] **Step 2: TDD — extractVariableKeys 단위 테스트**

Create: `tests/unit/mail-template/extract-variable-keys.test.ts`

```ts
import { describe, expect, it } from 'vitest';

// 함수가 actions 파일에 private 라 export 가 필요. 이 step 후에 actions 파일에서 export.
import { __testOnly_extractVariableKeys } from '@/actions/mail-template-actions';

describe('extractVariableKeys', () => {
  it('단일 토큰 추출', () => {
    expect(__testOnly_extractVariableKeys('안녕 {{수행기관}}')).toEqual(['수행기관']);
  });
  it('여러 소스 통합 + 중복 제거', () => {
    const r = __testOnly_extractVariableKeys('{{a}} {{b}}', '{{b}} {{c}}', '{{a}}');
    expect(r.sort()).toEqual(['a', 'b', 'c']);
  });
  it('공백 트림', () => {
    expect(__testOnly_extractVariableKeys('{{ 수행기관 }}')).toEqual(['수행기관']);
  });
  it('토큰 없으면 빈 배열', () => {
    expect(__testOnly_extractVariableKeys('plain text')).toEqual([]);
  });
});
```

- [ ] **Step 3: actions 파일에 test export 추가**

`src/actions/mail-template-actions.ts` 끝에 추가:

```ts
// ───────────────────────────────────────────────────────────────────
// test only — 단위 테스트에서만 사용. production 호출 금지.
export const __testOnly_extractVariableKeys = extractVariableKeys;
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `pnpm test tests/unit/mail-template/extract-variable-keys.test.ts`

Expected: 4 tests passed.

- [ ] **Step 5: 컴파일 검증**

Run: `pnpm exec tsc --noEmit`

Expected: 에러 0개.

- [ ] **Step 6: Commit**

```bash
git add src/actions/mail-template-actions.ts tests/unit/mail-template/extract-variable-keys.test.ts
git commit -m "feat: mailTemplate CRUD server actions 추가"
```

---

## Task A.7: 헤더 네비 — 컨택 드롭다운에 "메일 템플릿" 추가

**Files:**
- Modify: `src/components/operations/operations-tab-strip.tsx`

- [ ] **Step 1: 라우트 변수 추가 + active 검사 추가**

`src/components/operations/operations-tab-strip.tsx` 의 `OperationsTabStrip` 함수 안, `contactsResultCodesHref` 정의 직후에:

```ts
  const contactsMailTemplatesHref = `${operationsBase}/mail-templates`;
  const isContactsMailTemplatesActive = pathname.startsWith(contactsMailTemplatesHref);
```

- [ ] **Step 2: isContactsActive 에 새 active 포함**

`isContactsActive` 정의를 다음으로 교체:

```ts
  const isContactsActive =
    isContactsRootActive ||
    isContactsUploadActive ||
    isContactsColumnsActive ||
    isContactsResultCodesActive ||
    isContactsMailTemplatesActive;
```

- [ ] **Step 3: 드롭다운 항목 추가**

`NavigationMenuContent` 안 (결과코드 SubLink 다음 줄) 에:

```tsx
              <SubLink href={contactsMailTemplatesHref} active={isContactsMailTemplatesActive}>
                메일 템플릿
              </SubLink>
```

- [ ] **Step 4: 빌드 / 타입 검증**

Run: `pnpm exec tsc --noEmit`

Expected: 에러 0개.

- [ ] **Step 5: Manual smoke**

Run: `pnpm dev` (이미 떠 있으면 그대로)

브라우저: 어떤 설문의 운영 콘솔로 이동 → "컨택" 드롭다운 hover → "메일 템플릿" 항목 보임 → 클릭 시 404 (페이지는 다음 task).

- [ ] **Step 6: Commit**

```bash
git add src/components/operations/operations-tab-strip.tsx
git commit -m "feat: 컨택 드롭다운에 메일 템플릿 항목 추가"
```

---

## Task A.8: 목록 페이지

**Files:**
- Create: `src/components/operations/mail-template/mail-template-list.tsx`
- Create: `src/components/operations/mail-template/delete-template-button.tsx`
- Create: `src/app/admin/surveys/[id]/operations/mail-templates/page.tsx`

- [ ] **Step 1: 삭제 버튼 컴포넌트**

`src/components/operations/mail-template/delete-template-button.tsx`:

```tsx
'use client';

import { useTransition } from 'react';

import { Trash2 } from 'lucide-react';

import { deleteMailTemplateAction } from '@/actions/mail-template-actions';
import { Button } from '@/components/ui/button';

interface Props {
  surveyId: string;
  templateId: string;
  templateName: string;
}

export function DeleteTemplateButton({ surveyId, templateId, templateName }: Props) {
  const [pending, startTransition] = useTransition();

  const onClick = () => {
    if (!confirm(`"${templateName}" 템플릿을 삭제하시겠습니까?`)) return;
    startTransition(async () => {
      const r = await deleteMailTemplateAction(surveyId, templateId);
      if (!r.ok) alert(r.error ?? '삭제 실패');
    });
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={pending}
      className="text-red-600 hover:text-red-700"
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}
```

- [ ] **Step 2: 목록 row 컴포넌트**

`src/components/operations/mail-template/mail-template-list.tsx`:

```tsx
import Link from 'next/link';

import type { MailTemplate } from '@/db/schema/mail';

import { DeleteTemplateButton } from './delete-template-button';

interface Props {
  surveyId: string;
  templates: MailTemplate[];
}

export function MailTemplateList({ surveyId, templates }: Props) {
  if (templates.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 bg-white p-12 text-center text-gray-500">
        등록된 메일 템플릿이 없습니다.
        <div className="mt-2">
          <Link
            href={`/admin/surveys/${surveyId}/operations/mail-templates/new`}
            className="text-blue-600 hover:underline"
          >
            새 템플릿 만들기
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <table className="w-full">
        <thead className="bg-gray-50">
          <tr className="text-left text-sm text-gray-500">
            <th className="px-4 py-3">이름</th>
            <th className="px-4 py-3">제목</th>
            <th className="px-4 py-3">갱신</th>
            <th className="w-20" />
          </tr>
        </thead>
        <tbody>
          {templates.map((t) => (
            <tr key={t.id} className="border-t border-gray-100 text-sm hover:bg-gray-50">
              <td className="px-4 py-3 font-medium">
                <Link
                  href={`/admin/surveys/${surveyId}/operations/mail-templates/${t.id}/edit`}
                  className="text-blue-600 hover:underline"
                >
                  {t.name}
                </Link>
              </td>
              <td className="max-w-md truncate px-4 py-3 text-gray-700">{t.subject || '—'}</td>
              <td className="px-4 py-3 text-gray-500">
                {new Date(t.updatedAt).toLocaleDateString('ko-KR')}
              </td>
              <td className="px-4 py-3 text-right">
                <DeleteTemplateButton
                  surveyId={surveyId}
                  templateId={t.id}
                  templateName={t.name}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: 목록 페이지**

`src/app/admin/surveys/[id]/operations/mail-templates/page.tsx`:

```tsx
import Link from 'next/link';

import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { MailTemplateList } from '@/components/operations/mail-template/mail-template-list';
import { getMailTemplatesBySurvey } from '@/data/mail-templates';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function MailTemplatesListPage({ params }: Props) {
  const { id: surveyId } = await params;
  const templates = await getMailTemplatesBySurvey(surveyId);

  return (
    <main className="mx-auto max-w-7xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">메일 템플릿</h1>
          <p className="mt-1 text-sm text-gray-500">
            컨택리스트에 발송할 메일 템플릿을 관리합니다.
          </p>
        </div>
        <Button asChild>
          <Link href={`/admin/surveys/${surveyId}/operations/mail-templates/new`}>
            <Plus className="mr-1 h-4 w-4" />새 템플릿
          </Link>
        </Button>
      </div>
      <MailTemplateList surveyId={surveyId} templates={templates} />
    </main>
  );
}
```

- [ ] **Step 4: 빌드 검증**

Run: `pnpm exec tsc --noEmit`

Expected: 에러 0개.

- [ ] **Step 5: Manual smoke**

브라우저: `/admin/surveys/<설문ID>/operations/mail-templates` → 빈 상태 메시지 표시. 헤더/탭 strip 정상 표시.

- [ ] **Step 6: Commit**

```bash
git add src/components/operations/mail-template/mail-template-list.tsx \
        src/components/operations/mail-template/delete-template-button.tsx \
        src/app/admin/surveys/\[id\]/operations/mail-templates/page.tsx
git commit -m "feat: 메일 템플릿 목록 페이지 추가"
```

---

## Task A.9: 메타 필드 폼 컴포넌트

**Files:**
- Create: `src/components/operations/mail-template/meta-fields.tsx`

- [ ] **Step 1: 메타 필드 컴포넌트**

```tsx
'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface MetaFieldValues {
  name: string;
  subject: string;
  fromLocal: string;
  fromName: string;
  replyTo: string;
}

interface Props {
  values: MetaFieldValues;
  onChange: (next: MetaFieldValues) => void;
  fromDomain: string;   // 표시용. RESEND_FROM_DOMAIN 을 server 에서 prop 으로 내림
}

export function MetaFields({ values, onChange, fromDomain }: Props) {
  const set = <K extends keyof MetaFieldValues>(key: K, v: MetaFieldValues[K]) => {
    onChange({ ...values, [key]: v });
  };

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      <Field label="템플릿 이름" required>
        <Input
          value={values.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="예: 한국전시산업진흥회 초대 메일"
          maxLength={100}
        />
      </Field>

      <Field label="메일 제목" required hint="변수 토큰 사용 가능 — 예: {{수행기관}} 안내">
        <Input
          value={values.subject}
          onChange={(e) => set('subject', e.target.value)}
          maxLength={255}
        />
      </Field>

      <Field label="보낸이 표시명" required hint="변수 토큰 가능 — 예: {{수행기관}}">
        <Input
          value={values.fromName}
          onChange={(e) => set('fromName', e.target.value)}
          placeholder="예: 한국전시산업진흥회"
          maxLength={100}
        />
      </Field>

      <Field label="보낸이 계정" required>
        <div className="flex items-stretch">
          <Input
            value={values.fromLocal}
            onChange={(e) => set('fromLocal', e.target.value)}
            placeholder="예: survey"
            maxLength={64}
            className="rounded-r-none"
          />
          <span className="flex items-center rounded-r-md border border-l-0 border-gray-200 bg-gray-50 px-3 text-sm text-gray-500">
            @{fromDomain}
          </span>
        </div>
      </Field>

      <Field label="답장 받을 메일" required hint="발송 후 받는 사람이 답장하면 이 주소로 갑니다">
        <Input
          type="email"
          value={values.replyTo}
          onChange={(e) => set('replyTo', e.target.value)}
          placeholder="예: info@kotra.or.kr"
        />
      </Field>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-start gap-3">
      <Label className="pt-2 text-sm">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </Label>
      <div className="space-y-1">
        {children}
        {hint && <p className="text-xs text-gray-500">{hint}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 컴파일 확인**

Run: `pnpm exec tsc --noEmit`

Expected: 에러 0개.

- [ ] **Step 3: Commit**

```bash
git add src/components/operations/mail-template/meta-fields.tsx
git commit -m "feat: 메일 템플릿 메타 입력 폼 컴포넌트 추가"
```

---

## Task A.10: 생성/편집 페이지 (textarea body 임시)

**Files:**
- Create: `src/app/admin/surveys/[id]/operations/mail-templates/new/page.tsx`
- Create: `src/app/admin/surveys/[id]/operations/mail-templates/[mid]/edit/page.tsx`
- Create: `src/components/operations/mail-template/template-edit-form.tsx`

> Phase B 에서 textarea 를 MailTemplateEditor 로 교체. 그 전까지 단순 textarea 로 저장 동작 검증.

- [ ] **Step 1: 편집 폼 클라이언트 컴포넌트**

`src/components/operations/mail-template/template-edit-form.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  createMailTemplateAction,
  updateMailTemplateAction,
} from '@/actions/mail-template-actions';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { MailTemplate } from '@/db/schema/mail';

import { MetaFields, type MetaFieldValues } from './meta-fields';

interface Props {
  surveyId: string;
  fromDomain: string;
  template?: MailTemplate;  // 없으면 생성, 있으면 편집
}

export function TemplateEditForm({ surveyId, fromDomain, template }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [meta, setMeta] = useState<MetaFieldValues>({
    name: template?.name ?? '',
    subject: template?.subject ?? '',
    fromLocal: template?.fromLocal ?? '',
    fromName: template?.fromName ?? '',
    replyTo: template?.replyTo ?? '',
  });
  const [bodyHtml, setBodyHtml] = useState(template?.bodyHtml ?? '');

  const onSave = () => {
    setError(null);
    startTransition(async () => {
      const input = {
        ...meta,
        bodyHtml,
        attachments: template?.attachments ?? [],
      };

      const result = template
        ? await updateMailTemplateAction(surveyId, template.id, input)
        : await createMailTemplateAction(surveyId, input);

      if (!result.ok) {
        setError(result.error ?? '저장 실패');
        return;
      }
      router.push(`/admin/surveys/${surveyId}/operations/mail-templates`);
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <MetaFields values={meta} onChange={setMeta} fromDomain={fromDomain} />

      <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-4">
        <Label className="text-sm">본문 (Phase B 에서 TipTap 으로 교체)</Label>
        <Textarea
          value={bodyHtml}
          onChange={(e) => setBodyHtml(e.target.value)}
          placeholder="안녕하세요, {{수행기관}} 담당자님."
          className="min-h-[280px] font-mono text-sm"
        />
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>
          취소
        </Button>
        <Button type="button" onClick={onSave} disabled={pending}>
          {pending ? '저장 중...' : '저장'}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 생성 페이지**

`src/app/admin/surveys/[id]/operations/mail-templates/new/page.tsx`:

```tsx
import { TemplateEditForm } from '@/components/operations/mail-template/template-edit-form';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function NewMailTemplatePage({ params }: Props) {
  const { id: surveyId } = await params;
  const fromDomain = process.env.RESEND_FROM_DOMAIN ?? '';

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="mb-6 text-xl font-semibold">새 메일 템플릿</h1>
      <TemplateEditForm surveyId={surveyId} fromDomain={fromDomain} />
    </main>
  );
}
```

- [ ] **Step 3: 편집 페이지**

`src/app/admin/surveys/[id]/operations/mail-templates/[mid]/edit/page.tsx`:

```tsx
import { notFound } from 'next/navigation';

import { TemplateEditForm } from '@/components/operations/mail-template/template-edit-form';
import { getMailTemplate } from '@/data/mail-templates';

interface Props {
  params: Promise<{ id: string; mid: string }>;
}

export default async function EditMailTemplatePage({ params }: Props) {
  const { id: surveyId, mid: templateId } = await params;
  const template = await getMailTemplate(surveyId, templateId);
  if (!template) notFound();

  const fromDomain = process.env.RESEND_FROM_DOMAIN ?? '';

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="mb-6 text-xl font-semibold">메일 템플릿 편집</h1>
      <TemplateEditForm surveyId={surveyId} fromDomain={fromDomain} template={template} />
    </main>
  );
}
```

- [ ] **Step 4: 임시 env 추가 (.env.local — git ignore)**

`.env.local` 끝에 추가 (Phase D 에서 정식 .env.example 갱신):

```
RESEND_FROM_DOMAIN=send.megaresearch.co.kr
```

- [ ] **Step 5: 빌드 검증**

Run: `pnpm exec tsc --noEmit`

Expected: 에러 0개.

- [ ] **Step 6: Manual smoke — 생성 ~ 편집 ~ 삭제 풀 라이프사이클**

dev 서버에서:
1. 메일 템플릿 목록 → "새 템플릿"
2. 메타 필드 모두 채움 (이름·제목·표시명·계정·답장메일) + body textarea 에 `안녕하세요, {{수행기관}} 담당자님.` 입력
3. "저장" → 목록 페이지로 redirect, 방금 만든 템플릿 표시
4. 템플릿 클릭 → 편집 페이지, 모든 필드 복원 확인
5. 본문 수정 후 저장 → 갱신 시각 변경 확인
6. 삭제 버튼 → confirm → 목록에서 사라짐
7. (DB 직접 확인) `SELECT id, name, deleted_at FROM mail_templates;` → soft delete 행 deleted_at NOT NULL

- [ ] **Step 7: Commit**

```bash
git add src/components/operations/mail-template/template-edit-form.tsx \
        src/app/admin/surveys/\[id\]/operations/mail-templates/new/page.tsx \
        src/app/admin/surveys/\[id\]/operations/mail-templates/\[mid\]/edit/page.tsx
git commit -m "feat: 메일 템플릿 생성 편집 페이지 추가"
```

---

## Phase A 완료 게이트

- [ ] **Manual smoke 풀 검증**:
  - 헤더 네비 "메일 템플릿" 항목 hover/click 동작
  - 목록 / 생성 / 편집 / 삭제 풀 라이프사이클
  - 빈 상태 메시지 표시
  - 비로그인 시 unauthorized (action 단)
  - DB 컬럼 (특히 `variables_used`) 정상 채워짐

- [ ] **타입체크 통과**: `pnpm exec tsc --noEmit`
- [ ] **Lint 통과**: `pnpm lint`
- [ ] **Phase A PR 생성** (선택)

---

# Phase B — 에디터

## Task B.1: 패키지 설치

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 설치**

Run:
```bash
pnpm add @tiptap/extension-underline @tiptap/extension-text-style tiptap-extension-font-size
```

- [ ] **Step 2: 빌드 확인**

Run: `pnpm exec tsc --noEmit`

Expected: 에러 0개. 새 패키지 import 가능.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: TipTap underline text-style font-size 패키지 추가"
```

---

## Task B.2: globals.css 에 변수 토큰 스타일

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: 파일 끝에 추가**

```css
/* ==========================================
   메일 템플릿 — 변수 토큰 (ProseMirror Decoration)
   ========================================== */
.mail-var-token {
  background-color: var(--color-amber-100);
  color: var(--color-amber-800);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: var(--font-mono);
  font-size: 0.95em;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/globals.css
git commit -m "feat: 메일 변수 토큰 하이라이트 CSS 추가"
```

---

## Task B.3: ProseMirror Decoration 플러그인 — TDD

**Files:**
- Create: `tests/unit/mail-template/mail-var-token-plugin.test.ts`
- Create: `src/components/operations/mail-template/mail-var-token-plugin.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/unit/mail-template/mail-var-token-plugin.test.ts
import { describe, expect, it } from 'vitest';

// schema 는 가벼운 ProseMirror schema 가 필요. tiptap 의 starter-kit 활용.
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';

import { mailVarTokenPlugin, scanTokenRanges } from '@/components/operations/mail-template/mail-var-token-plugin';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    text: {},
  },
  marks: {},
});

function makeDoc(text: string) {
  return schema.node('doc', null, [schema.node('paragraph', null, [schema.text(text)])]);
}

describe('scanTokenRanges', () => {
  it('단일 토큰 위치 반환', () => {
    const doc = makeDoc('hi {{name}}');
    const ranges = scanTokenRanges(doc);
    expect(ranges).toEqual([{ from: 4, to: 12 }]); // paragraph offset 1 + 'hi '.length=3 = 4
  });

  it('여러 토큰 모두 반환', () => {
    const doc = makeDoc('{{a}} {{b}}');
    const ranges = scanTokenRanges(doc);
    expect(ranges.length).toBe(2);
  });

  it('토큰 없으면 빈 배열', () => {
    const doc = makeDoc('plain text');
    expect(scanTokenRanges(doc)).toEqual([]);
  });

  it('잘못된 형태({{ 만) 는 매칭 X', () => {
    const doc = makeDoc('{{ broken');
    expect(scanTokenRanges(doc)).toEqual([]);
  });
});

describe('mailVarTokenPlugin', () => {
  it('초기 doc 의 토큰을 Decoration 으로 마킹', () => {
    const doc = makeDoc('hi {{x}}');
    const state = EditorState.create({ doc, plugins: [mailVarTokenPlugin] });
    const deco = mailVarTokenPlugin.getState(state);
    expect(deco).toBeDefined();
    expect(deco!.find().length).toBe(1);
  });
});
```

- [ ] **Step 2: 테스트 실행 — FAIL 확인**

Run: `pnpm test tests/unit/mail-template/mail-var-token-plugin.test.ts`

Expected: 모듈 못 찾음 에러 (`mail-var-token-plugin` 파일 없음).

- [ ] **Step 3: 플러그인 구현**

`src/components/operations/mail-template/mail-var-token-plugin.ts`:

```ts
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const VAR_TOKEN_RE = /\{\{[^}]+\}\}/g;

export interface TokenRange {
  from: number;
  to: number;
}

/**
 * doc 전체를 순회하며 {{var}} 토큰의 절대 위치 범위를 반환.
 * Pure function — 테스트 가능.
 */
export function scanTokenRanges(doc: PMNode): TokenRange[] {
  const ranges: TokenRange[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const text = node.text ?? '';
    let m: RegExpExecArray | null;
    VAR_TOKEN_RE.lastIndex = 0;
    while ((m = VAR_TOKEN_RE.exec(text)) !== null) {
      const from = pos + m.index;
      ranges.push({ from, to: from + m[0].length });
    }
  });
  return ranges;
}

function buildDecorations(doc: PMNode): DecorationSet {
  const ranges = scanTokenRanges(doc);
  const decorations = ranges.map((r) =>
    Decoration.inline(r.from, r.to, { class: 'mail-var-token' }),
  );
  return DecorationSet.create(doc, decorations);
}

export const mailVarTokenPluginKey = new PluginKey<DecorationSet>('mail-var-token');

export const mailVarTokenPlugin = new Plugin<DecorationSet>({
  key: mailVarTokenPluginKey,
  state: {
    init: (_, { doc }) => buildDecorations(doc),
    apply: (tr, old) => (tr.docChanged ? buildDecorations(tr.doc) : old),
  },
  props: {
    decorations(state) {
      return mailVarTokenPluginKey.getState(state);
    },
  },
});
```

- [ ] **Step 4: 테스트 재실행 — PASS 확인**

Run: `pnpm test tests/unit/mail-template/mail-var-token-plugin.test.ts`

Expected: 모든 테스트 통과.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/mail-template/mail-var-token-plugin.test.ts \
        src/components/operations/mail-template/mail-var-token-plugin.ts
git commit -m "feat: 메일 변수 토큰 ProseMirror Decoration 플러그인 추가"
```

---

## Task B.4: 변수 카탈로그 server fetch

**Files:**
- Create: `src/components/operations/mail-template/variable-catalog.ts`

- [ ] **Step 1: 카탈로그 fetch 함수**

```ts
import 'server-only';

import { and, eq } from 'drizzle-orm';
import { cache } from 'react';

import { db } from '@/db';
import { contactTargets } from '@/db/schema/contacts';
import { getSurveyById } from '@/data/surveys';

export interface VariableDef {
  key: string;
  label: string;
  category: 'attrs' | 'system';
  description?: string;
}

export const getVariableCatalog = cache(async (surveyId: string): Promise<VariableDef[]> => {
  // 1. 시스템 변수 (이번 슬라이스 1개)
  const system: VariableDef[] = [
    {
      key: 'invite_link',
      label: '응답 페이지 링크',
      category: 'system',
      description: '컨택별 inviteToken 으로 자동 빌드',
    },
  ];

  // 2. attrs 변수 — ContactColumnScheme 우선
  const survey = await getSurveyById(surveyId);
  let attrsKeys: VariableDef[] = [];
  if (survey?.contactColumns?.columns) {
    attrsKeys = survey.contactColumns.columns
      .filter((c) => c.source.startsWith('attrs.'))
      .map((c) => ({
        key: c.source.slice(6),
        label: c.label,
        category: 'attrs' as const,
      }));
  }

  // 3. 폴백 — 첫 컨택 1행 attrs keys
  if (attrsKeys.length === 0) {
    const [sample] = await db
      .select({ attrs: contactTargets.attrs })
      .from(contactTargets)
      .where(eq(contactTargets.surveyId, surveyId))
      .limit(1);
    if (sample) {
      attrsKeys = Object.keys(sample.attrs).map((k) => ({
        key: k,
        label: k,
        category: 'attrs' as const,
      }));
    }
  }

  return [...attrsKeys, ...system];
});
```

- [ ] **Step 2: 컴파일**

Run: `pnpm exec tsc --noEmit`

Expected: 에러 0개.

- [ ] **Step 3: Commit**

```bash
git add src/components/operations/mail-template/variable-catalog.ts
git commit -m "feat: 변수 카탈로그 server fetch 추가"
```

---

## Task B.5: Popover 변수 메뉴

**Files:**
- Create: `src/components/operations/mail-template/popover-variable-menu.tsx`

> shadcn `Popover` 와 `Command` (cmdk) 가 이미 프로젝트에 있는지 확인. 없으면 `pnpm dlx shadcn@latest add popover command` 로 추가. (대부분 프로젝트에 popover 는 이미 있고 command 는 없을 수 있음.)

- [ ] **Step 1: shadcn primitives 확인 / 추가**

Run: `ls src/components/ui/popover.tsx src/components/ui/command.tsx 2>/dev/null`

없는 항목이 있으면:
```bash
pnpm dlx shadcn@latest add popover command
```

- [ ] **Step 2: 컴포넌트 작성**

```tsx
'use client';

import { useState } from 'react';

import { Variable } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import type { VariableDef } from './variable-catalog';

interface Props {
  catalog: VariableDef[];
  onPick: (key: string) => void;
}

export function PopoverVariableMenu({ catalog, onPick }: Props) {
  const [open, setOpen] = useState(false);

  const attrs = catalog.filter((v) => v.category === 'attrs');
  const system = catalog.filter((v) => v.category === 'system');

  const handlePick = (key: string) => {
    onPick(key);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="gap-1">
          <Variable className="h-4 w-4" />
          변수
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <Command>
          <CommandInput placeholder="변수 검색..." />
          <CommandList className="max-h-[280px]">
            <CommandEmpty>일치하는 변수가 없습니다.</CommandEmpty>
            {attrs.length > 0 && (
              <CommandGroup heading="컨택 데이터 (attrs)">
                {attrs.map((v) => (
                  <CommandItem key={v.key} value={`attrs-${v.key}`} onSelect={() => handlePick(v.key)}>
                    <span className="font-mono text-xs text-amber-700">{`{{${v.key}}}`}</span>
                    <span className="ml-2 text-xs text-gray-500">{v.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {system.length > 0 && (
              <CommandGroup heading="시스템">
                {system.map((v) => (
                  <CommandItem key={v.key} value={`system-${v.key}`} onSelect={() => handlePick(v.key)}>
                    <span className="font-mono text-xs text-amber-700">{`{{${v.key}}}`}</span>
                    <span className="ml-2 text-xs text-gray-500">{v.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {catalog.length === 0 && (
              <div className="p-4 text-center text-xs text-gray-500">
                이 설문에 컨택 attrs 가 등록되지 않았습니다.<br />
                <span className="text-gray-400">컨택리스트 → 리스트 업로드부터.</span>
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 3: 컴파일 + Commit**

Run: `pnpm exec tsc --noEmit`

```bash
git add src/components/operations/mail-template/popover-variable-menu.tsx \
        src/components/ui/popover.tsx src/components/ui/command.tsx
git commit -m "feat: 메일 변수 popover 메뉴 추가"
```

---

## Task B.6: TipTap 확장 셋

**Files:**
- Create: `src/components/operations/mail-template/editor-extensions.ts`

- [ ] **Step 1: 확장 셋 정의**

```ts
import Bold from '@tiptap/extension-bold';
import BulletList from '@tiptap/extension-bullet-list';
import Document from '@tiptap/extension-document';
import HardBreak from '@tiptap/extension-hard-break';
import Heading from '@tiptap/extension-heading';
import History from '@tiptap/extension-history';
import HorizontalRule from '@tiptap/extension-horizontal-rule';
import Image from '@tiptap/extension-image';
import Italic from '@tiptap/extension-italic';
import Link from '@tiptap/extension-link';
import ListItem from '@tiptap/extension-list-item';
import OrderedList from '@tiptap/extension-ordered-list';
import Paragraph from '@tiptap/extension-paragraph';
import Strike from '@tiptap/extension-strike';
import Table from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import Text from '@tiptap/extension-text';
import TextStyle from '@tiptap/extension-text-style';
import Underline from '@tiptap/extension-underline';
import FontSize from 'tiptap-extension-font-size';

import { mailVarTokenPlugin } from './mail-var-token-plugin';
import { Extension } from '@tiptap/core';

/** mailVarTokenPlugin 을 TipTap Extension 으로 wrap */
const MailVarTokenExtension = Extension.create({
  name: 'mailVarToken',
  addProseMirrorPlugins() {
    return [mailVarTokenPlugin];
  },
});

export function createMailEditorExtensions() {
  return [
    Document,
    Paragraph,
    Text,
    Bold,
    Italic,
    Underline,
    Strike,
    TextStyle,
    FontSize,
    Heading.configure({ levels: [1, 2, 3] }),
    BulletList,
    OrderedList,
    ListItem,
    HardBreak,
    HorizontalRule,
    History,
    Link.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer' } }),
    Image,
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    MailVarTokenExtension,
  ];
}
```

- [ ] **Step 2: 컴파일**

Run: `pnpm exec tsc --noEmit`

Expected: 에러 0개.

- [ ] **Step 3: Commit**

```bash
git add src/components/operations/mail-template/editor-extensions.ts
git commit -m "feat: 메일 에디터 TipTap 확장 셋 추가"
```

---

## Task B.7: 에디터 툴바

**Files:**
- Create: `src/components/operations/mail-template/editor-toolbar.tsx`

- [ ] **Step 1: 툴바 컴포넌트** (NoticeEditor 패턴 압축 재사용 + 변수 popover)

```tsx
'use client';

import {
  Bold, Image as ImageIcon, Italic, Link as LinkIcon, List, ListOrdered,
  Redo, Table as TableIcon, Underline, Undo,
  Columns, Rows, Merge, Split, Trash2, Paintbrush, X, Equal,
} from 'lucide-react';
import { Editor } from '@tiptap/react';

import { Button } from '@/components/ui/button';

import { PopoverVariableMenu } from './popover-variable-menu';
import type { VariableDef } from './variable-catalog';

interface Props {
  editor: Editor;
  catalog: VariableDef[];
  onPickImage: () => void;
  onPickLink: () => void;
}

export function EditorToolbar({ editor, catalog, onPickImage, onPickLink }: Props) {
  const insertVar = (key: string) => {
    editor.chain().focus().insertContent(`{{${key}}}`).run();
  };

  const setFontSize = (px: string) => {
    editor.chain().focus().setFontSize(`${px}px`).run();
  };

  return (
    <div className="flex flex-wrap gap-1 rounded-t-lg border border-b-0 border-gray-200 bg-gray-50 p-2">
      {/* 서식 */}
      <ToolBtn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <Underline className="h-4 w-4" />
      </ToolBtn>

      <select
        className="rounded border border-gray-200 bg-white px-1 text-xs"
        onChange={(e) => setFontSize(e.target.value)}
        defaultValue="14"
      >
        {[12, 14, 16, 18, 20, 24, 28, 32].map((s) => (
          <option key={s} value={s}>{s}px</option>
        ))}
      </select>

      <Sep />

      {/* 리스트 */}
      <ToolBtn active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered className="h-4 w-4" />
      </ToolBtn>

      <Sep />

      {/* 미디어 / 표 */}
      <ToolBtn onClick={onPickImage}><ImageIcon className="h-4 w-4" /></ToolBtn>
      <ToolBtn onClick={onPickLink}><LinkIcon className="h-4 w-4" /></ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
        <TableIcon className="h-4 w-4" />
      </ToolBtn>

      <Sep />

      <PopoverVariableMenu catalog={catalog} onPick={insertVar} />

      <div className="ml-auto flex gap-1">
        <ToolBtn onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>
          <Undo className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>
          <Redo className="h-4 w-4" />
        </ToolBtn>
      </div>

      {/* 표 contextual toolbar */}
      {editor.can().deleteTable() && (
        <div className="flex w-full flex-wrap gap-1 border-t border-gray-200 pt-2">
          <ToolBtn title="열 추가" onClick={() => editor.chain().focus().addColumnAfter().run()}>
            <Columns className="h-4 w-4" />
          </ToolBtn>
          <ToolBtn title="행 추가" onClick={() => editor.chain().focus().addRowAfter().run()}>
            <Rows className="h-4 w-4" />
          </ToolBtn>
          <ToolBtn title="열 삭제" className="text-red-600" disabled={!editor.can().deleteColumn()} onClick={() => editor.chain().focus().deleteColumn().run()}>
            <Columns className="h-4 w-4" /><span className="text-xs">−</span>
          </ToolBtn>
          <ToolBtn title="행 삭제" className="text-red-600" disabled={!editor.can().deleteRow()} onClick={() => editor.chain().focus().deleteRow().run()}>
            <Rows className="h-4 w-4" /><span className="text-xs">−</span>
          </ToolBtn>
          <ToolBtn title="셀 병합" disabled={!editor.can().mergeCells()} onClick={() => editor.chain().focus().mergeCells().run()}>
            <Merge className="h-4 w-4" />
          </ToolBtn>
          <ToolBtn title="셀 분할" disabled={!editor.can().splitCell()} onClick={() => editor.chain().focus().splitCell().run()}>
            <Split className="h-4 w-4" />
          </ToolBtn>
          <ToolBtn title="셀 배경" onClick={() => editor.chain().focus().updateAttributes('tableCell', { backgroundColor: '#e5e7eb' }).updateAttributes('tableHeader', { backgroundColor: '#e5e7eb' }).run()}>
            <Paintbrush className="h-4 w-4" />
          </ToolBtn>
          <ToolBtn title="셀 배경 제거" className="text-red-600" onClick={() => editor.chain().focus().updateAttributes('tableCell', { backgroundColor: null }).updateAttributes('tableHeader', { backgroundColor: null }).run()}>
            <Paintbrush className="h-4 w-4" /><X className="h-3 w-3" />
          </ToolBtn>
          <ToolBtn title="표 삭제" className="text-red-600" onClick={() => editor.chain().focus().deleteTable().run()}>
            <Trash2 className="h-4 w-4" />
          </ToolBtn>
        </div>
      )}
    </div>
  );
}

function ToolBtn({
  children, onClick, active, disabled, title, className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${active ? 'bg-gray-200' : ''} ${className ?? ''}`}
    >
      {children}
    </Button>
  );
}

function Sep() {
  return <div className="h-6 w-px bg-gray-300" />;
}
```

- [ ] **Step 2: 컴파일**

Run: `pnpm exec tsc --noEmit`

Expected: 에러 0개.

- [ ] **Step 3: Commit**

```bash
git add src/components/operations/mail-template/editor-toolbar.tsx
git commit -m "feat: 메일 에디터 툴바 추가"
```

---

## Task B.8: 메인 에디터 컴포넌트 (이미지 / 첨부 placeholder, Phase C 에서 통합)

**Files:**
- Create: `src/components/operations/mail-template/mail-template-editor.tsx`

- [ ] **Step 1: 에디터 컴포넌트** (이미지 업로드는 Phase C 에서 추가, 일단 prompt 로 URL 입력)

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';

import { EditorContent, useEditor } from '@tiptap/react';

import { createMailEditorExtensions } from './editor-extensions';
import { EditorToolbar } from './editor-toolbar';
import type { VariableDef } from './variable-catalog';

interface Props {
  initialHtml: string;
  catalog: VariableDef[];
  onChange: (html: string) => void;
}

export function MailTemplateEditor({ initialHtml, catalog, onChange }: Props) {
  const extensions = useMemo(() => createMailEditorExtensions(), []);
  const [, force] = useState({});

  const editor = useEditor({
    extensions,
    content: initialHtml,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          'prose prose-sm max-w-none focus:outline-none min-h-[320px] p-6 ' +
          '[&_table]:border-collapse [&_table]:w-full [&_table]:my-2 [&_table]:border [&_table]:border-gray-300 ' +
          '[&_table_td]:border [&_table_td]:border-gray-300 [&_table_td]:px-2 [&_table_td]:py-1 ' +
          '[&_table_th]:border [&_table_th]:border-gray-300 [&_table_th]:px-2 [&_table_th]:py-1 ' +
          '[&_table_th]:bg-gray-50',
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.isEmpty ? '' : editor.getHTML());
    },
    onSelectionUpdate: () => {
      // 툴바 active 상태 업데이트용 강제 리렌더
      force({});
    },
  });

  // initialHtml 변경 시 reset (편집 페이지에서 fetch 후 동기화)
  useEffect(() => {
    if (editor && initialHtml !== editor.getHTML()) {
      editor.commands.setContent(initialHtml, { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHtml]);

  if (!editor) return null;

  const onPickImage = () => {
    // Phase C 에서 R2 업로드로 교체. 현재는 외부 URL prompt 로 동작 검증.
    const url = window.prompt('이미지 URL');
    if (url) editor.chain().focus().setImage({ src: url }).run();
  };

  const onPickLink = () => {
    const url = window.prompt('링크 URL');
    if (url) editor.chain().focus().setLink({ href: url }).run();
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <EditorToolbar editor={editor} catalog={catalog} onPickImage={onPickImage} onPickLink={onPickLink} />
      <EditorContent editor={editor} className="border-t border-gray-200" />
    </div>
  );
}
```

- [ ] **Step 2: 컴파일**

Run: `pnpm exec tsc --noEmit`

Expected: 에러 0개.

- [ ] **Step 3: Commit**

```bash
git add src/components/operations/mail-template/mail-template-editor.tsx
git commit -m "feat: 메일 템플릿 메인 에디터 컴포넌트 추가"
```

---

## Task B.9: 편집 페이지에서 textarea → MailTemplateEditor 교체

**Files:**
- Modify: `src/components/operations/mail-template/template-edit-form.tsx`
- Modify: `src/app/admin/surveys/[id]/operations/mail-templates/new/page.tsx`
- Modify: `src/app/admin/surveys/[id]/operations/mail-templates/[mid]/edit/page.tsx`

- [ ] **Step 1: template-edit-form.tsx — textarea 제거, editor 사용**

`src/components/operations/mail-template/template-edit-form.tsx` 수정:

기존 `textarea` 자리 (Body 영역) 를 다음으로 교체:

```tsx
        <Label className="text-sm">본문</Label>
        <MailTemplateEditor
          initialHtml={template?.bodyHtml ?? ''}
          catalog={catalog}
          onChange={setBodyHtml}
        />
```

`<Textarea>` import 제거. 새 import 추가:
```tsx
import { MailTemplateEditor } from './mail-template-editor';
import type { VariableDef } from './variable-catalog';
```

Props 인터페이스에 `catalog` 추가:
```tsx
interface Props {
  surveyId: string;
  fromDomain: string;
  catalog: VariableDef[];
  template?: MailTemplate;
}
```

함수 시그니처도 갱신:
```tsx
export function TemplateEditForm({ surveyId, fromDomain, catalog, template }: Props) {
```

- [ ] **Step 2: new/page.tsx — catalog fetch + prop 전달**

```tsx
import { TemplateEditForm } from '@/components/operations/mail-template/template-edit-form';
import { getVariableCatalog } from '@/components/operations/mail-template/variable-catalog';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function NewMailTemplatePage({ params }: Props) {
  const { id: surveyId } = await params;
  const fromDomain = process.env.RESEND_FROM_DOMAIN ?? '';
  const catalog = await getVariableCatalog(surveyId);

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="mb-6 text-xl font-semibold">새 메일 템플릿</h1>
      <TemplateEditForm surveyId={surveyId} fromDomain={fromDomain} catalog={catalog} />
    </main>
  );
}
```

- [ ] **Step 3: [mid]/edit/page.tsx — 동일 패턴**

```tsx
import { notFound } from 'next/navigation';

import { TemplateEditForm } from '@/components/operations/mail-template/template-edit-form';
import { getVariableCatalog } from '@/components/operations/mail-template/variable-catalog';
import { getMailTemplate } from '@/data/mail-templates';

interface Props {
  params: Promise<{ id: string; mid: string }>;
}

export default async function EditMailTemplatePage({ params }: Props) {
  const { id: surveyId, mid: templateId } = await params;
  const template = await getMailTemplate(surveyId, templateId);
  if (!template) notFound();

  const fromDomain = process.env.RESEND_FROM_DOMAIN ?? '';
  const catalog = await getVariableCatalog(surveyId);

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="mb-6 text-xl font-semibold">메일 템플릿 편집</h1>
      <TemplateEditForm surveyId={surveyId} fromDomain={fromDomain} catalog={catalog} template={template} />
    </main>
  );
}
```

- [ ] **Step 4: 빌드**

Run: `pnpm exec tsc --noEmit`

Expected: 에러 0개.

- [ ] **Step 5: Manual smoke**

dev:
1. 새 템플릿 → 본문 영역에 TipTap 에디터 + 툴바 보임
2. 본문에 `안녕하세요, ` 입력 후 툴바 [변수] 클릭 → popover 검색 → "수행기관" 선택 → `{{수행기관}}` 자동 삽입 + amber 하이라이트
3. 표 추가 → 행/열/병합/분할 동작
4. B/I/U + 폰트사이즈 적용
5. 저장 → 목록 → 다시 편집 → 본문 + 토큰 모두 복원 + 하이라이트 유지

- [ ] **Step 6: Commit**

```bash
git add src/components/operations/mail-template/template-edit-form.tsx \
        src/app/admin/surveys/\[id\]/operations/mail-templates/new/page.tsx \
        src/app/admin/surveys/\[id\]/operations/mail-templates/\[mid\]/edit/page.tsx
git commit -m "feat: 편집 페이지 textarea → MailTemplateEditor 교체"
```

---

## Phase B 완료 게이트

- [ ] Manual smoke: 변수 토큰 삽입 + 하이라이트 + 표 편집 + 서식 모두 동작
- [ ] 저장 후 다시 편집 시 본문 + 토큰 복원
- [ ] `pnpm test` 모든 테스트 통과
- [ ] `pnpm exec tsc --noEmit` 에러 0
- [ ] Phase B PR 생성 (선택)

---

# Phase C — R2 업로드

## Task C.1: 패키지 설치

- [ ] **Step 1: presigner 추가**

Run:
```bash
pnpm add @aws-sdk/s3-request-presigner
```

(`@aws-sdk/client-s3` 는 이미 설치됨)

- [ ] **Step 2: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: aws-sdk s3-request-presigner 추가"
```

---

## Task C.2: R2 key 빌더 + 검증 — TDD

**Files:**
- Create: `tests/unit/mail-template/r2-key.test.ts`
- Create: `src/lib/mail/r2-key.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/unit/mail-template/r2-key.test.ts
import { describe, expect, it } from 'vitest';

import { buildR2Key, sanitizeFilename } from '@/lib/mail/r2-key';

describe('sanitizeFilename', () => {
  it('정상 파일명 그대로', () => {
    expect(sanitizeFilename('report.pdf')).toBe('report.pdf');
  });
  it('한글 + 공백 그대로 (encodeURIComponent 처리는 R2 가)', () => {
    expect(sanitizeFilename('협조 공문.pdf')).toBe('협조 공문.pdf');
  });
  it('윈도우 reserved 문자 제거', () => {
    expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j.pdf')).toBe('abcdefghij.pdf');
  });
  it('빈 문자열은 fallback', () => {
    expect(sanitizeFilename('')).toBe('file');
  });
});

describe('buildR2Key', () => {
  const SURVEY_ID = '550e8400-e29b-41d4-a716-446655440000';

  it('image kind', () => {
    const key = buildR2Key({ surveyId: SURVEY_ID, kind: 'image', filename: 'photo.png' });
    expect(key).toMatch(new RegExp(`^mail/${SURVEY_ID}/image/[a-zA-Z0-9_-]+-photo\\.png$`));
  });

  it('attachment kind', () => {
    const key = buildR2Key({ surveyId: SURVEY_ID, kind: 'attachment', filename: '협조공문.pdf' });
    expect(key.startsWith(`mail/${SURVEY_ID}/attachment/`)).toBe(true);
    expect(key.endsWith('-협조공문.pdf')).toBe(true);
  });

  it('서로 다른 호출은 서로 다른 key', () => {
    const k1 = buildR2Key({ surveyId: SURVEY_ID, kind: 'image', filename: 'x.png' });
    const k2 = buildR2Key({ surveyId: SURVEY_ID, kind: 'image', filename: 'x.png' });
    expect(k1).not.toBe(k2);
  });
});
```

- [ ] **Step 2: 테스트 실행 — FAIL 확인**

Run: `pnpm test tests/unit/mail-template/r2-key.test.ts`

Expected: 모듈 못 찾음.

- [ ] **Step 3: 구현**

`src/lib/mail/r2-key.ts`:

```ts
import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-', 16);

const RESERVED_RE = /[\\/:*?"<>|]/g;

export function sanitizeFilename(name: string): string {
  const cleaned = name.replace(RESERVED_RE, '').trim();
  return cleaned.length > 0 ? cleaned : 'file';
}

export interface BuildR2KeyInput {
  surveyId: string;
  kind: 'image' | 'attachment';
  filename: string;
}

export function buildR2Key({ surveyId, kind, filename }: BuildR2KeyInput): string {
  return `mail/${surveyId}/${kind}/${nanoid()}-${sanitizeFilename(filename)}`;
}
```

> 만약 `nanoid` 가 dep 에 없으면 추가: `pnpm add nanoid`

- [ ] **Step 4: 테스트 — PASS 확인**

Run: `pnpm test tests/unit/mail-template/r2-key.test.ts`

Expected: 모든 테스트 통과.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/mail-template/r2-key.test.ts src/lib/mail/r2-key.ts package.json pnpm-lock.yaml
git commit -m "feat: R2 key 빌더 헬퍼 추가"
```

---

## Task C.3: Presign API 라우트

**Files:**
- Create: `src/app/api/upload/presign/route.ts`

- [ ] **Step 1: 라우트 작성**

```ts
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { buildR2Key } from '@/lib/mail/r2-key';
import { requireAuth } from '@/lib/auth';

const requestSchema = z.object({
  surveyId: z.string().uuid(),
  kind: z.enum(['image', 'attachment']),
  filename: z.string().min(1).max(200),
  mime: z.string().min(1).max(200),
  size: z.number().int().positive(),
});

const IMAGE_MIMES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif',
  'image/webp', 'image/svg+xml', 'image/bmp',
]);
const IMAGE_MAX = 10 * 1024 * 1024;       // 10MB
const ATTACHMENT_MAX = 15 * 1024 * 1024;  // 15MB
const ATTACHMENT_BLACKLIST = new Set([
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-sh',
  'application/x-bat',
  'application/x-executable',
]);

export async function POST(req: NextRequest) {
  try {
    await requireAuth();
  } catch {
    return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  }

  let body: z.infer<typeof requestSchema>;
  try {
    body = requestSchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }

  const { surveyId, kind, filename, mime, size } = body;

  if (kind === 'image') {
    if (!IMAGE_MIMES.has(mime)) {
      return NextResponse.json({ error: '지원하지 않는 이미지 형식' }, { status: 400 });
    }
    if (size > IMAGE_MAX) {
      return NextResponse.json({ error: '이미지는 10MB 이하' }, { status: 400 });
    }
  } else {
    if (ATTACHMENT_BLACKLIST.has(mime)) {
      return NextResponse.json({ error: '실행파일은 첨부할 수 없습니다' }, { status: 400 });
    }
    if (size > ATTACHMENT_MAX) {
      return NextResponse.json({ error: '첨부는 15MB 이하' }, { status: 400 });
    }
  }

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const accessKey = process.env.CLOUDFLARE_R2_ACCESS_KEY;
  const secretKey = process.env.CLOUDFLARE_R2_SECRET_KEY;
  const bucket = process.env.CLOUDFLARE_R2_BUCKET;
  const publicUrl = process.env.CLOUDFLARE_R2_PUBLIC_URL;

  if (!accountId || !accessKey || !secretKey || !bucket || !publicUrl) {
    return NextResponse.json({ error: 'R2 설정 누락' }, { status: 500 });
  }

  const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  });

  const key = buildR2Key({ surveyId, kind, filename });

  const uploadUrl = await getSignedUrl(
    r2,
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: mime,
      ContentLength: size,
    }),
    { expiresIn: 300 },  // 5분
  );

  return NextResponse.json({
    uploadUrl,
    key,
    publicUrl: `${publicUrl}/${key}`,
  });
}
```

- [ ] **Step 2: 컴파일**

Run: `pnpm exec tsc --noEmit`

Expected: 에러 0개.

- [ ] **Step 3: Manual smoke (curl)**

```bash
# 로그인 쿠키 + 운영 콘솔 접속한 상태에서 브라우저 개발자도구 console:
fetch('/api/upload/presign', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    surveyId: '<설문ID>', kind: 'image',
    filename: 'test.png', mime: 'image/png', size: 1024
  })
}).then(r => r.json()).then(console.log)
```

Expected: `{ uploadUrl: 'https://...r2.cloudflarestorage.com/...?X-Amz-...', key: 'mail/...', publicUrl: '...' }`. uploadUrl 도메인이 R2 의 cloudflarestorage.com 인지 확인.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/upload/presign/route.ts
git commit -m "feat: R2 presigned URL 발급 API 추가"
```

---

## Task C.4: 클라이언트 업로더 훅

**Files:**
- Create: `src/components/operations/mail-template/use-r2-upload.ts`

- [ ] **Step 1: 훅 구현**

```ts
'use client';

import { useCallback, useRef, useState } from 'react';

interface UploadResult {
  key: string;
  publicUrl: string;
  filename: string;
  size: number;
  mime: string;
}

interface PresignResponse {
  uploadUrl: string;
  key: string;
  publicUrl: string;
}

export interface UseR2UploadResult {
  upload: (file: File, kind: 'image' | 'attachment') => Promise<UploadResult>;
  cancel: () => void;
  progress: number;
  uploading: boolean;
  error: string | null;
  reset: () => void;
}

export function useR2Upload(surveyId: string): UseR2UploadResult {
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const upload = useCallback(
    async (file: File, kind: 'image' | 'attachment'): Promise<UploadResult> => {
      setUploading(true);
      setError(null);
      setProgress(0);

      try {
        // 1. presign
        const presignRes = await fetch('/api/upload/presign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            surveyId,
            kind,
            filename: file.name,
            mime: file.type || 'application/octet-stream',
            size: file.size,
          }),
        });
        if (!presignRes.ok) {
          const body = await presignRes.json().catch(() => ({}));
          throw new Error(body.error ?? `presign 실패 (${presignRes.status})`);
        }
        const presign: PresignResponse = await presignRes.json();

        // 2. PUT to R2 (XHR for progress)
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhrRef.current = xhr;
          xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) setProgress((e.loaded / e.total) * 100);
          });
          xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else reject(new Error(`업로드 실패 (HTTP ${xhr.status})`));
          });
          xhr.addEventListener('error', () => reject(new Error('네트워크 오류')));
          xhr.addEventListener('abort', () => reject(new Error('업로드 취소')));
          xhr.open('PUT', presign.uploadUrl);
          xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
          xhr.send(file);
        });

        return {
          key: presign.key,
          publicUrl: presign.publicUrl,
          filename: file.name,
          size: file.size,
          mime: file.type || 'application/octet-stream',
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : '업로드 오류';
        setError(msg);
        throw e;
      } finally {
        setUploading(false);
        xhrRef.current = null;
      }
    },
    [surveyId],
  );

  const cancel = useCallback(() => {
    xhrRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    setProgress(0);
    setError(null);
  }, []);

  return { upload, cancel, progress, uploading, error, reset };
}
```

- [ ] **Step 2: 컴파일**

Run: `pnpm exec tsc --noEmit`

Expected: 에러 0개.

- [ ] **Step 3: Commit**

```bash
git add src/components/operations/mail-template/use-r2-upload.ts
git commit -m "feat: useR2Upload 클라이언트 훅 추가"
```

---

## Task C.5: 첨부 업로더 컴포넌트

**Files:**
- Create: `src/components/operations/mail-template/attachment-uploader.tsx`

- [ ] **Step 1: 컴포넌트**

```tsx
'use client';

import { useRef } from 'react';

import { Loader2, Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { MailAttachment } from '@/db/schema/schema-types';

import { useR2Upload } from './use-r2-upload';

const MAX_BYTES = 15 * 1024 * 1024;

interface Props {
  surveyId: string;
  attachments: MailAttachment[];
  onChange: (next: MailAttachment[]) => void;
}

function prettySize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function AttachmentUploader({ surveyId, attachments, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { upload, uploading, progress, error, reset } = useR2Upload(surveyId);

  const onFile = async (file: File) => {
    if (file.size > MAX_BYTES) {
      alert('파일 크기는 15MB 이하여야 합니다');
      return;
    }
    try {
      const r = await upload(file, 'attachment');
      onChange([
        ...attachments,
        { key: r.key, filename: r.filename, size: r.size, mime: r.mime },
      ]);
      reset();
    } catch {
      // useR2Upload 가 error 상태에 메시지 셋. 별도 처리 불필요.
    }
  };

  const onRemove = (key: string) => {
    onChange(attachments.filter((a) => a.key !== key));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {attachments.map((a) => (
          <div
            key={a.key}
            className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs"
          >
            <span className="text-gray-500">📎</span>
            <span className="font-medium">{a.filename}</span>
            <span className="text-gray-500">({prettySize(a.size)})</span>
            <button
              type="button"
              onClick={() => onRemove(a.key)}
              className="text-gray-400 hover:text-red-600"
              aria-label="첨부 제거"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}

        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = '';
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <>
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              {Math.round(progress)}%
            </>
          ) : (
            <>
              <Plus className="mr-1 h-3.5 w-3.5" />
              파일 추가
            </>
          )}
        </Button>
      </div>

      {error && <div className="text-xs text-red-600">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 2: meta-fields.tsx 에 통합 — 마지막 Field 자리에 attachments 추가**

`src/components/operations/mail-template/meta-fields.tsx` 의 props 인터페이스 + 컴포넌트 수정:

```tsx
import type { MailAttachment } from '@/db/schema/schema-types';

import { AttachmentUploader } from './attachment-uploader';

export interface MetaFieldValues {
  name: string;
  subject: string;
  fromLocal: string;
  fromName: string;
  replyTo: string;
}

interface Props {
  surveyId: string;
  values: MetaFieldValues;
  onChange: (next: MetaFieldValues) => void;
  attachments: MailAttachment[];
  onAttachmentsChange: (next: MailAttachment[]) => void;
  fromDomain: string;
}
```

함수 시그니처 + 마지막에 첨부 Field 추가:

```tsx
export function MetaFields({
  surveyId, values, onChange, attachments, onAttachmentsChange, fromDomain,
}: Props) {
  // ... 기존 set 함수 ...
  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      {/* 기존 필드들 ... */}

      <Field label="첨부">
        <AttachmentUploader
          surveyId={surveyId}
          attachments={attachments}
          onChange={onAttachmentsChange}
        />
      </Field>
    </div>
  );
}
```

- [ ] **Step 3: template-edit-form.tsx 에 첨부 state 연결**

```tsx
const [attachments, setAttachments] = useState<MailAttachment[]>(template?.attachments ?? []);

// MetaFields 렌더 시 props 추가:
<MetaFields
  surveyId={surveyId}
  values={meta}
  onChange={setMeta}
  attachments={attachments}
  onAttachmentsChange={setAttachments}
  fromDomain={fromDomain}
/>

// onSave input 에 attachments 사용:
const input = { ...meta, bodyHtml, attachments };
```

import 추가:
```tsx
import type { MailAttachment } from '@/db/schema/schema-types';
```

- [ ] **Step 4: 빌드**

Run: `pnpm exec tsc --noEmit`

Expected: 에러 0개.

- [ ] **Step 5: Manual smoke**

dev:
1. 새 템플릿 → 메타 영역 "첨부" 옆 [파일 추가] → 5MB 정도 PDF 선택 → 진행률 표시 → 완료 시 칩으로 표시
2. ✕ 클릭 → 칩 사라짐
3. 다시 추가 + 저장 → 편집 페이지 들어가서 attachments 복원 확인
4. 16MB 파일 시도 → "15MB 이하" 알림
5. R2 dashboard 에서 `mail/<surveyId>/attachment/...` 객체 생성 확인

- [ ] **Step 6: Commit**

```bash
git add src/components/operations/mail-template/attachment-uploader.tsx \
        src/components/operations/mail-template/meta-fields.tsx \
        src/components/operations/mail-template/template-edit-form.tsx
git commit -m "feat: 메일 첨부파일 R2 업로더 통합"
```

---

## Task C.6: 이미지 업로드 통합 (TipTap 툴바)

**Files:**
- Modify: `src/components/operations/mail-template/mail-template-editor.tsx`

- [ ] **Step 1: 에디터에 surveyId prop + 이미지 업로드 통합**

`mail-template-editor.tsx` 수정:

```tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { EditorContent, useEditor } from '@tiptap/react';
import { Loader2 } from 'lucide-react';

import { createMailEditorExtensions } from './editor-extensions';
import { EditorToolbar } from './editor-toolbar';
import { useR2Upload } from './use-r2-upload';
import type { VariableDef } from './variable-catalog';

interface Props {
  surveyId: string;            // 신규
  initialHtml: string;
  catalog: VariableDef[];
  onChange: (html: string) => void;
}

export function MailTemplateEditor({ surveyId, initialHtml, catalog, onChange }: Props) {
  const extensions = useMemo(() => createMailEditorExtensions(), []);
  const [, force] = useState({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { upload, uploading, progress, error: uploadError, reset } = useR2Upload(surveyId);

  const editor = useEditor({
    extensions,
    content: initialHtml,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          'prose prose-sm max-w-none focus:outline-none min-h-[320px] p-6 ' +
          '[&_table]:border-collapse [&_table]:w-full [&_table]:my-2 [&_table]:border [&_table]:border-gray-300 ' +
          '[&_table_td]:border [&_table_td]:border-gray-300 [&_table_td]:px-2 [&_table_td]:py-1 ' +
          '[&_table_th]:border [&_table_th]:border-gray-300 [&_table_th]:px-2 [&_table_th]:py-1 ' +
          '[&_table_th]:bg-gray-50',
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.isEmpty ? '' : editor.getHTML());
    },
    onSelectionUpdate: () => {
      force({});
    },
  });

  useEffect(() => {
    if (editor && initialHtml !== editor.getHTML()) {
      editor.commands.setContent(initialHtml, { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHtml]);

  if (!editor) return null;

  const onPickImage = () => fileInputRef.current?.click();

  const onImageFile = async (file: File) => {
    try {
      const r = await upload(file, 'image');
      editor.chain().focus().setImage({ src: r.publicUrl }).run();
      reset();
    } catch {
      // useR2Upload 가 error 상태 셋
    }
  };

  const onPickLink = () => {
    const url = window.prompt('링크 URL');
    if (url) editor.chain().focus().setLink({ href: url }).run();
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <EditorToolbar editor={editor} catalog={catalog} onPickImage={onPickImage} onPickLink={onPickLink} />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml,image/bmp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImageFile(f);
          e.target.value = '';
        }}
      />
      {uploading && (
        <div className="flex items-center gap-2 border-t border-gray-200 bg-blue-50 px-4 py-2 text-xs text-blue-700">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          이미지 업로드 중 {Math.round(progress)}%
        </div>
      )}
      {uploadError && (
        <div className="border-t border-gray-200 bg-red-50 px-4 py-2 text-xs text-red-700">
          {uploadError}
        </div>
      )}
      <EditorContent editor={editor} className="border-t border-gray-200" />
    </div>
  );
}
```

- [ ] **Step 2: template-edit-form.tsx 에서 surveyId 전달**

```tsx
<MailTemplateEditor
  surveyId={surveyId}
  initialHtml={template?.bodyHtml ?? ''}
  catalog={catalog}
  onChange={setBodyHtml}
/>
```

- [ ] **Step 3: 빌드**

Run: `pnpm exec tsc --noEmit`

Expected: 에러 0개.

- [ ] **Step 4: Manual smoke**

1. 편집 페이지 → 툴바 [🖼] 클릭 → 파일 선택 → 진행률 표시 → 본문에 이미지 인라인 삽입 확인
2. 본문에 이미지 src 가 R2 public URL 인지 (브라우저 개발자도구 element 확인)
3. 저장 → 다시 편집 시 이미지 정상 로드
4. 11MB 이미지 시도 → "10MB 이하" 에러

- [ ] **Step 5: Commit**

```bash
git add src/components/operations/mail-template/mail-template-editor.tsx \
        src/components/operations/mail-template/template-edit-form.tsx
git commit -m "feat: 본문 이미지 R2 업로드 통합"
```

---

## Phase C 완료 게이트

- [ ] 이미지 인라인 업로드 + 본문 표시 + 저장/복원
- [ ] 첨부 업로드/삭제/저장/복원
- [ ] 크기 제한 + mime 거부 동작
- [ ] R2 dashboard 에 객체 생성 확인
- [ ] `pnpm test` 통과 / `pnpm exec tsc --noEmit` 0
- [ ] Phase C PR 생성 (선택)

---

# Phase D — 발송

## Task D.1: 패키지 설치 + .env.example 갱신

**Files:**
- Modify: `package.json`, `.env.example` (있으면)

- [ ] **Step 1: 설치**

```bash
pnpm add resend @react-email/components @react-email/render
```

- [ ] **Step 2: .env.example 갱신** (파일 있으면)

```bash
ls .env.example 2>/dev/null && echo "found" || echo "missing"
```

있으면 끝에 추가:
```
# 메일 발송 — 슬라이스 5
RESEND_FROM_DOMAIN=send.megaresearch.co.kr
```

(없으면 생략 — `.env` / `.env.local` 에는 이미 추가됨)

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml .env.example
git commit -m "chore: resend react-email 패키지 추가"
```

---

## Task D.2: 변수 치환 헬퍼 — TDD

**Files:**
- Create: `tests/unit/mail-template/render-template.test.ts`
- Create: `src/lib/mail/render-template.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/unit/mail-template/render-template.test.ts
import { describe, expect, it } from 'vitest';

import { interpolateVariables } from '@/lib/mail/render-template';

describe('interpolateVariables', () => {
  const ctx = {
    attrs: { 수행기관: 'KOTRA', 참가기업명: '㈜한국기업' },
    inviteLink: 'https://example.kr/survey/abc?invite=xyz',
  };

  it('attrs 치환', () => {
    expect(interpolateVariables('{{수행기관}} 안내', ctx)).toBe('KOTRA 안내');
  });

  it('invite_link 치환', () => {
    expect(interpolateVariables('링크: {{invite_link}}', ctx))
      .toBe('링크: https://example.kr/survey/abc?invite=xyz');
  });

  it('다중 토큰', () => {
    expect(interpolateVariables('{{수행기관}} - {{참가기업명}}', ctx))
      .toBe('KOTRA - ㈜한국기업');
  });

  it('미정의 토큰은 빈 문자열', () => {
    expect(interpolateVariables('{{없는키}} 안내', ctx)).toBe(' 안내');
  });

  it('공백 트림', () => {
    expect(interpolateVariables('{{ 수행기관 }}', ctx)).toBe('KOTRA');
  });

  it('토큰 없는 텍스트는 그대로', () => {
    expect(interpolateVariables('plain', ctx)).toBe('plain');
  });
});
```

- [ ] **Step 2: 테스트 실행 — FAIL**

Run: `pnpm test tests/unit/mail-template/render-template.test.ts`

Expected: 모듈 못 찾음.

- [ ] **Step 3: 구현**

`src/lib/mail/render-template.ts`:

```ts
import 'server-only';

import { headers } from 'next/headers';

import type { ContactTarget } from '@/db/schema/contacts';
import type { MailTemplate } from '@/db/schema/mail';

export interface InterpolationContext {
  attrs: Record<string, string>;
  inviteLink: string;
}

/**
 * Pure function — {{var}} 치환. 미정의 키는 빈 문자열.
 * invite_link 은 ctx.inviteLink, 나머지는 ctx.attrs.
 */
export function interpolateVariables(text: string, ctx: InterpolationContext): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (_m, raw) => {
    const key = raw.trim();
    if (key === 'invite_link') return ctx.inviteLink;
    return ctx.attrs?.[key] ?? '';
  });
}

/**
 * 템플릿 + 컨택 → 치환된 (subject, bodyHtml, fromName) 반환.
 * `headers()` 로 현재 host 추출하여 invite_link 빌드.
 */
export async function renderTemplateForContact(
  template: Pick<MailTemplate, 'subject' | 'bodyHtml' | 'fromName'>,
  contact: Pick<ContactTarget, 'attrs' | 'inviteToken'>,
  surveyId: string,
): Promise<{ subject: string; bodyHtml: string; fromName: string }> {
  const h = await headers();
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
  const inviteLink = `${proto}://${host}/survey/${surveyId}?invite=${contact.inviteToken}`;

  const ctx: InterpolationContext = {
    attrs: contact.attrs ?? {},
    inviteLink,
  };

  return {
    subject: interpolateVariables(template.subject, ctx),
    bodyHtml: interpolateVariables(template.bodyHtml, ctx),
    fromName: interpolateVariables(template.fromName, ctx),
  };
}
```

- [ ] **Step 4: 테스트 — PASS**

Run: `pnpm test tests/unit/mail-template/render-template.test.ts`

Expected: 모든 테스트 통과.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/mail-template/render-template.test.ts src/lib/mail/render-template.ts
git commit -m "feat: 메일 변수 치환 헬퍼 추가"
```

---

## Task D.3: Resend 클라이언트 + react-email shell

**Files:**
- Create: `src/lib/mail/resend-client.ts`
- Create: `src/components/operations/mail-template/email-shell.tsx`

- [ ] **Step 1: Resend 클라이언트 (lazy)**

```ts
// src/lib/mail/resend-client.ts
import 'server-only';

import { Resend } from 'resend';

let _client: Resend | null = null;

export function getResendClient(): Resend {
  if (_client) return _client;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY 가 설정되지 않았습니다');
  _client = new Resend(key);
  return _client;
}
```

- [ ] **Step 2: react-email shell**

`src/components/operations/mail-template/email-shell.tsx`:

```tsx
import {
  Body, Container, Head, Hr, Html, Link, Section, Text,
} from '@react-email/components';

import type { MailAttachment } from '@/db/schema/schema-types';

interface Props {
  subject: string;
  bodyHtml: string;
  attachments: MailAttachment[];
  r2PublicUrl: string;
}

function prettySize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function EmailShell({ subject, bodyHtml, attachments, r2PublicUrl }: Props) {
  return (
    <Html lang="ko">
      <Head>
        <title>{subject}</title>
      </Head>
      <Body
        style={{
          backgroundColor: '#f5f5f7',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", "WantedSans Variable", sans-serif',
          margin: 0,
          padding: '24px 0',
        }}
      >
        <Container
          style={{
            maxWidth: '720px',
            margin: '0 auto',
            backgroundColor: '#ffffff',
            borderRadius: '8px',
          }}
        >
          <Section
            style={{ padding: '32px 32px 16px', lineHeight: 1.6, color: '#1c1c1e' }}
            dangerouslySetInnerHTML={{ __html: bodyHtml }}
          />
          {attachments.length > 0 && (
            <>
              <Hr style={{ borderColor: '#e5e5ea', margin: '0 32px' }} />
              <Section style={{ padding: '16px 32px' }}>
                <Text style={{ fontSize: '12px', color: '#6e6e73', margin: '0 0 8px' }}>
                  첨부파일
                </Text>
                {attachments.map((a) => (
                  <Link
                    key={a.key}
                    href={`${r2PublicUrl}/${a.key}`}
                    style={{
                      display: 'block',
                      padding: '8px 12px',
                      border: '1px solid #e5e5ea',
                      borderRadius: '6px',
                      marginBottom: '4px',
                      color: '#007aff',
                      fontSize: '13px',
                      textDecoration: 'none',
                    }}
                  >
                    📎 {a.filename} ({prettySize(a.size)}) — 다운로드
                  </Link>
                ))}
              </Section>
            </>
          )}
        </Container>
      </Body>
    </Html>
  );
}
```

- [ ] **Step 3: 빌드**

Run: `pnpm exec tsc --noEmit`

Expected: 에러 0개.

- [ ] **Step 4: Commit**

```bash
git add src/lib/mail/resend-client.ts src/components/operations/mail-template/email-shell.tsx
git commit -m "feat: Resend 클라이언트 react-email shell 추가"
```

---

## Task D.4: sendTestMailAction

**Files:**
- Modify: `src/actions/mail-template-actions.ts`
- Create: `src/data/contact-targets.ts` (없으면)

- [ ] **Step 1: 컨택 단건 fetch 헬퍼 — 없으면 생성**

확인: `grep -rn "getContactTarget" /Users/ljwoon/study/next-study/survey-table-project/src/ --include="*.ts" 2>/dev/null | head -3`

기존 헬퍼 있으면 그대로. 없으면 `src/data/contact-targets.ts`:

```ts
import 'server-only';

import { and, eq } from 'drizzle-orm';
import { cache } from 'react';

import { db } from '@/db';
import { contactTargets, type ContactTarget } from '@/db/schema/contacts';

export const getContactTarget = cache(
  async (surveyId: string, contactId: string): Promise<ContactTarget | null> => {
    const rows = await db
      .select()
      .from(contactTargets)
      .where(and(eq(contactTargets.id, contactId), eq(contactTargets.surveyId, surveyId)))
      .limit(1);
    return rows[0] ?? null;
  },
);
```

- [ ] **Step 2: action 추가**

`src/actions/mail-template-actions.ts` 끝에 추가 (test export 위에):

```ts
import { render } from '@react-email/render';

import { EmailShell } from '@/components/operations/mail-template/email-shell';
import { getContactTarget } from '@/data/contact-targets';
import { getMailTemplate } from '@/data/mail-templates';
import { renderTemplateForContact } from '@/lib/mail/render-template';
import { getResendClient } from '@/lib/mail/resend-client';

interface SendTestMailInput {
  surveyId: string;
  templateId: string;
  contactId: string;
  overrideEmail?: string;
}

export async function sendTestMailAction(
  input: SendTestMailInput,
): Promise<ActionResult<{ messageId: string }>> {
  await requireAuth();

  const template = await getMailTemplate(input.surveyId, input.templateId);
  if (!template) return { ok: false, error: '템플릿을 찾을 수 없습니다' };
  if (!template.fromLocal) return { ok: false, error: '보낸이 계정이 비어있습니다' };
  if (!template.fromName) return { ok: false, error: '보낸이 표시명이 비어있습니다' };
  if (!template.replyTo) return { ok: false, error: '답장 받을 메일이 비어있습니다' };

  const contact = await getContactTarget(input.surveyId, input.contactId);
  if (!contact) return { ok: false, error: '컨택을 찾을 수 없습니다' };

  const to = input.overrideEmail ?? contact.email;
  if (!to) return { ok: false, error: '받는 메일 주소가 없습니다' };

  const fromDomain = process.env.RESEND_FROM_DOMAIN;
  const r2Public = process.env.CLOUDFLARE_R2_PUBLIC_URL;
  if (!fromDomain || !r2Public) {
    return { ok: false, error: '서버 환경 변수가 설정되지 않았습니다' };
  }

  const rendered = await renderTemplateForContact(template, contact, input.surveyId);

  const html = await render(
    EmailShell({
      subject: rendered.subject,
      bodyHtml: rendered.bodyHtml,
      attachments: template.attachments,
      r2PublicUrl: r2Public,
    }),
  );

  const fromAddr = `${rendered.fromName} <${template.fromLocal}@${fromDomain}>`;

  const result = await getResendClient().emails.send({
    from: fromAddr,
    replyTo: template.replyTo,
    to,
    subject: rendered.subject,
    html,
  });

  if (result.error) {
    return { ok: false, error: `Resend 오류: ${result.error.message}` };
  }
  return { ok: true, data: { messageId: result.data?.id ?? '' } };
}
```

- [ ] **Step 3: 빌드**

Run: `pnpm exec tsc --noEmit`

Expected: 에러 0개. (react-email 의 `render` 가 async — `await` 확인. v6 API.)

- [ ] **Step 4: Commit**

```bash
git add src/actions/mail-template-actions.ts src/data/contact-targets.ts
git commit -m "feat: sendTestMailAction 추가"
```

---

## Task D.5: 컨택 picker 컴포넌트

**Files:**
- Create: `src/components/operations/mail-template/contact-picker.tsx`

- [ ] **Step 1: cmdk Combobox**

```tsx
'use client';

import { useState } from 'react';

import { Check, ChevronsUpDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface ContactPickerOption {
  id: string;
  email: string | null;
  groupValue: string | null;
  label: string;       // 표시 텍스트 (예: "홍길동 (KOTRA)")
  responded: boolean;  // responded_at != null
}

interface Props {
  options: ContactPickerOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  filterUnrespondedOnly: boolean;
  onToggleFilter: (next: boolean) => void;
}

export function ContactPicker({
  options, value, onChange, filterUnrespondedOnly, onToggleFilter,
}: Props) {
  const [open, setOpen] = useState(false);

  const filtered = filterUnrespondedOnly ? options.filter((o) => !o.responded) : options;
  const selected = options.find((o) => o.id === value) ?? null;

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" role="combobox" className="w-full justify-between">
            {selected ? selected.label : '컨택 선택...'}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="이름·이메일 검색..." />
            <CommandList className="max-h-[280px]">
              <CommandEmpty>일치하는 컨택이 없습니다.</CommandEmpty>
              <CommandGroup>
                {filtered.map((o) => (
                  <CommandItem
                    key={o.id}
                    value={`${o.label} ${o.email ?? ''}`}
                    onSelect={() => {
                      onChange(o.id);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn('mr-2 h-4 w-4', value === o.id ? 'opacity-100' : 'opacity-0')} />
                    <div className="flex-1">
                      <div className="text-sm">{o.label}</div>
                      <div className="text-xs text-gray-500">{o.email ?? '이메일 없음'}</div>
                    </div>
                    {o.responded && <span className="ml-2 text-xs text-emerald-600">응답</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <label className="flex items-center gap-1.5 text-xs text-gray-500">
        <input
          type="checkbox"
          checked={filterUnrespondedOnly}
          onChange={(e) => onToggleFilter(e.target.checked)}
        />
        응답 안 한 컨택만 보기
      </label>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/operations/mail-template/contact-picker.tsx
git commit -m "feat: 메일 컨택 picker 컴포넌트 추가"
```

---

## Task D.6: 미리보기 다이얼로그

**Files:**
- Create: `src/components/operations/mail-template/mail-preview-dialog.tsx`

- [ ] **Step 1: 다이얼로그**

```tsx
'use client';

import type { MailAttachment } from '@/db/schema/schema-types';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

import { ContactPicker, type ContactPickerOption } from './contact-picker';
import { useState } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  surveyId: string;
  contacts: ContactPickerOption[];
  fromDomain: string;
  template: {
    subject: string;
    bodyHtml: string;
    fromLocal: string;
    fromName: string;
    replyTo: string | null;
    attachments: MailAttachment[];
  };
  r2PublicUrl: string;
  /** 컨택 선택 시 클라이언트에서 attrs 미리채움. 발송 시점이 아닌 미리보기용 */
  contactAttrsLookup: (contactId: string) => Record<string, string>;
  contactInviteTokenLookup: (contactId: string) => string | null;
}

function prettySize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function interpolateClient(text: string, attrs: Record<string, string>, inviteLink: string) {
  return text.replace(/\{\{([^}]+)\}\}/g, (_m, raw) => {
    const k = raw.trim();
    if (k === 'invite_link') return inviteLink;
    return attrs[k] ?? '';
  });
}

export function MailPreviewDialog({
  open, onClose, surveyId, contacts, fromDomain, template, r2PublicUrl,
  contactAttrsLookup, contactInviteTokenLookup,
}: Props) {
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [filterUnresponded, setFilterUnresponded] = useState(false);

  const attrs = pickedId ? contactAttrsLookup(pickedId) : {};
  const inviteToken = pickedId ? contactInviteTokenLookup(pickedId) : null;
  const inviteLink = inviteToken
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/survey/${surveyId}?invite=${inviteToken}`
    : '';

  const subject = interpolateClient(template.subject, attrs, inviteLink);
  const bodyHtml = interpolateClient(template.bodyHtml, attrs, inviteLink);
  const fromName = interpolateClient(template.fromName, attrs, inviteLink);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="!max-w-[960px]">
        <DialogHeader>
          <DialogTitle>미리보기</DialogTitle>
        </DialogHeader>

        <div className="mb-3">
          <ContactPicker
            options={contacts}
            value={pickedId}
            onChange={setPickedId}
            filterUnrespondedOnly={filterUnresponded}
            onToggleFilter={setFilterUnresponded}
          />
        </div>

        <div className="rounded-lg bg-gray-100 p-6">
          <div className="mx-auto max-w-[720px] rounded-lg bg-white">
            <div className="border-b border-gray-200 px-6 py-3 text-xs text-gray-500">
              <div><strong className="text-gray-700">보낸이:</strong> {fromName} &lt;{template.fromLocal}@{fromDomain}&gt;</div>
              <div><strong className="text-gray-700">답장:</strong> {template.replyTo ?? '—'}</div>
              <div className="mt-1 text-sm text-gray-900"><strong className="text-gray-700">제목:</strong> {subject || '(제목 없음)'}</div>
            </div>
            <div className="prose prose-sm max-w-none p-6" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
            {template.attachments.length > 0 && (
              <div className="border-t border-gray-200 px-6 py-4">
                <div className="mb-2 text-xs text-gray-500">첨부파일</div>
                {template.attachments.map((a) => (
                  <a
                    key={a.key}
                    href={`${r2PublicUrl}/${a.key}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded border border-gray-200 px-3 py-2 text-xs text-blue-600 hover:bg-gray-50"
                  >
                    📎 {a.filename} ({prettySize(a.size)}) — 다운로드
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: 컴파일**

Run: `pnpm exec tsc --noEmit`

Expected: 에러 0개.

- [ ] **Step 3: Commit**

```bash
git add src/components/operations/mail-template/mail-preview-dialog.tsx
git commit -m "feat: 메일 미리보기 다이얼로그 추가"
```

---

## Task D.7: 테스트 발송 다이얼로그

**Files:**
- Create: `src/components/operations/mail-template/test-send-dialog.tsx`

- [ ] **Step 1: 다이얼로그**

```tsx
'use client';

import { useMemo, useState, useTransition } from 'react';

import { sendTestMailAction } from '@/actions/mail-template-actions';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { ContactPicker, type ContactPickerOption } from './contact-picker';

interface Props {
  open: boolean;
  onClose: () => void;
  surveyId: string;
  templateId: string;
  contacts: ContactPickerOption[];
  /** 본문/제목/표시명에 등장한 토큰 키들 (variables_used 캐시) */
  tokensInTemplate: string[];
  contactAttrsLookup: (contactId: string) => Record<string, string>;
  contactInviteTokenLookup: (contactId: string) => string | null;
}

export function TestSendDialog({
  open, onClose, surveyId, templateId, contacts,
  tokensInTemplate, contactAttrsLookup, contactInviteTokenLookup,
}: Props) {
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [filterUnresponded, setFilterUnresponded] = useState(false);
  const [overrideEmail, setOverrideEmail] = useState('');
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const picked = useMemo(() => contacts.find((c) => c.id === pickedId) ?? null, [contacts, pickedId]);

  // 받는 메일 default = 선택 컨택 이메일
  if (picked && overrideEmail === '' && picked.email) {
    setOverrideEmail(picked.email);
  }

  const attrs = pickedId ? contactAttrsLookup(pickedId) : {};
  const inviteToken = pickedId ? contactInviteTokenLookup(pickedId) : null;
  const inviteLink =
    inviteToken && typeof window !== 'undefined'
      ? `${window.location.origin}/survey/${surveyId}?invite=${inviteToken}`
      : '';

  const previewMap = tokensInTemplate.map((key) => ({
    key,
    value: key === 'invite_link' ? inviteLink : (attrs[key] ?? ''),
  }));

  const onSend = () => {
    if (!pickedId) {
      setResult({ ok: false, message: '컨택을 먼저 선택하세요' });
      return;
    }
    if (!overrideEmail) {
      setResult({ ok: false, message: '받는 메일 주소를 입력하세요' });
      return;
    }
    setResult(null);
    startTransition(async () => {
      const r = await sendTestMailAction({
        surveyId,
        templateId,
        contactId: pickedId,
        overrideEmail,
      });
      setResult(
        r.ok
          ? { ok: true, message: `발송 성공 (id: ${r.data?.messageId ?? '?'})` }
          : { ok: false, message: r.error ?? '발송 실패' },
      );
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="!max-w-[480px]">
        <DialogHeader>
          <DialogTitle>테스트 발송</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">컨택 선택 *</Label>
            <ContactPicker
              options={contacts}
              value={pickedId}
              onChange={(id) => {
                setPickedId(id);
                const c = contacts.find((o) => o.id === id);
                if (c?.email) setOverrideEmail(c.email);
              }}
              filterUnrespondedOnly={filterUnresponded}
              onToggleFilter={setFilterUnresponded}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">받는 메일 *</Label>
            <Input
              type="email"
              value={overrideEmail}
              onChange={(e) => setOverrideEmail(e.target.value)}
              placeholder="hong@example.com"
            />
            <p className="text-xs text-gray-500">컨택 이메일 default, 직접 덮어쓰기 가능</p>
          </div>

          {previewMap.length > 0 && (
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
              <div className="mb-1.5 text-xs font-medium text-gray-700">변수 치환 미리보기</div>
              <div className="space-y-1 text-xs">
                {previewMap.map(({ key, value }) => (
                  <div key={key} className="grid grid-cols-[140px_1fr] gap-2">
                    <span className="font-mono text-amber-700">{`{{${key}}}`}</span>
                    <span className="truncate text-gray-700">{value || <em className="text-red-500">(빈 값)</em>}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result && (
            <div className={`rounded p-2 text-xs ${result.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
              {result.message}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>닫기</Button>
          <Button type="button" onClick={onSend} disabled={pending}>
            {pending ? '발송 중...' : '발송 →'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: 컴파일**

Run: `pnpm exec tsc --noEmit`

Expected: 에러 0개.

- [ ] **Step 3: Commit**

```bash
git add src/components/operations/mail-template/test-send-dialog.tsx
git commit -m "feat: 테스트 발송 다이얼로그 추가"
```

---

## Task D.8: 편집 페이지에 미리보기 + 테스트발송 통합

**Files:**
- Modify: `src/components/operations/mail-template/template-edit-form.tsx`
- Modify: `src/app/admin/surveys/[id]/operations/mail-templates/[mid]/edit/page.tsx`
- Modify: `src/app/admin/surveys/[id]/operations/mail-templates/new/page.tsx`

- [ ] **Step 1: server-side contact list fetch — 신규 헬퍼**

`src/data/contact-targets.ts` 끝에 추가:

```ts
export const getContactTargetListForPicker = cache(
  async (surveyId: string) => {
    const rows = await db
      .select({
        id: contactTargets.id,
        email: contactTargets.email,
        groupValue: contactTargets.groupValue,
        attrs: contactTargets.attrs,
        inviteToken: contactTargets.inviteToken,
        respondedAt: contactTargets.respondedAt,
      })
      .from(contactTargets)
      .where(eq(contactTargets.surveyId, surveyId))
      .limit(2000);
    return rows;
  },
);
```

> 한 설문의 컨택 2000명 이상이면 picker 가 무거워지므로 limit 2000 (실태조사 규모상 충분). 향후 server-side 검색으로 교체.

- [ ] **Step 2: form 에 두 다이얼로그 + lookup 함수 통합**

`template-edit-form.tsx` 수정:

```tsx
'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  createMailTemplateAction,
  updateMailTemplateAction,
} from '@/actions/mail-template-actions';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { MailTemplate } from '@/db/schema/mail';
import type { MailAttachment } from '@/db/schema/schema-types';

import { MailPreviewDialog } from './mail-preview-dialog';
import { MailTemplateEditor } from './mail-template-editor';
import { MetaFields, type MetaFieldValues } from './meta-fields';
import { TestSendDialog } from './test-send-dialog';
import type { ContactPickerOption } from './contact-picker';
import type { VariableDef } from './variable-catalog';

interface ContactRow {
  id: string;
  email: string | null;
  groupValue: string | null;
  attrs: Record<string, string>;
  inviteToken: string;
  respondedAt: Date | null;
}

interface Props {
  surveyId: string;
  fromDomain: string;
  catalog: VariableDef[];
  contacts: ContactRow[];
  r2PublicUrl: string;
  template?: MailTemplate;
}

export function TemplateEditForm({
  surveyId, fromDomain, catalog, contacts, r2PublicUrl, template,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [meta, setMeta] = useState<MetaFieldValues>({
    name: template?.name ?? '',
    subject: template?.subject ?? '',
    fromLocal: template?.fromLocal ?? '',
    fromName: template?.fromName ?? '',
    replyTo: template?.replyTo ?? '',
  });
  const [bodyHtml, setBodyHtml] = useState(template?.bodyHtml ?? '');
  const [attachments, setAttachments] = useState<MailAttachment[]>(template?.attachments ?? []);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);

  // contact picker options (display label)
  const contactOptions: ContactPickerOption[] = useMemo(
    () =>
      contacts.map((c) => ({
        id: c.id,
        email: c.email,
        groupValue: c.groupValue,
        label: c.groupValue ? `${c.groupValue}` : (c.email ?? c.id.slice(0, 8)),
        responded: c.respondedAt !== null,
      })),
    [contacts],
  );

  const lookupAttrs = (id: string) => contacts.find((c) => c.id === id)?.attrs ?? {};
  const lookupInviteToken = (id: string) => contacts.find((c) => c.id === id)?.inviteToken ?? null;

  const tokensInTemplate = useMemo(() => {
    const set = new Set<string>();
    const re = /\{\{([^}]+)\}\}/g;
    [meta.subject, bodyHtml, meta.fromName].forEach((s) => {
      let m: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((m = re.exec(s)) !== null) set.add(m[1].trim());
    });
    return Array.from(set);
  }, [meta.subject, bodyHtml, meta.fromName]);

  const onSave = () =>
    new Promise<{ id: string } | null>((resolve) => {
      setError(null);
      startTransition(async () => {
        const input = { ...meta, bodyHtml, attachments };
        const result = template
          ? await updateMailTemplateAction(surveyId, template.id, input)
          : await createMailTemplateAction(surveyId, input);
        if (!result.ok) {
          setError(result.error ?? '저장 실패');
          resolve(null);
          return;
        }
        resolve('data' in result && result.data ? result.data : { id: template?.id ?? '' });
      });
    });

  const handleSaveAndExit = async () => {
    const r = await onSave();
    if (r) {
      router.push(`/admin/surveys/${surveyId}/operations/mail-templates`);
      router.refresh();
    }
  };

  const handleSaveAndOpenSend = async () => {
    if (!template) {
      // 새 템플릿이면 저장 후 편집 페이지로 이동 (id 확보)
      const r = await onSave();
      if (r?.id) {
        router.push(`/admin/surveys/${surveyId}/operations/mail-templates/${r.id}/edit?send=1`);
      }
      return;
    }
    const r = await onSave();
    if (r) setSendOpen(true);
  };

  return (
    <div className="space-y-4">
      <MetaFields
        surveyId={surveyId}
        values={meta}
        onChange={setMeta}
        attachments={attachments}
        onAttachmentsChange={setAttachments}
        fromDomain={fromDomain}
      />

      <div className="space-y-2">
        <Label className="text-sm">본문</Label>
        <MailTemplateEditor
          surveyId={surveyId}
          initialHtml={template?.bodyHtml ?? ''}
          catalog={catalog}
          onChange={setBodyHtml}
        />
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>
          취소
        </Button>
        <Button type="button" variant="outline" onClick={() => setPreviewOpen(true)} disabled={pending}>
          미리보기
        </Button>
        <Button type="button" variant="outline" onClick={handleSaveAndOpenSend} disabled={pending}>
          저장 + 테스트 발송
        </Button>
        <Button type="button" onClick={handleSaveAndExit} disabled={pending}>
          {pending ? '저장 중...' : '저장'}
        </Button>
      </div>

      {previewOpen && (
        <MailPreviewDialog
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          surveyId={surveyId}
          contacts={contactOptions}
          fromDomain={fromDomain}
          template={{
            subject: meta.subject,
            bodyHtml,
            fromLocal: meta.fromLocal,
            fromName: meta.fromName,
            replyTo: meta.replyTo,
            attachments,
          }}
          r2PublicUrl={r2PublicUrl}
          contactAttrsLookup={lookupAttrs}
          contactInviteTokenLookup={lookupInviteToken}
        />
      )}

      {sendOpen && template && (
        <TestSendDialog
          open={sendOpen}
          onClose={() => setSendOpen(false)}
          surveyId={surveyId}
          templateId={template.id}
          contacts={contactOptions}
          tokensInTemplate={tokensInTemplate}
          contactAttrsLookup={lookupAttrs}
          contactInviteTokenLookup={lookupInviteToken}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: edit/page.tsx — contacts + r2PublicUrl prop 추가**

```tsx
import { notFound } from 'next/navigation';

import { TemplateEditForm } from '@/components/operations/mail-template/template-edit-form';
import { getVariableCatalog } from '@/components/operations/mail-template/variable-catalog';
import { getContactTargetListForPicker } from '@/data/contact-targets';
import { getMailTemplate } from '@/data/mail-templates';

interface Props {
  params: Promise<{ id: string; mid: string }>;
}

export default async function EditMailTemplatePage({ params }: Props) {
  const { id: surveyId, mid: templateId } = await params;
  const template = await getMailTemplate(surveyId, templateId);
  if (!template) notFound();

  const fromDomain = process.env.RESEND_FROM_DOMAIN ?? '';
  const r2PublicUrl = process.env.CLOUDFLARE_R2_PUBLIC_URL ?? '';
  const catalog = await getVariableCatalog(surveyId);
  const contacts = await getContactTargetListForPicker(surveyId);

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="mb-6 text-xl font-semibold">메일 템플릿 편집</h1>
      <TemplateEditForm
        surveyId={surveyId}
        fromDomain={fromDomain}
        catalog={catalog}
        contacts={contacts}
        r2PublicUrl={r2PublicUrl}
        template={template}
      />
    </main>
  );
}
```

- [ ] **Step 4: new/page.tsx — 동일 패턴 (template prop 없음)**

```tsx
import { TemplateEditForm } from '@/components/operations/mail-template/template-edit-form';
import { getVariableCatalog } from '@/components/operations/mail-template/variable-catalog';
import { getContactTargetListForPicker } from '@/data/contact-targets';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function NewMailTemplatePage({ params }: Props) {
  const { id: surveyId } = await params;
  const fromDomain = process.env.RESEND_FROM_DOMAIN ?? '';
  const r2PublicUrl = process.env.CLOUDFLARE_R2_PUBLIC_URL ?? '';
  const catalog = await getVariableCatalog(surveyId);
  const contacts = await getContactTargetListForPicker(surveyId);

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="mb-6 text-xl font-semibold">새 메일 템플릿</h1>
      <TemplateEditForm
        surveyId={surveyId}
        fromDomain={fromDomain}
        catalog={catalog}
        contacts={contacts}
        r2PublicUrl={r2PublicUrl}
      />
    </main>
  );
}
```

- [ ] **Step 5: 빌드**

Run: `pnpm exec tsc --noEmit`

Expected: 에러 0개.

- [ ] **Step 6: Manual smoke**

dev:
1. 컨택 업로드된 설문에서 메일 템플릿 편집 → 메타 + 본문 입력
2. 본문에 `{{수행기관}}` + `{{invite_link}}` 삽입
3. [미리보기] → 다이얼로그 → 컨택 선택 → 변수 치환된 메일 본문 확인
4. [저장 + 테스트 발송] → 다이얼로그 → 컨택 선택 → 받는 메일에 본인 메일 입력 → [발송]
5. 받은 편지함 (Gmail/Naver) 에서 메일 수신 확인
6. 본문의 `{{수행기관}}` → 실제 attrs 값으로 치환 확인
7. `{{invite_link}}` 클릭 → 응답 페이지 진입 (inviteToken 동작) 확인
8. 첨부 다운로드 링크 클릭 → R2 파일 다운로드 확인

- [ ] **Step 7: Commit**

```bash
git add src/components/operations/mail-template/template-edit-form.tsx \
        src/data/contact-targets.ts \
        src/app/admin/surveys/\[id\]/operations/mail-templates/new/page.tsx \
        src/app/admin/surveys/\[id\]/operations/mail-templates/\[mid\]/edit/page.tsx
git commit -m "feat: 미리보기 테스트발송 다이얼로그 통합 1명 발송 슬라이스 완료"
```

---

## Phase D 완료 게이트 (= 슬라이스 완료)

- [ ] 1명 테스트 메일 본인 받은편지함에 도착
- [ ] 본문의 모든 `{{변수}}` 정상 치환 (제목 / from_name / 본문 / invite_link)
- [ ] `invite_link` 클릭 → `/survey/[id]?invite=<token>` 진입 확인
- [ ] 첨부 다운로드 링크 동작
- [ ] reply_to 헤더 정상 (메일 클라에서 답장 누르면 그 주소로 보임)
- [ ] 모든 단위 테스트 통과: `pnpm test`
- [ ] 타입 / 린트 0: `pnpm exec tsc --noEmit && pnpm lint`
- [ ] Phase D PR 생성

---

# Self-Review

## 1. Spec coverage

| Spec 섹션 | 구현 task |
|---|---|
| §3 라우트 / 헤더 네비 | A.7, A.8, A.10 |
| §4 DB 모델 | A.1, A.2, A.3 |
| §4 Drizzle / zod | A.3, A.4 |
| §4 data fetch | A.5 |
| §4 server actions (CRUD) | A.6 |
| §4 server actions (sendTest) | D.4 |
| §5 변수 토큰 / Decoration | B.3 |
| §5 카탈로그 | B.4 |
| §5 치환 (renderTemplateForContact) | D.2 |
| §5 저장 시 토큰 추출 (variables_used) | A.6 (extractVariableKeys) |
| §6 에디터 컴포넌트 | B.6, B.7, B.8, B.9 |
| §6 Popover 변수 메뉴 | B.5 |
| §6 테이블 편집 (NoticeEditor 패턴) | B.7 |
| §7 R2 presign API | C.3 |
| §7 클라이언트 업로더 | C.4 |
| §7 이미지 통합 | C.6 |
| §7 첨부 통합 | C.5 |
| §8 미리보기 다이얼로그 (max-w-[960px], 720px container) | D.6 |
| §9 react-email shell | D.3 |
| §9 sendTestMailAction | D.4 |
| §9 TestSendDialog | D.7 |
| §10 환경 변수 추가 | D.1 |
| §11 패키지 설치 | B.1, C.1, D.1 |

**모든 spec 항목 커버 ✓**

## 2. Placeholder scan

플랜 내부에서 검색:
- "TBD" / "TODO" / "implement later" : 없음
- "Add appropriate error handling" : 없음
- "Similar to Task N" : 없음 (코드 모두 self-contained)

## 3. Type 일관성

- `MetaFieldValues`: A.9 정의, C.5 / D.8 동일하게 사용
- `ContactPickerOption`: D.5 정의, D.6 / D.7 / D.8 동일 import
- `VariableDef`: B.4 정의, B.5 / B.8 / D.8 import
- `MailAttachment`: A.2 정의, schema-types.ts 에서 export, 모든 곳 동일
- `useR2Upload` API (`upload, cancel, progress, uploading, error, reset`): C.4 정의, C.5 / C.6 사용 시 동일

✓ 일관됨

---

# 다음 슬라이스 트리거

Phase D 완료 후 — 사용자가 "다음 메일 작업 시작" 신호 시:

1. `project_mail_next_slice_followups` 메모리 자동 로드 → QR / 단체발송 / 이력 / 수신거부 8건 항목 확인
2. 새 brainstorming → 새 spec → 새 plan
3. 이번 슬라이스의 `mail_templates.attachments` JSONB 가 다음 슬라이스에서 cron 청소 정책의 SoT가 됨

---

**플랜 끝.**
