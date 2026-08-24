'use client';

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
} from 'react';

/**
 * 응답 원본 주입 — 렌더러가 실행 환경을 모르게 하는 seam.
 *
 * 렌더러는 질문과 표를 그리는 일만 하고, 응답이 실제로 어디에 사는지는 각 feature 가 정한다.
 * 응답 페이지는 상위 React 상태(value/onChange props)를, 빌더 미리보기는 테스트 응답 스토어를
 * 쓴다. zustand 같은 구현은 주입하는 쪽 소유이고, 렌더러가 아는 것은 아래 함수들뿐이다.
 */

/**
 * 질문 응답의 외부 원본.
 *
 * subscribe/read 는 useSyncExternalStore 계약 그대로다. read 는 "렌더 시점"이 아니라
 * "호출 시점"의 최신 값을 돌려줘야 한다 — 쓰기 채널(use-question-response-writer)의
 * 병합 base 가 이 성질에 기댄다.
 */
export interface QuestionResponseSource {
  subscribe: (onStoreChange: () => void) => () => void;
  read: (questionId: string) => unknown;
  /** 병합이 끝난 질문 응답을 통째로 커밋한다. */
  write: (questionId: string, next: Record<string, unknown>) => void;
}

/**
 * 옵션 사이드카 텍스트(allowTextInput 기타 기입) 원본.
 *
 * 질문 응답과 달리 응답 페이지와 빌더 미리보기가 같은 저장소를 공유한다 —
 * 인용값 계산이 양쪽에서 같은 입력을 봐야 하기 때문.
 */
export interface OptionTextSource {
  subscribe: (onStoreChange: () => void) => () => void;
  read: (questionId: string) => Record<string, string> | undefined;
  write: (questionId: string, optionId: string, text: string) => void;
}

export interface ResponseSources {
  /** null 이면 value/onChange props 가 유일한 원본이다 (controlled 렌더). */
  questionResponses: QuestionResponseSource | null;
  optionTexts: OptionTextSource;
  /**
   * 곧 이어질 이 질문의 쓰기가 **응답자의 입력이 아니라 미리 채운 값**임을 알린다.
   *
   * prefill(defaultValueTemplate)과 숫자 빈값 기본치는 마운트 직후 스스로 한 번 쓴다.
   * 렌더러 입장에서는 둘 다 그냥 쓰기지만, 호스트에게는 "응답자가 아무것도 하지 않았다" 는
   * 사실이 중요할 수 있다. 렌더러는 그 사실만 알리고 무엇을 할지는 호스트가 정한다.
   *
   * 호출 규약: 알린 **직후 동기적으로** 해당 질문에 쓴다. 미주입이면 no-op.
   */
  markSeedWrite?: ((questionId: string) => void) | undefined;
}

const NOOP_UNSUBSCRIBE = () => {};
const noSubscribe = (): (() => void) => NOOP_UNSUBSCRIBE;

/**
 * Provider 없이 마운트된 경우. 질문 응답은 props 만 보면 되므로 그대로 동작하지만,
 * 옵션 텍스트는 저장할 곳이 없다 — 조용히 삼키면 사이드카가 통째로 유실되므로 소리를 낸다.
 */
const UNCONFIGURED: ResponseSources = {
  questionResponses: null,
  optionTexts: {
    subscribe: noSubscribe,
    read: () => undefined,
    write: () => {
      if (process.env.NODE_ENV !== 'production') {
        console.error(
          '[question-renderer] ResponseSourcesProvider 없이 옵션 텍스트를 쓰려 했습니다. 호출부가 원본을 주입해야 합니다.',
        );
      }
    },
  },
};

const ResponseSourcesContext = createContext<ResponseSources>(UNCONFIGURED);

export function ResponseSourcesProvider({
  sources,
  children,
}: {
  sources: ResponseSources;
  children: ReactNode;
}) {
  return (
    <ResponseSourcesContext.Provider value={sources}>{children}</ResponseSourcesContext.Provider>
  );
}

export function useResponseSources(): ResponseSources {
  return useContext(ResponseSourcesContext);
}

/**
 * 질문 응답 원본에서 파생값을 구독한다. source 가 null 이면 select(undefined) 고정값.
 *
 * select 는 안정 참조여야 한다(useCallback 또는 모듈 상수) — getSnapshot 이 매 렌더
 * 새 함수가 되면 useSyncExternalStore 가 렌더마다 스냅샷 재확인 effect 를 돌린다.
 * 서버 스냅샷도 같은 함수를 쓴다: 원본에 쓰는 주체는 브라우저 이벤트 핸들러뿐이라
 * 서버에서 read() 는 항상 초기값(미응답)이다.
 */
export function useQuestionResponseSelector<T>(
  source: QuestionResponseSource | null,
  questionId: string,
  select: (questionResponse: unknown) => T,
): T {
  const getSnapshot = useCallback(
    () => select(source ? source.read(questionId) : undefined),
    [source, questionId, select],
  );
  return useSyncExternalStore(source ? source.subscribe : noSubscribe, getSnapshot, getSnapshot);
}

/** 질문 단위 옵션 텍스트 맵 구독. */
export function useOptionTexts(
  source: OptionTextSource,
  questionId: string,
): Record<string, string> | undefined {
  const getSnapshot = useCallback(() => source.read(questionId), [source, questionId]);
  return useSyncExternalStore(source.subscribe, getSnapshot, getSnapshot);
}
