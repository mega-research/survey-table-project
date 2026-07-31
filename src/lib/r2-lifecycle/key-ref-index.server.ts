import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

import { db } from '@/db';
import {
  mailCampaigns,
  mailTemplates,
  questions,
  r2KeyRefs,
  savedCells,
  savedLookups,
  savedQuestions,
  surveys,
  surveyVersions,
} from '@/db/schema';
import type { R2DbExecutor } from '@/lib/r2-lifecycle/deletion-queue.server';
import { extractR2KeysFromJsonbValue, gateR2Key } from '@/lib/r2-lifecycle/key-extract';

/**
 * 일일 전량 재추출 대상. 가변 소스 + 작아서 굳이 증분 처리할 이유가 없는 소스.
 * 2026-07-31 실측 전량 추출 약 5초 (mail_campaigns 는 439kB / 79ms 로 무시 가능).
 *
 * mail_campaigns 는 스냅샷 컬럼이 불변이지만 여기에 둔다 — 크기가 작아 매일
 * 다시 읽어도 비용이 없고, 캠페인 생성 경로마다 기록을 심는 것보다 누락
 * 위험이 없다. 증분 처리가 필요한 것은 survey_versions 뿐이다.
 */
export const MUTABLE_SOURCES: Array<{ name: string; table: PgTable }> = [
  { name: 'surveys', table: surveys },
  { name: 'questions', table: questions },
  { name: 'saved_questions', table: savedQuestions },
  { name: 'saved_cells', table: savedCells },
  { name: 'saved_lookups', table: savedLookups },
  { name: 'mail_templates', table: mailTemplates },
  { name: 'mail_campaigns', table: mailCampaigns },
];

/**
 * 불변 소스 — 삽입 후 참조 키가 바뀌지 않고, 크기가 커서 재추출 비용이 크다.
 * 발행 시 1회 기록하고(Task 11) 다시 읽지 않는다. 이것이 비용의 핵심이다:
 * 148MB 중 130MB 를 차지하는 대형 스냅샷을 두 번 다시 읽지 않는다.
 * 월 1회 감사에서만 전량 재추출한다.
 */
export const IMMUTABLE_SOURCES: Array<{ name: string; table: PgTable }> = [
  { name: 'survey_versions', table: surveyVersions },
];

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
 * 주의: 행 전체를 Node 메모리로 가져온다. survey_versions 는 버전 보존 정책
 * 적용 후 약 15MB 이므로 감당 가능하지만, 정리 전(148MB)에 이 경로를 돌리면
 * 안 된다 — 배포 순서상 정리가 먼저다.
 */
async function rebuildSource(source: { name: string; table: PgTable }): Promise<number> {
  const rows = await db.select().from(source.table);
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
