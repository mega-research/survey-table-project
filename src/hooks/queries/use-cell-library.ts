'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { orpc } from '@/shared/lib/rpc';

// ========================
// Queries
// ========================

/** 모든 저장된 셀 조회 */
export function useSavedCells() {
  return useQuery(orpc.library.savedCells.list.queryOptions());
}

/** 셀 이름 검색 */
export function useSearchSavedCells(query: string) {
  return useQuery(
    orpc.library.savedCells.search.queryOptions({
      input: { query },
      enabled: query.length > 0,
    }),
  );
}

// ========================
// Mutations
// ========================

/** 셀 저장 */
export function useSaveCell() {
  const queryClient = useQueryClient();

  return useMutation(
    orpc.library.savedCells.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.library.savedCells.key() });
      },
    }),
  );
}

/** 저장된 셀 삭제
 * 컴포넌트 시그니처 유지: mutate(id: string)
 */
export function useDeleteSavedCell() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => orpc.library.savedCells.remove.call({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.library.savedCells.key() });
    },
  });
}

/** 셀 적용 (usageCount 증가 + cell 데이터 반환)
 * 컴포넌트 시그니처 유지: mutateAsync(id: string)
 */
export function useApplySavedCell() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => orpc.library.savedCells.apply.call({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.library.savedCells.key() });
    },
  });
}
