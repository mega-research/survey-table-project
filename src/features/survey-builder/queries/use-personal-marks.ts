'use client';

import { useRef } from 'react';

import { ORPCError } from '@orpc/client';
import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { getErrorMessage } from '@/lib/get-error-message';
import type {
  SurveyListPageItem,
  SurveyListPageResult,
} from '@/shared/contracts/survey-builder-io';
import type { PersonalTagColor } from '@/shared/contracts/workspace';
import type { MinePersonalTagsOutput, PersonalTagItem } from '@/shared/contracts/workspace-io';
import { client, orpc } from '@/shared/lib/rpc';
import { surveyKeys } from '@/shared/lib/survey-list-queries';

// 개인 표시 — 카드 단위 낙관적 갱신 (설문 즐겨찾기·태그 티켓 06·07). 별과 태그 붙이기·떼기가 같은
// 결로 돈다: 목록 페이지 캐시(`surveyKeys.pages()`)의 그 카드만 고치고, 서버가 맞춘 뒤 다시 읽는다.
// 태그는 내 태그 목록(`personalTagKeys.mine()`)의 붙은 수도 함께 고친다.

/**
 * 내 태그 쿼리 키 — 설문 목록(`surveyKeys`)과 따로다. 내 태그는 작업 범위와 무관해 팀을 바꿔도
 * 같은 목록이고, 설문 생성·이동 같은 목록 무효화에 휩쓸릴 이유가 없다.
 */
export const personalTagKeys = {
  all: ['personal-marks'] as const,
  mine: () => [...personalTagKeys.all, 'tags'] as const,
};

