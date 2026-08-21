import type { SurveyResponse } from '@/db/schema';
import type { Question, QuestionType } from '@/types/survey';

// ========================
// 필터 조건 타입
// ========================

export type FilterOperator =
  | 'equals' // 값이 정확히 일치
  | 'not_equals' // 값이 일치하지 않음
  | 'contains' // 값을 포함 (다중선택, 텍스트)
  | 'not_contains' // 값을 포함하지 않음
  | 'is_empty' // 빈 값
  | 'is_not_empty' // 비어있지 않음
  | 'greater_than' // 숫자 비교
  | 'less_than'; // 숫자 비교

export type FilterLogic = 'AND' | 'OR';

export interface FilterCondition {
  id: string;
  questionId: string;
  operator: FilterOperator;
  value?: string | string[];
}

export interface FilterGroup {
  id: string;
  conditions: FilterCondition[];
  logic: FilterLogic;
}

export interface FilterState {
  groups: FilterGroup[];
  groupLogic: FilterLogic; // 그룹 간 로직
}

export interface SavedSegment {
  id: string;
  name: string;
  description?: string;
  filter: FilterState;
  createdAt: Date;
  color?: string;
}

// ========================
// 필터 적용 함수
// ========================

/**
 * 단일 조건 평가
 */
function evaluateCondition(
  condition: FilterCondition,
  response: SurveyResponse,
  questions: Question[],
): boolean {
  const question = questions.find((q) => q.id === condition.questionId);
  if (!question) return true; // 질문을 찾지 못하면 통과

  const questionResponses = response.questionResponses as Record<string, unknown>;
  const answerValue = questionResponses[condition.questionId];

  switch (condition.operator) {
    case 'is_empty':
      return (
        answerValue === undefined ||
        answerValue === null ||
        answerValue === '' ||
        (Array.isArray(answerValue) && answerValue.length === 0)
      );

    case 'is_not_empty':
      return (
        answerValue !== undefined &&
        answerValue !== null &&
        answerValue !== '' &&
        !(Array.isArray(answerValue) && answerValue.length === 0)
      );

    case 'equals':
      if (Array.isArray(answerValue)) {
        // 다중선택에서 정확히 같은 값들만 선택했는지
        const conditionValues = Array.isArray(condition.value)
          ? condition.value
          : [condition.value];
        return (
          answerValue.length === conditionValues.length &&
          conditionValues.every((v) => answerValue.includes(v))
        );
      }
      return String(answerValue) === String(condition.value);

    case 'not_equals':
      if (Array.isArray(answerValue)) {
        const conditionValues = Array.isArray(condition.value)
          ? condition.value
          : [condition.value];
        return !(
          answerValue.length === conditionValues.length &&
          conditionValues.every((v) => answerValue.includes(v))
        );
      }
      return String(answerValue) !== String(condition.value);

    case 'contains':
      if (Array.isArray(answerValue)) {
        // 다중선택에서 특정 값을 포함하는지
        const conditionValues = Array.isArray(condition.value)
          ? condition.value
          : [condition.value];
        return conditionValues.some((v) => answerValue.includes(v));
      }
      // 텍스트에서 포함 여부
      return String(answerValue).toLowerCase().includes(String(condition.value).toLowerCase());

    case 'not_contains':
      if (Array.isArray(answerValue)) {
        const conditionValues = Array.isArray(condition.value)
          ? condition.value
          : [condition.value];
        return !conditionValues.some((v) => answerValue.includes(v));
      }
      return !String(answerValue).toLowerCase().includes(String(condition.value).toLowerCase());

    case 'greater_than':
      return Number(answerValue) > Number(condition.value);

    case 'less_than':
      return Number(answerValue) < Number(condition.value);

    default:
      return true;
  }
}

/**
 * 필터 그룹 평가
 */
function evaluateFilterGroup(
  group: FilterGroup,
  response: SurveyResponse,
  questions: Question[],
): boolean {
  if (group.conditions.length === 0) return true;

  const results = group.conditions.map((condition) =>
    evaluateCondition(condition, response, questions),
  );

  if (group.logic === 'AND') {
    return results.every(Boolean);
  } else {
    return results.some(Boolean);
  }
}

/**
 * 전체 필터 상태 평가
 */
export function applyFilter(
  filter: FilterState,
  responses: SurveyResponse[],
  questions: Question[],
): SurveyResponse[] {
  if (filter.groups.length === 0) return responses;

  return responses.filter((response) => {
    const groupResults = filter.groups.map((group) =>
      evaluateFilterGroup(group, response, questions),
    );

    if (filter.groupLogic === 'AND') {
      return groupResults.every(Boolean);
    } else {
      return groupResults.some(Boolean);
    }
  });
}

