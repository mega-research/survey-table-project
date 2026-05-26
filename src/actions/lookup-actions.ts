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

// trim 후 빈 문자열은 거부. 공백만 입력해서 통과되는 문제 방지.
const nonBlank = (max: number) =>
  z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1).max(max));

const SavedLookupInputSchema = z.object({
  name: nonBlank(200),
  description: z.string().max(1000).optional(),
  category: nonBlank(100),
  tags: z.array(z.string()).default([]),
  columns: z.array(nonBlank(200)).min(1),
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

// ========================
// surveys.lookups 자동 동기화 헬퍼
// ========================
//
// 보관함을 SoT 로 간주해 마스터가 수정/삭제되면 모든 설문의 lookups jsonb 사본이
// 자동으로 따라가게 한다. 두 propagation 모두 영향받은 surveyId 를 반환하여
// 호출처가 빌더 페이지 경로를 개별 revalidate 하도록 한다.
//
// publish 된 설문의 snapshot 은 별도 freeze 되어 있어 응답자 화면에는 영향 없음.

// trx 는 db.transaction(async (tx) => ...) 의 tx 와 동일 API. 정확한 타입을 명시하기 어려워
// 동일 인터페이스(typeof db) 를 그대로 사용한다.
type TxRunner = Pick<typeof db, 'execute' | 'delete'>;

/** drizzle postgres-js 의 execute 반환은 array-like (rows). 안전하게 id 만 추출. */
function extractSurveyIds(result: unknown): string[] {
  if (!Array.isArray(result)) return [];
  return (result as Array<{ id?: string }>)
    .map((r) => r?.id)
    .filter((id): id is string => typeof id === 'string');
}

/** 같은 sourceSavedLookupId 를 가진 surveys.lookups 사본의 name/columns/rows 를 일괄 갱신. */
async function propagateSavedLookupUpdate(
  trx: TxRunner,
  savedLookupId: string,
  next: { name: string; columns: string[]; rows: Array<Record<string, string | number>> },
): Promise<string[]> {
  // PG 는 jsonb_build_object 의 value 인자 타입을 추론 못 함 → 명시적 ::text cast 필수
  const affected = await trx.execute<{ id: string }>(sql`
    UPDATE surveys
    SET lookups = (
      SELECT jsonb_agg(
        CASE
          WHEN entry->>'sourceSavedLookupId' = ${savedLookupId}::text
          THEN entry
               || jsonb_build_object('name', ${next.name}::text)
               || jsonb_build_object('columns', ${JSON.stringify(next.columns)}::jsonb)
               || jsonb_build_object('rows', ${JSON.stringify(next.rows)}::jsonb)
          ELSE entry
        END
      )
      FROM jsonb_array_elements(lookups) entry
    ),
    updated_at = NOW()
    WHERE lookups @> jsonb_build_array(jsonb_build_object('sourceSavedLookupId', ${savedLookupId}::text))
    RETURNING id
  `);
  return extractSurveyIds(affected);
}

/** 같은 sourceSavedLookupId 를 가진 surveys.lookups 사본을 모두 제거. */
async function propagateSavedLookupDelete(
  trx: TxRunner,
  savedLookupId: string,
): Promise<string[]> {
  const affected = await trx.execute<{ id: string }>(sql`
    UPDATE surveys
    SET lookups = (
      SELECT COALESCE(jsonb_agg(entry), '[]'::jsonb)
      FROM jsonb_array_elements(lookups) entry
      WHERE entry->>'sourceSavedLookupId' IS DISTINCT FROM ${savedLookupId}::text
    ),
    updated_at = NOW()
    WHERE lookups @> jsonb_build_array(jsonb_build_object('sourceSavedLookupId', ${savedLookupId}::text))
    RETURNING id
  `);
  return extractSurveyIds(affected);
}

/** /admin/surveys + 영향 받은 surveyId 의 빌더 경로 revalidate. */
function revalidateSurveyBuilders(surveyIds: string[]) {
  revalidatePath('/admin/surveys');
  for (const sid of surveyIds) {
    revalidatePath(`/admin/surveys/${sid}`);
    revalidatePath(`/admin/surveys/${sid}/edit`);
  }
}

// 보관함 LUT 수정 — 마스터 update + propagation 을 한 트랜잭션으로 처리.
export async function updateSavedLookupAction(
  id: string,
  input: Partial<SavedLookupInput>,
): Promise<SavedLookup> {
  await requireAuth();

  const parsed = SavedLookupInputSchema.partial().parse(input);

  const { row, affectedSurveyIds } = await db.transaction(async (tx) => {
    const [updatedRow] = await tx
      .update(savedLookups)
      .set({
        ...parsed,
        rows: parsed.rows as LookupRow[] | undefined,
        updatedAt: new Date(),
      })
      .where(eq(savedLookups.id, id))
      .returning();

    if (!updatedRow) {
      throw new Error('보관함 LUT 를 찾을 수 없습니다.');
    }

    const ids = await propagateSavedLookupUpdate(tx, id, {
      name: updatedRow.name,
      columns: updatedRow.columns,
      rows: updatedRow.rows,
    });
    return { row: updatedRow, affectedSurveyIds: ids };
  });

  revalidateSurveyBuilders(affectedSurveyIds);
  return toSavedLookup(row);
}

// 보관함 LUT 삭제 — propagation 후 마스터 delete 를 한 트랜잭션으로 처리.
export async function deleteSavedLookupAction(id: string): Promise<void> {
  await requireAuth();

  const affectedSurveyIds = await db.transaction(async (tx) => {
    const ids = await propagateSavedLookupDelete(tx, id);
    await tx.delete(savedLookups).where(eq(savedLookups.id, id));
    return ids;
  });

  revalidateSurveyBuilders(affectedSurveyIds);
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