/** 내 태그 전부 — 태그 창·카드 태그 줄이 함께 본다. */
export function myPersonalTagsQueryOptions() {
  return {
    queryKey: personalTagKeys.mine(),
    queryFn: () => orpc.workspace.personalMarks.mine.call(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  };
}

export function useMyPersonalTags() {
  return useQuery(myPersonalTagsQueryOptions());
}

/**
 * 목록 페이지 캐시에서 그 카드만 바꾼다. 같은 범위의 다른 페이지 캐시는 그 카드를 모르니 손대지
 * 않고 정착 후 무효화에 맡긴다. `patch` 가 같은 값을 돌려주면 그 페이지는 그대로 둔다.
 *
 * 접두가 `pages()` 인 것이 중요하다 — `lists()` 로 훑으면 모양이 다른 사이드바 요약(배열)까지 잡힌다.
 */
function patchSurveyCard(
  queryClient: QueryClient,
  surveyId: string,
  patch: (page: SurveyListPageResult, item: SurveyListPageItem) => SurveyListPageResult,
): void {
  queryClient.setQueriesData<SurveyListPageResult>({ queryKey: surveyKeys.pages() }, (old) => {
    const target = old?.items.find((s) => s.id === surveyId);
    if (!old || !target) return old;
    return patch(old, target);
  });
}

function patchFavorite(queryClient: QueryClient, surveyId: string, on: boolean): void {
  patchSurveyCard(queryClient, surveyId, (page, target) => {
    if (target.isFavorite === on) return page;
    return {
      ...page,
      favoriteCount: Math.max(0, page.favoriteCount + (on ? 1 : -1)),
      items: page.items.map((s) => (s.id === surveyId ? { ...s, isFavorite: on } : s)),
    };
  });
}

/** 그 카드의 태그 줄 — 붙이면 끝에 더하고(붙인 순서), 떼면 뺀다. 내 태그의 붙은 수도 맞춘다. */
function patchTagLink(queryClient: QueryClient, surveyId: string, tagId: string, on: boolean) {
  let changed = false;
  patchSurveyCard(queryClient, surveyId, (page, target) => {
    if (target.myTagIds.includes(tagId) === on) return page;
    changed = true;
    const myTagIds = on
      ? [...target.myTagIds, tagId]
      : target.myTagIds.filter((id) => id !== tagId);
    return { ...page, items: page.items.map((s) => (s.id === surveyId ? { ...s, myTagIds } : s)) };
  });
  if (!changed) return;
  queryClient.setQueryData<MinePersonalTagsOutput>(personalTagKeys.mine(), (old) =>
    old
      ? {
          tags: old.tags.map((t) =>
            t.id === tagId ? { ...t, linkCount: Math.max(0, t.linkCount + (on ? 1 : -1)) } : t,
          ),
        }
      : old,
  );
}

/** 표시 하나의 의도 — 서버가 가진 상태와 사용자가 마지막으로 바란 상태. */
interface MarkIntent {
  confirmed: boolean;
  desired: boolean;
}

/**
 * 결과 상태 지정 표시(별·태그 연결)를 마지막 의도로 수렴시키는 공용 엔진.
 *
 * - **연타는 마지막 의도를 보낸다.** 키마다 요청을 하나씩만 돌리고, 도는 동안의 클릭은 의도만
 *   갱신한다. 요청이 끝났을 때 의도가 서버 상태와 다르면 그 값을 한 번 더 보낸다 — 요청을 겹쳐
 *   보내면 도착 순서가 뒤집혀 첫 클릭이 이길 수 있다. 서버도 결과 상태 지정이라 재시도가 안전하다.
 * - **실패하면 서버가 가진 상태로 되돌리고** 이유를 토스트로 보인다(남은 의도는 버린다).
 * - 정착하면 `settledKeys` 를 다시 읽는다.
 *
 * 의도 표는 훅 인스턴스가 쥔다 — 목록 화면에 하나만 두고 카드에 콜백으로 내린다.
 */
function useConvergingMark<A extends unknown[]>(options: {
  keyOf: (...args: A) => string;
  apply: (queryClient: QueryClient, on: boolean, ...args: A) => void;
  send: (on: boolean, ...args: A) => Promise<unknown>;
  failureMessage: string;
  settledKeys: () => ReadonlyArray<readonly unknown[]>;
}): (on: boolean, ...args: A) => void {
  const queryClient = useQueryClient();
  const intents = useRef(new Map<string, MarkIntent>());

  function invalidateSettled() {
    for (const queryKey of options.settledKeys()) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }

  function send(key: string, intent: MarkIntent, args: A): void {
    const on = intent.desired;
    options.send(on, ...args).then(
      () => {
        intent.confirmed = on;
        if (intent.desired !== on) {
          send(key, intent, args);
          return;
        }
        intents.current.delete(key);
        invalidateSettled();
      },
      (error: unknown) => {
        intents.current.delete(key);
        options.apply(queryClient, intent.confirmed, ...args);
        toast.error(getErrorMessage(error, options.failureMessage));
        invalidateSettled();
      },
    );
  }

  return (on, ...args) => {
    // 도는 목록 조회가 낙관적 값을 덮어쓰지 않게 — 정착 후 무효화가 다시 읽는다.
    for (const queryKey of options.settledKeys()) void queryClient.cancelQueries({ queryKey });
    options.apply(queryClient, on, ...args);
    const key = options.keyOf(...args);
    const pending = intents.current.get(key);
    if (pending) {
      pending.desired = on;
      return;
    }
    // 화면이 보인 값의 반대를 누른 것이다 — 서버가 가진 값은 그 직전 값.
    const intent: MarkIntent = { confirmed: !on, desired: on };
    intents.current.set(key, intent);
    send(key, intent, args);
  };
}

/**
 * 별 켜고 끄기 — `(surveyId, on)` 을 부르면 카드가 즉시 바뀌고 서버가 뒤따른다(티켓 06).
 * 정착하면 목록 페이지를 다시 읽는다 — 즐겨찾기만 보기에서 끈 카드가 빠지고 다른 페이지의 별
 * 개수가 맞춰진다.
 */
export function useSetFavorite(): (surveyId: string, on: boolean) => void {
  const mark = useConvergingMark<[surveyId: string]>({
    keyOf: (surveyId) => surveyId,
    apply: (queryClient, on, surveyId) => patchFavorite(queryClient, surveyId, on),
    send: (on, surveyId) => client.workspace.personalMarks.setFavorite({ surveyId, on }),
    failureMessage: '즐겨찾기를 바꾸지 못했습니다.',
    settledKeys: () => [surveyKeys.pages()],
  });
  return (surveyId, on) => mark(on, surveyId);
}

/**
 * 태그 붙이기·떼기 — `(surveyId, tagId, on)`. 별과 같은 엔진이고 의도는 설문·태그 쌍마다 따로다
 * (다른 태그는 서로 기다리지 않는다). 정착하면 목록 페이지와 내 태그를 다시 읽는다.
 */
export function useSetTagLink(): (surveyId: string, tagId: string, on: boolean) => void {
  const mark = useConvergingMark<[surveyId: string, tagId: string]>({
    keyOf: (surveyId, tagId) => `${surveyId}:${tagId}`,
    apply: (queryClient, on, surveyId, tagId) => patchTagLink(queryClient, surveyId, tagId, on),
    send: (on, surveyId, tagId) =>
      client.workspace.personalMarks.setTagLink({ surveyId, tagId, on }),
    failureMessage: '태그를 바꾸지 못했습니다.',
    settledKeys: () => [surveyKeys.pages(), personalTagKeys.mine()],
  });
  return (surveyId, tagId, on) => mark(on, surveyId, tagId);
}

/** 내 태그 목록에 만든(또는 돌려받은) 태그를 넣는다 — 이미 있으면 그 줄을 서버 값으로 바꾼다. */
function upsertMyTag(queryClient: QueryClient, tag: PersonalTagItem): void {
  queryClient.setQueryData<MinePersonalTagsOutput>(personalTagKeys.mine(), (old) => {
    if (!old) return old;
    const exists = old.tags.some((t) => t.id === tag.id);
    return { tags: exists ? old.tags.map((t) => (t.id === tag.id ? tag : t)) : [...old.tags, tag] };
  });
}

/**
 * 태그 만들기 + 그 카드에 붙이기 — `(surveyId, name)`. 새 태그 id 는 서버가 정하므로 낙관적으로
 * 그리지 않고, 응답이 오면 내 태그 목록과 그 카드에 넣는다. 같은 이름(공백·대소문자 무시)이 이미
 * 있으면 서버가 그 태그를 돌려준다 — 목록에 겹쳐 넣지 않는다. 실패하면 토스트만(바꾼 것이 없다).
 * 돌려주는 값은 만든 태그(실패면 null) — 태그 창이 입력을 비울지 정한다.
 */
export function useCreatePersonalTag(): (
  surveyId: string,
  name: string,
) => Promise<PersonalTagItem | null> {
  const queryClient = useQueryClient();
  return async (surveyId, name) => {
    try {
      const { tag } = await client.workspace.personalMarks.createTag({
        name,
        attachToSurveyId: surveyId,
      });
      upsertMyTag(queryClient, tag);
      patchSurveyCard(queryClient, surveyId, (page, target) =>
        target.myTagIds.includes(tag.id)
          ? page
          : {
              ...page,
              items: page.items.map((s) =>
                s.id === surveyId ? { ...s, myTagIds: [...s.myTagIds, tag.id] } : s,
              ),
            },
      );
      void queryClient.invalidateQueries({ queryKey: surveyKeys.pages() });
      void queryClient.invalidateQueries({ queryKey: personalTagKeys.mine() });
      return tag;
    } catch (error) {
      toast.error(getErrorMessage(error, '태그를 만들지 못했습니다.'));
      return null;
    }
  };
}

/** 내 태그 한 줄만 바꾼다 — 카드 태그 줄·검색 칩은 이름·색을 이 캐시에서 찾으므로 바로 따라온다. */
function patchMyTag(
  queryClient: QueryClient,
  tagId: string,
  patch: (tag: PersonalTagItem) => PersonalTagItem,
): void {
  queryClient.setQueryData<MinePersonalTagsOutput>(personalTagKeys.mine(), (old) =>
    old ? { tags: old.tags.map((t) => (t.id === tagId ? patch(t) : t)) } : old,
  );
}

/** 고칠 것 — 보낸 칸만 바뀐다. 이름은 화면이 앞뒤 공백을 걷어 보낸다(서버도 같은 정규화). */
export interface PersonalTagEdit {
  name?: string;
  color?: PersonalTagColor;
}

/**
 * 고치기 결과 — 이름 충돌(CONFLICT)이면 그 문구를 돌려줘 편집 패널이 이름 칸 아래에 보인다.
 * 그 밖의 실패는 훅이 토스트로 보였으므로 `nameError` 가 null 이다.
 */
export type PersonalTagEditResult = { ok: true } | { ok: false; nameError: string | null };

/**
 * 태그 이름·색 고치기 (티켓 08) — `(tagId, edit)`.
 *
 * - **누르는 즉시** 내 태그 캐시의 그 줄을 바꾼다(색 견본은 따로 확인 단추가 없다).
 * - **같은 태그의 요청은 차례로 보낸다** — 색을 연달아 누르면 앞 요청이 끝난 뒤 다음을 보내
 *   도착 순서가 뒤집히지 않는다. 서버도 사용자 잠금 순서대로 써서 나중 값이 남는다.
 * - 실패하면 이 요청이 바꾼 칸을(그 사이 다른 값으로 바뀌지 않았다면) 되돌린다. 이름 충돌은
 *   토스트 없이 결과로 돌려주고, 그 밖의 실패는 토스트로 보인다.
 * - 끝나면(성공·실패 모두) 내 태그와 목록 페이지를 다시 읽는다 — 다른 탭에서 지운 태그는
 *   여기서 사라진다.
 */
export function useUpdatePersonalTag(): (
  tagId: string,
  edit: PersonalTagEdit,
) => Promise<PersonalTagEditResult> {
  const queryClient = useQueryClient();
  const queues = useRef(new Map<string, Promise<unknown>>());

  return (tagId, edit) => {
    const before = queryClient
      .getQueryData<MinePersonalTagsOutput>(personalTagKeys.mine())
      ?.tags.find((t) => t.id === tagId);
    void queryClient.cancelQueries({ queryKey: personalTagKeys.mine() });
    patchMyTag(queryClient, tagId, (t) => ({
      ...t,
      ...(edit.name !== undefined ? { name: edit.name } : {}),
      ...(edit.color !== undefined ? { color: edit.color } : {}),
    }));

    const rollback = () => {
      if (!before) return;
      patchMyTag(queryClient, tagId, (t) => ({
        ...t,
        ...(edit.name !== undefined && t.name === edit.name ? { name: before.name } : {}),
        ...(edit.color !== undefined && t.color === edit.color ? { color: before.color } : {}),
      }));
    };

    const run = async (): Promise<PersonalTagEditResult> => {
      try {
        await client.workspace.personalMarks.updateTag({ tagId, ...edit });
        return { ok: true };
      } catch (error) {
        rollback();
        if (error instanceof ORPCError && error.code === 'CONFLICT') {
          return { ok: false, nameError: error.message };
        }
        toast.error(getErrorMessage(error, '태그를 고치지 못했습니다.'));
        return { ok: false, nameError: null };
      } finally {
        void queryClient.invalidateQueries({ queryKey: personalTagKeys.mine() });
        void queryClient.invalidateQueries({ queryKey: surveyKeys.pages() });
      }
    };

    // 앞 요청이 없으면 바로 보낸다 — 있으면 그 뒤에 잇는다.
    const previous = queues.current.get(tagId);
    const next = previous ? previous.then(run, run) : run();
    queues.current.set(tagId, next);
    void next.finally(() => {
      if (queues.current.get(tagId) === next) queues.current.delete(tagId);
    });
    return next;
  };
}

/**
 * 태그 지우기 (티켓 08) — `(tagId) => 지워졌는가`. 확인을 거친 뒤라 낙관적으로 그리지 않고, 끝나면
 * 내 태그와 카드 태그 줄에서 뺀 뒤 둘 다 다시 읽는다. 이미 없는 태그(NOT_FOUND — 다른 탭에서
 * 먼저 지움)는 바라던 결과라 같은 성공으로 접는다.
 */
export function useDeletePersonalTag(): (tagId: string) => Promise<boolean> {
  const queryClient = useQueryClient();
  return async (tagId) => {
    try {
      await client.workspace.personalMarks.deleteTag({ tagId });
    } catch (error) {
      if (!(error instanceof ORPCError && error.code === 'NOT_FOUND')) {
        toast.error(getErrorMessage(error, '태그를 지우지 못했습니다.'));
        return false;
      }
    }
    queryClient.setQueryData<MinePersonalTagsOutput>(personalTagKeys.mine(), (old) =>
      old ? { tags: old.tags.filter((t) => t.id !== tagId) } : old,
    );
    queryClient.setQueriesData<SurveyListPageResult>({ queryKey: surveyKeys.pages() }, (old) =>
      old && old.items.some((s) => s.myTagIds.includes(tagId))
        ? {
            ...old,
            items: old.items.map((s) =>
              s.myTagIds.includes(tagId)
                ? { ...s, myTagIds: s.myTagIds.filter((id) => id !== tagId) }
                : s,
            ),
          }
        : old,
    );
    void queryClient.invalidateQueries({ queryKey: personalTagKeys.mine() });
    void queryClient.invalidateQueries({ queryKey: surveyKeys.pages() });
    return true;
  };
}

/**
 * 태그를 검색에 걸었다고 기록한다 (0157) — `(tagId) => void`. 툴바 「자주 쓰는 태그」 순서의 재료일 뿐이라
 * 기다리지 않고, 실패해도 알리지 않는다(거르기는 주소가 이미 했다). 내 태그를 다시 읽지 않는다 — 누를
 * 때마다 줄이 뒤섞이면 다음 칩을 다시 찾아야 한다. 순서는 다음에 내 태그를 읽을 때 바뀐다.
 */
export function useRecordTagFilter(): (tagId: string) => void {
  return (tagId) => {
    void client.workspace.personalMarks.recordFilter({ tagId }).catch(() => {});
  };
}
