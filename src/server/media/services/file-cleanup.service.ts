import 'server-only';

import type { R2DeletionCandidate } from '@/db/schema';
import {
  cancelDeletionCandidate,
  listDeletionCandidates,
} from '@/server/storage-lifecycle/deletion-queue.server';

import {
  FILE_CLEANUP_HISTORY_STATUSES,
  FILE_CLEANUP_LIST_DEFAULT_LIMIT,
  type CancelDeletionInput,
  type ListHistoryInput,
  type ListPendingInput,
} from '../domain/file-cleanup';

/**
 * file-cleanup 서비스 — server/shared/r2-lifecycle 삭제 큐에 위임하는 얇은 레이어.
 *
 * 인증은 procedure(authed) 미들웨어가 보장하므로 여기서 requireAuth 호출하지 않는다.
 * 목록 갱신 반영은 클라이언트 invalidate 책임(revalidatePath 없음).
 */

/** 삭제 대기(pending) 후보 목록 — registeredAt 내림차순. */
export async function listPending(
  input?: ListPendingInput,
): Promise<R2DeletionCandidate[]> {
  return listDeletionCandidates({
    status: 'pending',
    limit: input?.limit ?? FILE_CLEANUP_LIST_DEFAULT_LIMIT,
  });
}

/** 집행 이력 — status 지정 시 해당 상태만, 생략 시 pending 제외 전체. */
export async function listHistory(
  input?: ListHistoryInput,
): Promise<R2DeletionCandidate[]> {
  return listDeletionCandidates({
    status: input?.status ?? FILE_CLEANUP_HISTORY_STATUSES,
    limit: input?.limit ?? FILE_CLEANUP_LIST_DEFAULT_LIMIT,
  });
}

/** 대기 후보 개별 취소 — 이미 처리된(비 pending) 후보면 false. */
export async function cancel(input: CancelDeletionInput): Promise<boolean> {
  return cancelDeletionCandidate(input.id);
}
