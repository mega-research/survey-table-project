'use client';

import { useEffect, useState } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  type SurveySuggestion,
  splitSurveyListSearchWords,
} from '@/shared/contracts/survey-builder-io';
import { orpc } from '@/shared/lib/rpc';
import { surveyKeys } from '@/shared/lib/survey-list-queries';

/** 타이핑이 이만큼 멈추면 한 번 묻는다. */
export const SURVEY_SUGGEST_DEBOUNCE_MS = 200;

/**
 * 자동완성 후보 키 — `lists()` 아래라 설문 생성·이동·삭제·카드 제목 변경이 접는 무효화를 그대로
 * 받는다(바뀐 제목이 후보에 남지 않게). 소비자가 목록 화면 하나라 키는 이 feature 에 둔다.
 */
export const surveySuggestKeys = {
  all: () => [...surveyKeys.lists(), 'suggest'] as const,
  of: (scope: string | null, q: string) => [...surveySuggestKeys.all(), scope, q] as const,
};

/** 검색어를 단어 단위로 접는다 — 앞뒤·연속 공백만 다른 검색어는 같은 조회다(서버도 단어로 나눈다). */
function normalizeSuggestQuery(q: string): string {
  return splitSurveyListSearchWords(q).join(' ');
}

export interface SurveySuggestionsState {
  /**
   * 지금 검색어의 설문 후보. **null 이면 보일 것이 없다** — 꺼짐·빈 검색어·아직 묻는 중·실패.
   * 실패도 null 로 접는다: 자동완성이 안 떠도 Enter 검색은 그대로 동작해야 해서 오류를 화면에
   * 올리지 않는다.
   */
  suggestions: SurveySuggestion[] | null;
  /** 지금 검색어의 후보를 기다리는 중(디바운스 대기 포함). */
  isPending: boolean;
}

/**
 * 자동완성 「설문」 칸 (설문 즐겨찾기·태그 티켓 05).
 *
 * - 타이핑이 200ms 멈추면 그 검색어로 `surveyBuilder.read.suggest` 를 한 번 부른다.
 * - 새 글자가 오면 앞선 요청을 그 자리에서 취소한다(AbortSignal 이 RPC 까지 간다).
 * - 늦게 온 결과는 그 검색어의 캐시 칸에만 앉는다 — 키가 검색어라 지금 검색어의 후보로 보이지 않는다.
 * - 같은 검색어는 TanStack Query 캐시가 30초 기억한다. 서버 캐시(Redis 등)는 두지 않는다.
 * - 재시도하지 않는다 — 실패는 후보 칸만 비우고 끝난다.
 */
export function useSurveySuggestions({
  scope,
  q,
  enabled,
}: {
  scope: string | null;
  q: string;
  enabled: boolean;
}): SurveySuggestionsState {
  const normalized = normalizeSuggestQuery(q);
  const [debounced, setDebounced] = useState('');
  const queryClient = useQueryClient();

  useEffect(() => {
    if (normalized === debounced) return;
    // 앞선 검색어의 요청은 지금 취소한다 — 디바운스가 끝날 때까지 기다리지 않는다.
    void queryClient.cancelQueries({ queryKey: surveySuggestKeys.of(scope, debounced) });
    const timer = setTimeout(() => setDebounced(normalized), SURVEY_SUGGEST_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [normalized, debounced, scope, queryClient]);

  const settled = debounced === normalized;
  const active = enabled && normalized !== '';
  const query = useQuery({
    queryKey: surveySuggestKeys.of(scope, debounced),
    queryFn: ({ signal }) =>
      orpc.surveyBuilder.read.suggest.call({ scope, q: debounced }, { signal }),
    enabled: active && settled,
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (!active) return { suggestions: null, isPending: false };
  if (!settled) return { suggestions: null, isPending: true };
  if (query.isSuccess) return { suggestions: query.data, isPending: false };
  return { suggestions: null, isPending: query.isPending && !query.isError };
}
