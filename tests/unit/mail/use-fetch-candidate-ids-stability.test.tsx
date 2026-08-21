import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/lib/rpc', () => ({ client: { mail: { campaigns: { fetchCandidateIds: vi.fn() } } } }));

import { useFetchCandidateIds } from '@/hooks/queries/use-campaigns';

/**
 * campaign-wizard 의 자동선택 effect 는 mutateAsync 를 deps 로 둔다. 이 함수가 재렌더·상태 변화에
 * 걸쳐 같은 identity 여야 effect 가 1회 트리거로 남는다(TanStack Query v5 는 observer 생성 시 bind).
 */
describe('useFetchCandidateIds.mutateAsync identity', () => {
  it('재렌더해도 mutateAsync 는 같은 함수다', () => {
    const qc = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(() => useFetchCandidateIds(), { wrapper });
    const first = result.current.mutateAsync;
    rerender();
    expect(result.current.mutateAsync).toBe(first);
    expect(result.current).not.toBe(first);
  });
});
