import type { Question } from '@/types/survey';
import {
  isGroupedChoiceQuestion,
  collectChoiceGroups,
} from '@/utils/choice-group-helpers';

/**
 * 질문 타입별 응답 충족 여부를 판정하는 순수 함수.
 *
 * survey-response-flow.tsx 의 isQuestionAnswered 콜백에서 추출했다.
 * 원본은 컴포넌트 클로저의 responses[question.id] 를 읽었으므로,
 * 여기서는 해당 응답값(response)을 명시적 인자로 받는다.
 *
 * 타입별 9-way 검증 의미론을 원본과 1:1 동일하게 유지한다.
 * - notice: requiresAcknowledgment=false 면 항상 true. true 면 agreed 플래그 또는 response===true.
 * - text/textarea: 공백 제거 후 길이 > 0.
 * - radio/select: null/undefined/'' 가 아니면 true.
 * - checkbox: 배열이고 길이 > 0. minSelections 가 양수면 그 이상.
 * - multiselect: 배열이고 길이 > 0.
 * - table: 비어있지 않은 object.
 * - default(ranking 등): true.
 *
 * @param question 판정 대상 질문 (type/required/minSelections/requiresAcknowledgment 사용)
 * @param response 해당 질문의 현재 응답값 (responses[question.id] 와 동일)
 */
export function isQuestionAnswered(question: Question, response: unknown): boolean {
  if (response === undefined || response === null) return false;

  switch (question.type) {
    case 'notice':
      if (!question.requiresAcknowledgment) return true;
      if (
        response &&
        typeof response === 'object' &&
        'agreed' in (response as Record<string, unknown>)
      )
        return (response as { agreed: boolean }).agreed;
      return response === true;
    case 'text':
    case 'textarea':
      return typeof response === 'string' && response.trim().length > 0;
    case 'radio':
      // 그룹별 선택 radio: 모든 그룹(default 포함)에 선택이 있어야 충족
      if (isGroupedChoiceQuestion(question)) {
        const map = (response ?? {}) as Record<string, unknown>;
        // Task 3에서 그룹 type별로 검증 로직을 분리 예정.
        // 현재는 radio 그룹 전제의 string 존재 여부만 확인한다(동작 무변화).
        return collectChoiceGroups(question).every(
          (g) => typeof map[g.groupKey] === 'string' && map[g.groupKey] !== '',
        );
      }
      return response !== null && response !== undefined && response !== '';
    case 'select':
      return response !== null && response !== undefined && response !== '';
    case 'checkbox':
      if (!Array.isArray(response) || response.length === 0) return false;
      if (question.minSelections !== undefined && question.minSelections > 0) {
        return response.length >= question.minSelections;
      }
      return true;
    case 'multiselect':
      return Array.isArray(response) && response.length > 0;
    case 'table':
      return (
        typeof response === 'object' &&
        response !== null &&
        Object.keys(response as Record<string, unknown>).length > 0
      );
    default:
      return true;
  }
}
