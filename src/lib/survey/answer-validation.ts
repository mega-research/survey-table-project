import type { Question } from '@/types/survey';
import {
  choiceValueKey,
  collectExclusiveChoiceCellIdsFromRows,
  collectTableExclusiveChoiceCellIds,
  hasTableExclusiveSelected,
  satisfiesMinSelections,
} from '@/lib/survey/exclusive-choice';
import {
  isGroupedChoiceQuestion,
  collectChoiceGroups,
  isGroupedRankingQuestion,
  collectRankingGroups,
  type ChoiceGroupWithCells,
} from '@/utils/choice-group-helpers';
import { parseRankingAnswers } from '@/utils/ranking-shared';
import { resolveRequiredMessage } from '@/utils/required-message';
import { collectChoiceOptCells } from '@/utils/choice-source';
import { isChoiceGroupTableQuestion, readTableChoiceGroups } from './choice-selection';

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
 * - checkbox: 배열이고 길이 > 0. minSelections 가 양수면 그 이상 — 단, 단독 선택 보기(「없음」)가
 *   하나라도 들어 있으면 개수와 무관하게 충족(CONTEXT.md "단독 선택 보기").
 * - multiselect: 배열이고 길이 > 0.
 * - table: 비어있지 않은 object.
 * - ranking: requireAllPositions 면 매길 순위 전부, 아니면 1개 이상. grouped 면 그룹마다 그만큼.
 *   live 그룹 0개(phantom-only)는 true.
 * - default: true.
 *
 * @param question 판정 대상 질문 (type/required/minSelections/requiresAcknowledgment 사용)
 * @param response 해당 질문의 현재 응답값 (responses[question.id] 와 동일)
 */
/**
 * 순위형이 충족되려면 몇 개를 골라야 하는지.
 *
 * `rankingConfig.requireAllPositions` 가 켜져 있으면 매길 순위 전부, 아니면 1순위 하나다.
 * 고를 수 있는 보기가 순위 개수보다 적으면 그만큼으로 낮춘다 — 채울 수 없는 개수를
 * 요구하면 응답자가 영영 다음으로 못 넘어간다. 그룹 순위형은 그룹마다 보기 수가 다르므로
 * 판정도 그룹 단위로 한다(`optionCount` 를 그룹의 멤버 셀 수로 넘긴다).
 */
function requiredRankCount(question: Question, optionCount: number): number {
  const config = question.rankingConfig;
  if (config?.requireAllPositions !== true) return 1;
  const positions = Math.max(1, Math.trunc(config.positions ?? 3));
  return optionCount > 0 ? Math.min(positions, optionCount) : positions;
}

/**
 * 비그룹 checkbox 응답값 하나가 단독 선택 보기인가. 값은 옵션 value(일반 문항) 또는
 * 보기 셀 id(보기 소스 표)이고, 기타 상세기재는 `{selectedValue}` 객체다.
 */
function isExclusiveChoiceValue(question: Question, val: unknown): boolean {
  const key = choiceValueKey(val);
  if (key === undefined) return false;
  if (question.options?.some((o) => o.exclusiveChoice === true && o.value === key)) return true;
  return collectExclusiveChoiceCellIdsFromRows(question.tableRowsData).has(key);
}

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
        if (isTableExclusiveSelected(question, map)) return true;
        return checkTargetChoiceGroups(question).every((g) => isChoiceGroupFilled(g, map));
      }
      // 비그룹 checkbox — 기존 배열 + minSelections 검증. 단독 선택 보기(「없음」) 하나면
      // 완결된 답이라 최소 선택 수를 충족한 것으로 본다 (CONTEXT.md "단독 선택 보기").
      if (question.type === 'checkbox') {
        if (!Array.isArray(response) || response.length === 0) return false;
        return satisfiesMinSelections(response, question.minSelections, (val) =>
          isExclusiveChoiceValue(question, val),
        );
      }
      // 비그룹 radio
      return response !== null && response !== undefined && response !== '';
    case 'select':
      return response !== null && response !== undefined && response !== '';
    case 'multiselect':
      return Array.isArray(response) && response.length > 0;
    case 'ranking': {
      // 채워야 할 순위 개수. 「모든 순위 입력 필수」가 켜져 있으면 positions 전체,
      // 아니면 1순위 하나. 이 토글은 빌더가 저장만 하고 읽는 곳이 없어 여태 아무 일도
      // 하지 않았다 — 1순위만 골라도 제출이 통과했다.
      if (!isGroupedRankingQuestion(question)) {
        // 비그룹 순위형. needed 가 1 이어도 빈 배열은 미충족이다 — 예전에는 상단 null
        // 가드만 통과하면 무조건 true 라 빈 배열도 응답으로 쳤다.
        const needed = requiredRankCount(question, question.options?.length ?? 0);
        return parseRankingAnswers(response).length >= needed;
      }
      // phantom-only 그룹(멤버 셀 0인 ranking 그룹만 존재)은 응답 불가능한 요구이므로
      // 비그룹과 동일하게 취급하여 상단 null 가드만 적용(항상 true).
      const groups = collectRankingGroups(question);
      if (groups.length === 0) return true;
      // grouped: 모든 그룹이 needed 개 이상.
      // legacy flat 배열(이식 직후 진행중 응답)은 맵이 아니므로 미충족.
      if (typeof response !== 'object' || response === null || Array.isArray(response)) return false;
      const map = response as Record<string, unknown>;
      return groups.every(
        (g) =>
          parseRankingAnswers(map[g.groupKey]).length >= requiredRankCount(question, g.cells.length),
      );
    }
    case 'table':
      // 보기 그룹 표 — 필수 그룹이 다 차야 응답이다. 입력 셀의 필수는 차단형 검증(셀 단위)이
      // 따로 본다. 선택은 표 응답 안 예약 키에 있어 정본 리더로 읽는다.
      if (isChoiceGroupTableQuestion(question)) {
        const map = readTableChoiceGroups(response);
        if (isTableExclusiveSelected(question, map)) return true;
        return checkTargetChoiceGroups(question).every((g) => isChoiceGroupFilled(g, map));
      }
      return (
        typeof response === 'object' &&
        response !== null &&
        Object.keys(response as Record<string, unknown>).length > 0
      );
    default:
      return true;
  }
}

