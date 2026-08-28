'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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
 * 설문 목록 조회 — 작업 범위로 좁힌 결과 + 고를 수 있는 범위 (티켓 07).
 *
 * scope 는 화면이 고른 값일 뿐이라 서버가 멤버십으로 다시 판정한다. 응답의 scope 가
 * 요청과 다를 수 있으므로(해산된 팀 등) 화면은 응답 쪽을 정답으로 삼아야 한다.
 */
export function surveyListQueryOptions(scope?: string | null, deleted = false) {
  return {
    // 휴지통은 조회 조건이 다르므로 키가 갈려야 한다 — 같은 키를 쓰면 모드를 오갈 때마다
    // 서로의 캐시를 덮어써 목록이 한 번씩 반대편 내용으로 번쩍인다(티켓 17).
    // 일반 목록의 키는 종전 그대로 둔다(범위 미지정이면 undefined) — 접미사를 늘 붙이면
    // 기존 캐시가 통째로 갈려 아무 이득 없이 첫 진입이 한 번 더 왕복한다.
    queryKey: deleted ? surveyKeys.list(`${scope ?? ''}|deleted`) : surveyKeys.list(scope ?? undefined),
    queryFn: () => orpc.surveyBuilder.read.list.call({ scope: scope ?? null, deleted }),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  };
}

export function useSurveys(scope?: string | null) {
  return useQuery(surveyListQueryOptions(scope));
}

/**
 * 삭제 취소 (티켓 17) — 슈퍼어드민 전용 표면.
 *
 * 휴지통 목록과 일반 목록 **양쪽**을 무효화한다. 복구된 설문은 휴지통에서 빠지고 일반
 * 목록에 나타나므로, 한쪽만 접으면 팀 화면으로 돌아갔을 때 방금 되살린 설문이 없다.
 */
export function useRestoreSurvey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (surveyId: string) => client.surveyBuilder.surveys.restore({ surveyId }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: surveyKeys.lists() });
    },
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
