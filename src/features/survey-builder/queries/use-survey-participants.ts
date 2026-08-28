'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  AddSurveyParticipantInput,
  RemoveSurveyParticipantInput,
} from '@/shared/contracts/workspace-io';
import { client, orpc } from '@/shared/lib/rpc';

import { surveyKeys } from './use-surveys';

/**
 * 설문 참여자 쿼리·변경 (역할 모델 v2 티켓 18, .pen FLOW 4-2).
 *
 * 키를 설문 상세 아래에 두는 이유는 참여가 **설문에 딸린 사실**이기 때문이다 — 사용자 축에
 * 두면 같은 목록이 사람 수만큼 갈린다.
 */
export const surveyParticipantKeys = {
  all: [...surveyKeys.all, 'participants'] as const,
  list: (surveyId: string) => [...surveyParticipantKeys.all, surveyId] as const,
  candidates: (surveyId: string, query: string) =>
    [...surveyParticipantKeys.all, surveyId, 'candidates', query] as const,
};

export function useSurveyParticipants(surveyId: string) {
  return useQuery({
    queryKey: surveyParticipantKeys.list(surveyId),
    queryFn: () => orpc.workspace.participants.list.call({ surveyId }),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });
}

/** 초대 후보 — 모달이 열려 있고 검색어가 있을 때만 조회한다(전 사용자 명부를 미리 안 당긴다). */
export function useParticipantCandidates(surveyId: string, query: string, enabled: boolean) {
  return useQuery({
    queryKey: surveyParticipantKeys.candidates(surveyId, query),
    queryFn: () => orpc.workspace.participants.searchCandidates.call({ surveyId, query }),
    enabled,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * 참여자 추가·제외 공통 무효화.
 *
 * 참여자 목록뿐 아니라 **설문 목록**도 접는다 — 초대는 그 사람의 목록에 카드를 더하고
 * 카드의 버튼 노출 근사(`isParticipant`)도 함께 바뀐다. 제외한 사람이 자기 목록에서 그
 * 카드를 잃는 것은 다음 조회 때다(그쪽 브라우저의 캐시까지는 접을 수 없다 — 강제는 서버 관문).
 *
 * `onSettled` 인 것은 그룹·공유와 같은 이유다: 실패의 대부분은 그 사이 상태가 바뀐 경우라,
 * 성공에만 접으면 화면이 옛 후보 목록을 들고 같은 실패를 반복한다.
 */
function useParticipantMutation<TInput>(fn: (input: TInput) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      // `all` 접두가 목록과 후보 캐시를 함께 접는다 — 목록만 따로 부르면 그 줄이 흡수된다.
      queryClient.invalidateQueries({ queryKey: surveyParticipantKeys.all });
      queryClient.invalidateQueries({ queryKey: surveyKeys.lists() });
    },
  });
}

export function useAddSurveyParticipant() {
  return useParticipantMutation<AddSurveyParticipantInput>((input) =>
    client.workspace.participants.add(input),
  );
}

export function useRemoveSurveyParticipant() {
  return useParticipantMutation<RemoveSurveyParticipantInput>((input) =>
    client.workspace.participants.remove(input),
  );
}
