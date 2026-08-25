import 'server-only';

import * as Sentry from '@sentry/nextjs';

import { logger } from '@/lib/logger';

import {
  fetchDueCandidates,
  isCandidateResolvable,
  resolveCandidate,
} from './deletion-queue';
import { getIndexedReferencedKeys } from './key-ref-index';
import { deleteR2ObjectVerified } from './r2-object-delete';
import { findReferencedKeys } from './reference-scan';
import { getLedgeredKeys } from './sent-ledger';

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
  /** 배치 조회 이후 취소 등으로 상태가 바뀌어 건너뛴 후보 수 */
  skipped: number;
  /** 인덱스는 '참조 없음'이라 했는데 스캔이 참조를 찾은 수 — 위험 방향 드리프트 */
  indexMisses: number;
  /** 참조 재확인이 실패해 아무 후보도 종결하지 못한 배치. 후보는 pending 유지. */
  scanFailed: boolean;
  /** 이 배치가 인덱스 조회를 건너뛰고 전량 스캔으로 처리됐는지 — 호출자가
   * 리빌드 실패 등으로 인덱스를 못 믿겠다고 알려온 경우 true (`options.indexUnusable`). */
  indexUnusable: boolean;
  hasMore: boolean;
}

/**
 * 기한 지난 후보 1배치 집행: ① 발송 장부 히트 → '보존됨' ② 전역 참조 재확인
 * 히트 → '보존됨' ③ 통과 → R2 삭제 + HEAD 검증 → '삭제됨', 오류는 '실패'로
 * 남겨 다음 집행에서 자동 재시도.
 *
 * 배치 조회와 후보 처리 사이에 부활 취소·관리자 취소가 끼어들 수 있다
 * (run 당 최대 1000건이라 창이 분 단위다). 상태가 바뀐 후보는 종결하지 않고
 * 건너뛰며, 삭제 분기는 R2 삭제 **전에** 확인해 취소된 객체를 지우지 않는다.
 *
 * `now` 는 실행(run) 시작 시각 — fetchDueCandidates 가 이 시각 이후 실패한
 * 행을 재집기하지 않아 같은 run 안의 즉시 재시도 루프를 막는다.
 *
 * `options.indexUnusable` 이 true 면 인덱스 조회 자체를 생략하고 장부 통과분
 * 전량을 스캔으로 넘긴다 — 리빌드가 실패해 인덱스가 그날 갱신되지 않았을 때
 * (예: 결정적 원인으로 매일 반복) stale 인덱스 히트가 후보를 '보존됨'으로
 * 영구 종결하는 것을 막기 위함. 스캔이 유일한 삭제 권한이라 정확도 손실은
 * 없고 스캔량만 늘어난다.
 */
