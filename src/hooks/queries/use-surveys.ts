'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { SurveyDiffPayload } from '@/features/survey-builder/domain/survey-save';
import { client, orpc } from '@/shared/lib/rpc';
import type { Survey } from '@/types/survey';

// ========================
// Query Keys
// ========================
export const surveyKeys = {
  all: ['surveys'] as const,
  lists: () => [...surveyKeys.all, 'list'] as const,
  list: (filters?: string) => [...surveyKeys.lists(), filters] as const,
  details: () => [...surveyKeys.all, 'detail'] as const,
  detail: (id: string) => [...surveyKeys.details(), id] as const,
  bySlug: (slug: string) => [...surveyKeys.all, 'slug', slug] as const,
};

// ========================
// Queries
// ========================

/**
 * 설문 목록 조회 (요약 정보 포함)
 */
export function useSurveys() {
  return useQuery({
    queryKey: surveyKeys.lists(),
    queryFn: () => orpc.surveyBuilder.read.list.call(),
  });
}

/**
 * 설문 상세 조회 (그룹, 질문 포함)
 */
export function useSurvey(surveyId: string | undefined) {
  return useQuery({
    queryKey: surveyKeys.detail(surveyId!),
    queryFn: () => orpc.surveyBuilder.read.withDetails.call({ surveyId: surveyId! }),
    enabled: !!surveyId,
  });
}

/**
 * 슬러그로 설문 조회
 */
export function useSurveyBySlug(slug: string | undefined) {
  return useQuery({
    queryKey: surveyKeys.bySlug(slug!),
    queryFn: () => orpc.surveyBuilder.publicRead.bySlug.call({ slug: slug! }),
    enabled: !!slug,
  });
}

/**
 * 설문 검색
 */
export function useSearchSurveys(query: string) {
  return useQuery({
    queryKey: surveyKeys.list(query),
    queryFn: () => orpc.surveyBuilder.read.search.call({ query }),
    enabled: query.length > 0,
  });
}

// ========================
// Mutations
// ========================

/**
 * 설문 생성
 */
export function useCreateSurvey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      title: string;
      description?: string;
      slug?: string;
      isPublic?: boolean;
    }) => client.surveyBuilder.surveys.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: surveyKeys.lists() });
    },
  });
}

/**
 * 설문 전체 저장 (설문 + 그룹 + 질문) — 신규 생성 전용
 */
export function useSaveSurvey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (survey: Survey) => client.surveyBuilder.save.saveWithDetails(survey),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: surveyKeys.lists() });
      queryClient.invalidateQueries({ queryKey: surveyKeys.detail(data.surveyId) });
    },
  });
}

/**
 * Diff 기반 설문 저장 (변경분만 전송)
 */
export function useSaveSurveyDiff() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: SurveyDiffPayload) => client.surveyBuilder.save.saveDiff(payload),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: surveyKeys.lists() });
      queryClient.invalidateQueries({ queryKey: surveyKeys.detail(data.surveyId) });
    },
  });
}

/**
 * 설문 업데이트 (기본 정보만)
 */
export function useUpdateSurvey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      surveyId,
      data,
    }: {
      surveyId: string;
      data: Parameters<typeof client.surveyBuilder.surveys.update>[0]['data'];
    }) => client.surveyBuilder.surveys.update({ surveyId, data }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: surveyKeys.lists() });
      queryClient.invalidateQueries({ queryKey: surveyKeys.detail(variables.surveyId) });
    },
  });
}

/**
 * 설문 삭제
 */
export function useDeleteSurvey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (surveyId: string) => client.surveyBuilder.surveys.delete({ surveyId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: surveyKeys.lists() });
    },
  });
}

/**
 * 설문 복제
 */
export function useDuplicateSurvey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (surveyId: string) => client.surveyBuilder.surveys.duplicate({ surveyId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: surveyKeys.lists() });
    },
  });
}
