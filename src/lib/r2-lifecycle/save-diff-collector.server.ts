import 'server-only';

import {
  cancelPendingCandidatesByKeys,
  registerDeletionCandidates,
  type R2DbExecutor,
} from '@/lib/r2-lifecycle/deletion-queue.server';
import {
  diffRemovedR2Keys,
  extractR2KeysFromJsonbValue,
} from '@/lib/r2-lifecycle/key-extract';

/**
 * 저장 경로 공용 마무리 — 쓰기와 같은 트랜잭션에서 호출한다.
 * 1) oldKeys − newKeys 를 'save-diff' 후보로 등록 (빠진 키)
 * 2) newKeys 에 있는 '대기' 후보를 취소 (부활 취소)
 *
 * 같은 편집 세션에서 지웠다 undo 로 복원해 저장하면 old == new 라 diff 에
 * 아예 걸리지 않는다 — 아무것도 등록되지 않는 것이 계약이다.
 */
export async function collectSaveDiffAndRevival(
  dbc: R2DbExecutor,
  input: { oldKeys: readonly string[]; newKeys: readonly string[]; reason: string },
): Promise<void> {
  const removed = diffRemovedR2Keys([...input.oldKeys], [...input.newKeys]);
  if (removed.length > 0) {
    await registerDeletionCandidates(dbc, {
      keys: removed,
      source: 'save-diff',
      reason: input.reason,
    });
  }
  if (input.newKeys.length > 0) {
    await cancelPendingCandidatesByKeys(dbc, input.newKeys);
  }
}

/**
 * 부분 update 경로용 — 비교를 payload 에 존재하는(undefined 아닌) 필드
 * 집합에 한정한다. 미포함 필드는 "빠짐"으로 오판하지 않는다.
 */
export async function collectFieldLimitedSaveDiff(
  dbc: R2DbExecutor,
  input: {
    oldRow: Record<string, unknown>;
    payloadRow: Record<string, unknown>;
    reason: string;
  },
): Promise<void> {
  const fields = Object.keys(input.payloadRow).filter((k) => input.payloadRow[k] !== undefined);
  if (fields.length === 0) return;
  const oldKeys = new Set<string>();
  const newKeys = new Set<string>();
  for (const field of fields) {
    for (const k of extractR2KeysFromJsonbValue(input.oldRow[field])) oldKeys.add(k);
    for (const k of extractR2KeysFromJsonbValue(input.payloadRow[field])) newKeys.add(k);
  }
  await collectSaveDiffAndRevival(dbc, {
    oldKeys: [...oldKeys],
    newKeys: [...newKeys],
    reason: input.reason,
  });
}
