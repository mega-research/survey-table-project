import 'server-only';

import { inArray } from 'drizzle-orm';

import { db } from '@/db';
import { r2SentKeys } from '@/db/schema';
import { gateR2Key } from '@/lib/r2-lifecycle/key-extract';
import type { R2DbExecutor } from '@/lib/r2-lifecycle/deletion-queue.server';

/**
 * 발송 장부 기록 — append-only. 이미 기록된 키는 무시되어 최초 발송 시각이
 * 보존된다. tmp/* 등 게이트 불통과 키는 기록하지 않는다.
 * 신규 기록된 행 수를 반환한다.
 */
export async function recordSentKeys(
  dbc: R2DbExecutor,
  keys: readonly string[],
): Promise<number> {
  const accepted = new Set<string>();
  for (const raw of keys) {
    const key = gateR2Key(raw);
    if (key) accepted.add(key);
  }
  if (accepted.size === 0) return 0;

  const inserted = await dbc
    .insert(r2SentKeys)
    .values([...accepted].map((key) => ({ key })))
    .onConflictDoNothing({ target: r2SentKeys.key })
    .returning({ key: r2SentKeys.key });
  return inserted.length;
}

/** 주어진 키 중 장부에 있는 것들의 집합. */
export async function getLedgeredKeys(keys: readonly string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await db
    .select({ key: r2SentKeys.key })
    .from(r2SentKeys)
    .where(inArray(r2SentKeys.key, [...keys]));
  return new Set(rows.map((r) => r.key));
}