/**
 * 표 전체 범위 단독 선택 보기(「없음」)가 골라져 있으면 이 표의 그룹 전부를 충족으로 본다 —
 * 그 보기가 다른 그룹까지 비우므로, 비운 그룹을 미충족으로 세면 「다음」이 영원히 막힌다.
 */
function isTableExclusiveSelected(question: Question, map: Record<string, unknown>): boolean {
  const ids = collectTableExclusiveChoiceCellIds(collectChoiceOptCells(question.tableRowsData));
  return hasTableExclusiveSelected(map, ids);
}

/**
 * 그룹 선택 맵 — 레거시 radio/checkbox 는 문항 응답 자체가 `{그룹키: ...}` 이고,
 * 보기 그룹 표(table)는 표 응답 안 예약 키에 있다. 두 모양을 한 맵으로 편다.
 */
function groupSelectionMap(question: Question, response: unknown): Record<string, unknown> {
  if (question.type === 'table') return readTableChoiceGroups(response);
  return (response ?? {}) as Record<string, unknown>;
}

/**
 * 그룹 충족 판정 — radio 그룹: 비어있지 않은 string, checkbox 그룹: 비어있지 않은 배열.
 * `ChoiceGroup.minSelections` 는 타입에만 있고 아직 어디서도 읽지 않는다 — 살릴 때는 개수 비교
 * 대신 `satisfiesMinSelections` 를 끼워 단독 선택 보기 면제를 같이 태울 것.
 */
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
/**
 * 아직 채워지지 않은 **필수** 보기 그룹의 셀 id 집합.
 *
 * 응답 화면이 "어디를 채워야 하는가" 를 자리로 보여주는 데 쓴다. 문구 하나는 미충족
 * 그룹 중 첫 번째만 알려주므로(`resolveGroupedRequiredMessage`), 열 개짜리 표에서는
 * 글만으로 위치를 짚기 어렵다.
 *
 * 대상 그룹 판정은 필수 게이트와 **같은 술어**를 쓴다 — 갈라지면 "빨갛지 않은데 다음이
 * 막힘" 또는 그 반대가 생긴다. 그룹 문항이 아니거나 다 채웠으면 빈 집합.
 */
export function collectUnfilledChoiceGroupCellIds(
  question: Question,
  response: unknown,
): Set<string> {
  if (!isGroupedChoiceQuestion(question)) return new Set();
  const map = groupSelectionMap(question, response);
  const out = new Set<string>();
  if (isTableExclusiveSelected(question, map)) return out;
  for (const group of checkTargetChoiceGroups(question)) {
    if (isChoiceGroupFilled(group, map)) continue;
    for (const cell of group.cells) out.add(cell.id);
  }
  return out;
}

export function resolveGroupedRequiredMessage(question: Question, response: unknown): string {
  if (isGroupedChoiceQuestion(question)) {
    const map = groupSelectionMap(question, response);
    const unmet = isTableExclusiveSelected(question, map)
      ? undefined
      : checkTargetChoiceGroups(question).find((g) => !isChoiceGroupFilled(g, map));
    const custom = unmet?.requiredMessage?.trim();
    if (custom) return custom;
  }
  return resolveRequiredMessage(question);
}
