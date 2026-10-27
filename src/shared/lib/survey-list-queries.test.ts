import { describe, expect, it, vi } from 'vitest';

import { surveyKeys, surveyListQueryOptions, surveyListScopeParam } from './survey-list-queries';

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
    // 휴지통 여부는 언제나 명시한다 — 서버 기본값에 기대면 두 모드의 계약이 갈린다(티켓 17).
    expect(listCall).toHaveBeenCalledWith({ scope: null, deleted: false });
  });
});

describe('surveyListScopeParam', () => {
  // 서버 페이지가 미리 채우는 키와 화면이 조회하는 키가 이 함수 하나에서 나온다 — 갈리면
  // 미리 받은 목록이 쓰이지 않고 첫 진입이 다시 왕복한다.
  it('팀 범위는 팀 id, 시스템 전체 보기는 예약어로 접는다', () => {
    expect(surveyListScopeParam({ kind: 'team', teamId: 'team-1' })).toBe('team-1');
    expect(surveyListScopeParam({ kind: 'system' })).toBe('system');
  });

  it('범위가 없거나 셸 밖이면 범위를 지목하지 않는다', () => {
    expect(surveyListScopeParam({ kind: 'none' })).toBeNull();
    expect(surveyListScopeParam(null)).toBeNull();
  });
});
