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
 */
export function shouldLoadPriorAnswer(
  question: Question,
  responses: Record<string, unknown>,
  allQuestions: readonly Question[],
  evalCtx?: BranchEvalCtx,
): boolean {
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
