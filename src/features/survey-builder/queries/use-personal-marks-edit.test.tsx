import type { ReactNode } from 'react';

import { ORPCError } from '@orpc/client';
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

import { personalTagKeys, useDeletePersonalTag, useUpdatePersonalTag } from './use-personal-marks';

// 내 태그 고치기·지우기 — 내 태그 캐시를 고쳐 카드·칩이 바로 따라오게 (설문 즐겨찾기·태그 티켓 08).

const rpc = vi.hoisted(() => ({ updateTag: vi.fn(), deleteTag: vi.fn() }));
vi.mock('@/shared/lib/rpc', () => ({
  client: {
    workspace: { personalMarks: { updateTag: rpc.updateTag, deleteTag: rpc.deleteTag } },
  },
  orpc: {},
}));

const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const SURVEY = 's-1';
const TAG_A = 't-a';
const TAG_B = 't-b';

function item(id: string, myTagIds: string[]): SurveyListPageItem {
  return { id, isFavorite: false, myTagIds } as unknown as SurveyListPageItem;
}

function tag(id: string, name: string, over: Partial<PersonalTagItem> = {}): PersonalTagItem {
  return { id, name, color: 'blue', linkCount: 1, ...over };
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

function setup(tags: PersonalTagItem[], items: SurveyListPageItem[] = []) {
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
    () => ({ update: useUpdatePersonalTag(), remove: useDeletePersonalTag() }),
    { wrapper },
  );
  const mine = () => queryClient.getQueryData<MinePersonalTagsOutput>(personalTagKeys.mine())!.tags;
  const tagsOf = (id: string) =>
    queryClient.getQueryData<SurveyListPageResult>(PAGE_KEY)!.items.find((s) => s.id === id)!
      .myTagIds;
  return { queryClient, hooks: result, mine, tagsOf };
}

beforeEach(() => {
  rpc.updateTag.mockReset();
  rpc.deleteTag.mockReset();
  toast.error.mockReset();
});

describe('태그 고치기', () => {
  it('누르는 즉시 내 태그의 이름·색이 바뀌고 서버에 보낸 것만 보낸다', () => {
    rpc.updateTag.mockReturnValue(deferred<unknown>().promise);
    const { hooks, mine } = setup([tag(TAG_A, 'A사'), tag(TAG_B, 'B기관')]);

    act(() => void hooks.current.update(TAG_B, { color: 'teal' }));
    expect(mine()[1]).toMatchObject({ name: 'B기관', color: 'teal' });
    expect(rpc.updateTag).toHaveBeenCalledWith({ tagId: TAG_B, color: 'teal' });

    act(() => void hooks.current.update(TAG_A, { name: 'A기관' }));
    expect(mine()[0]).toMatchObject({ name: 'A기관', color: 'blue' });
  });

  it('이름이 겹치면 되돌리고 그 이유를 돌려준다 — 토스트는 띄우지 않는다(칸 아래에 보인다)', async () => {
    rpc.updateTag.mockRejectedValue(
      new ORPCError('CONFLICT', { message: '이미 같은 이름의 태그가 있습니다' }),
    );
    const { hooks, mine } = setup([tag(TAG_A, 'A사'), tag(TAG_B, 'B기관')]);

    let result: unknown;
    await act(async () => {
      result = await hooks.current.update(TAG_B, { name: 'A사' });
    });

    expect(result).toEqual({ ok: false, nameError: '이미 같은 이름의 태그가 있습니다' });
    expect(mine()[1]!.name).toBe('B기관');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('다른 이유로 실패하면 되돌리고 토스트로 보인 뒤 내 태그를 다시 읽는다 — 다른 탭에서 지운 태그는 거기서 사라진다', async () => {
    rpc.updateTag.mockRejectedValue(
      new ORPCError('NOT_FOUND', { message: '태그를 찾을 수 없습니다.' }),
    );
    const { hooks, mine, queryClient } = setup([tag(TAG_A, 'A사')]);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    let result: unknown;
    await act(async () => {
      result = await hooks.current.update(TAG_A, { color: 'red' });
    });

    expect(result).toEqual({ ok: false, nameError: null });
    expect(mine()[0]!.color).toBe('blue');
    expect(toast.error).toHaveBeenCalledWith('태그를 찾을 수 없습니다.');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: personalTagKeys.mine() });
  });

  it('같은 태그를 연달아 고치면 요청이 겹치지 않고 차례로 간다 — 나중 값이 마지막에 도착한다', async () => {
    const first = deferred<unknown>();
    rpc.updateTag.mockReturnValueOnce(first.promise).mockResolvedValue(tag(TAG_A, 'A사'));
    const { hooks, mine } = setup([tag(TAG_A, 'A사')]);

    act(() => void hooks.current.update(TAG_A, { color: 'red' }));
    act(() => void hooks.current.update(TAG_A, { color: 'green' }));
    expect(rpc.updateTag).toHaveBeenCalledTimes(1);
    expect(mine()[0]!.color).toBe('green');

    await act(async () => first.resolve(tag(TAG_A, 'A사', { color: 'red' })));
    await waitFor(() => expect(rpc.updateTag).toHaveBeenCalledTimes(2));
    expect(rpc.updateTag).toHaveBeenLastCalledWith({ tagId: TAG_A, color: 'green' });
  });

  it('정착하면 내 태그와 목록 페이지를 다시 읽는다', async () => {
    rpc.updateTag.mockResolvedValue(tag(TAG_A, 'A기관'));
    const { hooks, queryClient } = setup([tag(TAG_A, 'A사')]);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    let result: unknown;
    await act(async () => {
      result = await hooks.current.update(TAG_A, { name: 'A기관' });
    });

    expect(result).toEqual({ ok: true });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: personalTagKeys.mine() });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: surveyKeys.pages() });
  });
});

