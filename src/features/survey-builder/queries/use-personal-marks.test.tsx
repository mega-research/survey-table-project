import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  INITIAL_SURVEY_LIST_PAGE_QUERY,
  type SurveyListPageItem,
  type SurveyListPageResult,
} from '@/shared/contracts/survey-builder-io';
import { surveyKeys } from '@/shared/lib/survey-list-queries';

import { useSetFavorite } from './use-personal-marks';

const rpc = vi.hoisted(() => ({ setFavorite: vi.fn() }));
vi.mock('@/shared/lib/rpc', () => ({
  client: { workspace: { personalMarks: { setFavorite: rpc.setFavorite } } },
  orpc: {},
}));

const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const SURVEY = 's-1';
const OTHER = 's-2';

function item(id: string, isFavorite: boolean): SurveyListPageItem {
  return { id, isFavorite } as SurveyListPageItem;
}

function page(items: SurveyListPageItem[], favoriteCount: number): SurveyListPageResult {
  return { items, favoriteCount } as SurveyListPageResult;
}

const PAGE_KEY = surveyKeys.page('team-1', INITIAL_SURVEY_LIST_PAGE_QUERY);

/** 수동으로 풀 수 있는 서버 응답 — 요청이 도는 동안의 화면을 본다. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(initial: SurveyListPageResult) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(PAGE_KEY, initial);
  // 요약 캐시는 모양이 다르다(배열) — 낙관적 갱신이 건드리면 안 된다.
  queryClient.setQueryData(surveyKeys.summaries('team-1'), [{ id: SURVEY }]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useSetFavorite(), { wrapper });
  const read = () => queryClient.getQueryData<SurveyListPageResult>(PAGE_KEY)!;
  const starOf = (id: string) => read().items.find((s) => s.id === id)!.isFavorite;
  return { queryClient, setFavorite: result.current, read, starOf };
}

beforeEach(() => {
  rpc.setFavorite.mockReset();
  toast.error.mockReset();
});

describe('별 켜고 끄기 — 낙관적 갱신', () => {
  it('누르는 즉시 카드 별과 별 개수가 바뀐다 — 서버 응답을 기다리지 않는다', () => {
    const server = deferred<unknown>();
    rpc.setFavorite.mockReturnValue(server.promise);
    const { setFavorite, read, starOf, queryClient } = setup(
      page([item(SURVEY, false), item(OTHER, true)], 1),
    );

    act(() => setFavorite(SURVEY, true));

    expect(starOf(SURVEY)).toBe(true);
    expect(starOf(OTHER)).toBe(true);
    expect(read().favoriteCount).toBe(2);
    expect(rpc.setFavorite).toHaveBeenCalledWith({ surveyId: SURVEY, on: true });
    expect(queryClient.getQueryData(surveyKeys.summaries('team-1'))).toEqual([{ id: SURVEY }]);
  });

  it('저장이 실패하면 원래대로 돌아가고 이유를 보인다', async () => {
    rpc.setFavorite.mockRejectedValue(new Error('설문을 찾을 수 없습니다.'));
    const { setFavorite, read, starOf } = setup(page([item(SURVEY, true)], 1));

    act(() => setFavorite(SURVEY, false));
    expect(starOf(SURVEY)).toBe(false);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('설문을 찾을 수 없습니다.'));
    expect(starOf(SURVEY)).toBe(true);
    expect(read().favoriteCount).toBe(1);
  });

  it('연타하면 요청이 겹치지 않고 마지막 의도를 보낸다', async () => {
    const first = deferred<unknown>();
    rpc.setFavorite.mockReturnValueOnce(first.promise).mockResolvedValue({});
    const { setFavorite, read, starOf } = setup(page([item(SURVEY, false)], 0));

    act(() => setFavorite(SURVEY, true));
    act(() => setFavorite(SURVEY, false));
    act(() => setFavorite(SURVEY, true));
    act(() => setFavorite(SURVEY, false));

    // 첫 요청이 도는 동안에는 더 보내지 않는다 — 순서가 뒤집혀 도착할 길을 막는다.
    expect(rpc.setFavorite).toHaveBeenCalledTimes(1);
    expect(starOf(SURVEY)).toBe(false);
    expect(read().favoriteCount).toBe(0);

    await act(async () => first.resolve({}));

    await waitFor(() => expect(rpc.setFavorite).toHaveBeenCalledTimes(2));
    expect(rpc.setFavorite).toHaveBeenLastCalledWith({ surveyId: SURVEY, on: false });
    expect(starOf(SURVEY)).toBe(false);
  });

  it('연타의 끝이 서버가 이미 가진 상태면 다시 보내지 않는다', async () => {
    const first = deferred<unknown>();
    rpc.setFavorite.mockReturnValueOnce(first.promise);
    const { setFavorite, starOf, queryClient } = setup(page([item(SURVEY, false)], 0));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    act(() => setFavorite(SURVEY, true));
    act(() => setFavorite(SURVEY, false));
    act(() => setFavorite(SURVEY, true));
    await act(async () => first.resolve({}));

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: surveyKeys.pages() }));
    expect(rpc.setFavorite).toHaveBeenCalledTimes(1);
    expect(starOf(SURVEY)).toBe(true);
  });
});
