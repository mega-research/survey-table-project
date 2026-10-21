'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { surveyAnchorKeys } from '@/features/survey-builder/queries/use-survey-anchors';
import { client, orpc } from '@/shared/lib/rpc';
import { surveyKeys, surveyListQueryOptions } from '@/shared/lib/survey-list-queries';
import type { Survey } from '@/types/survey';

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
 * 카드 제목 지정 (0140) — 비우면 null 로 가 설문지 제목을 따라간다. 목록 카드가 이 이름을 보이므로
 * 목록 캐시를 접는다. 운영 콘솔 머리는 RSC 라 그 화면에서 바꾸면 호출측이 router.refresh 한다.
 */
export function useSetSurveyCardTitle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { surveyId: string; cardTitle: string | null }) =>
      client.surveyBuilder.surveys.setCardTitle(input),
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
