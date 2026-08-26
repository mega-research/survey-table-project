'use client';

import { useQuery } from '@tanstack/react-query';

import { orpc } from '@/shared/lib/rpc';

/**
 * 현재 세션 사용자 — 내비게이션 노출 판정용.
 *
 * 표시 여부만 정한다. 실제 접근 차단은 페이지(requireSuperadminPage)와
 * procedure(superadmin 베이스)가 하므로, 이 값이 틀려도 데이터는 새지 않는다.
 * 사이드바(티켓 08)가 들어오면 이 훅의 소비처가 그쪽으로 옮겨간다.
 */
export function useCurrentUser() {
  return useQuery({
    queryKey: ['auth', 'current-user'],
    queryFn: () => orpc.auth.getUser.call(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
