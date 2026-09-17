import { nanoid } from 'nanoid';
import type { Question, QuestionOption, RankingAnswer } from '@/types/survey';

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

  const { allowOtherOption: _ao, ...questionWithoutOther } = question;
  // allowOtherOption 은 마이그레이션으로 옵션에 흡수되어 결과에서 제거된다(테스트가 undefined 기대).
  // Omit<T, 'allowOtherOption'> 는 제네릭 T 와 구조적으로 동일함을 TS 가 증명하지 못하므로,
  // 런타임상 정확히 일치하는 선언된 반환 타입으로 좁혀 단언한다.
  return {
    ...questionWithoutOther,
    options: [...existing, newOption],
    migratedOtherOptionId: newOption.id,
  } as T & MigratedQuestionShape;
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

interface SnapshotQuestion extends LegacyQuestionShape {
  type?: string;
  tableRowsData?: Array<{
    id: string;
    cells: Array<{
      id: string;
      type?: string;
      allowOtherOption?: boolean;
      radioOptions?: QuestionOption[];
      checkboxOptions?: QuestionOption[];
      selectOptions?: QuestionOption[];
    }>;
  }>;
}

export interface MigratedSnapshot {
  questions: SnapshotQuestion[];
  /** questionId -> __other__ ID -> 새 옵션 ID */
  otherIdMappings: Record<string, Record<string, string>>;
  /** questionId -> cellId -> '__other__' -> 새 옵션 ID (테이블 셀 레벨) */
  cellOtherIdMappings: Record<string, Record<string, Record<string, string>>>;
}

/**
 * snapshot 전체(질문 리스트 + 테이블 셀)를 순회해 allowOtherOption 을 실제 옵션으로 변환.
 * 입력 미변경(immutable). otherIdMappings 는 Task 6 runner 가 응답 데이터 치환에 사용.
 */
export function migrateSnapshotQuestions(snapshot: {
  questions: SnapshotQuestion[];
}): MigratedSnapshot {
  const otherIdMappings: Record<string, Record<string, string>> = {};
  const cellOtherIdMappings: Record<string, Record<string, Record<string, string>>> = {};

  const migrated = snapshot.questions.map(question => {
    const updated: SnapshotQuestion = { ...question };

    // 1. 질문 레벨 옵션 마이그레이션
    if (question.allowOtherOption) {
      const r = migrateQuestionOptions(question);
      if (r.options !== undefined) {
        updated.options = r.options;
      }
      delete updated.allowOtherOption;
      if (r.migratedOtherOptionId) {
        otherIdMappings[question.id] = { '__other__': r.migratedOtherOptionId };
      }
    }

    // 2. 테이블 셀 옵션 마이그레이션
    if (question.tableRowsData) {
      updated.tableRowsData = question.tableRowsData.map(row => ({
        ...row,
        cells: row.cells.map(cell => {
          if (!cell.allowOtherOption) return cell;

          // 비옵션 셀 타입 (text, image 등) 은 방어적으로 skip
          if (cell.type !== 'radio' && cell.type !== 'checkbox' && cell.type !== 'select') {
            return cell;
          }

          const optionsField =
            cell.type === 'checkbox' ? 'checkboxOptions' :
            cell.type === 'radio' ? 'radioOptions' :
            'selectOptions';
          const existing = cell[optionsField] ?? [];
          const fields = generateOtherOptionFields(existing.length);
          const newOption: QuestionOption = {
            id: nanoid(10),
            label: '기타',
            value: fields.optionCode,
            optionCode: fields.optionCode,
            spssNumericCode: fields.spssNumericCode,
            allowTextInput: true,
          };

          // cellOtherIdMappings 에 새 옵션 ID 기록
          if (!cellOtherIdMappings[question.id]) {
            cellOtherIdMappings[question.id] = {};
          }
          const questionMap = cellOtherIdMappings[question.id];
          if (questionMap && !questionMap[cell.id]) {
            questionMap[cell.id] = {};
          }
          const cellMap = questionMap?.[cell.id];
          if (cellMap) {
            cellMap['__other__'] = newOption.id;
          }

          const { allowOtherOption: _cellAo, ...cellWithout } = cell;
          return {
            ...cellWithout,
            [optionsField]: [...existing, newOption],
          };
        }),
      }));
    }

    return updated;
  });

  return { questions: migrated, otherIdMappings, cellOtherIdMappings };
}

