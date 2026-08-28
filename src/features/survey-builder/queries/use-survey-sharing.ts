'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { SetSurveyVisibilityInput } from '@/shared/contracts/workspace-io';
import { client } from '@/shared/lib/rpc';
import { surveyGroupKeys } from '@/shared/lib/survey-group-queries';

import { surveyKeys } from './use-surveys';

/**
 * 설문 공개 범위 변경 (역할 모델 v2 티켓 16, .pen FLOW 4-2).
 *
 * 무효화가 목록 하나로 끝나지 않는다. 공개 범위는 **누가 그 설문을 보는가**를 바꾸므로,
 * 사이드바 그룹 트리의 카운트(`listSurveyGroups` 가 「요청자가 볼 수 있는 설문」만 센다)도
 * 함께 움직인다 — 목록만 접으면 카드는 사라졌는데 폴더 숫자는 옛값으로 남는다.
 *
 * `onSettled` 인 것은 그룹 mutation 과 같은 이유다: 실패의 대부분은 그 사이 상태가 바뀐
 * 경우라, 성공에만 접으면 화면이 옛 값을 들고 같은 실패를 반복한다.
 */
export function useSetSurveyVisibility() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SetSurveyVisibilityInput) => client.workspace.sharing.setVisibility(input),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: surveyKeys.lists() });
      queryClient.invalidateQueries({ queryKey: surveyGroupKeys.all });
    },
  });
}
