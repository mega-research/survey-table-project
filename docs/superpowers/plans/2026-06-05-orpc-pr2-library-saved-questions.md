# oRPC PR2 — library feature (saved_questions 슬라이스) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** saved_questions(질문 보관함)을 첫 oRPC feature(`features/library`)로 옮겨, domain → server(service/procedure) → hook 전환 패턴을 확정한다. 이 슬라이스가 나머지 8개 feature의 복붙 템플릿이 된다.

**Architecture:** `features/library/`에 domain(타입+zod) + server/services(drizzle) + server/procedures(oRPC authed)를 만들고, 기존 `use-library.ts`의 saved_questions hook **내부만 `orpc.library.savedQuestions.*`로 전환하고 시그니처를 유지**한다 → 소비 컴포넌트(save-question-modal, question-library-panel) 무수정. 마지막에 대체된 server action/data/wrapper를 제거한다.

**Tech Stack:** oRPC 1.14.4, zod 4(복잡 JSONB는 `z.custom`), TanStack Query 5(`@orpc/tanstack-query` utils), Drizzle, Vitest(mock-driven).

---

## 핵심 설계 결정 (조사 기반)

1. **library feature = domain + server + (hook은 기존 위치 유지)**. UI 컴포넌트는 소비처(현 `components/survey-builder/`)에 그대로 둔다. 컴포넌트는 `use-library.ts` hook을 통해서만 library에 접근하므로 cross-feature import가 발생하지 않는다(hook 내부가 `@/shared/lib/rpc`의 `orpc` 경유).
2. **store(`question-library-store.ts`)는 순수 클라 UI 상태** → 이번 PR에서 건드리지 않는다(서버 상태 미소유). 단 순수 함수 `hasBranchLogic`/`removeBranchLogic`는 `features/library/domain/`으로 이전.
3. **slice 경계 = saved_questions만.** categories/tags/cells/lookups/import-export는 후속 슬라이스. saved_questions가 쓰는 6 query + 5 mutation만 이번에 옮긴다.
4. **인증**: 기존 action은 mutation마다 `requireAuth()`. oRPC에서는 `authed` 베이스를 쓰면 미들웨어가 일괄 처리하므로 service/handler에서 개별 `requireAuth` 호출 불필요. 조회(query)도 admin 전용 보관함이므로 `authed` 사용.
5. **복잡 JSONB(`QuestionData`)는 `z.custom<QuestionData>()`** 로 input/output 스키마를 만든다(전체 필드 zod는 과도). 타입 안전은 유지되고 런타임은 통과.

---

## File Structure

**신규:**
- `src/features/library/domain/saved-question.ts` — `SavedQuestion`/`QuestionData` 타입 re-export, zod 스키마(`SavedQuestionSchema`, `CreateSavedQuestionInput`, `UpdateSavedQuestionInput`), 순수 함수(`hasBranchLogic`, `removeBranchLogic`)
- `src/features/library/server/services/saved-questions.service.ts` — drizzle 쿼리/뮤테이션 11개(기존 `data/library.ts` + `library-actions.ts` 로직 이전)
- `src/features/library/server/procedures/saved-questions.ts` — oRPC procedure 11개(authed)
- `src/features/library/server/procedures/saved-questions.test.ts` — colocated unit(mock db)

**수정:**
- `src/server/router.ts` — `library` 라우터 추가
- `src/hooks/queries/use-library.ts` — saved_questions hook 내부를 `orpc.library.savedQuestions.*`로 전환(시그니처 유지)
- `src/actions/library-actions.ts` — saved_questions 함수 5개 제거(`saveQuestion`/`updateSavedQuestion`/`deleteSavedQuestion`/`applyQuestion`/`applyMultipleQuestions`)
- `src/actions/query-actions.ts` — saved_questions wrapper 6개 제거
- `src/data/library.ts` — saved_questions 쿼리 6개 제거

