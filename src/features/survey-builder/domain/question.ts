import * as z from 'zod';

import type { NewQuestion, Question } from '@/db/schema';
import type { PersistedQuestionField } from '@/db/schema/question-persisted-fields';
import { QUESTION_TYPES } from '@/types/question-types';
import type { Question as QuestionType } from '@/types/survey';

/**
 * 질문 CRUD 도메인 스키마.
 *
 * 복잡 JSONB 필드(options/selectLevels/tableColumns/tableRowsData/tableHeaderGrid/
 * tableValidationRules/dynamicRowConfigs/rankingConfig/choiceGroups/displayCondition)는 질문 유형마다
 * 형태가 제각각이라 z.custom 으로 타입만 보장한다(런타임 형태 변형 위험 방지).
 *
 * surveyId/questionId 는 기존 server action 과 동일하게 형식 검증 없이 받는다.
 * 모든 optional 필드는 원본 createQuestion/updateQuestion 시그니처를 1:1 보존한다
 * (불변식 A — 한 필드라도 누락하면 tsc 가 못 잡는 함정).
 */

// 타입 re-export (런타임 import 0)
export type { NewQuestion, Question };

/** 질문 생성 입력 — 원본 createQuestion(data) 시그니처와 동일. */
export const CreateQuestionInput = z.object({
  surveyId: z.string(),
  id: z.string().optional(),
  groupId: z.string().optional(),
  type: z.enum(QUESTION_TYPES),
  title: z.string(),
  description: z.string().optional(),
  required: z.boolean().optional(),
  order: z.number().optional(),
  options: z.custom<QuestionType['options']>().optional(),
  selectLevels: z.custom<QuestionType['selectLevels']>().optional(),
  tableTitle: z.string().optional(),
  tableColumns: z.custom<QuestionType['tableColumns']>().optional(),
  tableRowsData: z.custom<QuestionType['tableRowsData']>().optional(),
  tableHeaderGrid: z.custom<QuestionType['tableHeaderGrid']>().optional(),
  allowOtherOption: z.boolean().optional(),
  optionsColumns: z.number().optional(),
  optionsAlign: z.enum(['left', 'center', 'right']).optional(),
  minSelections: z.number().optional(),
  maxSelections: z.number().optional(),
  noticeContent: z.string().optional(),
  requiresAcknowledgment: z.boolean().optional(),
  placeholder: z.string().optional(),
  defaultValueTemplate: z.string().nullable().optional(),
  inputType: z.enum(['text', 'number']).optional(),
  emptyDefault: z.number().nullable().optional(),
  piiEncrypted: z.boolean().optional(),
  tableValidationRules: z.custom<QuestionType['tableValidationRules']>().optional(),
  displayCondition: z.custom<QuestionType['displayCondition']>().optional(),
  dynamicRowConfigs: z.custom<QuestionType['dynamicRowConfigs']>().optional(),
  hideColumnLabels: z.boolean().optional(),
  hideTitle: z.boolean().optional(),
  pageBreakBefore: z.boolean().optional(),
  rankingConfig: z.custom<QuestionType['rankingConfig']>().optional(),
  choiceGroups: z.custom<QuestionType['choiceGroups']>().optional(),
  questionCode: z.string().optional(),
  isCustomSpssVarName: z.boolean().optional(),
  exportLabel: z.string().optional(),
  spssVarType: z.string().optional(),
  spssMeasure: z.string().optional(),
});
export type CreateQuestionInput = z.infer<typeof CreateQuestionInput>;

/**
 * 질문 업데이트 입력 — 원본 updateQuestion(questionId, data) 화이트리스트와 동일.
 * groupId 는 명시적 null 로 ungroup 가능해야 하므로 nullable (undefined=미변경, null=해제).
 * type 은 의도적으로 부재 — 질문 type 은 생성 후 불변이며(변경 UI 없음),
 * 패치에 실려 와도 zod strip 으로 무시된다 (RPC 레벨 type 변경 구멍 봉인).
 */
