'use client';

import { useRef } from 'react';

import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { getErrorMessage } from '@/lib/get-error-message';
import type { SurveyListPageResult } from '@/shared/contracts/survey-builder-io';
import { client } from '@/shared/lib/rpc';
import { surveyKeys } from '@/shared/lib/survey-list-queries';

// 개인 표시 — 카드 단위 낙관적 갱신 (설문 즐겨찾기·태그 티켓 06). 내 태그(티켓 07)의 붙이기·떼기도
// 같은 결로 이 파일에 붙는다: 목록 페이지 캐시(`surveyKeys.pages()`)의 그 카드만 고치고, 서버가
// 맞춘 뒤 페이지를 다시 읽는다.

/**
 * 목록 페이지 캐시에서 그 카드의 별을 바꾼다. 카드가 실린 페이지의 별 개수도 함께 고친다 — 같은
 * 범위의 다른 페이지 캐시는 그 카드를 모르니 손대지 않고 정착 후 무효화에 맡긴다.
 *
 * 접두가 `pages()` 인 것이 중요하다 — `lists()` 로 훑으면 모양이 다른 사이드바 요약(배열)까지 잡힌다.
 */
function patchFavorite(queryClient: QueryClient, surveyId: string, on: boolean): void {
  queryClient.setQueriesData<SurveyListPageResult>({ queryKey: surveyKeys.pages() }, (old) => {
    const target = old?.items.find((s) => s.id === surveyId);
    if (!old || !target || target.isFavorite === on) return old;
    return {
      ...old,
      favoriteCount: Math.max(0, old.favoriteCount + (on ? 1 : -1)),
      items: old.items.map((s) => (s.id === surveyId ? { ...s, isFavorite: on } : s)),
    };
  });
}

/** 설문 하나의 별 의도 — 서버가 가진 상태와 사용자가 마지막으로 바란 상태. */
interface FavoriteIntent {
  confirmed: boolean;
  desired: boolean;
}

/**
 * 별 켜고 끄기 — `(surveyId, on)` 을 부르면 카드가 즉시 바뀌고 서버가 뒤따른다.
 *
 * - **연타는 마지막 의도를 보낸다.** 설문마다 요청을 하나씩만 돌리고, 도는 동안의 클릭은 의도만
 *   갱신한다. 요청이 끝났을 때 의도가 서버 상태와 다르면 그 값을 한 번 더 보낸다 — 요청을 겹쳐
 *   보내면 도착 순서가 뒤집혀 첫 클릭이 이길 수 있다. 서버도 결과 상태 지정이라 재시도가 안전하다.
 * - **실패하면 서버가 가진 상태로 되돌리고** 이유를 토스트로 보인다(남은 의도는 버린다).
 * - 정착하면 목록 페이지를 다시 읽는다 — 즐겨찾기만 보기에서 끈 카드가 빠지고 다른 페이지의 별
 *   개수가 맞춰진다.
 *
 * 의도 표는 이 훅 인스턴스가 쥔다 — 목록 화면에 하나만 두고 카드에 콜백으로 내린다.
 */
export function useSetFavorite(): (surveyId: string, on: boolean) => void {
  const queryClient = useQueryClient();
  const intents = useRef(new Map<string, FavoriteIntent>());

  function send(surveyId: string, intent: FavoriteIntent): void {
    const on = intent.desired;
    client.workspace.personalMarks.setFavorite({ surveyId, on }).then(
      () => {
        intent.confirmed = on;
        if (intent.desired !== on) {
          send(surveyId, intent);
          return;
        }
        intents.current.delete(surveyId);
        void queryClient.invalidateQueries({ queryKey: surveyKeys.pages() });
      },
      (error: unknown) => {
        intents.current.delete(surveyId);
        patchFavorite(queryClient, surveyId, intent.confirmed);
        toast.error(getErrorMessage(error, '즐겨찾기를 바꾸지 못했습니다.'));
        void queryClient.invalidateQueries({ queryKey: surveyKeys.pages() });
      },
    );
  }

  return (surveyId, on) => {
    // 도는 목록 조회가 낙관적 값을 덮어쓰지 않게 — 정착 후 무효화가 다시 읽는다.
    void queryClient.cancelQueries({ queryKey: surveyKeys.pages() });
    patchFavorite(queryClient, surveyId, on);
    const pending = intents.current.get(surveyId);
    if (pending) {
      pending.desired = on;
      return;
    }
    // 카드가 보인 값의 반대를 누른 것이다 — 서버가 가진 값은 그 직전 값.
    const intent: FavoriteIntent = { confirmed: !on, desired: on };
    intents.current.set(surveyId, intent);
    send(surveyId, intent);
  };
}
