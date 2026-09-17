'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { TransferSurveyOwnershipInput } from '@/shared/contracts/workspace-io';
import { client, orpc } from '@/shared/lib/rpc';

import { surveyParticipantKeys } from './use-survey-participants';
import { surveyKeys } from './use-surveys';

/**
 * 소유권 이전 쿼리·변경 (역할 모델 v2 티켓 19, .pen FLOW 4-4).
 *
 * 후보 목록은 모달이 열려 있을 때만 부른다 — 설문 카드마다 미리 당길 이유가 없다.
 */
export function useTransferCandidates(surveyId: string) {
  return useQuery({
    queryKey: [...surveyKeys.detail(surveyId), 'transfer-candidates'],
    queryFn: () => orpc.workspace.ownership.candidates.call({ surveyId }),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * 소유권 이전.
 *
 * 무효화가 넓다 — 이전은 소유자뿐 아니라 **팀까지 움직일 수 있다**(타 팀 참여자에게 넘기면
 * 설문이 그 팀으로 따라가고 그룹은 미분류가 된다). 목록·그룹·참여자 캐시가 전부 옛 값을
 * 들고 있으면 카드가 엉뚱한 팀에 남아 보인다.
 */
export function useTransferSurveyOwnership() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TransferSurveyOwnershipInput) =>
      client.workspace.ownership.transfer(input),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: surveyKeys.all });
      queryClient.invalidateQueries({ queryKey: surveyParticipantKeys.all });
    },
  });
}