/** 응답 value에서 선택된 option id 집합을 수집한다. */
export function collectSelectedOptionIds(
  value: unknown,
  options?: { id: string; value: string }[],
): Set<string> {
  const selectedValues = new Set<string>();

  const collect = (candidate: unknown) => {
    if (typeof candidate === 'string') {
      selectedValues.add(candidate);
    } else if (Array.isArray(candidate)) {
      candidate.forEach(collect);
    } else if (candidate && typeof candidate === 'object') {
      if ('optionValue' in candidate && typeof candidate.optionValue === 'string') {
        selectedValues.add(candidate.optionValue);
      } else {
        Object.entries(candidate).forEach(([key, entry]) => {
          if (key !== '__optTexts__') collect(entry);
        });
      }
    }
  };

  collect(value);

  if (!options || options.length === 0) return selectedValues;

  const selectedIds = new Set<string>();
  for (const option of options) {
    if (selectedValues.has(option.value)) selectedIds.add(option.id);
  }
  return selectedIds;
}

/**
 * 제출 시점 helper -- 선택된 옵션의 텍스트만 남기고 미선택 텍스트는 drop.
 * 빌더에서 "선택 해제 시 텍스트 유지" 정책을 따르므로, 클라이언트 상태에서는 보존되고
 * 제출 직전 이 함수로 정리.
 *
 * @param value - 응답 value. radio/select 는 option.value (string), checkbox 는 option.value[],
 *   ranking 은 RankingAnswer[]. optionTexts key 가 option.id 이고 value 가 option.value 인 경우
 *   options 배열을 전달해야 정확한 매칭이 가능하다.
 * @param optionTexts - questionId 단위 옵션 텍스트 (key = option.id)
 * @param options - (선택) 질문의 options 배열. 전달 시 value(option.value) → id(option.id) 변환에 사용.
 *   전달하지 않으면 value 를 직접 key 로 비교한다 (하위 호환).
 */
export function filterOptionTextsForSubmission(
  value: unknown,
  optionTexts: Record<string, string> | undefined,
  options?: { id: string; value: string }[],
): Record<string, string> | undefined {
  if (!optionTexts) return undefined;
  const selectedIds = collectSelectedOptionIds(value, options);

  const filtered: Record<string, string> = {};
  for (const [optionId, text] of Object.entries(optionTexts)) {
    if (selectedIds.has(optionId) && text.trim().length > 0) {
      filtered[optionId] = text;
    }
  }

  return Object.keys(filtered).length > 0 ? filtered : undefined;
}

/**
 * 테이블 질문의 모든 셀(radio/checkbox/select) 옵션을 {id, value} 페어로 모은다.
 * 같은 id 중복은 한 번만 포함. filterOptionTextsForSubmission 에 전달해
 * 테이블 셀 응답에서도 option.value → option.id 변환이 가능하도록 한다.
 */
export function collectTableQuestionOptions(question: Question): { id: string; value: string }[] {
  if (!question.tableRowsData || question.tableRowsData.length === 0) return [];
  const result: { id: string; value: string }[] = [];
  const seen = new Set<string>();
  for (const row of question.tableRowsData) {
    if (!row.cells) continue;
    for (const cell of row.cells) {
      const cellOpts = [
        ...(cell.radioOptions ?? []),
        ...(cell.checkboxOptions ?? []),
        ...(cell.selectOptions ?? []),
      ];
      for (const opt of cellOpts) {
        if (seen.has(opt.id)) continue;
        seen.add(opt.id);
        result.push({ id: opt.id, value: opt.value ?? opt.id });
      }
    }
  }
  return result;
}
