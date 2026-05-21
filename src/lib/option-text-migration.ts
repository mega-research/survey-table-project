import { nanoid } from 'nanoid';
import type { QuestionOption, RankingAnswer } from '@/types/survey';

export interface LegacyQuestionShape {
  id: string;
  allowOtherOption?: boolean;
  options?: QuestionOption[];
}

export interface MigratedQuestionShape extends LegacyQuestionShape {
  migratedOtherOptionId: string | null;
}

export interface LegacyResponseShape {
  questionId: string;
  value: unknown;
  otherInputs?: Array<{ optionId: string; inputValue: string }>;
  optionTexts?: Record<string, string>;
}

export interface MigratedResponseShape {
  questionId: string;
  value: unknown;
  optionTexts?: Record<string, string>;
  otherInputs?: undefined;
}

/**
 * 옵션 개수가 N 개일 때 추가될 "기타" 옵션의 코드/변수번호 생성.
 * 10 개 이상이면 zero-pad 컨벤션은 기존 옵션들이 따르고 있을 것으로 가정 (그대로 다음 숫자).
 */
export function generateOtherOptionFields(existingOptionCount: number): {
  optionCode: string;
  spssNumericCode: number;
  variableNumber: string;
} {
  const nextNumber = existingOptionCount + 1;
  return {
    optionCode: String(nextNumber),
    spssNumericCode: nextNumber,
    variableNumber: String(nextNumber),
  };
}

/**
 * 질문의 allowOtherOption=true 를 마지막 옵션 append 로 변환.
 * idempotent: allowOtherOption 이 falsy 면 변환 안 함.
 * 반환된 객체는 새 객체 (입력 미변경).
 */
export function migrateQuestionOptions<T extends LegacyQuestionShape>(
  question: T,
): T & MigratedQuestionShape {
  if (!question.allowOtherOption) {
    return { ...question, migratedOtherOptionId: null };
  }

  const existing = question.options ?? [];
  const fields = generateOtherOptionFields(existing.length);
  const newOption: QuestionOption = {
    id: nanoid(10),
    label: '기타',
    value: fields.optionCode,
    optionCode: fields.optionCode,
    spssNumericCode: fields.spssNumericCode,
    allowTextInput: true,
  };

  return {
    ...question,
    allowOtherOption: undefined,
    options: [...existing, newOption],
    migratedOtherOptionId: newOption.id,
  };
}

/**
 * 단일 응답을 새 shape 로 변환.
 * - otherInputs[] -> optionTexts: Record<id, string>
 * - ranking 의 '__other__' -> 실제 옵션 ID + optionText
 * - mapping: { 기존 otherOption ID -> 마이그레이션된 새 옵션 ID }
 * - mapping 에 키가 없으면 value 그대로 유지 (방어적 -- production 데이터 보존)
 */
export function migrateResponseValue(
  response: LegacyResponseShape,
  otherIdMapping: Record<string, string>,
): MigratedResponseShape {
  const result: MigratedResponseShape = {
    questionId: response.questionId,
    value: response.value,
  };

  // ranking 응답: 배열 안에 RankingAnswer 객체들
  if (Array.isArray(response.value) && response.value.length > 0 && typeof response.value[0] === 'object') {
    const rankingItems = response.value as RankingAnswer[];
    result.value = rankingItems.map(item => {
      if (item.optionValue === '__other__') {
        const newId = otherIdMapping['__other__'] ?? item.optionValue;
        return {
          rank: item.rank,
          optionValue: newId,
          optionText: item.otherText,
        };
      }
      return { rank: item.rank, optionValue: item.optionValue };
    });
    return result;
  }

  // radio/select/checkbox 응답: value 가 string 또는 string[]
  // __other__ ID 를 실제 옵션 ID 로 치환 (mapping 에 없으면 untouched)
  if (typeof response.value === 'string' && otherIdMapping[response.value]) {
    result.value = otherIdMapping[response.value];
  } else if (Array.isArray(response.value)) {
    result.value = (response.value as string[]).map(v => otherIdMapping[v] ?? v);
  }

  // otherInputs -> optionTexts (빈 배열이면 변환 결과 없음)
  if (response.otherInputs && response.otherInputs.length > 0) {
    const optionTexts: Record<string, string> = { ...(response.optionTexts ?? {}) };
    for (const entry of response.otherInputs) {
      const newId = otherIdMapping[entry.optionId] ?? entry.optionId;
      optionTexts[newId] = entry.inputValue;
    }
    if (Object.keys(optionTexts).length > 0) {
      result.optionTexts = optionTexts;
    }
  } else if (response.optionTexts) {
    result.optionTexts = { ...response.optionTexts };
  }

  return result;
}

/**
 * 제출 시점 helper -- 선택된 옵션의 텍스트만 남기고 미선택 텍스트는 drop.
 * 빌더에서 "선택 해제 시 텍스트 유지" 정책을 따르므로, 클라이언트 상태에서는 보존되고
 * 제출 직전 이 함수로 정리.
 */
export function filterOptionTextsForSubmission(
  value: unknown,
  optionTexts: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!optionTexts) return undefined;

  const selectedIds = new Set<string>();
  if (typeof value === 'string') {
    selectedIds.add(value);
  } else if (Array.isArray(value)) {
    for (const v of value) {
      if (typeof v === 'string') {
        selectedIds.add(v);
      } else if (v && typeof v === 'object' && 'optionValue' in v) {
        selectedIds.add((v as { optionValue: string }).optionValue);
      }
    }
  }

  const filtered: Record<string, string> = {};
  for (const [optionId, text] of Object.entries(optionTexts)) {
    if (selectedIds.has(optionId) && text.trim().length > 0) {
      filtered[optionId] = text;
    }
  }

  return Object.keys(filtered).length > 0 ? filtered : undefined;
}
