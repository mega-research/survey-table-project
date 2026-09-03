import type { Question } from '@/types/survey';
import {
  isGroupedChoiceQuestion,
  collectChoiceGroups,
  isGroupedRankingQuestion,
  collectRankingGroups,
  type ChoiceGroupWithCells,
} from '@/utils/choice-group-helpers';
import { parseRankingAnswers } from '@/utils/ranking-shared';
import { resolveRequiredMessage } from '@/utils/required-message';

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
 * - ranking: grouped면 모든 그룹에 1개 이상의 순위 응답 (Record<groupKey, RankingAnswer[]>). 비그룹 또는 live 그룹 0개(phantom-only)는 true.
 * - default: true.
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
    // fallthrough: checkbox 질문도 choiceGroups 가 있으면 grouped 경로를 밟는다.
    case 'checkbox':
      // 그룹별 선택(radio 또는 checkbox 그룹 1개 이상):
      // 그룹별 required 오버라이드가 있으면 유효 필수 그룹만, 없으면 기존처럼 모든 그룹.
      // 그룹 type별 검증:
      //   - radio 그룹: 비어있지 않은 string 값이 있어야 한다.
      //   - checkbox 그룹: 1개 이상의 요소를 가진 배열이어야 한다.
      if (isGroupedChoiceQuestion(question)) {
        const map = (response ?? {}) as Record<string, unknown>;
        return checkTargetChoiceGroups(question).every((g) => isChoiceGroupFilled(g, map));
      }
      // 비그룹 checkbox — 기존 배열 + minSelections 검증
      if (question.type === 'checkbox') {
        if (!Array.isArray(response) || response.length === 0) return false;
        if (question.minSelections !== undefined && question.minSelections > 0) {
          return response.length >= question.minSelections;
        }
        return true;
      }
      // 비그룹 radio
      return response !== null && response !== undefined && response !== '';
    case 'select':
      return response !== null && response !== undefined && response !== '';
    case 'multiselect':
      return Array.isArray(response) && response.length > 0;
    case 'ranking': {
      // 비그룹 순위형: 기존 동작(상단 null 가드만 적용, 항상 true) 불변
      if (!isGroupedRankingQuestion(question)) return true;
      // phantom-only 그룹(멤버 셀 0인 ranking 그룹만 존재)은 응답 불가능한 요구이므로
      // 비그룹과 동일하게 취급하여 상단 null 가드만 적용(항상 true).
      const groups = collectRankingGroups(question);
      if (groups.length === 0) return true;
      // grouped: 모든 그룹에 1개 이상의 순위 응답.
      // legacy flat 배열(이식 직후 진행중 응답)은 맵이 아니므로 미충족.
      if (typeof response !== 'object' || response === null || Array.isArray(response)) return false;
      const map = response as Record<string, unknown>;
      return groups.every((g) => parseRankingAnswers(map[g.groupKey]).length >= 1);
    }
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

/** 그룹 충족 판정 — radio 그룹: 비어있지 않은 string, checkbox 그룹: 비어있지 않은 배열 */
function isChoiceGroupFilled(
  group: ChoiceGroupWithCells,
  map: Record<string, unknown>,
): boolean {
  if (group.type === 'checkbox') {
    return Array.isArray(map[group.groupKey]) && (map[group.groupKey] as unknown[]).length > 0;
  }
  return typeof map[group.groupKey] === 'string' && map[group.groupKey] !== '';
}

/**
 * 충족 검사 대상 그룹 — 그룹별 required 오버라이드를 질문 레벨 required 와 합성한다.
 * 유효 필수 그룹(required ?? question.required === true)이 하나라도 있으면 그 그룹들만,
 * 하나도 없으면 기존 의미론(모든 그룹)을 유지한다 — 선택형 그룹 질문의 진행률
 * 집계(모든 그룹 채워야 "답변됨")가 바뀌지 않도록.
 */
function checkTargetChoiceGroups(question: Question): ChoiceGroupWithCells[] {
  const groups = collectChoiceGroups(question);
  const required = groups.filter((g) => (g.required ?? question.required) === true);
  return required.length > 0 ? required : groups;
}

/** 그룹에 명시적 required:true 오버라이드가 있는지 — 질문 필수 OFF 여도 차단 판정에 태운다 */
export function hasExplicitRequiredChoiceGroup(question: Question): boolean {
  if (!isGroupedChoiceQuestion(question)) return false;
  return collectChoiceGroups(question).some((g) => g.required === true);
}

/**
 * 필수 미응답 안내 문구 해석 (그룹 인지) — 미충족 필수 그룹 중 문구가 지정된
 * 첫 그룹의 문구를 쓰고, 없으면 질문 requiredMessage → 기본 문구로 폴백한다.
 * 비그룹 질문은 질문 레벨 해석과 동일.
 */
export function resolveGroupedRequiredMessage(question: Question, response: unknown): string {
  if (isGroupedChoiceQuestion(question)) {
    const map = (response ?? {}) as Record<string, unknown>;
    const unmet = checkTargetChoiceGroups(question).find((g) => !isChoiceGroupFilled(g, map));
    const custom = unmet?.requiredMessage?.trim();
    if (custom) return custom;
  }
  return resolveRequiredMessage(question);
}
