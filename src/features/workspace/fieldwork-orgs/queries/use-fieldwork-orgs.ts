'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  ArchiveFieldworkOrgInput,
  CreateFieldworkOrgInput,
  UpdateFieldworkOrgInput,
} from '@/shared/contracts/workspace-io';
import { client, orpc } from '@/shared/lib/rpc';

import { fieldworkOrgKeys, userKeys } from '../../account-query-keys';

/** 업체 카드 목록 — 소속 계정 명단을 함께 싣고 온다 (.pen FLOW 10-4). */
export function useFieldworkOrgs(enabled = true) {
  return useQuery({
    queryKey: fieldworkOrgKeys.list(),
    queryFn: () => orpc.workspace.fieldworkOrgs.list.call(),
    enabled,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * 활성 업체의 id·이름만 — 발급 모달의 셀렉트와 **사용자 관리 탭 라벨의 개수**가 쓴다.
 *
 * 카드 목록(`useFieldworkOrgs`)과 다른 키를 쓰는 것이 요점이다: 저쪽은 전 업체의 계정
 * 명부(이름·이메일·상태)를 실어 오므로, 숫자 하나나 셀렉트 하나 때문에 그 무게를 끌고 오면
 * 안 된다. 두 표면을 서버에서 가른 이유와 같은 이유다.
 */
export function useFieldworkOrgOptions(enabled = true) {
  return useQuery({
    queryKey: fieldworkOrgKeys.options(),
    queryFn: () => orpc.workspace.fieldworkOrgs.options.call(),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * 업체 쓰기 셋의 무효화는 **사용자 목록까지 함께** 접는다.
 *
 * 이름을 바꾸면 사용자 관리 표의 「소속」 열이 그 이름을 그리고 있고(조인으로 온다), 종료는
 * 발급 모달의 선택지를 바꾼다. 업체 캐시만 접으면 옆 탭이 낡은 이름을 계속 보여준다.
 */
function useOrgMutation<TInput>(run: (input: TInput) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: fieldworkOrgKeys.all }),
        queryClient.invalidateQueries({ queryKey: userKeys.all }),
      ]);
    },
  });
}

export function useCreateFieldworkOrg() {
  return useOrgMutation((input: CreateFieldworkOrgInput) =>
    client.workspace.fieldworkOrgs.create(input),
  );
}

export function useUpdateFieldworkOrg() {
  return useOrgMutation((input: UpdateFieldworkOrgInput) =>
    client.workspace.fieldworkOrgs.update(input),
  );
}

export function useArchiveFieldworkOrg() {
  return useOrgMutation((input: ArchiveFieldworkOrgInput) =>
    client.workspace.fieldworkOrgs.archive(input),
  );
}
