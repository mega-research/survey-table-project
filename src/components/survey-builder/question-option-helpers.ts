import { nanoid } from 'nanoid';
import { generateId } from '@/lib/utils';
import { getMaxSpssCode, nextUniqueOptionNumber } from '@/utils/option-code-generator';
import { generateOtherOptionFields } from '@/lib/option-text-migration';
import { Question, QuestionOption, SelectLevel } from '@/types/survey';

/**
 * "+ 텍스트 옵션 추가" 버튼이 호출하는 헬퍼.
 * allowTextInput=true 옵션을 마지막에 append.
 * 코드/변수번호는 기존 옵션 수 기준 자동 부여 (사용자가 빌더에서 수정 가능).
 */
export function createTextInputOption(existingOptions: QuestionOption[]): QuestionOption {
  const fields = generateOtherOptionFields(existingOptions.length);
  // value 는 선택 응답 키라 목록 안에서 유일해야 한다 — 중간 삭제 이력이 있으면
  // length 기반 optionCode 가 기존 value 와 충돌할 수 있어 유일 번호로 발번.
  const value = String(nextUniqueOptionNumber(existingOptions, ''));
  return {
    id: nanoid(10),
    label: '',
    value,
    optionCode: fields.optionCode,
    spssNumericCode: fields.spssNumericCode,
    allowTextInput: true,
  };
}

export const OTHER_OPTION_ID = 'other-option';
export const OTHER_OPTION_LABEL = '기타';

export function addOtherOptionIfNeeded(options: QuestionOption[]): QuestionOption[] {
  const hasOtherOption = options.some((option) => option.id === OTHER_OPTION_ID);
  if (!hasOtherOption) {
    return [
      ...options,
      {
        id: OTHER_OPTION_ID,
        label: OTHER_OPTION_LABEL,
        value: 'other',
        hasOther: true,
        spssNumericCode: getMaxSpssCode(options) + 1,
      },
    ];
  }
  return options;
}

export function removeOtherOption(options: QuestionOption[]): QuestionOption[] {
  return options.filter((option) => option.id !== OTHER_OPTION_ID);
}

// --- 아래 함수들은 setFormData를 인자로 받아 상태를 업데이트하는 헬퍼 ---

type SetFormData = React.Dispatch<React.SetStateAction<Partial<Question>>>;

export function createAddOption(setFormData: SetFormData) {
  return () => {
    setFormData((prev) => {
      const existingOptions = prev.options || [];
      const optionNumber = nextUniqueOptionNumber(existingOptions, '옵션');
      const newOption: QuestionOption = {
        id: generateId(),
        label: `옵션 ${optionNumber}`,
        value: `옵션${optionNumber}`,
        spssNumericCode: getMaxSpssCode(existingOptions) + 1,
      };
      return {
        ...prev,
        options: [...existingOptions, newOption],
      };
    });
  };
}

// QuestionOption 중 undefined 허용(optional) 키만 clear 대상으로 한다.
export type OptionalOptionKey = {
  [K in keyof QuestionOption]-?: undefined extends QuestionOption[K] ? K : never;
}[keyof QuestionOption];

export function createUpdateOption(setFormData: SetFormData) {
  // clear: 자동 코드 복원처럼 optionCode 등을 비워야 할 때 키 자체를 제거한다.
  // exactOptionalPropertyTypes 하에서 spread로는 optional 키를 undefined로 둘 수 없기 때문.
  return (
    optionId: string,
    updates: Partial<QuestionOption>,
    clear?: OptionalOptionKey[],
  ) => {
    setFormData((prev) => {
      const next: Partial<Question> = { ...prev };
      if (prev.options !== undefined) {
        next.options = prev.options.map((option) => {
          if (option.id !== optionId) return option;
          const merged: QuestionOption = { ...option, ...updates };
          if (clear) {
            for (const key of clear) {
              delete merged[key];
            }
          }
          return merged;
        });
      }
      return next;
    });
  };
}

export function createRemoveOption(setFormData: SetFormData) {
  return (optionId: string) => {
    setFormData((prev) => {
      const next: Partial<Question> = { ...prev };
      if (prev.options !== undefined) {
        next.options = prev.options.filter((option) => option.id !== optionId);
      }
      return next;
    });
  };
}

export function createHandleOtherOptionToggle(setFormData: SetFormData) {
  return (enabled: boolean) => {
    setFormData((prev) => {
      const currentOptions = prev.options || [];
      const updatedOptions = enabled
        ? addOtherOptionIfNeeded(currentOptions)
        : removeOtherOption(currentOptions);

      return {
        ...prev,
        allowOtherOption: enabled,
        options: updatedOptions,
      };
    });
  };
}

