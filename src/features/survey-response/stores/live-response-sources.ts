'use client';

import type {
  OptionTextSource,
  ResponseSources,
} from '@/features/question-renderer/response-sources';

import { useSurveyResponseStore } from './survey-response-store';

/**
 * 옵션 사이드카 텍스트 원본 — 응답 페이지와 빌더 미리보기가 같은 저장소를 공유한다.
 * 인용값(collectAnswerQuotes) 계산이 양쪽에서 같은 입력을 봐야 해서 저장소를 하나로 둔다.
 * 그래서 빌더 adapter 도 이 상수를 가져다 쓴다.
 */
export const optionTextSource: OptionTextSource = {
  subscribe: (onStoreChange) => useSurveyResponseStore.subscribe(onStoreChange),
  read: (questionId) => useSurveyResponseStore.getState().optionTexts[questionId],
  write: (questionId, optionId, text) =>
    useSurveyResponseStore.getState().setOptionText(questionId, optionId, text),
};

/**
 * 미리 채운 값(prefill·숫자 빈값 기본치)이 쓰이기 직전에 남기는 표시.
 *
 * 렌더러는 "이 쓰기는 응답자의 입력이 아니다" 만 알리고, 그것을 어떻게 쓸지는 여기 —
 * 응답 흐름 — 가 정한다. 응답 행 INSERT 는 응답자가 실제로 답했을 때만 발사해야 하므로
 * handleResponse 가 이 표시를 보고 트리거를 건너뛴다.
 *
 * 표시는 **한 번만 유효하다**. 알린 직후 동기적으로 쓰기가 이어지는 것이 계약이라
 * 소비도 같은 tick 에 일어난다. 쓰기가 어떤 이유로 삼켜져 소비되지 않으면 표시가 남아
 * 다음 실제 답변을 잘못 억제하므로, microtask 로 스스로 지운다.
 */
const seedWrites = new Set<string>();

/** 표시가 있었으면 지우고 true. 없으면 false. */
export function consumeSeedWrite(questionId: string): boolean {
  return seedWrites.delete(questionId);
}

/**
 * 응답 페이지의 응답 원본.
 * 질문 응답은 응답 흐름의 React 상태가 소유하므로 렌더러에 줄 외부 원본이 없다 —
 * 렌더러는 value/onChange props 만 본다(controlled).
 */
export const liveResponseSources: ResponseSources = {
  questionResponses: null,
  optionTexts: optionTextSource,
  markSeedWrite: (questionId) => {
    seedWrites.add(questionId);
    queueMicrotask(() => seedWrites.delete(questionId));
  },
};
