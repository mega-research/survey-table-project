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
  columns: z.array(z.string().min(1)).min(1),
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
      columns: parsed.columns,
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
//
// 보관함 마스터를 SoT 로 간주. 갱신 후 모든 설문의 lookups jsonb 에서 같은
// sourceSavedLookupId 사본의 name/columns/rows 를 SQL 로 일괄 동기화.
// (publish 된 설문의 snapshot 은 별도 freeze 되어 있어 응답자 화면에 영향 없음)
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

  // 모든 설문의 lookups 사본 자동 동기화
  await db.execute(sql`
    UPDATE surveys
    SET lookups = (
      SELECT jsonb_agg(
        CASE
          WHEN entry->>'sourceSavedLookupId' = ${id}
          THEN entry
               || jsonb_build_object('name', ${row.name}::text)
               || jsonb_build_object('columns', ${JSON.stringify(row.columns)}::jsonb)
               || jsonb_build_object('rows', ${JSON.stringify(row.rows)}::jsonb)
          ELSE entry
        END
      )
      FROM jsonb_array_elements(lookups) entry
    ),
    updated_at = NOW()
    WHERE lookups @> jsonb_build_array(jsonb_build_object('sourceSavedLookupId', ${id}))
  `);

  revalidatePath('/admin/surveys');
  return toSavedLookup(row);
}

// 보관함 LUT 삭제
//
// 마스터 삭제 시 같은 sourceSavedLookupId 를 참조하는 모든 설문의 사본도 일괄 제거.
// (publish 된 설문의 snapshot 은 별도 freeze 되어 있어 응답자 화면에 영향 없음)
export async function deleteSavedLookupAction(id: string): Promise<void> {
  await requireAuth();

  // 모든 설문의 lookups 에서 매칭되는 사본 제거 (삭제 전에 — FK 제약은 없지만 일관성 위해)
  await db.execute(sql`
    UPDATE surveys
    SET lookups = (
      SELECT COALESCE(jsonb_agg(entry), '[]'::jsonb)
      FROM jsonb_array_elements(lookups) entry
      WHERE entry->>'sourceSavedLookupId' IS DISTINCT FROM ${id}
    ),
    updated_at = NOW()
    WHERE lookups @> jsonb_build_array(jsonb_build_object('sourceSavedLookupId', ${id}))
  `);

  await db.delete(savedLookups).where(eq(savedLookups.id, id));
  revalidatePath('/admin/surveys');
}

// ========================
// 설문 LUT (surveys.lookups jsonb)
// ========================

// 보관함 → 설문으로 LUT 추가.
//
// 같은 sourceSavedLookupId 사본이 이미 있으면 중복 추가하지 않고 데이터만 최신 보관함 값으로 갱신.
// (사용자가 같은 LUT 를 여러 번 "이 설문에 추가" 눌러도 사본이 쌓이지 않음)
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

  const survey = await db.query.surveys.findFirst({
    where: eq(surveys.id, surveyId),
    columns: { lookups: true },
  });
  if (!survey) {
    throw new Error('설문을 찾을 수 없습니다.');
  }

  const list = survey.lookups ?? [];
  const existing = list.find((l) => l.sourceSavedLookupId === savedLookupId);

  if (existing) {
    // 이미 등록된 사본 → 데이터만 최신 보관함 값으로 갱신 (id 보존, usageCount 증가 안 함)
    const updated: SurveyLookup = {
      ...existing,
      name: saved.name,
      columns: saved.columns,
      rows: saved.rows,
    };
    const next = list.map((l) => (l.id === existing.id ? updated : l));
    await db
      .update(surveys)
      .set({ lookups: next, updatedAt: new Date() })
      .where(eq(surveys.id, surveyId));
    revalidatePath(`/admin/surveys/${surveyId}`);
    return updated;
  }

  // 신규 사본 추가 + usageCount 증가
  const newLookup: SurveyLookup = {
    id: nanoid(),
    name: saved.name,
    sourceSavedLookupId: saved.id,
    columns: saved.columns,
    rows: saved.rows,
  };
  const next = [...list, newLookup];

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
    columns: row.columns,
    rows: row.rows,
    usageCount: row.usageCount,
    isPreset: row.isPreset,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