**범위 밖(후속):** categories/tags/import-export 슬라이스, cells·lookups feature, store 이전, UI 컴포넌트의 `features/`로의 물리 이동(survey-builder feature PR7에서).

---

## Task 1: domain — 타입·zod·순수함수

**Files:**
- Create: `src/features/library/domain/saved-question.ts`

- [ ] **Step 1: domain 파일 작성**

```ts
// src/features/library/domain/saved-question.ts
import * as z from 'zod';

import type { QuestionData } from '@/db/schema/schema-types';
import type { SavedQuestion } from '@/db/schema/surveys';
import type { Question, QuestionConditionGroup } from '@/types/survey';

export type { SavedQuestion };
export type { QuestionData };

/** 복잡 JSONB는 z.custom으로 타입만 보장(런타임 통과). */
export const QuestionDataSchema = z.custom<QuestionData>();
export const SavedQuestionSchema = z.custom<SavedQuestion>();

// 컴포넌트가 useSaveQuestion().mutateAsync({ question, metadata }) 로 호출하므로
// input도 nested(question + metadata)로 정의해 컴포넌트 무수정을 보장한다.
export const CreateSavedQuestionInput = z.object({
  question: QuestionDataSchema,
  metadata: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    category: z.string().min(1),
    tags: z.array(z.string()).optional(),
  }),
});
export type CreateSavedQuestionInput = z.infer<typeof CreateSavedQuestionInput>;

export const UpdateSavedQuestionInput = z.object({
  id: z.string(),
  updates: z
    .object({
      name: z.string(),
      description: z.string(),
      category: z.string(),
      tags: z.array(z.string()),
      question: QuestionDataSchema,
    })
    .partial(),
});
export type UpdateSavedQuestionInput = z.infer<typeof UpdateSavedQuestionInput>;

/** 분기 로직(displayCondition) 존재 여부. question-library-store에서 이전. */
export function hasBranchLogic(question: Question): boolean {
  const cond = question.displayCondition as QuestionConditionGroup | undefined;
  return !!cond && Array.isArray(cond.conditions) && cond.conditions.length > 0;
}

/** 분기 로직 제거한 새 question 반환. question-library-store에서 이전. */
export function removeBranchLogic(question: Question): Question {
  const { displayCondition: _omit, ...rest } = question;
  return rest as Question;
}
```

> 주의: `hasBranchLogic`/`removeBranchLogic`의 정확한 본문은 `src/stores/question-library-store.ts`의 현재 구현을 그대로 옮긴다(위는 형태 예시). 옮긴 뒤 store의 두 함수는 Task 6에서 제거하고 import를 domain으로 바꾼다. `QuestionConditionGroup` 등 타입 경로가 다르면 실제 경로로 맞춘다.

- [ ] **Step 2: 타입체크**

Run: `pnpm exec tsc --noEmit 2>&1 | grep -E "^src/features/library" || echo "library 에러 없음"`
Expected: `library 에러 없음`

- [ ] **Step 3: 커밋**

```bash
git add src/features/library/domain/saved-question.ts
git commit -m "feat: library domain saved-question 타입 및 zod 스키마 추가"
```

---

## Task 2: server/service — drizzle 쿼리·뮤테이션

**Files:**
- Create: `src/features/library/server/services/saved-questions.service.ts`

- [ ] **Step 1: service 파일 작성**

기존 `src/data/library.ts`(쿼리)와 `src/actions/library-actions.ts`(뮤테이션)의 saved_questions 로직을 **순수 service 함수로 이전**한다. `requireAuth`/`revalidatePath`는 제거(인증은 procedure의 `authed` 미들웨어가, 캐시 무효화는 클라 hook의 invalidate가 담당). R2 이미지 처리(`promoteSurveyImages`/`extractImageUrlsFromQuestion`/`deleteImagesFromR2Server`)는 그대로 유지한다.

