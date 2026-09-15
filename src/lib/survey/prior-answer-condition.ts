import { OPT_TEXTS_KEY } from '@/lib/survey/response-sidecars';
import type { PriorAnswers } from '@/lib/survey/prior-answers';
import type { Question, QuestionConditionGroup } from '@/types/survey';
import { type BranchEvalCtx, emptyBranchEvalCtx } from '@/utils/branch-eval';
import { evaluateQuestionConditionGroup } from '@/utils/branch-logic';

/**
 * 이월값 불러오기 조건 — 문항 단위로 "이 문항은 언제 이월값을 받는가" 를 정한다.
 *
 * 표시 조건과 **별개 축**이다. 표시 조건은 문항을 보일지 정하고, 이 조건은 보이는 문항에
 * 이월값을 깔지 정한다. 두 축이 필요한 이유는 같은 문항 안에서 갈리는 경우가 있어서다 —
 * 이직했으면 작년 회사를 지우고 새로 받아야 하는데 문항 자체는 양쪽 다 보여야 한다.
 * 표시 조건으로는 "보이되 안 채운다" 를 표현할 수 없다.
 *
 * **미설정은 불러온다.** 이 필드가 없던 시절에 발행된 설문이 그대로 돌아가야 한다.
 * 조건 형태가 깨진 JSONB 도 같은 쪽으로 폴백한다 — 표시 조건의 실패 방향(보이는 쪽)과
 * 같은 규약이며, 여기서 안 채우는 쪽으로 넘어지면 지난 회차 답이 조용히 사라진다.
 *
 * `priorAnswerDisabled` 는 조건보다 앞선다. 「이월값 불러오기」를 끈 문항은 조건이
 * 무엇이든 안 받는다 — 이월을 막으려고 도달 불가능한 조건을 걸던 우회를 대체한다.
 */
export function shouldLoadPriorAnswer(
  question: Question,
  responses: Record<string, unknown>,
  allQuestions: readonly Question[],
  evalCtx?: BranchEvalCtx,
): boolean {
  if (question.priorAnswerDisabled === true) return false;
  const condition = question.priorAnswerCondition as QuestionConditionGroup | undefined;
  if (!condition) return true;
  if (!Array.isArray(condition.conditions) || condition.conditions.length === 0) return true;
  return evaluateQuestionConditionGroup(
    condition,
    responses,
    [...allQuestions],
    evalCtx ?? emptyBranchEvalCtx(),
  );
}

/**
 * 이월 응답 한 벌에서 이월값 불러오기 조건이 거짓인 문항의 값을 걷어낸다.
 *
 * 변동 확인(체인지 컨펌) 스위치가 켜진 경로가 쓰는 필터다. 그 경로는 이 함수를 거치지
 * 않은 원본 이월 응답을 그대로 표시·잠금·확인 게이트·확인 시 복사에 썼는데, 그러면
 * 문항별 이월값 조건이 조용히 무시된다 — 스위치를 켜는 순간 이 기능이 죽는 셈이다.
 * 조건이 없는 문항, 조건이 참인 문항, 문항 목록에 없는 키(사이드카 등)는 그대로 통과한다.
 */
export function filterPriorAnswersByCondition(
  prior: PriorAnswers | null | undefined,
  questions: readonly Question[],
  responses: Record<string, unknown>,
  evalCtx?: BranchEvalCtx,
): PriorAnswers | null {
  if (!prior) return null;
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const filtered: PriorAnswers = {};
  for (const [questionId, value] of Object.entries(prior)) {
    const question = questionById.get(questionId);
    if (question && !shouldLoadPriorAnswer(question, responses, questions, evalCtx)) continue;
    filtered[questionId] = value;
  }
  return filtered;
}

/**
 * 이월 응답에서 「이월값 불러오기」를 끈 문항의 값을 통째로 걷어낸다.
 *
 * 조건 기반 필터(`filterPriorAnswersByCondition`)와 달리 현재 응답을 보지 않는다 —
 * 스위치는 응답과 무관한 정적 설정이라 설문 로드 시점에도 판정할 수 있다.
 *
 * 로더는 이월 응답의 `__optTexts__`(상세 기재 사이드카)를 입력란 스토어에 시드하는데,
 * 그 시드는 프리필 effect 보다 먼저 돌고 문항별 게이트가 없었다. 그래서 스위치를 꺼도
 * 상세 기재 칸에는 지난 회차 값이 그대로 보였다(2026-09-08 DQ7 매출액 10000).
 * 사이드카는 문항 id 로 묶여 있으므로 같은 판정으로 함께 걷어낸다.
 */
export function omitDisabledPriorAnswers(
  prior: PriorAnswers | null | undefined,
  questions: readonly Question[],
): PriorAnswers | null {
  if (!prior) return null;
  const disabled = new Set(
    questions.filter((q) => q.priorAnswerDisabled === true).map((q) => q.id),
  );
  if (disabled.size === 0) return prior;
  const out: PriorAnswers = {};
  for (const [key, value] of Object.entries(prior)) {
    if (disabled.has(key)) continue;
    if (key === OPT_TEXTS_KEY && value && typeof value === 'object' && !Array.isArray(value)) {
      const kept = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).filter(([qid]) => !disabled.has(qid)),
      );
      if (Object.keys(kept).length > 0) out[key] = kept as PriorAnswers[string];
      continue;
    }
    out[key] = value;
  }
  return out;
}
