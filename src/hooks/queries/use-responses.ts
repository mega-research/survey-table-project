'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  exportResponsesAsCsv,
  exportResponsesAsJson,
  getCompletedResponses,
  getResponseById,
  getResponsesBySurvey,
} from '@/actions/query-actions';
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
    queryFn: () => getResponsesBySurvey(surveyId!),
    enabled: !!surveyId,
  });
}

/**
 * 설문별 완료된 응답 목록 조회
 */
export function useCompletedResponses(surveyId: string | undefined) {
  return useQuery({
    queryKey: responseKeys.completedBySurvey(surveyId!),
    queryFn: () => getCompletedResponses(surveyId!),
    enabled: !!surveyId,
  });
}

/**
 * 응답 상세 조회
 */
export function useResponse(responseId: string | undefined) {
  return useQuery({
    queryKey: responseKeys.detail(responseId!),
    queryFn: () => getResponseById(responseId!),
    enabled: !!responseId,
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
 * 응답 시작
 */
export function useStartResponse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ surveyId, sessionId }: { surveyId: string; sessionId?: string }) =>
      client.surveyResponse.response.start({ surveyId, sessionId }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: responseKeys.listBySurvey(variables.surveyId),
      });
    },
  });
}

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
    mutationFn: (surveyId: string) => exportResponsesAsJson(surveyId),
  });
}

/**
 * 응답 내보내기 (CSV)
 */
export function useExportResponsesCsv() {
  return useMutation({
    mutationFn: (surveyId: string) => exportResponsesAsCsv(surveyId),
  });
}
