import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@/db';
import { r2KeyRefs } from '@/db/schema';
import type { R2DbExecutor } from '@/lib/r2-lifecycle/deletion-queue.server';
import { extractR2KeysFromJsonbValue, gateR2Key } from '@/lib/r2-lifecycle/key-extract';
import {
  IMMUTABLE_SOURCES,
  MUTABLE_SOURCES,
  type R2ReferenceSource,
} from '@/lib/r2-lifecycle/reference-surface.server';

/**
 * 특정 source row 의 참조를 통째로 교체한다. 키가 비어도 기존 참조는 지운다
 * (콘텐츠에서 이미지가 전부 빠진 경우).
 * 신규 기록된 행 수를 반환한다.
 */
export async function recordKeyRefs(
  dbc: R2DbExecutor,
  sourceTable: string,
  sourceId: string,
  keys: readonly string[],
): Promise<number> {
  await dbc
    .delete(r2KeyRefs)
    .where(and(eq(r2KeyRefs.sourceTable, sourceTable), eq(r2KeyRefs.sourceId, sourceId)));

  const accepted = new Set<string>();
  for (const raw of keys) {
    const key = gateR2Key(raw);
    if (key) accepted.add(key);
  }
  if (accepted.size === 0) return 0;

  const inserted = await dbc
    .insert(r2KeyRefs)
    .values([...accepted].map((key) => ({ key, sourceTable, sourceId })))
    .onConflictDoNothing()
    .returning({ key: r2KeyRefs.key });
  return inserted.length;
}

/**
 * 소멸한 source row 들의 인덱스 참조를 지운다.
 *
 * 인덱스 히트는 후보를 '보존됨'(종결 상태)으로 닫는다 — fetchDueCandidates 는
 * pending/failed 만 다시 집으므로 재시도 경로가 없다. 따라서 콘텐츠가 사라진
 * 뒤에 남은 인덱스 행은 "과보존"이 아니라 **영구 보존 잠금**이다. 콘텐츠를
 * 없애는 트랜잭션이 그 자리에서 인덱스도 함께 거둬야 한다.
 *
 * 가변 소스(questions·mail_templates 등)는 일일 리빌드가 집행 직전에 테이블
 * 단위로 전량 교체하므로 이 호출이 필요 없다. 필요한 것은 월 1회만 재추출되는
 * 불변 소스(survey_versions)다.
 */
export async function deleteKeyRefsBySourceIds(
  dbc: R2DbExecutor,
  sourceTable: string,
  sourceIds: readonly string[],
): Promise<void> {
  if (sourceIds.length === 0) return;
  await dbc
    .delete(r2KeyRefs)
    .where(
      and(eq(r2KeyRefs.sourceTable, sourceTable), inArray(r2KeyRefs.sourceId, [...sourceIds])),
    );
}

/** 주어진 키 중 인덱스가 "참조됨"으로 아는 것들의 집합. */
export async function getIndexedReferencedKeys(
  keys: readonly string[],
): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await db
    .select({ key: r2KeyRefs.key })
    .from(r2KeyRefs)
    .where(inArray(r2KeyRefs.key, [...keys]));
  return new Set(rows.map((row) => row.key));
}

/**
 * 소스 테이블 하나를 전량 재추출해 인덱스를 교체한다.
 * 트랜잭션 안에서 해당 source_table 행을 지우고 다시 채운다 — 재생성이지
 * 증분 유지가 아니다.
 *
 * 표면 술어(extraWhere)를 스캔과 동일하게 적용한다 — 인덱스가 스캔보다 넓으면
 * 스캔이라면 허용했을 삭제를 인덱스 히트가 종결 상태로 막아버린다.
 *
 * 주의: 행 전체를 Node 메모리로 가져온다. survey_versions 는 버전 보존 정책
 * 적용 후 약 15MB 이므로 감당 가능하지만, 정리 전(148MB)에 이 경로를 돌리면
 * 안 된다 — 배포 순서상 정리가 먼저다.
 */
async function rebuildSource(source: R2ReferenceSource): Promise<number> {
  const rows = await db.select().from(source.table).where(source.extraWhere);
  const values: Array<{ key: string; sourceTable: string; sourceId: string }> = [];
  for (const row of rows) {
    const id = (row as { id?: string }).id;
    if (!id) continue;
    for (const key of extractR2KeysFromJsonbValue(row)) {
      values.push({ key, sourceTable: source.name, sourceId: id });
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(r2KeyRefs).where(eq(r2KeyRefs.sourceTable, source.name));
    if (values.length > 0) {
      await tx.insert(r2KeyRefs).values(values).onConflictDoNothing();
    }
  });
  return values.length;
}

/** 가변 소스만 재구축 — 일 1회 집행 직전에 돈다. */
export async function rebuildMutableKeyRefs(): Promise<Array<{ table: string; keys: number }>> {
  const results: Array<{ table: string; keys: number }> = [];
  for (const source of MUTABLE_SOURCES) {
    results.push({ table: source.name, keys: await rebuildSource(source) });
  }
  return results;
}

/** 전 소스 재구축 — 월 1회 감사, 그리고 인덱스 최초 채우기. */
export async function rebuildAllKeyRefs(): Promise<Array<{ table: string; keys: number }>> {
  const results: Array<{ table: string; keys: number }> = [];
  for (const source of [...MUTABLE_SOURCES, ...IMMUTABLE_SOURCES]) {
    results.push({ table: source.name, keys: await rebuildSource(source) });
  }
  return results;
}
