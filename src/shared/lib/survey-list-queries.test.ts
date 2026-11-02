import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import {
  surveyKeys,
  surveyListQueryOptions,
  surveyListScopeParam,
  surveySummaryListQueryOptions,
} from './survey-list-queries';

const listCall = vi.fn();
const summariesCall = vi.fn();

vi.mock('@/shared/lib/rpc', () => ({
  client: {},
  orpc: {
    surveyBuilder: {
      read: {
        list: {
          call: (...args: unknown[]) => listCall(...args),
        },
        listSummaries: {
          call: (...args: unknown[]) => summariesCall(...args),
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

describe('surveySummaryListQueryOptions', () => {
  it('요약 조회를 부르고 범위 미지정은 null 로 보낸다', () => {
    surveySummaryListQueryOptions('team-1').queryFn();
    expect(summariesCall).toHaveBeenLastCalledWith({ scope: 'team-1' });
    surveySummaryListQueryOptions(null).queryFn();
    expect(summariesCall).toHaveBeenLastCalledWith({ scope: null });
  });

  it('설문 생성·이동·삭제가 접는 목록 키 무효화가 사이드바 요약도 접는다', async () => {
    // mutation 들(use-surveys·use-survey-groups·use-survey-sync)은 `surveyKeys.lists()` 하나를 접는다.
    const queryClient = new QueryClient();
    const summaryKey = surveySummaryListQueryOptions('team-1').queryKey;
    queryClient.setQueryData(summaryKey, []);
    expect(queryClient.getQueryState(summaryKey)?.isInvalidated).toBe(false);

    await queryClient.invalidateQueries({ queryKey: surveyKeys.lists() });

    expect(queryClient.getQueryState(summaryKey)?.isInvalidated).toBe(true);
  });

  it('목록 키와 갈리고 범위마다 갈린다 — 같은 키면 모양이 다른 두 응답이 서로의 캐시를 덮는다', () => {
    expect(surveySummaryListQueryOptions('team-1').queryKey).not.toEqual(
      surveyListQueryOptions('team-1').queryKey,
    );
    expect(surveySummaryListQueryOptions(null).queryKey).not.toEqual(
      surveyListQueryOptions(null).queryKey,
    );
    expect(surveySummaryListQueryOptions('team-1').queryKey).not.toEqual(
      surveySummaryListQueryOptions('team-2').queryKey,
    );
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