export const UpdateQuestionData = z.object({
  groupId: z.string().nullable().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  required: z.boolean().optional(),
  order: z.number().optional(),
  options: z.custom<QuestionType['options']>().optional(),
  selectLevels: z.custom<QuestionType['selectLevels']>().optional(),
  tableTitle: z.string().optional(),
  tableColumns: z.custom<QuestionType['tableColumns']>().optional(),
  tableRowsData: z.custom<QuestionType['tableRowsData']>().optional(),
  tableHeaderGrid: z.custom<QuestionType['tableHeaderGrid']>().optional(),
  allowOtherOption: z.boolean().optional(),
  optionsColumns: z.number().optional(),
  optionsAlign: z.enum(['left', 'center', 'right']).optional(),
  minSelections: z.number().optional(),
  maxSelections: z.number().optional(),
  noticeContent: z.string().optional(),
  requiresAcknowledgment: z.boolean().optional(),
  placeholder: z.string().optional(),
  defaultValueTemplate: z.string().nullable().optional(),
  inputType: z.enum(['text', 'number']).optional(),
  emptyDefault: z.number().nullable().optional(),
  piiEncrypted: z.boolean().optional(),
  tableValidationRules: z.custom<QuestionType['tableValidationRules']>().optional(),
  dynamicRowConfigs: z.custom<QuestionType['dynamicRowConfigs']>().optional(),
  hideColumnLabels: z.boolean().optional(),
  hideTitle: z.boolean().optional(),
  pageBreakBefore: z.boolean().optional(),
  rankingConfig: z.custom<QuestionType['rankingConfig']>().optional(),
  choiceGroups: z.custom<QuestionType['choiceGroups']>().optional(),
  displayCondition: z.custom<QuestionType['displayCondition']>().optional(),
  questionCode: z.string().optional(),
  isCustomSpssVarName: z.boolean().optional(),
  exportLabel: z.string().optional(),
  spssVarType: z.string().optional(),
  spssMeasure: z.string().optional(),
});
export type UpdateQuestionData = z.infer<typeof UpdateQuestionData>;

// surveyId 는 WS-2 IDOR 봉인용 — service WHERE 스코프로 전달된다.
export const UpdateQuestionInput = z.object({
  questionId: z.string(),
  surveyId: z.string(),
  data: UpdateQuestionData,
});
export type UpdateQuestionInput = z.infer<typeof UpdateQuestionInput>;

// ── 영속 필드 커버리지 컴파일 프로브 ──────────────────────────────
// 신규 영속 컬럼이 PERSISTED_QUESTION_FIELDS 에 등재되면 아래 return 할당이
// 컴파일 에러가 되어 create/update 스키마 누락(H17 류 silent strip 손실)을 차단한다.

/** Create 스키마가 영속 필드 전부를 입력으로 받는지의 컴파일 검사. */
export function assertCreateSchemaCoversPersistedFields(
  field: PersistedQuestionField,
): keyof CreateQuestionInput {
  return field;
}

/** Update 스키마가 영속 필드(생성 후 불변인 type 제외)를 전부 받는지의 컴파일 검사. */
export function assertUpdateSchemaCoversPersistedFields(
  field: Exclude<PersistedQuestionField, 'type'>,
): keyof UpdateQuestionData {
  return field;
}

export const DeleteQuestionInput = z.object({
  questionId: z.string(),
  surveyId: z.string(),
});
export type DeleteQuestionInput = z.infer<typeof DeleteQuestionInput>;

export const ReorderQuestionsInput = z.object({
  questionIds: z.array(z.string()),
  surveyId: z.string(),
});
export type ReorderQuestionsInput = z.infer<typeof ReorderQuestionsInput>;

/** create/update 반환행 — db select 행(JSONB 포함)을 그대로 노출. */
export const QuestionRow = z.custom<Question>();
export type QuestionRow = z.infer<typeof QuestionRow>;

/** delete/reorder 공통 출력 */
export const QuestionMutationOutput = z.object({ ok: z.literal(true) });
export type QuestionMutationOutput = z.infer<typeof QuestionMutationOutput>;
