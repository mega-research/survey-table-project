import type { Question, QuestionGroup } from '@/types/survey';
import type { BranchEvalCtx } from '@/utils/branch-eval';
import { getBranchRuleForResponse, shouldDisplayQuestion } from '@/utils/branch-logic';

interface DetectScreenOutOptions {
  /** 스냅샷의 질문 그룹 — 그룹 표시 조건까지 반영하려면 필요하다. */
  groups?: QuestionGroup[];
  /** LUT·컨택 attrs 를 참조하는 표시 조건 평가용 컨텍스트. 클라이언트와 같은 재료를 넘긴다. */
  evalCtx?: BranchEvalCtx;
}

/**
 * 제출된 응답이 자격미달(부적격)로 종료됐는지 판정한다.
 *
 * `end` 분기 규칙은 해당 선택지에 응답값이 있어야만 트리거되므로, 값의 존재가 곧
 * 응답자가 그 질문에 도달했다는 뜻이다. 따라서 전 질문을 훑어 `endOutcome`이
 * 'screened_out' 인 end 규칙이 하나라도 매칭되면 자격미달로 본다.
 *
 * 단, "값의 존재 = 도달" 은 표시 조건을 함께 봐야 성립한다. 응답자가 뒤 질문에서
 * 자격미달 옵션을 고른 뒤 앞 질문으로 돌아가 그 질문을 숨기면, 클라이언트는 숨은
 * 질문의 답을 지우지 않고 제출 페이로드에 그대로 실어 보낸다. 표시 조건이 거짓인
 * 질문은 응답자가 실제로 지나온 경로가 아니므로 판정에서 제외한다.
 *
 * `endOutcome` 미지정은 'completed' 로 해석한다 — 기존 설문의 end 분기가 조용히
 * 자격미달로 재분류되는 것을 막는 기본값이다.
 */
export function detectScreenOut(
  questions: Question[],
  responses: Record<string, unknown>,
  options?: DetectScreenOutOptions,
): boolean {
  for (const question of questions) {
    if (!shouldDisplayQuestion(question, responses, questions, options?.groups, options?.evalCtx)) {
      continue;
    }
    const rule = getBranchRuleForResponse(question, responses[question.id]);
    if (rule?.action === 'end' && rule.endOutcome === 'screened_out') return true;
  }
  return false;
}
