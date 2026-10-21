'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { AccessLinkKind, SurveyGuestTab } from '@/shared/contracts/workspace';
import { client, orpc } from '@/shared/lib/rpc';
import { surveyKeys } from '@/shared/lib/survey-list-queries';

/**
 * 설문 접속 링크(외주 실사 링크 · 클라이언트 링크) 쿼리·변경 (ADR-0026·0029, .pen FLOW 10-2).
 *
 * 실사 초대 훅(use-survey-fieldwork)과 캐시를 따로 둔다 — 두 모델이 공존하는 창에서 한 키로
 * 합치면 링크 발급 한 번이 초대 목록까지 다시 당긴다.
 *
 * **비밀번호 평문은 캐시에 두지 않는다.** 조회 응답에 그 값이 없고(서버가 싣지 않는다),
 * 발급·재설정·평문 조회는 전부 mutation 이라 결과가 화면 상태로만 잠깐 머문다. useQuery 로
 * 두면 그 값이 쿼리 캐시에 남아 다른 화면·리렌더에서 되살아난다.
 */
export const surveyAccessLinkKeys = {
  all: [...surveyKeys.all, 'access-link'] as const,
  // 종류가 키에 들어간다 — 한 설문에 외주 링크와 클라이언트 링크가 함께 서므로, 빠지면 두
  // 패널이 서로의 캐시를 덮어 「클라이언트 블록에 외주 링크의 주소가 뜬다」.
  detail: (surveyId: string, kind: AccessLinkKind) =>
    [...surveyAccessLinkKeys.all, surveyId, kind] as const,
};

export function useSurveyAccessLink(surveyId: string, kind: AccessLinkKind) {
  return useQuery({
    queryKey: surveyAccessLinkKeys.detail(surveyId, kind),
    queryFn: () => orpc.workspace.accessLinks.get.call({ surveyId, kind }),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * 발급·재설정·종료 공통 무효화.
 *
 * `onSettled` 인 것은 형제 훅들과 같은 이유다 — 실패의 대부분은 그 사이 상태가 바뀐 경우라
 * (이미 발급됨·이미 종료됨), 성공에만 접으면 화면이 옛 상태를 들고 같은 실패를 반복한다.
 *
 * 설문 목록은 접지 않는다. 링크는 카드에 아무 표식도 만들지 않는다(ADR-0026 — 외주임을 알리는
 * 표시를 두지 않는다).
 */
function useLinkMutation<TInput, TOutput>(fn: (input: TInput) => Promise<TOutput>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: surveyAccessLinkKeys.all });
    },
  });
}

export function useIssueAccessLink() {
  return useLinkMutation((input: { surveyId: string; kind: AccessLinkKind; password?: string }) =>
    client.workspace.accessLinks.issue(input),
  );
}

export function useResetAccessLinkPassword() {
  return useLinkMutation((input: { surveyId: string; kind: AccessLinkKind; password?: string }) =>
    client.workspace.accessLinks.resetPassword(input),
  );
}

export function useCloseAccessLink() {
  return useLinkMutation((input: { surveyId: string; kind: AccessLinkKind }) =>
    client.workspace.accessLinks.close(input),
  );
}

/**
 * 클라이언트 링크의 현황 탭 저장 (ADR-0029) — 종류를 받지 않는다. 탭은 클라이언트 링크의 축이다.
 *
 * 네 값을 통째로 보낸다. 칩 하나만 보내면 두 사람이 다른 칩을 동시에 누를 때 한쪽의 저장이
 * 다른 쪽을 옛 값으로 되돌린다.
 */
export function useSetClientLinkTab() {
  return useLinkMutation((input: { surveyId: string; tab: SurveyGuestTab; enabled: boolean }) =>
    client.workspace.accessLinks.setClientTab(input),
  );
}

/**
 * 평문 비밀번호 조회 — mutation 으로 두는 것이 의도다.
 *
 * 읽기이지만 **부작용이 있다**: 호출 한 줄이 구조화 로그에 남아 「누가 언제 읽었는가」가 된다.
 * useQuery 로 두면 화면이 열릴 때마다 저절로 불려 그 기록이 의미를 잃는다.
 */
export function useRevealAccessLinkPassword() {
  return useMutation({
    mutationFn: (input: { surveyId: string; kind: AccessLinkKind }) =>
      client.workspace.accessLinks.revealPassword(input),
  });
}
