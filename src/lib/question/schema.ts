import * as z from 'zod';

import { MOBILE_TABLE_DISPLAY_MODES } from '@/types/mobile-table-display';
import { QUESTION_TYPES } from '@/types/question-types';
import type { Question } from '@/types/survey';

import type {
  CheckboxQuestion,
  MultiselectQuestion,
  NoticeQuestion,
  QuestionVariant,
  RadioQuestion,
  RankingQuestion,
  SelectQuestion,
  TableQuestion,
  TextQuestion,
  TextareaQuestion,
} from './variants';

/**
 * Question variant 의 zod 런타임 스키마.
 *
 * - JSONB 복합 필드는 z.custom 으로 타입만 고정한다 (깊이 2 경계 — 내부 형태의
 *   런타임 검증은 후속 단계, features/* /domain 의 기존 컨벤션과 동일).
 * - z.object 의 기본 strip 동작이 곧 오염 흡수 메커니즘이다: 스냅샷·편집 모달이
 *   심어 놓은 cross-type 키(예: radio 행의 noticeContent)는 strict parse 시 소거된다.
 * - variants.ts(TS)와 이 파일(zod)의 키셋 드리프트는 아래 QuestionSchemaDriftGates 가
 *   컴파일로 차단한다. JSONB 복합 필드의 값 타입은 양쪽 모두 flat Question 에서
 *   끌어와 원천 동일하지만, enum 리프(spssVarType/spssMeasure/inputType)는 z.enum
 *   으로 어휘를 재기술한다 — 이쪽 드리프트는 QuestionEnumLeafGates 가 차단한다.
 */

const base = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  required: z.boolean(),
  groupId: z.string().optional(),
  order: z.number(),
  displayCondition: z.custom<NonNullable<Question['displayCondition']>>().optional(),
  questionCode: z.string().optional(),
  isCustomSpssVarName: z.boolean().optional(),
  exportLabel: z.string().optional(),
  spssVarType: z.enum(['Numeric', 'String', 'Date', 'DateTime']).optional(),
  spssMeasure: z.enum(['Nominal', 'Ordinal', 'Continuous']).optional(),
});

const embeddedTable = z.object({
  tableTitle: z.string().optional(),
  tableColumns: z.custom<NonNullable<Question['tableColumns']>>().optional(),
  tableRowsData: z.custom<NonNullable<Question['tableRowsData']>>().optional(),
  tableHeaderGrid: z.custom<NonNullable<Question['tableHeaderGrid']>>().optional(),
  hideColumnLabels: z.boolean().optional(),
});

const choiceGroups = z.object({
  choiceGroups: z.custom<NonNullable<Question['choiceGroups']>>().optional(),
});

const optionList = z.object({
  options: z.custom<NonNullable<Question['options']>>().optional(),
  optionsColumns: z.number().optional(),
  optionsAlign: z.enum(['left', 'center', 'right']).optional(),
  allowOtherOption: z.boolean().optional(),
});

const mobileTableDisplay = z.object({
  mobileOriginalTable: z.boolean().optional(),
  mobileTableDisplayMode: z.enum(MOBILE_TABLE_DISPLAY_MODES).optional().catch(undefined),
  mobileDrilldownOmitLeadingColumns: z.number().int().min(0).optional(),
  mobileDrilldownRepeatHeaderStartRow: z.number().int().min(0).nullable().optional().catch(undefined),
  mobileDrilldownRepeatHeaderEndRow: z.number().int().min(0).nullable().optional().catch(undefined),
});

export const TextQuestionSchema = base.extend({
  type: z.literal('text'),
  placeholder: z.string().optional(),
  defaultValueTemplate: z.string().nullable().optional(),
  inputType: z.enum(['text', 'number']).optional(),
  emptyDefault: z.number().optional(),
});

export const TextareaQuestionSchema = base.extend({
  type: z.literal('textarea'),
});

export const RadioQuestionSchema = base
  .extend(optionList.shape)
  .extend(embeddedTable.shape)
  .extend(mobileTableDisplay.shape)
  .extend(choiceGroups.shape)
  .extend({ type: z.literal('radio') });

export const CheckboxQuestionSchema = base
  .extend(optionList.shape)
  .extend(embeddedTable.shape)
  .extend(mobileTableDisplay.shape)
  .extend(choiceGroups.shape)
  .extend({
    type: z.literal('checkbox'),
    minSelections: z.number().optional(),
    maxSelections: z.number().optional(),
  });

