'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { ListHistoryInput } from '@/features/media/domain/file-cleanup';
import { client, orpc } from '@/shared/lib/rpc';

// ========================
// Query Keys
// ========================
export const fileCleanupKeys = {
  all: ['file-cleanup'] as const,
  pending: () => [...fileCleanupKeys.all, 'pending'] as const,
  history: (status?: string) => [...fileCleanupKeys.all, 'history', status ?? 'all'] as const,
};

/** 이력 필터 상태 — pending 제외 (도메인 스키마에서 파생). */
export type FileCleanupHistoryStatus = NonNullable<ListHistoryInput['status']>;

// ========================
// Queries
// ========================

/**
 * 삭제 대기(pending) 후보 목록
 */
export function useDeletionPending() {
  return useQuery({
    queryKey: fileCleanupKeys.pending(),
    queryFn: () => orpc.media.fileCleanup.listPending.call(),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * 집행 이력 조회 — status 미지정 시 pending 제외 전체
 */
export function useDeletionHistory(status?: FileCleanupHistoryStatus) {
  return useQuery({
    queryKey: fileCleanupKeys.history(status),
    queryFn: () => orpc.media.fileCleanup.listHistory.call(status ? { status } : undefined),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });
}

// ========================
// Mutations
// ========================

/**
 * 대기 후보 개별 취소 — 성공 시 대기/이력 쿼리 모두 무효화
 */
export function useCancelDeletion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client.media.fileCleanup.cancel({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fileCleanupKeys.all });
    },
  });
}