```ts
// src/features/library/server/services/saved-questions.service.ts
import 'server-only';

import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';

import { db } from '@/db';
import { savedQuestions } from '@/db/schema/surveys';
import type { SavedQuestion } from '@/db/schema/surveys';
import { generateId } from '@/lib/utils'; // 기존 applyQuestion이 쓰는 ID 생성기와 동일 경로로 맞출 것
import { promoteSurveyImages } from '@/lib/survey'; // 기존 library-actions import 경로로 맞출 것
import {
  deleteImagesFromR2Server,
  extractImageUrlsFromQuestion,
} from '@/lib/upload'; // 기존 경로로 맞출 것
import type { Question } from '@/types/survey';

export async function listSavedQuestions(): Promise<SavedQuestion[]> {
  return db.query.savedQuestions.findMany({
    orderBy: [desc(savedQuestions.updatedAt)],
  }) as unknown as Promise<SavedQuestion[]>;
}

export async function searchSavedQuestions(query: string): Promise<SavedQuestion[]> {
  return db.query.savedQuestions.findMany({
    where: or(
      ilike(savedQuestions.name, `%${query}%`),
      ilike(savedQuestions.description, `%${query}%`),
    ),
    orderBy: [desc(savedQuestions.updatedAt)],
  }) as unknown as Promise<SavedQuestion[]>;
}

export async function getSavedQuestionsByCategory(category: string): Promise<SavedQuestion[]> {
  return db.query.savedQuestions.findMany({
    where: eq(savedQuestions.category, category),
    orderBy: [desc(savedQuestions.updatedAt)],
  }) as unknown as Promise<SavedQuestion[]>;
}

export async function getRecentlyUsedQuestions(limit = 5): Promise<SavedQuestion[]> {
  const rows = (await db.query.savedQuestions.findMany({
    orderBy: [desc(savedQuestions.updatedAt)],
    limit,
  })) as unknown as SavedQuestion[];
  return rows.filter((q) => q.usageCount > 0);
}

export async function getMostUsedQuestions(limit = 5): Promise<SavedQuestion[]> {
  return db.query.savedQuestions.findMany({
    orderBy: [desc(savedQuestions.usageCount)],
    limit,
  }) as unknown as Promise<SavedQuestion[]>;
}

export async function getSavedQuestionsByTag(tag: string): Promise<SavedQuestion[]> {
  const all = (await db.query.savedQuestions.findMany()) as unknown as SavedQuestion[];
  return all.filter((q) => (q.tags ?? []).includes(tag));
}

export async function createSavedQuestion(input: {
  question: Question;
  metadata: { name: string; description?: string; category: string; tags?: string[] };
}): Promise<SavedQuestion> {
  const [promoted] = await promoteSurveyImages([input.question]);
  const [row] = await db
    .insert(savedQuestions)
    .values({
      question: promoted,
      name: input.metadata.name,
      description: input.metadata.description,
      category: input.metadata.category,
      tags: input.metadata.tags ?? [],
      isPreset: false,
      usageCount: 0,
    })
    .returning();
  return row as unknown as SavedQuestion;
}

export async function updateSavedQuestion(
  id: string,
  updates: Partial<{
    name: string;
    description: string;
    category: string;
    tags: string[];
    question: Question;
  }>,
): Promise<SavedQuestion> {
  const next: Record<string, unknown> = { ...updates, updatedAt: new Date() };
  if (updates.question) {
    const [promoted] = await promoteSurveyImages([updates.question]);
    next.question = promoted;
  }
  const [row] = await db
    .update(savedQuestions)
    .set(next)
    .where(eq(savedQuestions.id, id))
    .returning();
  return row as unknown as SavedQuestion;
}

export async function deleteSavedQuestion(id: string): Promise<void> {
  const existing = await db.query.savedQuestions.findFirst({
    where: eq(savedQuestions.id, id),
  });
  if (existing) {
    const images = extractImageUrlsFromQuestion(existing.question);
    if (images.length > 0) {
      await deleteImagesFromR2Server(images).catch(() => {}); // 이미지 삭제 실패해도 질문 삭제는 계속
    }
  }
  await db.delete(savedQuestions).where(eq(savedQuestions.id, id));
}

export async function applySavedQuestion(id: string): Promise<Question | null> {
  const [updated] = await db
    .update(savedQuestions)
    .set({ usageCount: sql`${savedQuestions.usageCount} + 1`, updatedAt: new Date() })
    .where(eq(savedQuestions.id, id))
    .returning();
  if (!updated) return null;
  const { groupId: _g, ...rest } = updated.question as Question;
  return { ...rest, id: generateId(), order: 0 } as Question;
}

export async function applyMultipleSavedQuestions(ids: string[]): Promise<Question[]> {
  if (ids.length === 0) return [];
  const rows = (await db.query.savedQuestions.findMany({
    where: inArray(savedQuestions.id, ids),
  })) as unknown as SavedQuestion[];
  await db
    .update(savedQuestions)
    .set({ usageCount: sql`${savedQuestions.usageCount} + 1`, updatedAt: new Date() })
    .where(inArray(savedQuestions.id, ids));
  return rows.map((row) => {
    const { groupId: _g, ...rest } = row.question as Question;
    return { ...rest, id: generateId(), order: 0 } as Question;
  });
}
```

