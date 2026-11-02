import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  INITIAL_SURVEY_LIST_PAGE_QUERY,
  type SurveyListPageItem,
  type SurveyListPageResult,
} from '@/shared/contracts/survey-builder-io';
import type { MinePersonalTagsOutput, PersonalTagItem } from '@/shared/contracts/workspace-io';
import { surveyKeys } from '@/shared/lib/survey-list-queries';

import { personalTagKeys, useCreatePersonalTag, useSetTagLink } from './use-personal-marks';

// 내 태그 붙이기·만들기 — 카드 단위 낙관적 갱신 (설문 즐겨찾기·태그 티켓 07).

const rpc = vi.hoisted(() => ({ setTagLink: vi.fn(), createTag: vi.fn() }));
vi.mock('@/shared/lib/rpc', () => ({
  client: {
    workspace: { personalMarks: { setTagLink: rpc.setTagLink, createTag: rpc.createTag } },
  },
  orpc: {},
}));

const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const SURVEY = 's-1';
const OTHER = 's-2';
const TAG_A = 't-a';
const TAG_B = 't-b';

function item(id: string, myTagIds: string[]): SurveyListPageItem {
  return { id, isFavorite: false, myTagIds } as unknown as SurveyListPageItem;
}

function tag(id: string, name: string, linkCount: number): PersonalTagItem {
  return { id, name, color: 'blue', linkCount };
}

const PAGE_KEY = surveyKeys.page('team-1', INITIAL_SURVEY_LIST_PAGE_QUERY);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(items: SurveyListPageItem[], tags: PersonalTagItem[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(PAGE_KEY, {
    items,
    favoriteCount: 0,
  } as unknown as SurveyListPageResult);
  queryClient.setQueryData<MinePersonalTagsOutput>(personalTagKeys.mine(), { tags });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(
    () => ({ setTagLink: useSetTagLink(), createTag: useCreatePersonalTag() }),
    { wrapper },
  );
  const tagsOf = (id: string) =>
    queryClient.getQueryData<SurveyListPageResult>(PAGE_KEY)!.items.find((s) => s.id === id)!
      .myTagIds;
  const mine = () => queryClient.getQueryData<MinePersonalTagsOutput>(personalTagKeys.mine())!.tags;
  return { queryClient, hooks: result, tagsOf, mine };
}

beforeEach(() => {
  rpc.setTagLink.mockReset();
  rpc.createTag.mockReset();
  toast.error.mockReset();
});

describe('태그 붙이기·떼기 — 낙관적 갱신', () => {
  it('누르는 즉시 그 카드의 태그 줄과 내 태그의 붙은 수가 바뀐다', () => {
    rpc.setTagLink.mockReturnValue(deferred<unknown>().promise);
    const { hooks, tagsOf, mine } = setup(
      [item(SURVEY, [TAG_A]), item(OTHER, [])],
      [tag(TAG_A, 'A사', 1), tag(TAG_B, '2026', 0)],
    );

    act(() => hooks.current.setTagLink(SURVEY, TAG_B, true));
    expect(tagsOf(SURVEY)).toEqual([TAG_A, TAG_B]);
    expect(tagsOf(OTHER)).toEqual([]);
    expect(mine().find((t) => t.id === TAG_B)!.linkCount).toBe(1);
    expect(rpc.setTagLink).toHaveBeenCalledWith({ surveyId: SURVEY, tagId: TAG_B, on: true });

    act(() => hooks.current.setTagLink(OTHER, TAG_A, true));
    expect(tagsOf(OTHER)).toEqual([TAG_A]);
  });

  it('떼기가 실패하면 태그가 돌아오고 이유를 보인다', async () => {
    rpc.setTagLink.mockRejectedValue(new Error('태그를 찾을 수 없습니다.'));
    const { hooks, tagsOf, mine } = setup([item(SURVEY, [TAG_A])], [tag(TAG_A, 'A사', 1)]);

    act(() => hooks.current.setTagLink(SURVEY, TAG_A, false));
    expect(tagsOf(SURVEY)).toEqual([]);
    expect(mine()[0]!.linkCount).toBe(0);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('태그를 찾을 수 없습니다.'));
    expect(tagsOf(SURVEY)).toEqual([TAG_A]);
    expect(mine()[0]!.linkCount).toBe(1);
  });

  it('같은 태그를 연타하면 요청이 겹치지 않고 마지막 의도를 보낸다 — 다른 태그는 따로 돈다', async () => {
    const first = deferred<unknown>();
    rpc.setTagLink.mockReturnValueOnce(first.promise).mockResolvedValue({});
    const { hooks, tagsOf } = setup([item(SURVEY, [])], [tag(TAG_A, 'A사', 0), tag(TAG_B, 'B', 0)]);

    act(() => hooks.current.setTagLink(SURVEY, TAG_A, true));
    act(() => hooks.current.setTagLink(SURVEY, TAG_A, false));
    act(() => hooks.current.setTagLink(SURVEY, TAG_B, true));

    expect(rpc.setTagLink).toHaveBeenCalledTimes(2);
    expect(rpc.setTagLink).toHaveBeenLastCalledWith({ surveyId: SURVEY, tagId: TAG_B, on: true });
    expect(tagsOf(SURVEY)).toEqual([TAG_B]);

    await act(async () => first.resolve({}));
    await waitFor(() => expect(rpc.setTagLink).toHaveBeenCalledTimes(3));
    expect(rpc.setTagLink).toHaveBeenLastCalledWith({ surveyId: SURVEY, tagId: TAG_A, on: false });
  });

  it('정착하면 목록 페이지와 내 태그를 다시 읽는다', async () => {
    rpc.setTagLink.mockResolvedValue({});
    const { hooks, queryClient } = setup([item(SURVEY, [])], [tag(TAG_A, 'A사', 0)]);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    act(() => hooks.current.setTagLink(SURVEY, TAG_A, true));

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: personalTagKeys.mine() }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: surveyKeys.pages() });
  });
});

