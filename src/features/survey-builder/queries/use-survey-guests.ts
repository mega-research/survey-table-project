'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  AddSurveyGuestInput,
  RemoveSurveyGuestInput,
  SetSurveyGuestTabsInput,
} from '@/shared/contracts/workspace-io';
import { client, orpc } from '@/shared/lib/rpc';

import { surveyKeys } from './use-surveys';

/**
 * 설문 게스트 부여 쿼리·변경 (역할 모델 v2 티켓 21, .pen FLOW 4-2 클라이언트 블록).
 *
 * 참여자 훅(use-survey-participants)과 나란한 구조지만 캐시는 따로 둔다 — 한 키로 합치면
 * 탭 저장 한 번이 참여자 목록까지 다시 당긴다.
 */
export const surveyGuestKeys = {
  all: [...surveyKeys.all, 'guests'] as const,
  list: (surveyId: string) => [...surveyGuestKeys.all, surveyId] as const,
  candidates: (surveyId: string, query: string) =>
    [...surveyGuestKeys.all, surveyId, 'candidates', query] as const,
};

export function useSurveyGuests(surveyId: string) {
  return useQuery({
    queryKey: surveyGuestKeys.list(surveyId),
    queryFn: () => orpc.workspace.guests.list.call({ surveyId }),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });
}

/** 부여 후보 — 모달이 열려 있고 검색어가 있을 때만 조회한다. */
export function useGuestCandidates(surveyId: string, query: string, enabled: boolean) {
  return useQuery({
    queryKey: surveyGuestKeys.candidates(surveyId, query),
    queryFn: () => orpc.workspace.guests.searchCandidates.call({ surveyId, query }),
    enabled,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * 부여 추가·해제·탭 저장 공통 무효화.
 *
 * 참여자와 달리 **설문 목록은 접지 않는다**. 게스트는 내부 설문 목록에 카드를 얻지 않으므로
 * (자기 홈은 `/guest`) 그 캐시가 바뀔 일이 없다 — 접으면 모달을 만질 때마다 목록이 헛돈다.
 *
 * `onSettled` 인 것은 그룹·공유·참여자와 같은 이유다: 실패의 대부분은 그 사이 상태가 바뀐
 * 경우라, 성공에만 접으면 화면이 옛 후보 목록을 들고 같은 실패를 반복한다.
 */
function useGuestMutation<TInput>(fn: (input: TInput) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: surveyGuestKeys.all });
    },
  });
}

export function useAddSurveyGuest() {
  return useGuestMutation<AddSurveyGuestInput>((input) => client.workspace.guests.add(input));
}

export function useSetSurveyGuestTabs() {
  return useGuestMutation<SetSurveyGuestTabsInput>((input) =>
    client.workspace.guests.setTabs(input),
  );
}

export function useRemoveSurveyGuest() {
  return useGuestMutation<RemoveSurveyGuestInput>((input) => client.workspace.guests.remove(input));
}