> **중요**: 위 import 경로(`@/lib/utils`의 `generateId`, `@/lib/survey`의 `promoteSurveyImages`, `@/lib/upload`의 R2 함수)는 **기존 `src/actions/library-actions.ts`의 실제 import와 정확히 일치시켜라.** 현재 코드를 열어 동일 심볼·경로를 복사할 것. `and` import는 미사용이면 제거.

- [ ] **Step 2: 타입체크**

Run: `pnpm exec tsc --noEmit 2>&1 | grep -E "^src/features/library" || echo "library 에러 없음"`
Expected: `library 에러 없음`

- [ ] **Step 3: 커밋**

```bash
git add src/features/library/server/services/saved-questions.service.ts
git commit -m "feat: library saved-questions service 추가"
```

---

## Task 3: server/procedures — oRPC procedure + colocated test (TDD)

**Files:**
- Create: `src/features/library/server/procedures/saved-questions.ts`
- Test: `src/features/library/server/procedures/saved-questions.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```ts
// src/features/library/server/procedures/saved-questions.test.ts
import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

// service를 mock — procedure가 service에 위임하는지 검증
const svc = {
  listSavedQuestions: vi.fn(),
  searchSavedQuestions: vi.fn(),
  createSavedQuestion: vi.fn(),
  applySavedQuestion: vi.fn(),
};
vi.mock('../services/saved-questions.service', () => svc);

import { savedQuestions } from './saved-questions';

function authedContext(): ORPCContext {
  return {
    db: {} as never,
    supabase: {} as never,
    user: { id: 'admin-1', email: 'a@b.com' },
  };
}

