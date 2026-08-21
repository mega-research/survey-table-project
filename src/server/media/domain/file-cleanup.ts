import * as z from 'zod';

/**
 * file-cleanup 도메인 — R2 유예 삭제 큐의 admin 조회/취소 procedure 입출력 스키마.
 *
 * 범위:
 * - listPending: 삭제 대기(pending) 후보 목록
 * - listHistory: 집행 이력 조회 — status 생략 시 pending 제외 전체
 * - cancel: 대기 후보 개별 취소 (7일 유예 안에 실수 되돌리기)
 *
 * 실제 큐 조작은 server/shared/r2-lifecycle/deletion-queue.server 소관 — 여기는 스키마만 둔다.
 */

/** 전체 후보 상태. */
export const FILE_CLEANUP_STATUSES = [
  'pending',
  'cancelled',
  'kept',
  'deleted',
  'failed',
] as const;

/** 이력에서 조회 가능한 상태 — pending 은 대기 목록(listPending) 전용. */
export const FILE_CLEANUP_HISTORY_STATUSES = [
  'cancelled',
  'kept',
  'deleted',
  'failed',
] as const;

/** 목록 조회 기본/최대 행 수 — admin 화면용 안전 상한. */
export const FILE_CLEANUP_LIST_DEFAULT_LIMIT = 200;
export const FILE_CLEANUP_LIST_MAX_LIMIT = 500;

const LimitSchema = z
  .number()
  .int()
  .min(1)
  .max(FILE_CLEANUP_LIST_MAX_LIMIT)
  .optional();

/** 대기 목록 조회 입력 — limit 만 선택 지정. */
export const ListPendingInput = z.object({ limit: LimitSchema });
export type ListPendingInput = z.infer<typeof ListPendingInput>;

/** 이력 조회 입력 — status 생략 시 pending 제외 전체. */
export const ListHistoryInput = z.object({
  status: z.enum(FILE_CLEANUP_HISTORY_STATUSES).optional(),
  limit: LimitSchema,
});
export type ListHistoryInput = z.infer<typeof ListHistoryInput>;

/** 대기 후보 개별 취소 입력. */
export const CancelDeletionInput = z.object({ id: z.string().uuid() });
export type CancelDeletionInput = z.infer<typeof CancelDeletionInput>;

/** 취소 결과 — 이미 처리된(비 pending) 후보면 false. */
export const CancelDeletionResult = z.boolean();

/** 삭제 후보 행 — db schema R2DeletionCandidate 와 동일 shape (Date 는 RPC 직렬화 유지). */
export const DeletionCandidateRow = z.object({
  id: z.string(),
  key: z.string(),
  // source/status 는 DB text 컬럼(R2DeletionCandidate) 그대로 통과 — enum 으로 잠그면
  // drizzle string 타입과 output 검증이 어긋난다. 화면 라벨은 raw 폴백 맵으로 처리.
  source: z.string(),
  reason: z.string().nullable(),
  status: z.string(),
  registeredAt: z.date(),
  executeAfter: z.date(),
  resolvedAt: z.date().nullable(),
  resultNote: z.string().nullable(),
});
export type DeletionCandidateRow = z.infer<typeof DeletionCandidateRow>;

export const DeletionCandidateList = z.array(DeletionCandidateRow);
