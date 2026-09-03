import { QuestionCondition } from '@/types/survey';

// tableConditions/additionalConditions는 expression 전환·토글 해제 시 비워야 한다.
// requiredValues/expressionConfig 는 참조 질문 변경 시 이전 질문 종속 설정이라 함께 비운다
// (rowIds·기대값이 새 질문에 없는 id 로 남으면 셀 타입 판정이 unsupported 로 오판한다).
// name은 조건 이름 입력을 비웠을 때 영속 키를 제거해야 한다.
// exactOptionalPropertyTypes 하에서 spread로는 키 제거가 불가하므로 clear 인자로 명시한다.
export type ClearableConditionKey =
  | 'tableConditions'
  | 'additionalConditions'
  | 'requiredValues'
  | 'expressionConfig'
  | 'name';

export type UpdateConditionFn = (
  conditionId: string,
  updates: Partial<QuestionCondition>,
  clear?: ClearableConditionKey[],
) => void;
