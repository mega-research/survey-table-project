import 'server-only';

import * as Sentry from '@sentry/nextjs';

import {
  fetchDueCandidates,
  resolveCandidate,
} from '@/lib/r2-lifecycle/deletion-queue.server';
import { getIndexedReferencedKeys } from '@/lib/r2-lifecycle/key-ref-index.server';
import { deleteR2ObjectVerified } from '@/lib/r2-lifecycle/r2-object-delete.server';
import { findReferencedKeys } from '@/lib/r2-lifecycle/reference-scan.server';
import { getLedgeredKeys } from '@/lib/r2-lifecycle/sent-ledger.server';

/**
 * 배치 크기 — 참조 재확인 비용이 `패턴 수 × 스캔 표면 크기` 라서 키 수에
 * 비례한다. 2026-07-31 실측: 148MB 표면 기준 100패턴 136.7초(타임아웃),
 * 5패턴 약 18초. 버전 보존 정책·파생 인덱스 적용 후 상향 재조정 대상.
 */
export const R2_EXECUTOR_BATCH_SIZE = 5;
/** run 당 처리 상한 5×200=1000건. 일일 후보 발생량이 이에 못 미치고 미처리분은 다음 run 으로 이월된다. */
export const R2_EXECUTOR_MAX_BATCHES = 200;

export interface DeletionBatchResult {
  processed: number;
  keptLedger: number;
  /** 파생 인덱스 히트로 스캔 없이 보존된 키 수 */
  keptIndexed: number;
  keptReferenced: number;
  deleted: number;
  failed: number;
  /** 인덱스는 '참조 없음'이라 했는데 스캔이 참조를 찾은 수 — 위험 방향 드리프트 */
  indexMisses: number;
  /** 참조 재확인이 실패해 아무 후보도 종결하지 못한 배치. 후보는 pending 유지. */
  scanFailed: boolean;
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
    keptIndexed: 0,
    keptReferenced: 0,
    deleted: 0,
    failed: 0,
    indexMisses: 0,
    scanFailed: false,
    hasMore: due.length === limit,
  };
  if (due.length === 0) return result;

  const keys = [...new Set(due.map((c) => c.key))];
  const ledgered = await getLedgeredKeys(keys);
  const afterLedger = keys.filter((k) => !ledgered.has(k));

  // 파생 인덱스는 사전 필터다 — '참조됨'으로 스캔을 생략시킬 수는 있으나
  // '참조 없음'으로 삭제를 결정하지는 못한다. 최종 판정은 콘텐츠 스캔이며,
  // 따라서 인덱스 드리프트는 과보존 방향으로만 작용한다 (spec 6.3).
  const indexed = await getIndexedReferencedKeys(afterLedger);
  const toScan = afterLedger.filter((k) => !indexed.has(k));
  // 판정 불능은 보존으로 귀결한다 — 스캔이 실패하면 아무것도 삭제하지 않고
  // 후보를 pending 으로 남긴 채 배치를 정상 종료한다. 예외를 그대로 던지면
  // Inngest step 이 실패해 재시도까지 실패하며 집행 전체가 정지한다.
  let referenced: Set<string>;
  try {
    referenced = toScan.length > 0 ? await findReferencedKeys(toScan) : new Set<string>();
  } catch (error) {
    console.error('r2 참조 재확인 실패 — 배치 보류:', error);
    Sentry.captureException(error, {
      tags: { operation: 'r2_reference_scan' },
      extra: { keyCount: toScan.length },
      level: 'warning',
    });
    return {
      processed: 0,
      keptLedger: 0,
      keptIndexed: 0,
      keptReferenced: 0,
      deleted: 0,
      failed: 0,
      indexMisses: 0,
      scanFailed: true,
      hasMore: false,
    };
  }

  // 스캔 대상은 인덱스가 '참조 없음'이라 한 키뿐이므로, 스캔이 찾은 것은
  // 정의상 전부 인덱스 누락이다. 위험 방향(누락 → 삭제 가능)이라 보고한다.
  if (referenced.size > 0) {
    result.indexMisses = referenced.size;
    console.warn('r2 참조 인덱스 누락 감지:', [...referenced]);
    Sentry.captureMessage('r2 참조 인덱스 누락', {
      level: 'warning',
      tags: { operation: 'r2_key_ref_index' },
      extra: { keys: [...referenced] },
    });
  }

  for (const candidate of due) {
    if (ledgered.has(candidate.key)) {
      await resolveCandidate(candidate.id, 'kept', '발송 장부 보호 — 발송된 메일이 참조');
      result.keptLedger += 1;
    } else if (indexed.has(candidate.key)) {
      await resolveCandidate(candidate.id, 'kept', '참조 인덱스에서 참조 발견');
      result.keptIndexed += 1;
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
  keptIndexed: number;
  keptReferenced: number;
  deleted: number;
  failed: number;
  indexMisses: number;
  scanFailures: number;
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
    keptIndexed: 0,
    keptReferenced: 0,
    deleted: 0,
    failed: 0,
    indexMisses: 0,
    scanFailures: 0,
  };

  for (let i = 0; i < maxBatches; i++) {
    const batch = await step.run(`execute-batch-${i}`, () =>
      executeDueDeletionBatch(batchSize, startedAt),
    );
    totals.batches += 1;
    totals.processed += batch.processed;
    totals.keptLedger += batch.keptLedger;
    totals.keptIndexed += batch.keptIndexed;
    totals.keptReferenced += batch.keptReferenced;
    totals.deleted += batch.deleted;
    totals.failed += batch.failed;
    totals.indexMisses += batch.indexMisses;
    if (batch.scanFailed) totals.scanFailures += 1;
    if (!batch.hasMore) break;
  }
  return totals;
}