export function createAddSelectLevel(setFormData: SetFormData) {
  return () => {
    setFormData((prev) => {
      const newLevel: SelectLevel = {
        id: generateId(),
        label: `레벨 ${(prev.selectLevels?.length || 0) + 1}`,
        placeholder: '',
        order: prev.selectLevels?.length || 0,
        options: [],
      };
      return {
        ...prev,
        selectLevels: [...(prev.selectLevels || []), newLevel],
      };
    });
  };
}

export function createUpdateSelectLevel(setFormData: SetFormData) {
  return (levelId: string, updates: Partial<SelectLevel>) => {
    setFormData((prev) => {
      const next: Partial<Question> = { ...prev };
      if (prev.selectLevels !== undefined) {
        next.selectLevels = prev.selectLevels.map((level) =>
          level.id === levelId ? { ...level, ...updates } : level,
        );
      }
      return next;
    });
  };
}

export function createRemoveSelectLevel(setFormData: SetFormData) {
  return (levelId: string) => {
    setFormData((prev) => {
      const next: Partial<Question> = { ...prev };
      if (prev.selectLevels !== undefined) {
        next.selectLevels = prev.selectLevels
          .filter((level) => level.id !== levelId)
          .map((level, index) => ({ ...level, order: index }));
      }
      return next;
    });
  };
}

export function createAddLevelOption(setFormData: SetFormData) {
  return (levelId: string) => {
    setFormData((prev) => {
      const level = prev.selectLevels?.find((l) => l.id === levelId);
      if (!level) return prev;

      const levelIndex = prev.selectLevels?.findIndex((l) => l.id === levelId) || 0;
      const optionCount = level.options?.length || 0;

      const newOption: QuestionOption = {
        id: generateId(),
        label: `옵션 ${optionCount + 1}`,
        value: levelIndex === 0 ? `옵션${optionCount + 1}` : `상위옵션-옵션${optionCount + 1}`,
        spssNumericCode: getMaxSpssCode(level.options) + 1,
      };

      const next: Partial<Question> = { ...prev };
      if (prev.selectLevels !== undefined) {
        next.selectLevels = prev.selectLevels.map((l) =>
          l.id === levelId ? { ...l, options: [...(l.options || []), newOption] } : l,
        );
      }
      return next;
    });
  };
}

export function createUpdateOptionWithParent(setFormData: SetFormData) {
  return (levelId: string, optionId: string, parentValue: string, optionLabel: string) => {
    const sanitizedLabel = optionLabel.trim();
    const autoValue = `${parentValue}-${sanitizedLabel}`;

    setFormData((prev) => {
      const next: Partial<Question> = { ...prev };
      if (prev.selectLevels !== undefined) {
        next.selectLevels = prev.selectLevels.map((level) =>
          level.id === levelId
            ? {
                ...level,
                options: level.options?.map((option) =>
                  option.id === optionId
                    ? { ...option, label: optionLabel, value: autoValue }
                    : option,
                ),
              }
            : level,
        );
      }
      return next;
    });
  };
}

export function getParentLevelOptions(
  selectLevels: SelectLevel[] | undefined,
  currentLevelIndex: number,
): QuestionOption[] {
  if (currentLevelIndex === 0) return [];
  const parentLevel = selectLevels?.[currentLevelIndex - 1];
  return parentLevel?.options || [];
}

export function createUpdateLevelOption(setFormData: SetFormData) {
  return (levelId: string, optionId: string, updates: Partial<QuestionOption>) => {
    setFormData((prev) => {
      const next: Partial<Question> = { ...prev };
      if (prev.selectLevels !== undefined) {
        next.selectLevels = prev.selectLevels.map((level) =>
          level.id === levelId
            ? {
                ...level,
                options: level.options?.map((option) =>
                  option.id === optionId ? { ...option, ...updates } : option,
                ),
              }
            : level,
        );
      }
      return next;
    });
  };
}

export function createRemoveLevelOption(setFormData: SetFormData) {
  return (levelId: string, optionId: string) => {
    setFormData((prev) => {
      const next: Partial<Question> = { ...prev };
      if (prev.selectLevels !== undefined) {
        next.selectLevels = prev.selectLevels.map((level) =>
          level.id === levelId
            ? {
                ...level,
                options: level.options?.filter((option) => option.id !== optionId),
              }
            : level,
        );
      }
      return next;
    });
  };
}
