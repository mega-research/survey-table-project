import type { Question } from '@/types/survey';
import { getBranchRuleForResponse } from '@/utils/branch-logic';

/**
 * 제출된 응답이 자격미달(부적격)로 종료됐는지 판정한다.
 *
 * `end` 분기 규칙은 해당 선택지에 응답값이 있어야만 트리거되므로, 값의 존재가 곧
 * 응답자가 그 질문에 도달했다는 뜻이다. 따라서 전 질문을 훑어 `endOutcome`이
 * 'screened_out' 인 end 규칙이 하나라도 매칭되면 자격미달로 본다.
 *
 * `endOutcome` 미지정은 'completed' 로 해석한다 — 기존 설문의 end 분기가 조용히
 * 자격미달로 재분류되는 것을 막는 기본값이다.
 */
export function detectScreenOut(
  questions: Question[],
  responses: Record<string, unknown>,
): boolean {
  for (const question of questions) {
    const rule = getBranchRuleForResponse(question, responses[question.id]);
    if (rule?.action === 'end' && rule.endOutcome === 'screened_out') return true;
  }
  return false;
}