describe('태그 지우기', () => {
  it('지워지면 내 태그와 카드 태그 줄에서 빼고 둘 다 다시 읽는다', async () => {
    rpc.deleteTag.mockResolvedValue({ tagId: TAG_B });
    const { hooks, mine, tagsOf, queryClient } = setup(
      [tag(TAG_A, 'A사'), tag(TAG_B, 'B기관')],
      [item(SURVEY, [TAG_A, TAG_B])],
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    let ok: unknown;
    await act(async () => {
      ok = await hooks.current.remove(TAG_B);
    });

    expect(ok).toBe(true);
    expect(rpc.deleteTag).toHaveBeenCalledWith({ tagId: TAG_B });
    expect(mine().map((t) => t.id)).toEqual([TAG_A]);
    expect(tagsOf(SURVEY)).toEqual([TAG_A]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: personalTagKeys.mine() });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: surveyKeys.pages() });
  });

  it('다른 탭에서 먼저 지웠으면(NOT_FOUND) 바라던 결과라 조용히 목록에서 뺀다', async () => {
    rpc.deleteTag.mockRejectedValue(
      new ORPCError('NOT_FOUND', { message: '태그를 찾을 수 없습니다.' }),
    );
    const { hooks, mine } = setup([tag(TAG_A, 'A사')]);

    let ok: unknown;
    await act(async () => {
      ok = await hooks.current.remove(TAG_A);
    });

    expect(ok).toBe(true);
    expect(mine()).toEqual([]);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('그 밖의 실패는 토스트로 보이고 목록은 그대로다', async () => {
    rpc.deleteTag.mockRejectedValue(new Error('네트워크 오류'));
    const { hooks, mine } = setup([tag(TAG_A, 'A사')]);

    let ok: unknown;
    await act(async () => {
      ok = await hooks.current.remove(TAG_A);
    });

    expect(ok).toBe(false);
    expect(mine().map((t) => t.id)).toEqual([TAG_A]);
    expect(toast.error).toHaveBeenCalledWith('네트워크 오류');
  });
});