describe('savedQuestions procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('list는 service.listSavedQuestions 결과를 반환한다', async () => {
    svc.listSavedQuestions.mockResolvedValue([{ id: 'q1', name: '질문1' }]);
    const client = createRouterClient(
      { savedQuestions },
      { context: authedContext() },
    );
    const res = await client.savedQuestions.list();
    expect(svc.listSavedQuestions).toHaveBeenCalledOnce();
    expect(res[0]?.id).toBe('q1');
  });

  it('create는 입력을 service.createSavedQuestion에 위임한다', async () => {
    svc.createSavedQuestion.mockResolvedValue({ id: 'new', name: '새질문' });
    const client = createRouterClient(
      { savedQuestions },
      { context: authedContext() },
    );
    const input = { question: { id: 'x', type: 'text', title: 't', required: false, order: 0 }, metadata: { name: '새질문', category: '기본' } };
    const res = await client.savedQuestions.create(input as never);
    expect(svc.createSavedQuestion).toHaveBeenCalledWith(input);
    expect(res.id).toBe('new');
  });

  it('인증 없으면 list가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient(
      { savedQuestions },
      { context: { db: {} as never, supabase: {} as never, user: null } },
    );
    await expect(client.savedQuestions.list()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm exec vitest run src/features/library/server/procedures/saved-questions.test.ts`
Expected: FAIL — `Cannot find module './saved-questions'`

- [ ] **Step 3: procedure 작성**

```ts
// src/features/library/server/procedures/saved-questions.ts
import * as z from 'zod';

import { authed } from '@/server/orpc';

import {
  CreateSavedQuestionInput,
  QuestionDataSchema,
  SavedQuestionSchema,
  UpdateSavedQuestionInput,
} from '../../domain/saved-question';
import * as svc from '../services/saved-questions.service';

const list = authed
  .output(z.array(SavedQuestionSchema))
  .handler(() => svc.listSavedQuestions());

const search = authed
  .input(z.object({ query: z.string() }))
  .output(z.array(SavedQuestionSchema))
  .handler(({ input }) => svc.searchSavedQuestions(input.query));

const byCategory = authed
  .input(z.object({ category: z.string() }))
  .output(z.array(SavedQuestionSchema))
  .handler(({ input }) => svc.getSavedQuestionsByCategory(input.category));

const recentlyUsed = authed
  .input(z.object({ limit: z.number().optional() }))
  .output(z.array(SavedQuestionSchema))
  .handler(({ input }) => svc.getRecentlyUsedQuestions(input.limit));

const mostUsed = authed
  .input(z.object({ limit: z.number().optional() }))
  .output(z.array(SavedQuestionSchema))
  .handler(({ input }) => svc.getMostUsedQuestions(input.limit));

const byTag = authed
  .input(z.object({ tag: z.string() }))
  .output(z.array(SavedQuestionSchema))
  .handler(({ input }) => svc.getSavedQuestionsByTag(input.tag));

const create = authed
  .input(CreateSavedQuestionInput)
  .output(SavedQuestionSchema)
  .handler(({ input }) => svc.createSavedQuestion(input));

const update = authed
  .input(UpdateSavedQuestionInput)
  .output(SavedQuestionSchema)
  .handler(({ input }) => svc.updateSavedQuestion(input.id, input.updates));

const remove = authed
  .input(z.object({ id: z.string() }))
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ input }) => {
    await svc.deleteSavedQuestion(input.id);
    return { ok: true as const };
  });

const apply = authed
  .input(z.object({ id: z.string() }))
  .output(QuestionDataSchema.nullable())
  .handler(({ input }) => svc.applySavedQuestion(input.id));

const applyMultiple = authed
  .input(z.object({ ids: z.array(z.string()) }))
  .output(z.array(QuestionDataSchema))
  .handler(({ input }) => svc.applyMultipleSavedQuestions(input.ids));

export const savedQuestions = {
  list,
  search,
  byCategory,
  recentlyUsed,
  mostUsed,
  byTag,
  create,
  update,
  remove,
  apply,
  applyMultiple,
};
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm exec vitest run src/features/library/server/procedures/saved-questions.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/features/library/server/procedures/saved-questions.ts src/features/library/server/procedures/saved-questions.test.ts
git commit -m "feat: library saved-questions oRPC procedure 및 테스트 추가"
```

---

## Task 4: router 등록 + RPC end-to-end 검증

**Files:**
- Modify: `src/server/router.ts`

- [ ] **Step 1: router에 library 추가**

`src/server/router.ts`를 아래로 교체:

```ts
// src/server/router.ts
import { savedQuestions } from '@/features/library/server/procedures/saved-questions';

import { health } from './procedures/health';

