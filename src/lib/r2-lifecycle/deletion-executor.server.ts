import 'server-only';

import {
  fetchDueCandidates,
  resolveCandidate,
} from '@/lib/r2-lifecycle/deletion-queue.server';
import { deleteR2ObjectVerified } from '@/lib/r2-lifecycle/r2-object-delete.server';
import { findReferencedKeys } from '@/lib/r2-lifecycle/reference-scan.server';
import { getLedgeredKeys } from '@/lib/r2-lifecycle/sent-ledger.server';

export const R2_EXECUTOR_BATCH_SIZE = 100;
export const R2_EXECUTOR_MAX_BATCHES = 50;

export interface DeletionBatchResult {
  processed: number;
  keptLedger: number;
  keptReferenced: number;
  deleted: number;
  failed: number;
  hasMore: boolean;
}

/**
 * 기한 지난 후보 1배치 집행: ① 발송 장부 히트 → '보존됨' ② 전역 참조 재확인
 * 히트 → '보존됨' ③ 통과 → R2 삭제 + HEAD 검증 → '삭제됨', 오류는 '실패'로
 * 남겨 다음 집행에서 자동 재시도.
 *
 * `now` 는 실행(run) 시작 시각 — fetchDueCandidates 가 이 시각 이후 실패한
 * 행을 재집기하지 않아 같은 run 안의 즉시 재시도 루프를 막는다.
 */
export async function executeDueDeletionBatch(
  limit = R2_EXECUTOR_BATCH_SIZE,
  now = new Date(),
): Promise<DeletionBatchResult> {
  const due = await fetchDueCandidates(limit, now);
  const result: DeletionBatchResult = {
    processed: due.length,
    keptLedger: 0,
    keptReferenced: 0,
    deleted: 0,
    failed: 0,
    hasMore: due.length === limit,
  };
  if (due.length === 0) return result;

  const keys = [...new Set(due.map((c) => c.key))];
  const ledgered = await getLedgeredKeys(keys);
  const toScan = keys.filter((k) => !ledgered.has(k));
  const referenced = toScan.length > 0 ? await findReferencedKeys(toScan) : new Set<string>();

  for (const candidate of due) {
    if (ledgered.has(candidate.key)) {
      await resolveCandidate(candidate.id, 'kept', '발송 장부 보호 — 발송된 메일이 참조');
      result.keptLedger += 1;
    } else if (referenced.has(candidate.key)) {
      await resolveCandidate(candidate.id, 'kept', '전역 참조 재확인에서 참조 발견');
      result.keptReferenced += 1;
    } else {
      const deletion = await deleteR2ObjectVerified(candidate.key);
      if (deletion.ok) {
        await resolveCandidate(candidate.id, 'deleted', 'R2 삭제 후 HEAD 검증 완료');
        result.deleted += 1;
      } else {
        await resolveCandidate(candidate.id, 'failed', deletion.error);
        result.failed += 1;
      }
    }
  }
  return result;
}

/**
 * Inngest step 의 좁은 주입 interface — 테스트에서 fake step 으로 대체.
 * 배치 결과는 JSON-플레인(숫자·불리언)이라 inngest 의 Jsonify 반환과 구조
 * 동일 — 비제네릭 시그니처로 두면 실제 step 이 캐스트 없이 대입된다.
 */
export interface DeletionExecutorStep {
  run(id: string, fn: () => Promise<DeletionBatchResult>): Promise<DeletionBatchResult>;
}

export interface DeletionExecutorTotals {
  batches: number;
  processed: number;
  keptLedger: number;
  keptReferenced: number;
  deleted: number;
  failed: number;
}

/**
 * step 커서 분할 실행 — 배치당 step.run 하나로 Vercel 단일 실행 시간한도를
 * 피한다. hasMore=false 또는 maxBatches 도달 시 종료(백스톱).
 */
export async function runDeletionExecutor(
  step: DeletionExecutorStep,
  options?: { batchSize?: number; maxBatches?: number; now?: Date },
): Promise<DeletionExecutorTotals> {
  const batchSize = options?.batchSize ?? R2_EXECUTOR_BATCH_SIZE;
  const maxBatches = options?.maxBatches ?? R2_EXECUTOR_MAX_BATCHES;
  const startedAt = options?.now ?? new Date();
  const totals: DeletionExecutorTotals = {
    batches: 0,
    processed: 0,
    keptLedger: 0,
    keptReferenced: 0,
    deleted: 0,
    failed: 0,
  };

  for (let i = 0; i < maxBatches; i++) {
    const batch = await step.run(`execute-batch-${i}`, () =>
      executeDueDeletionBatch(batchSize, startedAt),
    );
    totals.batches += 1;
    totals.processed += batch.processed;
    totals.keptLedger += batch.keptLedger;
    totals.keptReferenced += batch.keptReferenced;
    totals.deleted += batch.deleted;
    totals.failed += batch.failed;
    if (!batch.hasMore) break;
  }
  return totals;
}
