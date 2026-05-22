'use server';

import { revalidatePath } from 'next/cache';

import { eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import { db } from '@/db';
import { savedLookups, surveys } from '@/db/schema';
import { requireAuth } from '@/lib/auth';
import type { SavedLookup, SurveyLookup } from '@/types/survey';

// ========================
// 입력 검증 스키마
// ========================

const SavedLookupInputSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  category: z.string().min(1).max(100),
  tags: z.array(z.string()).default([]),
  keyColumns: z.array(z.string().min(1)).min(1),
  valueColumn: z.string().min(1),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number()]))),
});

type LookupRow = Record<string, string | number>;
type SavedLookupInput = Omit<z.infer<typeof SavedLookupInputSchema>, 'rows'> & {
  rows: LookupRow[];
};

// ========================
// saved_lookups CRUD
// ========================

// 보관함 LUT 목록 조회
export async function listSavedLookupsAction(
  params: { category?: string; search?: string } = {},
): Promise<SavedLookup[]> {
  await requireAuth();

  const rows = params.category
    ? await db.query.savedLookups.findMany({
        where: eq(savedLookups.category, params.category),
      })
    : await db.query.savedLookups.findMany();

  const searchTerm = params.search?.toLowerCase();
  const filtered = searchTerm
    ? rows.filter(
        (r) =>
          r.name.toLowerCase().includes(searchTerm) ||
          (r.description ?? '').toLowerCase().includes(searchTerm),
      )
    : rows;

  return filtered.map(toSavedLookup);
}

// 보관함 LUT 생성
export async function createSavedLookupAction(
  input: SavedLookupInput,
): Promise<SavedLookup> {
  await requireAuth();

  const parsed = SavedLookupInputSchema.parse(input);

  const [row] = await db
    .insert(savedLookups)
    .values({
      name: parsed.name,
      description: parsed.description,
      category: parsed.category,
      tags: parsed.tags,
      keyColumns: parsed.keyColumns,
      valueColumn: parsed.valueColumn,
      rows: parsed.rows as LookupRow[],
    })
    .returning();

  if (!row) {
    throw new Error('보관함 LUT 생성에 실패했습니다.');
  }

  revalidatePath('/admin/surveys');
  return toSavedLookup(row);
}

// 보관함 LUT 수정
export async function updateSavedLookupAction(
  id: string,
  input: Partial<SavedLookupInput>,
): Promise<SavedLookup> {
  await requireAuth();

  const parsed = SavedLookupInputSchema.partial().parse(input);

  const [row] = await db
    .update(savedLookups)
    .set({
      ...parsed,
      rows: parsed.rows as LookupRow[] | undefined,
      updatedAt: new Date(),
    })
    .where(eq(savedLookups.id, id))
    .returning();

  if (!row) {
    throw new Error('보관함 LUT 를 찾을 수 없습니다.');
  }

  revalidatePath('/admin/surveys');
  return toSavedLookup(row);
}

// 보관함 LUT 삭제
export async function deleteSavedLookupAction(id: string): Promise<void> {
  await requireAuth();

  await db.delete(savedLookups).where(eq(savedLookups.id, id));
  revalidatePath('/admin/surveys');
}

// ========================
// 설문 LUT (surveys.lookups jsonb)
// ========================

// 보관함 → 설문으로 LUT 복사 (snapshot freeze + usageCount 증가)
export async function copySavedLookupToSurveyAction(
  surveyId: string,
  savedLookupId: string,
): Promise<SurveyLookup> {
  await requireAuth();

  const saved = await db.query.savedLookups.findFirst({
    where: eq(savedLookups.id, savedLookupId),
  });
  if (!saved) {
    throw new Error('보관함 LUT 를 찾을 수 없습니다.');
  }

  const newLookup: SurveyLookup = {
    id: nanoid(),
    name: saved.name,
    sourceSavedLookupId: saved.id,
    keyColumns: saved.keyColumns,
    valueColumn: saved.valueColumn,
    rows: saved.rows,
  };

  const survey = await db.query.surveys.findFirst({
    where: eq(surveys.id, surveyId),
    columns: { lookups: true },
  });
  if (!survey) {
    throw new Error('설문을 찾을 수 없습니다.');
  }

  const next: SurveyLookup[] = [...(survey.lookups ?? []), newLookup];

  await db.transaction(async (tx) => {
    await tx
      .update(surveys)
      .set({ lookups: next, updatedAt: new Date() })
      .where(eq(surveys.id, surveyId));

    await tx
      .update(savedLookups)
      .set({ usageCount: sql`${savedLookups.usageCount} + 1` })
      .where(eq(savedLookups.id, savedLookupId));
  });

  revalidatePath(`/admin/surveys/${surveyId}`);
  return newLookup;
}

// 설문 LUT upsert (신규 추가 또는 기존 id 갱신)
export async function upsertSurveyLookupAction(
  surveyId: string,
  lookup: SurveyLookup,
): Promise<SurveyLookup> {
  await requireAuth();

  const survey = await db.query.surveys.findFirst({
    where: eq(surveys.id, surveyId),
    columns: { lookups: true },
  });
  if (!survey) {
    throw new Error('설문을 찾을 수 없습니다.');
  }

  const list: SurveyLookup[] = survey.lookups ?? [];
  const idx = list.findIndex((l) => l.id === lookup.id);

  const next: SurveyLookup[] =
    idx >= 0
      ? list.map((l, i) => (i === idx ? lookup : l))
      : [...list, { ...lookup, id: lookup.id || nanoid() }];

  await db
    .update(surveys)
    .set({ lookups: next, updatedAt: new Date() })
    .where(eq(surveys.id, surveyId));

  revalidatePath(`/admin/surveys/${surveyId}`);
  return next[idx >= 0 ? idx : next.length - 1];
}

// 설문 LUT 삭제
export async function deleteSurveyLookupAction(
  surveyId: string,
  surveyLookupId: string,
): Promise<void> {
  await requireAuth();

  const survey = await db.query.surveys.findFirst({
    where: eq(surveys.id, surveyId),
    columns: { lookups: true },
  });
  if (!survey) {
    throw new Error('설문을 찾을 수 없습니다.');
  }

  const next: SurveyLookup[] = (survey.lookups ?? []).filter(
    (l) => l.id !== surveyLookupId,
  );

  await db
    .update(surveys)
    .set({ lookups: next, updatedAt: new Date() })
    .where(eq(surveys.id, surveyId));

  revalidatePath(`/admin/surveys/${surveyId}`);
}

// ========================
// 내부 헬퍼
// ========================

function toSavedLookup(row: typeof savedLookups.$inferSelect): SavedLookup {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    category: row.category,
    tags: row.tags,
    keyColumns: row.keyColumns,
    valueColumn: row.valueColumn,
    rows: row.rows,
    usageCount: row.usageCount,
    isPreset: row.isPreset,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