export const router = {
  health,
  library: {
    savedQuestions,
  },
};

export type AppRouter = typeof router;
```

- [ ] **Step 2: 타입체크 + 전체 테스트**

Run: `pnpm exec tsc --noEmit 2>&1 | grep -cE "^src/" || echo 0`
Expected: `0`

Run: `pnpm exec vitest run src/features/library src/server`
Expected: 모두 PASS

- [ ] **Step 3: RPC 런타임 검증 (인증 필요 → 401 확인)**

dev 서버를 background로 띄우고(`BROWSER=none pnpm dev`), 인증 없이 호출 시 막히는지 확인:
```bash
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/rpc/library/savedQuestions/list -H 'content-type: application/json' -d '{"json":null}'
```
Expected: `401` 또는 oRPC UNAUTHORIZED 에러 응답(인증 미들웨어 동작 확인). DB를 변경하는 호출은 하지 말 것. 검증 후 dev 서버 종료.

- [ ] **Step 4: 커밋**

```bash
git add src/server/router.ts
git commit -m "feat: router에 library savedQuestions 등록"
```

---

## Task 5: use-library.ts hook을 orpc로 전환 (시그니처 유지)

**Files:**
- Modify: `src/hooks/queries/use-library.ts`

**핵심:** saved_questions 관련 hook의 **내부 구현만** `orpc.library.savedQuestions.*`로 바꾸고, **export 시그니처(이름·인자·반환 형태)는 그대로 유지**한다. 그래야 `save-question-modal.tsx`·`question-library-panel.tsx`가 무수정으로 동작한다. categories/tags/import-export hook은 이번에 건드리지 않는다.

- [ ] **Step 1: import 교체**

`use-library.ts` 상단의 `@/actions/library-actions`·`@/actions/query-actions` import 중 **saved_questions용 심볼만 제거**하고 `orpc`를 추가한다. (categories/tags/import-export용 심볼 `createCategory`/`updateCategory`/`deleteCategory`/`initializeDefaultCategories`/`initializePresetQuestions`/`exportLibrary`/`importLibrary`/`getAllCategories`/`getAllTags`는 유지.)

제거할 import: `applyMultipleQuestions`, `applyQuestion`, `deleteSavedQuestion`, `saveQuestion`, `updateSavedQuestion` (from library-actions) / `getAllSavedQuestions`, `getMostUsedQuestions`, `getQuestionsByCategory`, `getQuestionsByTag`, `getRecentlyUsedQuestions`, `searchSavedQuestions` (from query-actions).

추가:
```ts
import { orpc } from '@/shared/lib/rpc';
```

- [ ] **Step 2: query hook 6개 전환**

각 hook 본문을 아래로 교체(시그니처·이름 유지):

```ts
export function useSavedQuestions() {
  return useQuery(orpc.library.savedQuestions.list.queryOptions());
}

export function useQuestionsByCategory(category: string | undefined) {
  return useQuery(
    orpc.library.savedQuestions.byCategory.queryOptions({
      input: { category: category! },
      enabled: !!category,
    }),
  );
}

export function useSearchQuestions(query: string) {
  return useQuery(
    orpc.library.savedQuestions.search.queryOptions({
      input: { query },
      enabled: query.length > 0,
    }),
  );
}

export function useRecentlyUsedQuestions(limit?: number) {
  return useQuery(orpc.library.savedQuestions.recentlyUsed.queryOptions({ input: { limit } }));
}

export function useMostUsedQuestions(limit?: number) {
  return useQuery(orpc.library.savedQuestions.mostUsed.queryOptions({ input: { limit } }));
}

