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
 * 응답 페이지의 응답 원본.
 * 질문 응답은 응답 흐름의 React 상태가 소유하므로 렌더러에 줄 외부 원본이 없다 —
 * 렌더러는 value/onChange props 만 본다(controlled).
 */
export const liveResponseSources: ResponseSources = {
  questionResponses: null,
  optionTexts: optionTextSource,
};
