'use client';

import type {
  QuestionResponseSource,
  ResponseSources,
} from '@/features/question-renderer/response-sources';
import { optionTextSource } from '@/features/survey-response/stores/live-response-sources';

import { useTestResponseStore } from './test-response-store';

/**
 * 빌더 미리보기의 질문 응답 원본 — 테스트 응답 스토어.
 * read 는 호출 시점 최신값이라 같은 tick 에 여러 셀이 써도 패치가 누적된다.
 */
export const testQuestionResponseSource: QuestionResponseSource = {
  subscribe: (onStoreChange) => useTestResponseStore.subscribe(onStoreChange),
  read: (questionId) => useTestResponseStore.getState().testResponses[questionId],
  write: (questionId, next) =>
    useTestResponseStore
      .getState()
      .updateTestResponse(questionId, next as Record<string, string | string[] | object>),
};

/** 빌더 미리보기가 렌더러에 주입하는 응답 원본 묶음. */
export const previewResponseSources: ResponseSources = {
  questionResponses: testQuestionResponseSource,
  optionTexts: optionTextSource,
};