export async function executeDueDeletionBatch(
  limit = R2_EXECUTOR_BATCH_SIZE,
  now = new Date(),
  options?: { indexUnusable?: boolean },
): Promise<DeletionBatchResult> {
  const due = await fetchDueCandidates(limit, now);
  const indexUnusable = options?.indexUnusable ?? false;
  const result: DeletionBatchResult = {
    processed: due.length,
    keptLedger: 0,
    keptIndexed: 0,
    keptReferenced: 0,
    deleted: 0,
    failed: 0,
    skipped: 0,
    indexMisses: 0,
    scanFailed: false,
    indexUnusable,
    hasMore: due.length === limit,
  };
  if (due.length === 0) return result;

  const keys = [...new Set(due.map((c) => c.key))];
  const ledgered = await getLedgeredKeys(keys);
  const afterLedger = keys.filter((k) => !ledgered.has(k));

  // 파생 인덱스는 사전 필터다 — '참조됨'으로 스캔을 생략시킬 수는 있으나
  // '참조 없음'으로 삭제를 결정하지는 못한다. 최종 판정은 콘텐츠 스캔이며,
  // 따라서 인덱스 드리프트는 과보존 방향으로만 작용한다 (spec 6.3).
  // 인덱스 조회 자체가 실패해도(테이블 부재·타임아웃 등) 인덱스는 삭제 권한이
  // 없으므로 빈 결과로 취급하고 전량 스캔으로 낮춰 진행한다 — 정지시키지 않는다.
  // 호출자가 이미 인덱스를 못 믿겠다고 알려온 경우(indexUnusable) 조회 자체를
  // 생략한다 — stale 한 리빌드 실패 인덱스를 조회해봐야 같은 결론이다.
  let indexed: Set<string>;
  if (indexUnusable) {
    indexed = new Set<string>();
  } else {
    try {
      indexed = await getIndexedReferencedKeys(afterLedger);
    } catch (error) {
      logger.error({ err: error }, 'r2 참조 인덱스 조회 실패 — 전량 스캔으로 대체');
      Sentry.captureException(error, {
        tags: { operation: 'r2_key_ref_index' },
        extra: { keyCount: afterLedger.length },
        level: 'warning',
      });
      indexed = new Set<string>();
    }
  }
  const toScan = afterLedger.filter((k) => !indexed.has(k));
  // 판정 불능은 보존으로 귀결한다 — 스캔이 실패하면 아무것도 삭제하지 않고
  // 후보를 pending 으로 남긴 채 배치를 정상 종료한다. 예외를 그대로 던지면
  // Inngest step 이 실패해 재시도까지 실패하며 집행 전체가 정지한다.
  let referenced: Set<string>;
  try {
    referenced = toScan.length > 0 ? await findReferencedKeys(toScan) : new Set<string>();
  } catch (error) {
    logger.error({ err: error }, 'r2 참조 재확인 실패 — 배치 보류');
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
      skipped: 0,
      indexMisses: 0,
      scanFailed: true,
      indexUnusable,
      hasMore: false,
    };
  }

  // 스캔 대상은 인덱스가 '참조 없음'이라 한 키뿐이므로, 스캔이 찾은 것은
  // 정의상 전부 인덱스 누락이다. 위험 방향(누락 → 삭제 가능)이라 보고한다.
  if (referenced.size > 0) {
    result.indexMisses = referenced.size;
    logger.warn({ keys: [...referenced] }, 'r2 참조 인덱스 누락 감지');
    Sentry.captureMessage('r2 참조 인덱스 누락', {
      level: 'warning',
      tags: { operation: 'r2_key_ref_index' },
      extra: { keys: [...referenced] },
    });
  }

  /** 상태 가드에 막히면(= 그 사이 취소됨) 종결 대신 건너뜀으로 회계한다. */
  const resolve = async (
    candidateId: string,
    status: 'kept' | 'deleted' | 'failed',
    note: string,
  ): Promise<boolean> => {
    if (await resolveCandidate(candidateId, status, note)) return true;
    result.skipped += 1;
    return false;
  };

  for (const candidate of due) {
    if (ledgered.has(candidate.key)) {
      if (await resolve(candidate.id, 'kept', '발송 장부 보호 — 발송된 메일이 참조')) {
        result.keptLedger += 1;
      }
    } else if (indexed.has(candidate.key)) {
      if (await resolve(candidate.id, 'kept', '참조 인덱스에서 참조 발견')) {
        result.keptIndexed += 1;
      }
    } else if (referenced.has(candidate.key)) {
      if (await resolve(candidate.id, 'kept', '전역 참조 재확인에서 참조 발견')) {
        result.keptReferenced += 1;
      }
    } else if (!(await isCandidateResolvable(candidate.id))) {
      // 배치 조회 이후 취소된 후보 — R2 삭제는 되돌릴 수 없으므로 지우지 않는다.
      result.skipped += 1;
    } else {
      const deletion = await deleteR2ObjectVerified(candidate.key);
      if (deletion.ok) {
        if (await resolve(candidate.id, 'deleted', 'R2 삭제 후 HEAD 검증 완료')) {
          result.deleted += 1;
        }
      } else if (await resolve(candidate.id, 'failed', deletion.error)) {
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
  skipped: number;
  indexMisses: number;
  scanFailures: number;
  /** 인덱스 조회를 건너뛰고 처리된 배치 수 — run 전체 그대로면 batches 와 같다.
   * 0 이 아니면 이 run 은 인덱스 없이(=스캔 전량) 돌았다는 뜻이라 회계에서
   * 드러나야 한다 (options.indexUnusable). */
  indexUnusableBatches: number;
}

/**
 * step 커서 분할 실행 — 배치당 step.run 하나로 Vercel 단일 실행 시간한도를
 * 피한다. hasMore=false 또는 maxBatches 도달 시 종료(백스톱).
 *
 * `options.indexUnusable` 은 호출자(예: 당일 인덱스 리빌드 실패한 cron)가
 * 이번 run 의 인덱스를 못 믿겠다고 알리는 신호다 — 모든 배치에 그대로
 * 전달되어 인덱스 조회를 생략시킨다.
 */
export async function runDeletionExecutor(
  step: DeletionExecutorStep,
  options?: { batchSize?: number; maxBatches?: number; now?: Date; indexUnusable?: boolean },
): Promise<DeletionExecutorTotals> {
  const batchSize = options?.batchSize ?? R2_EXECUTOR_BATCH_SIZE;
  const maxBatches = options?.maxBatches ?? R2_EXECUTOR_MAX_BATCHES;
  const startedAt = options?.now ?? new Date();
  const indexUnusable = options?.indexUnusable ?? false;
  const totals: DeletionExecutorTotals = {
    batches: 0,
    processed: 0,
    keptLedger: 0,
    keptIndexed: 0,
    keptReferenced: 0,
    deleted: 0,
    failed: 0,
    skipped: 0,
    indexMisses: 0,
    scanFailures: 0,
    indexUnusableBatches: 0,
  };

  for (let i = 0; i < maxBatches; i++) {
    const batch = await step.run(`execute-batch-${i}`, () =>
      executeDueDeletionBatch(batchSize, startedAt, { indexUnusable }),
    );
    totals.batches += 1;
    totals.processed += batch.processed;
    totals.keptLedger += batch.keptLedger;
    totals.keptIndexed += batch.keptIndexed;
    totals.keptReferenced += batch.keptReferenced;
    totals.deleted += batch.deleted;
    totals.failed += batch.failed;
    totals.skipped += batch.skipped;
    totals.indexMisses += batch.indexMisses;
    if (batch.scanFailed) totals.scanFailures += 1;
    if (batch.indexUnusable) totals.indexUnusableBatches += 1;
    if (!batch.hasMore) break;
  }

  // 배치 조회 이후 취소 경합으로 건너뛴 후보가 있으면 run 당 1회만 알린다
  // (배치마다 울리면 같은 경합의 소음이 반복된다). 인덱스 누락과 같은 관례
  // (captureMessage, warning, 태그+수치) 를 따른다.
  if (totals.skipped > 0) {
    logger.warn({ skipped: totals.skipped }, 'r2 삭제 후보 취소 경합 감지');
    Sentry.captureMessage('r2 삭제 후보 취소 경합', {
      level: 'warning',
      tags: { operation: 'r2_deletion_candidate_race' },
      extra: { skipped: totals.skipped },
    });
  }

  return totals;
}
