'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { client, orpc } from '@/shared/lib/rpc';

// ========================
// Query Keys
// ========================
export const responseKeys = {
  all: ['responses'] as const,
  lists: () => [...responseKeys.all, 'list'] as const,
  listBySurvey: (surveyId: string) => [...responseKeys.lists(), surveyId] as const,
  completedBySurvey: (surveyId: string) =>
    [...responseKeys.lists(), surveyId, 'completed'] as const,
  details: () => [...responseKeys.all, 'detail'] as const,
  detail: (id: string) => [...responseKeys.details(), id] as const,
  summary: (surveyId: string) => [...responseKeys.all, 'summary', surveyId] as const,
  statistics: (surveyId: string, questionId: string) =>
    [...responseKeys.all, 'statistics', surveyId, questionId] as const,
};

// ========================
// Queries
// ========================

/**
 * 설문별 응답 목록 조회
 */
export function useResponses(surveyId: string | undefined) {
  return useQuery({
    queryKey: responseKeys.listBySurvey(surveyId!),
    queryFn: () => orpc.surveyBuilder.read.responsesBySurvey.call({ surveyId: surveyId! }),
    enabled: !!surveyId,
  });
}

/**
 * 설문별 완료된 응답 목록 조회
 */
export function useCompletedResponses(surveyId: string | undefined) {
  return useQuery({
    queryKey: responseKeys.completedBySurvey(surveyId!),
    queryFn: () => orpc.surveyBuilder.read.completedResponses.call({ surveyId: surveyId! }),
    enabled: !!surveyId,
  });
}

/**
 * 응답 상세 조회. WS-2 IDOR 봉인: 설문 스코프를 함께 전달한다.
 */
export function useResponse(responseId: string | undefined, surveyId: string | undefined) {
  return useQuery({
    queryKey: responseKeys.detail(responseId!),
    queryFn: () =>
      orpc.surveyBuilder.read.responseById.call({
        responseId: responseId!,
        surveyId: surveyId!,
      }),
    enabled: !!responseId && !!surveyId,
  });
}

/**
 * 응답 통계 요약 조회
 */
export function useResponseSummary(surveyId: string | undefined) {
  return useQuery({
    queryKey: responseKeys.summary(surveyId!),
    queryFn: () => orpc.analytics.stats.survey.call({ surveyId: surveyId! }),
    enabled: !!surveyId,
  });
}

/**
 * 질문별 통계 조회
 */
export function useQuestionStatistics(
  surveyId: string | undefined,
  questionId: string | undefined,
) {
  return useQuery({
    queryKey: responseKeys.statistics(surveyId!, questionId!),
    queryFn: () =>
      orpc.analytics.stats.question.call({ surveyId: surveyId!, questionId: questionId! }),
    enabled: !!surveyId && !!questionId,
  });
}

// ========================
// Mutations
// ========================

/**
 * 질문 응답 업데이트
 */
export function useUpdateQuestionResponse() {
  return useMutation({
    mutationFn: ({
      responseId,
      questionId,
      value,
    }: {
      responseId: string;
      questionId: string;
      value: unknown;
    }) => client.surveyResponse.response.updateAnswer({ responseId, questionId, value }),
  });
}

/**
 * 응답 완료
 */
export function useCompleteResponse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (responseId: string) =>
      client.surveyResponse.response.complete({ responseId }),
    onSuccess: (data) => {
      if (!data) return;
      queryClient.invalidateQueries({
        queryKey: responseKeys.listBySurvey(data.surveyId),
      });
      queryClient.invalidateQueries({
        queryKey: responseKeys.completedBySurvey(data.surveyId),
      });
      queryClient.invalidateQueries({
        queryKey: responseKeys.summary(data.surveyId),
      });
    },
  });
}

/**
 * 응답 내보내기 (JSON)
 */
export function useExportResponsesJson() {
  return useMutation({
    mutationFn: (surveyId: string) => orpc.surveyBuilder.read.exportJson.call({ surveyId }),
  });
}

/**
 * 응답 내보내기 (CSV)
 */
export function useExportResponsesCsv() {
  return useMutation({
    mutationFn: (surveyId: string) => orpc.surveyBuilder.read.exportCsv.call({ surveyId }),
  });
}