export function useQuestionsByTag(tag: string | undefined) {
  return useQuery(
    orpc.library.savedQuestions.byTag.queryOptions({
      input: { tag: tag! },
      enabled: !!tag,
    }),
  );
}
```

> oRPC tanstack-query의 `queryOptions`는 `{ input, ...queryOptions }`를 받는다. `enabled` 등 표준 옵션을 그대로 넘길 수 있다. `libraryKeys`는 mutation invalidation에서 계속 쓰이므로 **삭제하지 말 것**.

- [ ] **Step 3: mutation hook 5개 전환**

invalidate는 oRPC 키 헬퍼로 교체한다. saved_questions 전체 무효화는 `orpc.library.savedQuestions.key()`(부분 키)를 쓴다:

```ts
export function useSaveQuestion() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.library.savedQuestions.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.library.savedQuestions.key() });
        queryClient.invalidateQueries({ queryKey: libraryKeys.tags() });
      },
    }),
  );
}

export function useUpdateSavedQuestion() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.library.savedQuestions.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.library.savedQuestions.key() });
        queryClient.invalidateQueries({ queryKey: libraryKeys.tags() });
      },
    }),
  );
}

export function useDeleteSavedQuestion() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.library.savedQuestions.remove.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.library.savedQuestions.key() });
      },
    }),
  );
}

export function useApplyQuestion() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.library.savedQuestions.apply.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.library.savedQuestions.key() });
      },
    }),
  );
}

