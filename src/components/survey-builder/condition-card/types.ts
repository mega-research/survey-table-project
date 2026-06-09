import { QuestionCondition } from '@/types/survey';

// tableConditions/additionalConditions는 expression 전환·토글 해제 시 비워야 한다.
// exactOptionalPropertyTypes 하에서 spread로는 키 제거가 불가하므로 clear 인자로 명시한다.
export type ClearableConditionKey = 'tableConditions' | 'additionalConditions';

export type UpdateConditionFn = (
  conditionId: string,
  updates: Partial<QuestionCondition>,
  clear?: ClearableConditionKey[],
) => void;
