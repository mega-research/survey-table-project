'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { orpc } from '@/shared/lib/rpc';

// ========================
// Query Keys
// ========================
export const libraryKeys = {
  all: ['library'] as const,
  questions: () => [...libraryKeys.all, 'questions'] as const,
  questionsByCategory: (category: string) =>
    [...libraryKeys.questions(), 'category', category] as const,
  questionsByTag: (tag: string) => [...libraryKeys.questions(), 'tag', tag] as const,
  searchQuestions: (query: string) => [...libraryKeys.questions(), 'search', query] as const,
  recentlyUsed: (limit?: number) => [...libraryKeys.questions(), 'recent', limit] as const,
  mostUsed: (limit?: number) => [...libraryKeys.questions(), 'popular', limit] as const,
  tags: () => [...libraryKeys.all, 'tags'] as const,
  categories: () => [...libraryKeys.all, 'categories'] as const,
};

// ========================
// Queries
// ========================

/**
 * 모든 저장된 질문 조회
 */
export function useSavedQuestions() {
  return useQuery(orpc.library.savedQuestions.list.queryOptions());
}

/**
 * 카테고리별 질문 조회
 */
export function useQuestionsByCategory(category: string | undefined) {
  return useQuery(
    orpc.library.savedQuestions.byCategory.queryOptions({
      input: { category: category! },
      enabled: !!category,
    }),
  );
}

/**
 * 질문 검색
 */
export function useSearchQuestions(query: string) {
  return useQuery(
    orpc.library.savedQuestions.search.queryOptions({
      input: { query },
      enabled: query.length > 0,
    }),
  );
}

/**
 * 최근 사용 질문 조회
 */
export function useRecentlyUsedQuestions(limit?: number) {
  return useQuery(orpc.library.savedQuestions.recentlyUsed.queryOptions({ input: { limit } }));
}

/**
 * 가장 많이 사용된 질문 조회
 */
export function useMostUsedQuestions(limit?: number) {
  return useQuery(orpc.library.savedQuestions.mostUsed.queryOptions({ input: { limit } }));
}

/**
 * 태그별 질문 조회
 */
export function useQuestionsByTag(tag: string | undefined) {
  return useQuery(
    orpc.library.savedQuestions.byTag.queryOptions({
      input: { tag: tag! },
      enabled: !!tag,
    }),
  );
}

/**
 * 모든 태그 조회
 */
export function useAllTags() {
  return useQuery({
    queryKey: libraryKeys.tags(),
    queryFn: () => orpc.surveyBuilder.read.allTags.call(),
  });
}

/**
 * 모든 카테고리 조회
 */
export function useCategories() {
  return useQuery(orpc.library.questionCategories.list.queryOptions());
}

// ========================
// Mutations
// ========================

/**
 * 질문 저장
 */
export function useSaveQuestion() {
  const queryClient = useQueryClient();

  return useMutation(
    orpc.library.savedQuestions.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.library.savedQuestions.key() });
        queryClient.invalidateQueries({ queryKey: libraryKeys.tags() });
      },
    }),
  );
}

/**
 * 저장된 질문 업데이트
 */
export function useUpdateSavedQuestion() {
  const queryClient = useQueryClient();

  return useMutation(
    orpc.library.savedQuestions.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.library.savedQuestions.key() });
        queryClient.invalidateQueries({ queryKey: libraryKeys.tags() });
      },
    }),
  );
}

/**
 * 저장된 질문 삭제
 * 컴포넌트 시그니처 유지: mutate(id: string)
 */
export function useDeleteSavedQuestion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => orpc.library.savedQuestions.remove.call({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.library.savedQuestions.key() });
      // 마지막으로 해당 태그를 보유한 질문을 삭제하면 태그 목록도 갱신되어야 하므로
      // create/update 와 동일하게 파생 tags 키를 함께 무효화한다.
      queryClient.invalidateQueries({ queryKey: libraryKeys.tags() });
    },
  });
}

/**
 * 질문 적용 (복제해서 반환)
 * 컴포넌트 시그니처 유지: mutateAsync(id: string)
 */
export function useApplyQuestion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => orpc.library.savedQuestions.apply.call({ id }),
    onSuccess: () => {
      // usageCount 증가로 인한 캐시 무효화
      queryClient.invalidateQueries({ queryKey: orpc.library.savedQuestions.key() });
    },
  });
}

/**
 * 여러 질문 적용
 * 컴포넌트 시그니처 유지: mutateAsync(ids: string[])
 */
export function useApplyMultipleQuestions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ids: string[]) => orpc.library.savedQuestions.applyMultiple.call({ ids }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.library.savedQuestions.key() });
    },
  });
}

/**
 * 카테고리 생성
 * 컴포넌트 시그니처 유지: mutateAsync({ name, color })
 */
export function useCreateCategory() {
  const queryClient = useQueryClient();

  return useMutation(
    orpc.library.questionCategories.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.library.questionCategories.key() });
      },
    }),
  );
}

/**
 * 카테고리 업데이트
 * 컴포넌트 시그니처 유지: mutate({ id, updates })
 */
export function useUpdateCategory() {
  const queryClient = useQueryClient();

  return useMutation(
    orpc.library.questionCategories.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.library.questionCategories.key() });
      },
    }),
  );
}

/**
 * 카테고리 삭제
 * 컴포넌트 시그니처 유지: mutate(id: string)
 */
export function useDeleteCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => orpc.library.questionCategories.remove.call({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.library.questionCategories.key() });
      // 삭제된 카테고리의 질문들은 서버에서 'custom'으로 재배정되므로 질문 목록도 갱신해야 한다.
      // 저장 질문 쿼리는 oRPC 키([['library','savedQuestions',...], {...}])를 쓰므로
      // 플랫 키 libraryKeys.questions()로는 prefix-match가 되지 않아 무효화가 누락된다.
      queryClient.invalidateQueries({ queryKey: orpc.library.savedQuestions.key() });
    },
  });
}

/**
 * 라이브러리 내보내기
 */
export function useExportLibrary() {
  return useMutation({
    mutationFn: () => orpc.library.transfer.export.call(),
  });
}

/**
 * 라이브러리 가져오기
 */
export function useImportLibrary() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (json: string) => orpc.library.transfer.import.call({ json }),
    onSuccess: () => {
      // import 는 savedQuestions + questionCategories 를 insert 한다.
      // libraryKeys.all(=['library']) 은 oRPC 키 형태([['library',...], {...}])와
      // partialMatchKey 가 string↔array 로 어긋나 무효화되지 않으므로,
      // 다른 mutation 과 동일하게 oRPC key() + 파생 tags 키를 직접 무효화한다.
      queryClient.invalidateQueries({ queryKey: orpc.library.savedQuestions.key() });
      queryClient.invalidateQueries({ queryKey: orpc.library.questionCategories.key() });
      queryClient.invalidateQueries({ queryKey: libraryKeys.tags() });
    },
  });
}

/**
 * 기본 카테고리 초기화
 */
export function useInitializeCategories() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => orpc.library.questionCategories.initializeDefaults.call({}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.library.questionCategories.key() });
    },
  });
}

/**
 * 프리셋 질문 초기화
 */
export function useInitializePresets() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => orpc.library.transfer.initializePresets.call(),
    onSuccess: () => {
      // 저장 질문 쿼리는 oRPC 키([['library','savedQuestions',...], {...}])를 쓰므로
      // 플랫 키 libraryKeys.questions()로는 prefix-match가 되지 않아 무효화가 누락된다.
      queryClient.invalidateQueries({ queryKey: orpc.library.savedQuestions.key() });
    },
  });
}
