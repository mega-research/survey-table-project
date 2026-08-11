import 'server-only';

import { and, inArray, isNotNull } from 'drizzle-orm';

import { surveyVersions } from '@/db/schema';
import {
  registerDeletionCandidates,
  type R2DbExecutor,
} from '@/lib/r2-lifecycle/deletion-queue.server';
import { extractR2KeysFromJsonbValue } from '@/lib/r2-lifecycle/key-extract';
import { deleteKeyRefsBySourceIds } from '@/lib/r2-lifecycle/key-ref-index.server';

export interface PruneVersionsResult {
  /** snapshot 을 실제로 비운 버전 수 */
  pruned: number;
  /** 유예 큐에 신규 등록된 키 수 */
  registeredKeys: number;
}

/**
 * 버전 스냅샷 정리 — snapshot 을 NULL 로 비우고 그 스냅샷이 참조하던 R2 키를
 * 유예 삭제 큐에 등록한다.
 *
 * 반드시 같은 트랜잭션(dbc)에서 원자적으로 수행한다: 등록 없이 비우면 참조를
 * 복원할 수 없어 R2 고아 객체가 영구히 남는다. 등록되는 키 대부분은 현재
 * 발행본과 공유되므로 집행 시 '보존됨'으로 종결될 것이다 — 등록은 회계의
 * 정확성을 위한 것이지 실제 삭제를 기대하는 것이 아니다.
 *
 * 같은 트랜잭션에서 해당 버전의 파생 참조 인덱스 행도 지운다. 비우기와
 * 인덱스 해제는 한 동작이다 — 남겨두면 정리된 버전이 인덱스를 통해 참조를
 * 계속 주장하고, 인덱스 히트는 후보를 종결 상태('보존됨')로 닫아 재시도
 * 경로 없이 삭제를 영구히 막는다.
 */
export async function pruneVersionSnapshots(
  dbc: R2DbExecutor,
  versionIds: readonly string[],
  reason: string,
): Promise<PruneVersionsResult> {
  if (versionIds.length === 0) return { pruned: 0, registeredKeys: 0 };

  const rows = await dbc
    .select({ id: surveyVersions.id, snapshot: surveyVersions.snapshot })
    .from(surveyVersions)
    .where(
      and(inArray(surveyVersions.id, [...versionIds]), isNotNull(surveyVersions.snapshot)),
    );
  if (rows.length === 0) return { pruned: 0, registeredKeys: 0 };

  const keys = new Set<string>();
  for (const row of rows) {
    for (const key of extractR2KeysFromJsonbValue(row.snapshot)) keys.add(key);
  }

  let registeredKeys = 0;
  if (keys.size > 0) {
    const registered = await registerDeletionCandidates(dbc, {
      keys: [...keys],
      source: 'version-prune',
      reason,
    });
    registeredKeys = registered.registered;
  }

  const updated = await dbc
    .update(surveyVersions)
    .set({ snapshot: null, prunedAt: new Date() })
    .where(
      and(
        inArray(
          surveyVersions.id,
          rows.map((row) => row.id),
        ),
        isNotNull(surveyVersions.snapshot),
      ),
    )
    .returning({ id: surveyVersions.id });

  await deleteKeyRefsBySourceIds(
    dbc,
    'survey_versions',
    updated.map((row) => row.id),
  );

  return { pruned: updated.length, registeredKeys };
}
