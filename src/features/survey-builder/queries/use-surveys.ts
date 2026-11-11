'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { surveyAnchorKeys } from '@/features/survey-builder/queries/use-survey-anchors';
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
};

// ========================
// Queries
// ========================

/**
 * 설문 목록 조회 (요약 정보 포함)
 */
export function surveyListQueryOptions() {
  return {
    queryKey: surveyKeys.lists(),
    queryFn: () => orpc.surveyBuilder.read.list.call(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  };
}

export function useSurveys() {
  return useQuery(surveyListQueryOptions());
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

// ========================
// Mutations
// ========================

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
      // 질문·그룹이 지워지면 FK 가 그 영역 앵커도 함께 지운다. 다시 읽지 않으면
      // 조사표 탭에 지워진 대상의 사각형이 그대로 남는다.
      queryClient.invalidateQueries({ queryKey: surveyAnchorKeys.list(data.surveyId) });
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
 * 카드 제목(목록 카드에만 쓰는 이름) 바꾸기. 빈 글자 · null 이면 지워서 설문 제목을 따라가게 한다.
 */
export function useSetSurveyListTitle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { surveyId: string; listTitle: string | null }) =>
      client.surveyBuilder.surveys.setListTitle(input),
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
