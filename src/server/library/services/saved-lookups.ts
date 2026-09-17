import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { savedLookups } from '@/db/schema';
import type { SavedLookup } from '@/types/survey';

import type {
  CreateSavedLookupInput,
  ListSavedLookupsInput,
  UpdateSavedLookupInput,
} from '../domain/saved-lookup';

type LookupRow = Record<string, string | number>;

// drizzle $inferSelect row -> domain SavedLookup 명시 변환.
// description: string | null -> string | undefined (domain optional, exactOptionalPropertyTypes 대응)
// tags/columns/rows 는 schema 가 notNull + default 라 null 이 아니지만, 매퍼에서 명시 보존.
function toDomainSavedLookup(
  row: typeof savedLookups.$inferSelect,
): SavedLookup {
  const result: SavedLookup = {
    id: row.id,
    name: row.name,
    category: row.category,
    tags: row.tags,
    columns: row.columns,
    rows: row.rows,
    usageCount: row.usageCount,
    isPreset: row.isPreset,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (row.description != null) {
    result.description = row.description;
  }
  return result;
}

// ========================
// surveys.lookups 자동 동기화 헬퍼
// ========================
//
// 보관함을 SoT 로 간주해 마스터가 수정/삭제되면 모든 설문의 lookups jsonb 사본이
// 자동으로 따라가게 한다. 무효화(revalidate)는 클라이언트 invalidate 가 담당하므로
// 여기서는 DB propagation 만 수행하고 영향 surveyId 는 사용하지 않는다.
//
// publish 된 설문의 snapshot 은 별도 freeze 되어 있어 응답자 화면에는 영향 없음.

// trx 는 db.transaction(async (tx) => ...) 의 tx 와 동일 API. 정확한 타입을 명시하기 어려워
// 동일 인터페이스(typeof db) 를 그대로 사용한다.
type TxRunner = Pick<typeof db, 'execute' | 'delete'>;

/** 같은 sourceSavedLookupId 를 가진 surveys.lookups 사본의 name/columns/rows 를 일괄 갱신. */
async function propagateSavedLookupUpdate(
  trx: TxRunner,
  savedLookupId: string,
  next: { name: string; columns: string[]; rows: Array<Record<string, string | number>> },
): Promise<void> {
  // PG 는 jsonb_build_object 의 value 인자 타입을 추론 못 함 → 명시적 ::text cast 필수
  await trx.execute(sql`
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
  `);
}

/** 같은 sourceSavedLookupId 를 가진 surveys.lookups 사본을 모두 제거. */
async function propagateSavedLookupDelete(
  trx: TxRunner,
  savedLookupId: string,
): Promise<void> {
  await trx.execute(sql`
    UPDATE surveys
    SET lookups = (
      SELECT COALESCE(jsonb_agg(entry), '[]'::jsonb)
      FROM jsonb_array_elements(lookups) entry
      WHERE entry->>'sourceSavedLookupId' IS DISTINCT FROM ${savedLookupId}::text
    ),
    updated_at = NOW()
    WHERE lookups @> jsonb_build_array(jsonb_build_object('sourceSavedLookupId', ${savedLookupId}::text))
  `);
}

// ========================
// 쿼리
// ========================

/** 보관함 LUT 목록 조회. category 필터 + 이름/설명 대소문자 무시 검색. */
export async function listSavedLookups(
  params: ListSavedLookupsInput = {},
): Promise<SavedLookup[]> {
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

  return filtered.map(toDomainSavedLookup);
}

// ========================
// 뮤테이션
// ========================

/** 보관함 LUT 생성. */
export async function createSavedLookup(
  input: CreateSavedLookupInput,
): Promise<SavedLookup> {
  const [row] = await db
    .insert(savedLookups)
    .values({
      name: input.name,
      description: input.description,
      category: input.category,
      tags: input.tags,
      columns: input.columns,
      rows: input.rows as LookupRow[],
    })
    .returning();

  if (!row) {
    throw new Error('보관함 LUT 생성에 실패했습니다.');
  }

  return toDomainSavedLookup(row);
}

/**
 * 보관함 LUT 수정 — 마스터 update + surveys.lookups propagation 을 한 트랜잭션으로 처리.
 * updates 에 없는 컬럼은 drizzle .set 이 undefined 를 silent skip 하므로 NULL 덮어쓰기 없음.
 */
export async function updateSavedLookup(
  id: string,
  updates: UpdateSavedLookupInput['updates'],
): Promise<SavedLookup> {
  const row = await db.transaction(async (tx) => {
    const [updatedRow] = await tx
      .update(savedLookups)
      .set({
        ...updates,
        rows: updates.rows as LookupRow[] | undefined,
        updatedAt: new Date(),
      })
      .where(eq(savedLookups.id, id))
      .returning();

    if (!updatedRow) {
      throw new Error('보관함 LUT 를 찾을 수 없습니다.');
    }

    await propagateSavedLookupUpdate(tx, id, {
      name: updatedRow.name,
      columns: updatedRow.columns,
      rows: updatedRow.rows,
    });
    return updatedRow;
  });

  return toDomainSavedLookup(row);
}

/** 보관함 LUT 삭제 — propagation(사본 제거) 후 마스터 delete 를 한 트랜잭션으로 처리. */
export async function deleteSavedLookup(id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await propagateSavedLookupDelete(tx, id);
    await tx.delete(savedLookups).where(eq(savedLookups.id, id));
  });
}