export function useApplyMultipleQuestions() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.library.savedQuestions.applyMultiple.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.library.savedQuestions.key() });
      },
    }),
  );
}
```

> **호출부 호환**: `create` input은 Task 1에서 nested(`{ question, metadata }`)로 정의돼 있어, 컴포넌트의 `mutateAsync({ question, metadata })` 호출과 그대로 일치한다. `update`도 `{ id, updates }`로 일치. 따라서 어댑터 없이 hook이 `mutationOptions`에 단순 위임하면 컴포넌트가 무수정으로 동작한다.

- [ ] **Step 4: 타입체크 + 컴포넌트 무수정 확인**

Run: `pnpm exec tsc --noEmit 2>&1 | grep -cE "^src/" || echo 0`
Expected: `0` (컴포넌트가 hook 시그니처에 의존하므로, 0이면 무수정 호환 성공)

- [ ] **Step 5: 커밋**

```bash
git add src/hooks/queries/use-library.ts
git commit -m "feat: saved_questions hook을 oRPC 클라이언트로 전환"
```

> **실행 전 확인**: `save-question-modal.tsx`·`question-library-panel.tsx`의 실제 `mutateAsync` 인자 형태를 Step 1 전에 한 번 확인하라. 본 plan은 `create = { question, metadata }`, `update = { id, updates }`로 맞춰 두었으나(Task 1·2·3 모두 nested), 실제와 어긋나면 procedure input을 실제 호출에 맞추고 tsc(Step 4 = 0)로 검증한다.

---

## Task 6: 대체된 server action·data·wrapper 제거

**Files:**
- Modify: `src/actions/library-actions.ts`
- Modify: `src/actions/query-actions.ts`
- Modify: `src/data/library.ts`
- Modify: `src/stores/question-library-store.ts`

- [ ] **Step 1: 잔존 참조 확인**

Run:
```bash
grep -rn "saveQuestion\|updateSavedQuestion\|deleteSavedQuestion\|applyQuestion\|applyMultipleQuestions" src --include=*.ts --include=*.tsx | grep -v "features/library" | grep -v "use-library.ts"
```
Expected: saved_questions action을 직접 import하는 곳이 더 없어야 한다(use-library hook 경유만). 만약 다른 직접 참조가 나오면, 그 호출부도 hook 경유로 바꾸거나 별도 보고.

- [ ] **Step 2: library-actions.ts에서 saved_questions 함수 5개 제거**

`saveQuestion`, `updateSavedQuestion`, `deleteSavedQuestion`, `applyQuestion`, `applyMultipleQuestions` 함수와, 이들만 쓰던 import(예: `promoteSurveyImages`, R2 헬퍼, `generateId`, `sql`, `inArray`)를 제거한다. categories/import-export 함수(`createCategory` 등)는 유지. 제거 후 미사용 import가 없도록 정리.

- [ ] **Step 3: query-actions.ts에서 saved_questions wrapper 6개 제거**

`getAllSavedQuestions`, `searchSavedQuestions`, `getQuestionsByCategory`, `getRecentlyUsedQuestions`, `getMostUsedQuestions`, `getQuestionsByTag` re-export를 제거. `getAllCategories`·`getAllTags`는 유지.

- [ ] **Step 4: data/library.ts에서 saved_questions 쿼리 6개 제거**

`getAllSavedQuestions`, `searchSavedQuestions`, `getQuestionsByCategory`, `getRecentlyUsedQuestions`, `getMostUsedQuestions`, `getQuestionsByTag` 제거(service로 이전됨). `getAllTags`·`getAllCategories`는 유지(아직 query-actions가 씀).

- [ ] **Step 5: store에서 순수함수 제거 + import 정리**

`question-library-store.ts`의 `hasBranchLogic`/`removeBranchLogic`를 제거하고, 이를 import하던 `question-library-panel.tsx`의 import를 `@/features/library/domain/saved-question`로 변경한다.

- [ ] **Step 6: 타입체크 + lint + 전체 테스트**

Run:
```bash
pnpm exec tsc --noEmit 2>&1 | grep -cE "^src/" || echo 0
pnpm lint 2>&1 | tail -2
pnpm test 2>&1 | tail -4
```
Expected: tsc `0`, lint `0 errors`, vitest 전체 통과(신규 포함). 미사용 import 경고 없이 깔끔할 것.

- [ ] **Step 7: 커밋**

```bash
git add src/actions/library-actions.ts src/actions/query-actions.ts src/data/library.ts src/stores/question-library-store.ts src/components/survey-builder/question-library-panel.tsx
git commit -m "refactor: 대체된 saved_questions server action 및 data 쿼리 제거"
```

---

## Task 7: 최종 검증 + 머지

- [ ] **Step 1: 전체 게이트**

Run:
```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test
```
Expected: lint 0 errors, tsc 통과, vitest 전체 통과(신규 실패 0).

- [ ] **Step 2: 빌더 라이브러리 패널 end-to-end 수동 검증**

test DB가 셋업된 상태에서 dev 서버를 띄우고, `/admin/surveys/create` 또는 `/admin/surveys/[id]/edit`에서 질문 보관함 패널이 열리고 목록 조회·질문 저장·적용이 동작하는지 확인한다(saved_questions가 orpc 경유로 정상 동작). DB 변경이 실제 일어나므로 **로컬 test DB에서만** 수행.

> 자동화가 어려우면, 최소한 `pnpm test:e2e`의 기존 smoke가 깨지지 않는지 + 위 게이트 통과로 갈음하고, 수동 확인 결과를 보고에 명시.

- [ ] **Step 3: PR 또는 머지**

finishing-a-development-branch 스킬로 처리(merge/PR 결정은 사용자 승인).

---

## Self-Review 체크리스트 (실행자가 PR 전 확인)

- [ ] procedure가 전부 `authed` 베이스인가(보관함은 admin 전용). `.input()`/`.output()` 규율 준수?
- [ ] service에 `requireAuth`/`revalidatePath`가 남아있지 않은가(인증=미들웨어, 무효화=클라 invalidate)?
- [ ] hook **시그니처가 그대로**라 save-question-modal·question-library-panel이 무수정인가?
- [ ] `create`/`update` procedure input이 컴포넌트의 실제 `mutateAsync` 인자 형태와 일치하는가?
- [ ] survey-builder 컴포넌트가 `@/features/library/*`를 직접 import하지 않고 hook/`@/shared/lib/rpc`만 경유하는가(ESLint 룰)?
- [ ] 제거 후 미사용 import·dead code 없는가?