export const SelectQuestionSchema = base.extend({
  type: z.literal('select'),
  options: z.custom<NonNullable<Question['options']>>().optional(),
  allowOtherOption: z.boolean().optional(),
});

export const MultiselectQuestionSchema = base.extend({
  type: z.literal('multiselect'),
  selectLevels: z.custom<NonNullable<Question['selectLevels']>>().optional(),
});

export const RankingQuestionSchema = base
  .extend(optionList.shape)
  .extend(embeddedTable.shape)
  .extend(choiceGroups.shape)
  .extend({
    type: z.literal('ranking'),
    rankingConfig: z.custom<NonNullable<Question['rankingConfig']>>().optional(),
  });

export const TableQuestionSchema = base
  .extend(embeddedTable.shape)
  .extend(mobileTableDisplay.shape)
  .extend({
    type: z.literal('table'),
    tableValidationRules: z.custom<NonNullable<Question['tableValidationRules']>>().optional(),
    dynamicRowConfigs: z.custom<NonNullable<Question['dynamicRowConfigs']>>().optional(),
  });

export const NoticeQuestionSchema = base.extend({
  type: z.literal('notice'),
  noticeContent: z.string().optional(),
  requiresAcknowledgment: z.boolean().optional(),
});

export const QuestionVariantSchema = z.discriminatedUnion('type', [
  TextQuestionSchema,
  TextareaQuestionSchema,
  RadioQuestionSchema,
  CheckboxQuestionSchema,
  SelectQuestionSchema,
  MultiselectQuestionSchema,
  RankingQuestionSchema,
  TableQuestionSchema,
  NoticeQuestionSchema,
]);

// ── 드리프트 게이트 ───────────────────────────────────────────────
// TS variant(variants.ts)와 zod 스키마의 "키셋" 동치를 컴파일로 강제한다.
// optional 정밀도(exactOptionalPropertyTypes ↔ zod `T | undefined`)는 의도적으로
// 비교하지 않는다 — 값 타입의 출처가 양쪽 모두 flat Question 이라 드리프트 축은 키셋뿐.
type Expect<T extends true> = T;
type KeysEqual<A, B> = [Exclude<keyof A, keyof B>] extends [never]
  ? [Exclude<keyof B, keyof A>] extends [never]
    ? true
    : false
  : false;

export type QuestionSchemaDriftGates = [
  Expect<KeysEqual<z.output<typeof TextQuestionSchema>, TextQuestion>>,
  Expect<KeysEqual<z.output<typeof TextareaQuestionSchema>, TextareaQuestion>>,
  Expect<KeysEqual<z.output<typeof RadioQuestionSchema>, RadioQuestion>>,
  Expect<KeysEqual<z.output<typeof CheckboxQuestionSchema>, CheckboxQuestion>>,
  Expect<KeysEqual<z.output<typeof SelectQuestionSchema>, SelectQuestion>>,
  Expect<KeysEqual<z.output<typeof MultiselectQuestionSchema>, MultiselectQuestion>>,
  Expect<KeysEqual<z.output<typeof RankingQuestionSchema>, RankingQuestion>>,
  Expect<KeysEqual<z.output<typeof TableQuestionSchema>, TableQuestion>>,
  Expect<KeysEqual<z.output<typeof NoticeQuestionSchema>, NoticeQuestion>>,
  // 판별자 어휘가 QUESTION_TYPES 와 동치인지 (union 옵션 누락/과잉 차단)
  Expect<KeysEqual<Record<z.output<typeof QuestionVariantSchema>['type'], 0>, Record<(typeof QUESTION_TYPES)[number], 0>>>,
  Expect<KeysEqual<Record<QuestionVariant['type'], 0>, Record<(typeof QUESTION_TYPES)[number], 0>>>,
];

// enum 리프는 z.enum 으로 어휘를 재기술하므로 키셋 게이트가 못 잡는다 —
// 리터럴 union 의 상호 할당 가능성으로 flat Question 과의 어휘 동치를 강제한다.
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export type QuestionEnumLeafGates = [
  Expect<MutuallyAssignable<z.output<typeof base>['spssVarType'], Question['spssVarType'] | undefined>>,
  Expect<MutuallyAssignable<z.output<typeof base>['spssMeasure'], Question['spssMeasure'] | undefined>>,
  Expect<MutuallyAssignable<z.output<typeof TextQuestionSchema>['inputType'], Question['inputType'] | undefined>>,
];
