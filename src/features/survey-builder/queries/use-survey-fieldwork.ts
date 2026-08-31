'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  AddSurveyFieldworkInput,
  RemoveSurveyFieldworkInput,
} from '@/shared/contracts/workspace-io';
import { client, orpc } from '@/shared/lib/rpc';

import { surveyKeys } from './use-surveys';

/**
 * 설문 실사 초대 쿼리·변경 (역할 모델 v2 티켓 25, .pen FLOW 4-2 실사 블록).
 *
 * 게스트 훅(use-survey-guests)과 나란한 구조지만 캐시는 따로 둔다 — 한 키로 합치면 실사
 * 초대 한 번이 게스트 목록까지 다시 당긴다. 탭 저장이 없어 mutation 은 둘뿐이다.
 */
export const surveyFieldworkKeys = {
  all: [...surveyKeys.all, 'fieldwork'] as const,
  list: (surveyId: string) => [...surveyFieldworkKeys.all, surveyId] as const,
  candidates: (surveyId: string, query: string) =>
    [...surveyFieldworkKeys.all, surveyId, 'candidates', query] as const,
};

export function useSurveyFieldwork(surveyId: string) {
  return useQuery({
    queryKey: surveyFieldworkKeys.list(surveyId),
    queryFn: () => orpc.workspace.fieldwork.list.call({ surveyId }),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });
}

/** 초대 후보 — 모달이 열려 있고 검색어가 있을 때만 조회한다. */
export function useFieldworkCandidates(surveyId: string, query: string, enabled: boolean) {
  return useQuery({
    queryKey: surveyFieldworkKeys.candidates(surveyId, query),
    queryFn: () => orpc.workspace.fieldwork.searchCandidates.call({ surveyId, query }),
    enabled,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * 초대 추가·해제 공통 무효화.
 *
 * 게스트와 같은 이유로 **설문 목록은 접지 않는다** — 실사는 내부 설문 목록에 카드를 얻지
 * 않으므로(자기 홈은 `/fieldwork`) 그 캐시가 바뀔 일이 없다.
 *
 * `onSettled` 인 것도 같다: 실패의 대부분은 그 사이 상태가 바뀐 경우라, 성공에만 접으면
 * 화면이 옛 후보 목록을 들고 같은 실패를 반복한다.
 */
function useFieldworkMutation<TInput>(fn: (input: TInput) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: surveyFieldworkKeys.all });
    },
  });
}

export function useAddSurveyFieldwork() {
  return useFieldworkMutation<AddSurveyFieldworkInput>((input) =>
    client.workspace.fieldwork.add(input),
  );
}

export function useRemoveSurveyFieldwork() {
  return useFieldworkMutation<RemoveSurveyFieldworkInput>((input) =>
    client.workspace.fieldwork.remove(input),
  );
}