/**
 * 필터 가능한 질문인지 확인
 */
export function isFilterableQuestion(question: Question): boolean {
  const filterableTypes: QuestionType[] = [
    'radio',
    'checkbox',
    'select',
    'multiselect',
    'text',
    'textarea',
  ];
  return filterableTypes.includes(question.type);
}

/**
 * 질문 타입에 따른 사용 가능한 연산자 반환
 */
export function getAvailableOperators(questionType: QuestionType): FilterOperator[] {
  switch (questionType) {
    case 'radio':
    case 'select':
      return ['equals', 'not_equals', 'is_empty', 'is_not_empty'];

    case 'checkbox':
    case 'multiselect':
      return ['contains', 'not_contains', 'equals', 'not_equals', 'is_empty', 'is_not_empty'];

    case 'text':
    case 'textarea':
      return ['equals', 'not_equals', 'contains', 'not_contains', 'is_empty', 'is_not_empty'];

    default:
      return ['is_empty', 'is_not_empty'];
  }
}

/**
 * 연산자 라벨 반환
 */
export function getOperatorLabel(operator: FilterOperator): string {
  const labels: Record<FilterOperator, string> = {
    equals: '같음',
    not_equals: '같지 않음',
    contains: '포함',
    not_contains: '포함하지 않음',
    is_empty: '응답 없음',
    is_not_empty: '응답 있음',
    greater_than: '보다 큼',
    less_than: '보다 작음',
  };
  return labels[operator];
}

// ========================
// 필터 상태 헬퍼 함수
// ========================

/**
 * 빈 필터 상태 생성
 */
export function createEmptyFilter(): FilterState {
  return {
    groups: [],
    groupLogic: 'AND',
  };
}

/**
 * 새 필터 그룹 생성
 */
export function createFilterGroup(): FilterGroup {
  return {
    id: crypto.randomUUID(),
    conditions: [],
    logic: 'AND',
  };
}

/**
 * 새 필터 조건 생성
 */
export function createFilterCondition(questionId: string): FilterCondition {
  return {
    id: crypto.randomUUID(),
    questionId,
    operator: 'equals',
  };
}

/**
 * 필터 상태에 조건 추가
 */
export function addConditionToFilter(filter: FilterState, condition: FilterCondition): FilterState {
  // 그룹이 없으면 새 그룹 생성
  if (filter.groups.length === 0) {
    const newGroup = createFilterGroup();
    newGroup.conditions.push(condition);
    return {
      ...filter,
      groups: [newGroup],
    };
  }

  // 마지막 그룹에 조건 추가
  const updatedGroups = [...filter.groups];
  const lastGroupSrc = updatedGroups[updatedGroups.length - 1];
  if (!lastGroupSrc) return filter;
  const lastGroup: FilterGroup = { ...lastGroupSrc };
  lastGroup.conditions = [...lastGroup.conditions, condition];
  updatedGroups[updatedGroups.length - 1] = lastGroup;

  return {
    ...filter,
    groups: updatedGroups,
  };
}

/**
 * 필터 상태에서 조건 제거
 */
export function removeConditionFromFilter(filter: FilterState, conditionId: string): FilterState {
  const updatedGroups = filter.groups
    .map((group) => ({
      ...group,
      conditions: group.conditions.filter((c) => c.id !== conditionId),
    }))
    .filter((group) => group.conditions.length > 0); // 빈 그룹 제거

  return {
    ...filter,
    groups: updatedGroups,
  };
}

/**
 * 필터 상태에서 조건 업데이트
 */
export function updateConditionInFilter(
  filter: FilterState,
  conditionId: string,
  updates: Partial<FilterCondition>,
): FilterState {
  const updatedGroups = filter.groups.map((group) => ({
    ...group,
    conditions: group.conditions.map((c) => (c.id === conditionId ? { ...c, ...updates } : c)),
  }));

  return {
    ...filter,
    groups: updatedGroups,
  };
}

/**
 * 활성 필터 조건 개수
 */
export function getActiveFilterCount(filter: FilterState): number {
  return filter.groups.reduce((total, group) => total + group.conditions.length, 0);
}

/**
 * 필터 결과 요약
 */
export interface FilterSummary {
  totalResponses: number;
  filteredResponses: number;
  filterRate: number;
}

export function getFilterSummary(
  filter: FilterState,
  responses: SurveyResponse[],
  questions: Question[],
): FilterSummary {
  const filteredResponses = applyFilter(filter, responses, questions);
  return {
    totalResponses: responses.length,
    filteredResponses: filteredResponses.length,
    filterRate: responses.length > 0 ? (filteredResponses.length / responses.length) * 100 : 0,
  };
}
