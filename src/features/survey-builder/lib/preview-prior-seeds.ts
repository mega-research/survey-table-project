/**
 * 빌더(설문 편집) 미리보기의 이월 값 — 첫 번째 조사 대상의 이월 응답을 응답 화면과 같은 규칙으로 깐다.
 *
 * 적재는 공개 경로·관리자 「설문 보기」와 같다(`normalizePriorAnswers` → `omitDisabledPriorAnswers`).
 * 깔 문항 판정도 응답 화면의 `collectPriorAnswerPrefills` 를 그대로 쓴다 — 값이 이미 있는 문항은 덮지 않고,
 * 답이 없는 유형·「이월값 불러오기」를 끈 문항·이월값 조건이 거짓인 문항은 뺀다. 미리보기는 한 화면에
 * 모든 문항을 그리므로 단계가 아니라 문항 전체를 넘긴다. 기타·상세 기재(`__optTexts__`)는 응답 값이 아니라
 * 스토어 사이드카라 따로 돌려준다.
 */
import { collectPriorAnswerPrefills, type PriorAnswerPrefillEntry } from '@/features/survey-response/lib/prior-answer-prefill';
import { readOptTextsSidecar } from '@/lib/option-text-read';
import { omitDisabledPriorAnswers } from '@/lib/survey/prior-answer-condition';
import { normalizePriorAnswers } from '@/lib/survey/prior-answers';
import type { Question } from '@/types/survey';
import type { BranchEvalCtx } from '@/utils/branch-eval';

export interface PreviewPriorSeeds {
  entries: PriorAnswerPrefillEntry[];
  optionTexts: Record<string, Record<string, string>>;
}

export function collectPreviewPriorSeeds(
  raw: unknown,
  questions: readonly Question[],
  responses: Record<string, unknown>,
  evalCtx?: BranchEvalCtx,
): PreviewPriorSeeds {
  const prior = raw == null ? null : omitDisabledPriorAnswers(normalizePriorAnswers(raw), questions);
  if (!prior || Object.keys(prior).length === 0) return { entries: [], optionTexts: {} };
  return {
    entries: collectPriorAnswerPrefills(questions, prior, responses, questions, evalCtx),
    optionTexts: readOptTextsSidecar(prior),
  };
}
