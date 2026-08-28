'use client';

import { useQuery } from '@tanstack/react-query';

import { orpc } from '@/shared/lib/rpc';

/**
 * 퇴사 처리 화면의 승계 미리보기 (.pen FLOW 9-3, 티켓 19).
 *
 * 모달이 열릴 때만 조회한다 — 사용자 목록의 행마다 미리 당기면 사람 수만큼 설문 전수를
 * 훑는다. 캐시도 짧게 둔다: 제안은 참여자·팀장 구성에 따라 바뀌고, 처리자가 보고 있는
 * 목록이 실제 상태와 어긋나면 서버의 전수 대조에서 거부된다.
 */
export function useSuccessionPreview(userId: string) {
  return useQuery({
    queryKey: ['users', 'succession-preview', userId],
    queryFn: () => orpc.workspace.ownership.successionPreview.call({ userId }),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}
