import type { QuestionType } from '@/types/survey';

/**
 * 질문 유형 어휘의 런타임 SoT.
 *
 * QuestionType(타입 전용 리터럴 union)과 이 배열의 동치는 아래 두 방향의
 * 컴파일 검사로 강제된다 — 어느 쪽에 리터럴을 추가/삭제해도 tsc 가 어긋남을 잡는다.
 * features/* /domain 의 zod 스키마(z.enum)와 분기 헬퍼가 공유하는 단일 출처이며,
 * 의존성 0 인 const 전용 모듈이라 domain 계층에서 import 해도 안전하다.
 */
export const QUESTION_TYPES = [
  'text',
  'textarea',
  'radio',
  'checkbox',
  'select',
  'multiselect',
  'ranking',
  'table',
  'notice',
] as const satisfies readonly QuestionType[];

// 역방향 포함 검사 — QuestionType 에 새 리터럴이 생기면 아래 return 할당이 컴파일 에러가 된다.
// (satisfies 는 QUESTION_TYPES ⊆ QuestionType 만 보장하므로 반대 방향은 캐스트 없는 할당으로 강제)
export function toRegisteredQuestionType(type: QuestionType): (typeof QUESTION_TYPES)[number] {
  return type;
}

/**
 * 내장 테이블 capability — 자기 자신의 tableRowsData/tableColumns 를 정식 소비하는 유형.
 * table 본연 + radio/checkbox(choice_opt 옵션 소스) + ranking(optionsSource='table' 의 ranking_opt).
 */
export const EMBEDDED_TABLE_TYPES = [
  'radio',
  'checkbox',
  'ranking',
  'table',
] as const satisfies readonly QuestionType[];

/** choiceGroups(테이블 레벨 옵션 그룹)를 소비하는 유형 — table 은 정의만 있고 소비 경로가 없다. */
export const CHOICE_GROUP_TYPES = [
  'radio',
  'checkbox',
  'ranking',
] as const satisfies readonly QuestionType[];

/** question.options 배열을 옵션 소스로 쓰는 유형 (ranking 은 optionsSource='manual' 일 때). */
export const OPTION_LIST_TYPES = [
  'radio',
  'checkbox',
  'select',
  'ranking',
] as const satisfies readonly QuestionType[];

/** 옵션에 optionCode/spssNumericCode 가 발번되는 선택 컨트롤 유형 (SPSS hydrate·코드 정리 대상). */
export const CODED_CHOICE_TYPES = [
  'radio',
  'checkbox',
  'select',
  'multiselect',
] as const satisfies readonly QuestionType[];

export type EmbeddedTableType = (typeof EMBEDDED_TABLE_TYPES)[number];
export type ChoiceGroupType = (typeof CHOICE_GROUP_TYPES)[number];
export type OptionListType = (typeof OPTION_LIST_TYPES)[number];
export type CodedChoiceType = (typeof CODED_CHOICE_TYPES)[number];

export function isQuestionTypeValue(value: string): value is QuestionType {
  return (QUESTION_TYPES as readonly string[]).includes(value);
}

export function isEmbeddedTableType(type: QuestionType): type is EmbeddedTableType {
  return (EMBEDDED_TABLE_TYPES as readonly QuestionType[]).includes(type);
}

export function isChoiceGroupType(type: QuestionType): type is ChoiceGroupType {
  return (CHOICE_GROUP_TYPES as readonly QuestionType[]).includes(type);
}

export function isOptionListType(type: QuestionType): type is OptionListType {
  return (OPTION_LIST_TYPES as readonly QuestionType[]).includes(type);
}

export function isCodedChoiceType(type: QuestionType): type is CodedChoiceType {
  return (CODED_CHOICE_TYPES as readonly QuestionType[]).includes(type);
}