describe('태그 만들기 + 붙이기', () => {
  it('만들어지면 내 태그 목록에 더하고 그 카드에 붙인다', async () => {
    rpc.createTag.mockResolvedValue({ tag: tag(TAG_B, 'C사', 1), created: true });
    const { hooks, tagsOf, mine } = setup([item(SURVEY, [TAG_A])], [tag(TAG_A, 'A사', 1)]);

    await act(async () => {
      await hooks.current.createTag(SURVEY, 'C사');
    });

    expect(rpc.createTag).toHaveBeenCalledWith({ name: 'C사', attachToSurveyId: SURVEY });
    expect(tagsOf(SURVEY)).toEqual([TAG_A, TAG_B]);
    expect(mine().map((t) => t.id)).toEqual([TAG_A, TAG_B]);
  });

  it('같은 이름의 기존 태그가 돌아오면 목록에 겹쳐 넣지 않고 붙은 수만 맞춘다', async () => {
    rpc.createTag.mockResolvedValue({ tag: tag(TAG_A, 'A사', 2), created: false });
    const { hooks, tagsOf, mine } = setup([item(SURVEY, [])], [tag(TAG_A, 'A사', 1)]);

    await act(async () => {
      await hooks.current.createTag(SURVEY, 'a사');
    });

    expect(tagsOf(SURVEY)).toEqual([TAG_A]);
    expect(mine()).toEqual([tag(TAG_A, 'A사', 2)]);
  });

  it('실패하면 이유를 보이고 아무것도 바꾸지 않는다', async () => {
    rpc.createTag.mockRejectedValue(new Error('태그는 300개까지 만들 수 있습니다'));
    const { hooks, tagsOf, mine } = setup([item(SURVEY, [])], [tag(TAG_A, 'A사', 0)]);

    await act(async () => {
      await hooks.current.createTag(SURVEY, '새것');
    });

    expect(toast.error).toHaveBeenCalledWith('태그는 300개까지 만들 수 있습니다');
    expect(tagsOf(SURVEY)).toEqual([]);
    expect(mine()).toEqual([tag(TAG_A, 'A사', 0)]);
  });
});
