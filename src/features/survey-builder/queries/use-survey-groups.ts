'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  CollectSurveysIntoGroupInput,
  CreateSurveyGroupInput,
  MoveSurveyToGroupInput,
  RenameSurveyGroupInput,
  ReorderSurveyGroupsInput,
} from '@/shared/contracts/workspace-io';
import { client, orpc } from '@/shared/lib/rpc';
import { surveyGroupKeys, surveyGroupListQueryOptions } from '@/shared/lib/survey-group-queries';

import { surveyKeys } from './use-surveys';

/**
 * 설문 그룹 쿼리·변경 (역할 모델 v2 티켓 12, .pen FLOW 2).
 *
 * 키와 목록 조회 옵션은 `@/shared/lib/survey-group-queries` 가 소유한다 — 사이드바 트리
 * (workspace 묶음)도 같은 목록을 보는데 feature 끼리 직접 import 할 수 없기 때문이다.
 * 변경은 설문 목록 캐시도 함께 접어야 해서 여기(그 키의 주인 옆)에 산다.
 */
export function useSurveyGroups(teamId: string | null) {
  return useQuery(surveyGroupListQueryOptions(teamId));
}

/** 「설문 담기」 후보 — 모달이 열려 있을 때만 조회한다. */
export function useUngroupedSurveys(teamId: string | null, query: string, enabled: boolean) {
  return useQuery({
    queryKey: surveyGroupKeys.ungrouped(teamId ?? '', query),
    queryFn: () =>
      orpc.workspace.surveyGroups.listUngrouped.call({ teamId: teamId as string, query }),
    enabled: enabled && Boolean(teamId),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * 그룹 구조·소속을 바꾸는 mutation 공통 무효화.
 *
 * 그룹 목록(카운트)과 설문 목록(카드의 소속 그룹)이 함께 움직인다 — 한쪽만 접으면 담기
 * 직후 카드가 아직 미분류로 보이거나 그룹 카운트가 옛 값으로 남는다.
 *
 * `onSettled` 인 것이 중요하다. 실패의 대부분은 CONFLICT — 그 사이 누가 같은 설문을 옮겨
 * "미분류 설문만" 조건이 깨진 경우다. 성공에만 무효화하면 화면은 옛 후보 목록을 그대로 들고
 * 있어 다시 눌러도 같은 실패가 반복되고, staleTime·refetchOnWindowFocus:false 때문에 모달을
 * 닫았다 여는 것 말고는 회복 경로가 없다.
 */
function useSurveyGroupMutation<TInput, TResult>(fn: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: surveyGroupKeys.all });
      queryClient.invalidateQueries({ queryKey: surveyKeys.lists() });
    },
  });
}

export function useCreateSurveyGroup() {
  return useSurveyGroupMutation((input: CreateSurveyGroupInput) =>
    client.workspace.surveyGroups.create(input),
  );
}

export function useRenameSurveyGroup() {
  return useSurveyGroupMutation((input: RenameSurveyGroupInput) =>
    client.workspace.surveyGroups.rename(input),
  );
}

export function useReorderSurveyGroups() {
  return useSurveyGroupMutation((input: ReorderSurveyGroupsInput) =>
    client.workspace.surveyGroups.reorder(input),
  );
}

export function useRemoveSurveyGroup() {
  return useSurveyGroupMutation((groupId: string) =>
    client.workspace.surveyGroups.remove({ groupId }),
  );
}

export function useCollectSurveysIntoGroup() {
  return useSurveyGroupMutation((input: CollectSurveysIntoGroupInput) =>
    client.workspace.surveyGroups.collect(input),
  );
}

export function useMoveSurveyToGroup() {
  return useSurveyGroupMutation((input: MoveSurveyToGroupInput) =>
    client.workspace.surveyGroups.move(input),
  );
}
