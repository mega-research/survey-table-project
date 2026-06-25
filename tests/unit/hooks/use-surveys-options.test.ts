import { describe, expect, it, vi } from 'vitest';

const listCall = vi.fn();

vi.mock('@/shared/lib/rpc', () => ({
  client: {},
  orpc: {
    surveyBuilder: {
      read: {
        list: {
          call: (...args: unknown[]) => listCall(...args),
        },
      },
    },
  },
}));

import { surveyKeys, surveyListQueryOptions } from '@/hooks/queries/use-surveys';

describe('surveyListQueryOptions', () => {
  it('짧은 stale window 로 설문 목록 재마운트 중복 요청을 줄인다', () => {
    const options = surveyListQueryOptions();

    expect(options.queryKey).toEqual(surveyKeys.lists());
    expect(options.staleTime).toBe(30_000);
    expect(options.refetchOnWindowFocus).toBe(false);
  });
});
