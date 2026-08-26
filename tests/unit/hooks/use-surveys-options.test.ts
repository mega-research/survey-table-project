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

import { surveyKeys, surveyListQueryOptions } from '@/features/survey-builder/queries/use-surveys';

describe('surveyListQueryOptions', () => {
  it('짧은 stale window 로 설문 목록 재마운트 중복 요청을 줄인다', () => {
    const options = surveyListQueryOptions();

    expect(options.queryKey).toEqual(surveyKeys.list(undefined));
    expect(options.staleTime).toBe(30_000);
    expect(options.refetchOnWindowFocus).toBe(false);
  });

  it('작업 범위마다 캐시 키가 갈린다 — 팀을 바꾸면 이전 범위의 목록을 재사용하지 않는다', () => {
    // .pen FLOW 6-1 노트: 팀 전환 시 다른 범위의 캐시를 재사용하지 않는다.
    expect(surveyListQueryOptions('team-1').queryKey).not.toEqual(
      surveyListQueryOptions('team-2').queryKey,
    );
    expect(surveyListQueryOptions('system').queryKey).not.toEqual(
      surveyListQueryOptions(null).queryKey,
    );
  });

  it('범위를 요청하지 않으면 서버가 쿠키로 판정하도록 null 을 보낸다', () => {
    surveyListQueryOptions().queryFn();
    expect(listCall).toHaveBeenCalledWith({ scope: null });
  });
});
